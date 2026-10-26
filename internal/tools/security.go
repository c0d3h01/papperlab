package tools

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-pdf/fpdf"
	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/sergi/go-diff/diffmatchpatch"
)

func init() {
	Register(&Tool{
		ID: "protect", Name: "Protect PDF", Group: "security",
		Description: "Encrypt a PDF with a password and granular permissions.",
		Run:         protectPDF,
	})
	Register(&Tool{
		ID: "unlock", Name: "Unlock PDF", Group: "security",
		Description: "Remove password protection from documents you own.",
		Run:         unlockPDF,
	})
	Register(&Tool{
		ID: "redact", Name: "Redact PDF", Group: "security",
		Description: "Permanently remove sensitive text and regions by rasterizing.",
		Requires:    []string{"poppler"},
		Run:         redactPDF,
	})
	Register(&Tool{
		ID: "compare", Name: "Compare PDF", Group: "security",
		Description: "Side-by-side visual and text comparison with change highlights.",
		Requires:    []string{"poppler"},
		Run:         comparePDF,
	})
}

func protectPDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	userPW := c.Str("userPassword", "")
	if strings.TrimSpace(userPW) == "" {
		return fmt.Errorf("choose a password to open the document")
	}
	ownerPW := c.Str("ownerPassword", "")
	if ownerPW == "" {
		ownerPW = userPW + "-owner-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	out := c.OutPath(baseName(in.Name) + "-protected.pdf")
	conf := pdfConf(c.Password())
	c.Progress(20, "Encrypting document")
	if c.Engines.QPDF {
		printPerm := "full"
		if !c.Bool("allowPrinting", true) {
			printPerm = "none"
		}
		modify := "all"
		if !c.Bool("allowModifying", true) {
			modify = "none"
		}
		extract := "y"
		if !c.Bool("allowCopying", true) {
			extract = "n"
		}
		annotate := "y"
		if !c.Bool("allowAnnotating", true) {
			annotate = "n"
		}
		args := []string{
			"--encrypt", userPW, ownerPW, "256",
			"--print=" + printPerm, "--modify=" + modify,
			"--extract=" + extract, "--annotate=" + annotate,
			"--form=" + boolYN(c.Bool("allowForms", true)),
			"--assemble=" + boolYN(c.Bool("allowAssembling", true)),
			"--accessibility=" + boolYN(c.Bool("allowAccessibility", true)),
			"--", in.Path, out,
		}
		if _, err := c.Engines.RunCommand(c.Ctx, c.Engines.QPDFPath, args...); err != nil {
			return fmt.Errorf("encrypt with qpdf: %w", err)
		}
	} else {
		conf.UserPW = userPW
		conf.OwnerPW = ownerPW
		conf.EncryptUsingAES = true
		conf.EncryptKeyLength = 256
		if err := api.EncryptFile(c.Ctx, in.Path, out, conf); err != nil {
			return fmt.Errorf("encrypt: %w", err)
		}
	}
	c.SetMeta("encrypted", true)
	c.SetMeta("encryption", "AES-256")
	c.SetMeta("permissions", map[string]bool{
		"printing": c.Bool("allowPrinting", true), "copying": c.Bool("allowCopying", true),
		"modifying": c.Bool("allowModifying", true), "annotating": c.Bool("allowAnnotating", true),
	})
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func unlockPDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	info, infoErr := c.infoFor(in.Path, c.Password())
	if infoErr == nil && info != nil && !info.Encrypted {
		return fmt.Errorf("this PDF is not password protected")
	}
	out := c.OutPath(baseName(in.Name) + "-unlocked.pdf")
	c.Progress(25, "Removing encryption")
	if c.Engines.QPDF {
		args := []string{}
		if c.Password() != "" {
			args = append(args, "--password="+c.Password())
		}
		args = append(args, "--decrypt", in.Path, out)
		if _, err := c.Engines.RunCommand(c.Ctx, c.Engines.QPDFPath, args...); err != nil {
			return fmt.Errorf("unlock failed (check the password): %w", err)
		}
	} else {
		if err := api.DecryptFile(c.Ctx, in.Path, out, pdfConf(c.Password())); err != nil {
			return fmt.Errorf("unlock failed (check the password): %w", err)
		}
	}
	if fileSizeOf(out) == 0 {
		return fmt.Errorf("unlock produced an empty file")
	}
	c.SetMeta("encrypted", false)
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func redactPDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	dims, pages, err := pageDims(in.Path, c.Password())
	if err != nil {
		return fmt.Errorf("%s: %w", in.Name, err)
	}
	var boxes []redactBox
	for _, m := range c.MapSlice("boxes") {
		page := intFromAny(m["page"], 0)
		if page < 1 || page > pages {
			continue
		}
		x := clamp01(floatFromAny(m["x"], 0))
		y := clamp01(floatFromAny(m["y"], 0))
		w := clamp01(floatFromAny(m["w"], 0))
		h := clamp01(floatFromAny(m["h"], 0))
		if w == 0 || h == 0 {
			continue
		}
		boxes = append(boxes, redactBox{page, x, y, minf(w, 1-x), minf(h, 1-y)})
	}
	terms := c.Strings("terms")
	if len(terms) > 0 {
		found, err := findTextBoxes(in.Path, c.Password(), terms)
		if err != nil {
			return fmt.Errorf("search for redaction terms: %w", err)
		}
		for _, f := range found {
			if f.Page >= 1 && f.Page <= pages {
				boxes = append(boxes, redactBox{f.Page, f.X, f.Y, f.W, f.H})
			}
		}
	}
	if len(boxes) == 0 {
		return fmt.Errorf("mark at least one area or search for a term to redact")
	}
	// Rasterizing is intentional: it guarantees the removed text is no longer
	// present in the PDF's content streams, not merely hidden behind a box.
	dpi := c.Int("dpi", 200)
	if dpi < 120 {
		dpi = 120
	}
	if dpi > 400 {
		dpi = 400
	}
	prefix := c.TempPath("redact-page")
	args := []string{"-png", "-r", strconv.Itoa(dpi)}
	if c.Password() != "" {
		args = append(args, "-upw", c.Password())
	}
	args = append(args, in.Path, prefix)
	c.Progress(10, "Rendering pages for permanent redaction")
	if _, err := c.Engines.RunCommand(c.Ctx, findTool("pdftoppm"), args...); err != nil {
		return fmt.Errorf("render pages: %w", err)
	}
	images, _ := filepath.Glob(prefix + "*.png")
	sortRendered(images)
	if len(images) != pages {
		return fmt.Errorf("expected %d pages, rendered %d", pages, len(images))
	}
	byPage := map[int][]redactBox{}
	for _, b := range boxes {
		byPage[b.Page] = append(byPage[b.Page], b)
	}
	pdf := fpdf.NewCustom(&fpdf.InitType{UnitStr: "pt", Size: fpdf.SizeType{Wd: dims[0].Width, Ht: dims[0].Height}, OrientationStr: "P"})
	pdf.SetMargins(0, 0, 0)
	pdf.SetAutoPageBreak(false, 0)
	pdf.SetCompression(true)
	for i, imgPath := range images {
		pageNr := i + 1
		src, err := decodeImage(imgPath)
		if err != nil {
			return fmt.Errorf("decode page %d: %w", pageNr, err)
		}
		bounds := src.Bounds()
		img := image.NewRGBA(bounds)
		draw.Draw(img, bounds, src, bounds.Min, draw.Src)
		for _, rb := range byPage[pageNr] {
			r := image.Rect(
				int(rb.X*float64(bounds.Dx())), int(rb.Y*float64(bounds.Dy())),
				int((rb.X+rb.W)*float64(bounds.Dx())), int((rb.Y+rb.H)*float64(bounds.Dy())),
			)
			draw.Draw(img, r, image.NewUniform(color.Black), image.Point{}, draw.Src)
		}
		clean := c.TempPath(fmt.Sprintf("redacted-%04d.png", pageNr))
		out, err := os.Create(clean)
		if err != nil {
			return err
		}
		if err := png.Encode(out, img); err != nil {
			out.Close()
			return err
		}
		out.Close()
		pdf.AddPageFormat("P", fpdf.SizeType{Wd: dims[i].Width, Ht: dims[i].Height})
		opts := fpdf.ImageOptions{ImageType: "PNG", ReadDpi: false}
		pdf.ImageOptions(clean, 0, 0, dims[i].Width, dims[i].Height, false, opts, 0, "")
		c.Progress(15+(i+1)*65/len(images), fmt.Sprintf("Redacting page %d of %d", pageNr, len(images)))
	}
	outPDF := c.OutPath(baseName(in.Name) + "-redacted.pdf")
	c.Progress(85, "Writing sanitized PDF")
	if err := pdf.OutputFileAndClose(outPDF); err != nil {
		return fmt.Errorf("write redacted PDF: %w", err)
	}
	report := map[string]any{
		"redactions": len(boxes), "pages": len(images), "dpi": dpi,
		"method": "rasterized (source text removed)", "boxes": boxes,
	}
	reportBytes, _ := jsonMarshal(report)
	reportPath := c.OutPath(baseName(in.Name) + "-redaction-report.json")
	if err := writeText(reportPath, string(reportBytes)); err != nil {
		return err
	}
	c.SetMeta("redactions", len(boxes))
	c.SetMeta("rasterized", true)
	if _, err := c.AddOutput(filepath.Base(outPDF), "application/pdf", "pdf", outPDF); err != nil {
		return err
	}
	if _, err := c.AddOutput(filepath.Base(reportPath), "application/json", "json", reportPath); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func comparePDF(c *Context) error {
	ins, err := c.requirePDFs(2)
	if err != nil {
		return err
	}
	a, b := ins[0], ins[1]
	dpi := c.Int("dpi", 110)
	if dpi < 72 {
		dpi = 72
	}
	if dpi > 180 {
		dpi = 180
	}
	pagesA, err := pageCount(a.Path, c.Password())
	if err != nil {
		return fmt.Errorf("%s: %w", a.Name, err)
	}
	pagesB, err := pageCount(b.Path, c.Password())
	if err != nil {
		return fmt.Errorf("%s: %w", b.Name, err)
	}
	maxPages := max(pagesA, pagesB)
	if maxPages > 80 {
		return fmt.Errorf("comparison is limited to 80 pages")
	}
	c.Progress(5, "Rendering first document")
	prefixA, prefixB := c.TempPath("cmp-a"), c.TempPath("cmp-b")
	if err := renderPages(c, a.Path, prefixA, dpi); err != nil {
		return err
	}
	c.Progress(25, "Rendering second document")
	if err := renderPages(c, b.Path, prefixB, dpi); err != nil {
		return err
	}
	imgsA, _ := filepath.Glob(prefixA + "*.png")
	imgsB, _ := filepath.Glob(prefixB + "*.png")
	sortRendered(imgsA)
	sortRendered(imgsB)
	textA, _ := readTextPages(a.Path, c.Password())
	textB, _ := readTextPages(b.Path, c.Password())
	dmp := diffmatchpatch.New()
	var pageMeta []map[string]any
	for p := 0; p < maxPages; p++ {
		var left, right image.Image
		if p < len(imgsA) {
			left = readImage(imgsA[p])
		}
		if p < len(imgsB) {
			right = readImage(imgsB[p])
		}
		if left == nil {
			left = blankImage(600, 800)
		}
		if right == nil {
			right = blankImage(600, 800)
		}
		diffImg, similarity := diffImages(left, right)
		contact := sideBySide(left, right, diffImg)
		name := fmt.Sprintf("compare-%03d.png", p+1)
		path := c.OutPath(name)
		if err := writePNG(path, contact); err != nil {
			return err
		}
		if _, err := c.AddOutput(name, "image/png", "image", path); err != nil {
			return err
		}
		ta, tb := "", ""
		if p < len(textA) {
			ta = textA[p]
		}
		if p < len(textB) {
			tb = textB[p]
		}
		diffs := dmp.DiffMain(ta, tb, false)
		dmp.DiffCleanupSemantic(diffs)
		html := dmp.DiffPrettyHtml(diffs)
		if len(html) > 200_000 {
			html = html[:200_000] + "…"
		}
		pageMeta = append(pageMeta, map[string]any{
			"page": p + 1, "similarity": round1(similarity * 100),
			"leftPresent": p < len(imgsA), "rightPresent": p < len(imgsB),
			"textDiff": html,
		})
		c.Progress(30+(p+1)*60/maxPages, fmt.Sprintf("Comparing page %d of %d", p+1, maxPages))
	}
	c.SetMeta("pages", pageMeta)
	c.SetMeta("pageCountA", pagesA)
	c.SetMeta("pageCountB", pagesB)
	c.SetMeta("documentA", a.Name)
	c.SetMeta("documentB", b.Name)
	c.Progress(100, "Ready")
	return nil
}

func renderPages(c *Context, path, prefix string, dpi int) error {
	args := []string{"-png", "-r", strconv.Itoa(dpi)}
	if c.Password() != "" {
		args = append(args, "-upw", c.Password())
	}
	args = append(args, path, prefix)
	if _, err := c.Engines.RunCommand(c.Ctx, findTool("pdftoppm"), args...); err != nil {
		return fmt.Errorf("render pages: %w", err)
	}
	return nil
}

func readImage(path string) image.Image {
	img, err := decodeImage(path)
	if err != nil {
		return nil
	}
	return img
}

func writePNG(path string, img image.Image) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return png.Encode(f, img)
}

func blankImage(w, h int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(img, img.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	return img
}

func diffImages(a, b image.Image) (image.Image, float64) {
	ab, bb := a.Bounds(), b.Bounds()
	w := max(ab.Dx(), bb.Dx())
	h := max(ab.Dy(), bb.Dy())
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(out, out.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	changed, total := 0, 0
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			ar, ag, ab2, _ := a.At(ab.Min.X+minInt(x, ab.Dx()-1), ab.Min.Y+minInt(y, ab.Dy()-1)).RGBA()
			br, bg, bb2, _ := b.At(bb.Min.X+minInt(x, bb.Dx()-1), bb.Min.Y+minInt(y, bb.Dy()-1)).RGBA()
			// Compare at 8-bit resolution.
			d := absInt(int(ar>>8)-int(br>>8)) + absInt(int(ag>>8)-int(bg>>8)) + absInt(int(ab2>>8)-int(bb2>>8))
			total++
			if d > 45 {
				changed++
				out.Set(x, y, color.RGBA{255, 59, 48, 255})
			} else {
				g := uint8(238)
				out.Set(x, y, color.RGBA{g, g, g, 255})
			}
		}
	}
	similarity := 1.0
	if total > 0 {
		similarity = 1 - float64(changed)/float64(total)
	}
	return out, similarity
}

func sideBySide(left, right, diff image.Image) image.Image {
	gap := 18
	lw, lh := left.Bounds().Dx(), left.Bounds().Dy()
	rw, rh := right.Bounds().Dx(), right.Bounds().Dy()
	dw, dh := diff.Bounds().Dx(), diff.Bounds().Dy()
	h := max(lh, max(rh, dh))
	w := lw + rw + dw + gap*4
	out := image.NewRGBA(image.Rect(0, 0, w, h+44))
	draw.Draw(out, out.Bounds(), image.NewUniform(color.RGBA{246, 243, 236, 255}), image.Point{}, draw.Src)
	// Labels
	draw.Draw(out, image.Rect(gap, 10, gap+8, 18), image.NewUniform(color.RGBA{37, 71, 255, 255}), image.Point{}, draw.Src)
	draw.Draw(out, image.Rect(gap, 10, gap+lw, 44), image.NewUniform(color.RGBA{246, 243, 236, 255}), image.Point{}, draw.Src)
	// Reset the label bar to a subtle line.
	draw.Draw(out, image.Rect(0, 0, w, 34), image.NewUniform(color.RGBA{246, 243, 236, 255}), image.Point{}, draw.Src)
	draw.Draw(out, image.Rect(gap, 16, gap+lw, 34), image.NewUniform(color.RGBA{37, 71, 255, 24}), image.Point{}, draw.Src)
	draw.Draw(out, image.Rect(gap*2+lw, 16, gap*2+lw+rw, 34), image.NewUniform(color.RGBA{255, 92, 53, 24}), image.Point{}, draw.Src)
	draw.Draw(out, image.Rect(gap*3+lw+rw, 16, gap*3+lw+rw+dw, 34), image.NewUniform(color.RGBA{120, 120, 120, 24}), image.Point{}, draw.Src)
	draw.Draw(out, image.Rect(gap, 44, gap+lw, 44+lh), left, left.Bounds().Min, draw.Src)
	draw.Draw(out, image.Rect(gap*2+lw, 44, gap*2+lw+rw, 44+rh), right, right.Bounds().Min, draw.Src)
	draw.Draw(out, image.Rect(gap*3+lw+rw, 44, gap*3+lw+rw+dw, 44+dh), diff, diff.Bounds().Min, draw.Src)
	return out
}

type redactBox struct {
	Page       int
	X, Y, W, H float64
}

func findTextBoxes(path, password string, terms []string) ([]redactBox, error) {
	out := path + "-bbox.html"
	args := []string{"-bbox", "-enc", "UTF-8"}
	if password != "" {
		args = append(args, "-upw", password)
	}
	args = append(args, path, out)
	if _, err := runTool(context.Background(), "pdftotext", args...); err != nil {
		return nil, err
	}
	defer os.Remove(out)
	raw, err := os.ReadFile(out)
	if err != nil {
		return nil, err
	}
	var doc bboxDoc
	if err := xml.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	lowerTerms := make([]string, 0, len(terms))
	for _, t := range terms {
		if t = strings.TrimSpace(strings.ToLower(t)); t != "" {
			lowerTerms = append(lowerTerms, t)
		}
	}
	type result = redactBox
	var results []result
	for pi, page := range doc.Pages {
		if page.Width <= 0 || page.Height <= 0 {
			continue
		}
		lines := groupWordsIntoLines(page.Words)
		for _, line := range lines {
			var parts []string
			for _, w := range line.Words {
				parts = append(parts, w.Text)
			}
			text := strings.ToLower(strings.Join(parts, " "))
			for _, term := range lowerTerms {
				if !strings.Contains(text, term) {
					continue
				}
				// If a term matches a single word, use just that word.
				matched := false
				for _, w := range line.Words {
					if strings.Contains(strings.ToLower(w.Text), term) {
						results = append(results, result{pi + 1, w.XMin / page.Width, w.YMin / page.Height, (w.XMax - w.XMin) / page.Width, (w.YMax - w.YMin) / page.Height})
						matched = true
					}
				}
				if !matched {
					x0, y0, x1, y1 := line.XMin, line.YMin, line.XMax, line.YMax
					results = append(results, result{pi + 1, x0 / page.Width, y0 / page.Height, (x1 - x0) / page.Width, (y1 - y0) / page.Height})
				}
			}
		}
	}
	return results, nil
}

type bboxDoc struct {
	Pages []bboxPage `xml:"body>doc>page"`
}
type bboxPage struct {
	Width  float64    `xml:"width,attr"`
	Height float64    `xml:"height,attr"`
	Words  []bboxWord `xml:"word"`
}
type bboxWord struct {
	XMin float64 `xml:"xMin,attr"`
	YMin float64 `xml:"yMin,attr"`
	XMax float64 `xml:"xMax,attr"`
	YMax float64 `xml:"yMax,attr"`
	Text string  `xml:",chardata"`
}
type bboxLine struct {
	Words      []bboxWord
	XMin, YMin float64
	XMax, YMax float64
}

func groupWordsIntoLines(words []bboxWord) []bboxLine {
	sorted := append([]bboxWord{}, words...)
	sort.Slice(sorted, func(i, j int) bool {
		if math.Abs(sorted[i].YMin-sorted[j].YMin) > 2 {
			return sorted[i].YMin < sorted[j].YMin
		}
		return sorted[i].XMin < sorted[j].XMin
	})
	var lines []bboxLine
	for _, w := range sorted {
		if w.Text == "" {
			continue
		}
		if len(lines) == 0 || math.Abs(lines[len(lines)-1].YMin-w.YMin) > 2 {
			lines = append(lines, bboxLine{XMin: w.XMin, YMin: w.YMin, XMax: w.XMax, YMax: w.YMax, Words: []bboxWord{w}})
			continue
		}
		line := &lines[len(lines)-1]
		line.Words = append(line.Words, w)
		if w.XMin < line.XMin {
			line.XMin = w.XMin
		}
		if w.XMax > line.XMax {
			line.XMax = w.XMax
		}
		if w.YMax > line.YMax {
			line.YMax = w.YMax
		}
	}
	return lines
}

func boolYN(b bool) string {
	if b {
		return "y"
	}
	return "n"
}

func minf(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func absInt(a int) int {
	if a < 0 {
		return -a
	}
	return a
}

// jsonMarshal is isolated so tools don't each import encoding/json.
func jsonMarshal(v any) ([]byte, error) {
	return json.MarshalIndent(v, "", "  ")
}
