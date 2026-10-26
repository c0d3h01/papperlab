package tools

import (
	"archive/zip"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/color"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"

	"paperlab/internal/engine"
)

func pdfConf(password string) *model.Configuration {
	conf := model.NewDefaultConfiguration()
	conf.ValidationMode = model.ValidationRelaxed
	if password != "" {
		conf.UserPW = password
		conf.OwnerPW = password
	}
	return conf
}

func (c *Context) Password() string {
	return c.Str("password", "")
}

func pageCount(path, password string) (int, error) {
	n, err := api.PageCountFile(context.Background(), path)
	if err != nil {
		// Retry through a configured context for encrypted documents.
		f, ferr := os.Open(path)
		if ferr != nil {
			return 0, err
		}
		defer f.Close()
		n, err = api.PageCount(context.Background(), f, pdfConf(password))
	}
	return n, err
}

func pageDims(path, password string) ([]PageSize, int, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, err
	}
	defer f.Close()
	dims, err := api.PageDims(context.Background(), f, pdfConf(password))
	if err != nil {
		return nil, 0, err
	}
	out := make([]PageSize, 0, len(dims))
	for _, d := range dims {
		out = append(out, PageSize{Width: d.Width, Height: d.Height})
	}
	return out, len(dims), nil
}

func (c *Context) inputPDFs() []Input {
	var out []Input
	for _, in := range c.Inputs {
		if in.Role == "" || in.Role == "files" {
			out = append(out, in)
		}
	}
	return out
}

func (c *Context) requirePDFs(min int) ([]Input, error) {
	ins := c.inputPDFs()
	if len(ins) < min {
		return nil, fmt.Errorf("this tool needs at least %d PDF file(s)", min)
	}
	for _, in := range ins {
		if !strings.EqualFold(filepath.Ext(in.Name), ".pdf") {
			return nil, fmt.Errorf("%s is not a PDF", in.Name)
		}
	}
	return ins, nil
}

func (c *Context) requireFiles(min int, exts ...string) ([]Input, error) {
	ins := c.inputPDFs()
	if len(ins) < min {
		return nil, fmt.Errorf("this tool needs at least %d file(s)", min)
	}
	allowed := map[string]bool{}
	for _, e := range exts {
		allowed[strings.ToLower(e)] = true
	}
	if len(allowed) > 0 {
		for _, in := range ins {
			if !allowed[strings.ToLower(filepath.Ext(in.Name))] {
				return nil, fmt.Errorf("%s: unsupported file type", in.Name)
			}
		}
	}
	return ins, nil
}

// selectedPages turns a page option into pdfcpu page-selection tokens.
func (c *Context) selectedPages(key string, pages int) ([]string, error) {
	raw := c.Str(key, "all")
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.EqualFold(raw, "all") || raw == "*" {
		return nil, nil
	}
	raw = strings.ReplaceAll(raw, " ", "")
	parts := strings.Split(raw, ",")
	sel := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, err := api.PagesForSelection(pages, []string{part}, true); err != nil {
			return nil, fmt.Errorf("invalid page selection %q", part)
		}
		sel = append(sel, part)
	}
	if len(sel) == 0 {
		return nil, fmt.Errorf("enter at least one page or range")
	}
	return sel, nil
}

func parseRanges(raw string, pages int) ([][]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("enter at least one page range")
	}
	parts := strings.Split(raw, ",")
	var out [][]string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, err := api.PagesForSelection(pages, []string{p}, true); err != nil {
			return nil, fmt.Errorf("invalid page range %q", p)
		}
		out = append(out, []string{p})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("enter at least one page range")
	}
	return out, nil
}

func splitEvery(pages, span int) [][]string {
	if span < 1 {
		span = 1
	}
	var out [][]string
	for from := 1; from <= pages; from += span {
		thru := from + span - 1
		if thru > pages {
			thru = pages
		}
		if from == thru {
			out = append(out, []string{strconv.Itoa(from)})
		} else {
			out = append(out, []string{fmt.Sprintf("%d-%d", from, thru)})
		}
	}
	return out
}

func pageGroups(c *Context, pages int) ([][]string, error) {
	mode := c.Str("mode", "ranges")
	switch mode {
	case "each":
		return splitEvery(pages, 1), nil
	case "every":
		return splitEvery(pages, c.Int("every", 1)), nil
	case "bookmarks":
		return nil, fmt.Errorf("bookmark splitting requires the bookmark mode")
	default:
		return parseRanges(c.Str("ranges", ""), pages)
	}
}

func zipFiles(outPath string, files []string) error {
	f, err := os.Create(outPath)
	if err != nil {
		return err
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	seen := map[string]int{}
	for _, path := range files {
		st, err := os.Stat(path)
		if err != nil || st.IsDir() {
			continue
		}
		name := safeFileName(filepath.Base(path))
		if n, ok := seen[name]; ok {
			seen[name] = n + 1
			ext := filepath.Ext(name)
			name = fmt.Sprintf("%s-%d%s", strings.TrimSuffix(name, ext), n+1, ext)
		} else {
			seen[name] = 1
		}
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		src, err := os.Open(path)
		if err != nil {
			return err
		}
		_, err = io.Copy(w, src)
		src.Close()
		if err != nil {
			return err
		}
	}
	return zw.Close()
}

func readText(path, password string) (string, error) {
	bin := findTool("pdftotext")
	if bin == "" {
		return "", fmt.Errorf("pdftotext is not installed")
	}
	out := path + ".txt"
	args := []string{"-layout", "-enc", "UTF-8"}
	if password != "" {
		args = append(args, "-upw", password)
	}
	args = append(args, path, out)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if _, err := engine.Run(ctx, bin, args...); err != nil {
		// A scanned PDF can legitimately produce no text; keep the empty file.
		if _, statErr := os.Stat(out); statErr != nil {
			return "", err
		}
	}
	b, err := os.ReadFile(out)
	if err != nil {
		return "", err
	}
	_ = os.Remove(out)
	return strings.ReplaceAll(string(b), "\r\n", "\n"), nil
}

func readTextPages(path, password string) ([]string, error) {
	text, err := readText(path, password)
	if err != nil {
		return nil, err
	}
	parts := strings.Split(text, "\f")
	for len(parts) > 0 && strings.TrimSpace(parts[len(parts)-1]) == "" {
		parts = parts[:len(parts)-1]
	}
	return parts, nil
}

func findTool(name string) string {
	return engine.FindTool(name)
}

func runTool(ctx context.Context, name string, args ...string) (string, error) {
	bin := findTool(name)
	if bin == "" {
		return "", fmt.Errorf("%s is not installed", name)
	}
	return engine.Run(ctx, bin, args...)
}

func writeText(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o600)
}

func dataURLToFile(dataURL, path string) error {
	comma := strings.Index(dataURL, ",")
	if comma < 0 {
		return fmt.Errorf("invalid image data")
	}
	header := dataURL[:comma]
	payload := dataURL[comma+1:]
	var raw []byte
	var err error
	if strings.Contains(header, ";base64") {
		raw, err = base64.StdEncoding.DecodeString(payload)
	} else {
		raw = []byte(payload)
	}
	if err != nil {
		return fmt.Errorf("invalid image data: %w", err)
	}
	if len(raw) > 20*1024*1024 {
		return fmt.Errorf("image is too large")
	}
	return os.WriteFile(path, raw, 0o600)
}

var hexColor = regexp.MustCompile(`^#?([0-9a-fA-F]{6})$`)

func parseColor(raw string, fallback uint32) uint32 {
	m := hexColor.FindStringSubmatch(strings.TrimSpace(raw))
	if m == nil {
		return fallback
	}
	v, err := strconv.ParseUint(m[1], 16, 32)
	if err != nil {
		return fallback
	}
	return uint32(v)
}

func simpleColor(rgb uint32) *color.SimpleColor {
	c := color.NewSimpleColor(rgb)
	return &c
}

func normalizePageToken(tok string) string {
	return strings.ReplaceAll(strings.TrimSpace(tok), " ", "")
}

func sortedUniqueInts(in []int) []int {
	set := map[int]bool{}
	var out []int
	for _, n := range in {
		if !set[n] {
			set[n] = true
			out = append(out, n)
		}
	}
	sort.Ints(out)
	return out
}

func pageSelectionFromInts(pages []int, total int) ([]string, error) {
	var tokens []string
	for _, p := range pages {
		if p < 1 || p > total {
			return nil, fmt.Errorf("page %d is outside this document", p)
		}
		tokens = append(tokens, strconv.Itoa(p))
	}
	return tokens, nil
}

func (c *Context) infoFor(path, password string) (*pdfcpu.PDFInfo, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return api.PDFInfo(c.Ctx, f, filepath.Base(path), nil, false, pdfConf(password))
}

const maxImagePixels = 64_000_000

func (c *Context) pageSizes(path string) ([]PageSize, int, error) {
	return pageDims(path, c.Password())
}

func checkImageConfig(cfg image.Config) error {
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return fmt.Errorf("could not read image dimensions")
	}
	if cfg.Width > maxImagePixels || cfg.Height > maxImagePixels ||
		int64(cfg.Width) > int64(maxImagePixels)/int64(cfg.Height) {
		return fmt.Errorf("image is too large (maximum %d megapixels)", maxImagePixels/1_000_000)
	}
	return nil
}

func decodeImageConfig(path string) (image.Config, string, error) {
	f, err := os.Open(path)
	if err != nil {
		return image.Config{}, "", err
	}
	defer f.Close()
	cfg, format, err := image.DecodeConfig(f)
	if err != nil {
		return image.Config{}, "", err
	}
	if err := checkImageConfig(cfg); err != nil {
		return image.Config{}, "", err
	}
	return cfg, format, nil
}

// decodeImage checks the declared dimensions before allocating the full bitmap.
func decodeImage(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return nil, err
	}
	if err := checkImageConfig(cfg); err != nil {
		return nil, err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	img, _, err := image.Decode(f)
	return img, err
}

func pageToken(n int) string { return strconv.Itoa(n) }

func selectedOrDefault(sel []string) []string { return sel }

// pdfcpuTypesRect builds a rectangle from top-left coordinates in points.
func pdfcpuTypesRect(x, y, w, h float64, pageHeight float64) *types.Rectangle {
	return types.NewRectangle(x, pageHeight-y-h, x+w, pageHeight-y)
}
