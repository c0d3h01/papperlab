package tools

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

func init() {
	Register(&Tool{
		ID: "merge", Name: "Merge PDF", Group: "organize",
		Description: "Combine PDFs in the order you want, with optional bookmarks.",
		Run:         mergePDFs,
	})
	Register(&Tool{
		ID: "split", Name: "Split PDF", Group: "organize",
		Description: "Separate one page or a whole set into independent PDF files.",
		Run:         splitPDF,
	})
	Register(&Tool{
		ID: "remove-pages", Name: "Remove pages", Group: "organize",
		Description: "Delete unwanted pages from a PDF in one pass.",
		Run:         removePages,
	})
	Register(&Tool{
		ID: "extract-pages", Name: "Extract pages", Group: "organize",
		Description: "Pull selected pages into a new, clean PDF.",
		Run:         extractPages,
	})
	Register(&Tool{
		ID: "organize", Name: "Organize PDF", Group: "organize",
		Description: "Reorder, duplicate, rotate, and delete pages visually.",
		Run:         organizePDF,
	})
	Register(&Tool{
		ID: "rotate", Name: "Rotate PDF", Group: "organize",
		Description: "Turn all or selected pages clockwise.",
		Run:         rotatePDF,
	})
	Register(&Tool{
		ID: "crop", Name: "Crop PDF", Group: "organize",
		Description: "Trim margins or crop a precise region of every page.",
		Run:         cropPDF,
	})
	Register(&Tool{
		ID: "n-up", Name: "N-up PDF", Group: "organize",
		Description: "Place 2, 4, 6, 9 or 16 pages on a single sheet.",
		Run:         nupPDF,
	})
	Register(&Tool{
		ID: "booklet", Name: "PDF Booklet", Group: "organize",
		Description: "Impose pages for folded booklets and zines.",
		Run:         bookletPDF,
	})
}

func mergePDFs(c *Context) error {
	ins, err := c.requirePDFs(2)
	if err != nil {
		return err
	}
	conf := pdfConf(c.Password())
	c.Progress(5, "Checking documents")
	var paths []string
	var bookmarks []pdfcpu.Bookmark
	page := 1
	total := 0
	for i, in := range ins {
		if _, err := api.PageCountFile(c.Ctx, in.Path); err != nil {
			return fmt.Errorf("%s: %w", in.Name, err)
		}
		paths = append(paths, in.Path)
		bookmarks = append(bookmarks, pdfcpu.Bookmark{Title: baseName(in.Name), PageFrom: page})
		n, _ := pageCount(in.Path, c.Password())
		page += n
		total += n
		c.Progress(5+(i+1)*50/len(ins), "Checking "+in.Name)
	}
	out := c.OutPath(baseName(ins[0].Name) + "-merged.pdf")
	c.Progress(65, "Merging pages")
	if err := api.MergeCreateFile(c.Ctx, paths, out, false, conf); err != nil {
		return fmt.Errorf("merge failed: %w", err)
	}
	if c.Bool("addBookmarks", true) {
		c.Progress(85, "Adding bookmarks")
		_ = api.AddBookmarksFile(c.Ctx, out, out, bookmarks, false, conf)
	}
	c.SetMeta("pages", total)
	c.SetMeta("files", len(ins))
	if _, err := c.AddOutput(baseName(ins[0].Name)+"-merged.pdf", "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func splitPDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	pages, err := pageCount(in.Path, c.Password())
	if err != nil {
		return fmt.Errorf("%s: %w", in.Name, err)
	}
	conf := pdfConf(c.Password())
	mode := c.Str("mode", "ranges")
	var groups [][]string
	var titles []string
	if mode == "bookmarks" {
		f, err := os.Open(in.Path)
		if err != nil {
			return err
		}
		bms, err := api.Bookmarks(c.Ctx, f, conf)
		f.Close()
		if err != nil || len(bms) == 0 {
			return fmt.Errorf("this PDF has no bookmarks to split by")
		}
		starts := map[int]string{}
		for _, bm := range bms {
			if bm.PageFrom >= 1 && bm.PageFrom <= pages {
				if _, ok := starts[bm.PageFrom]; !ok {
					starts[bm.PageFrom] = bm.Title
				}
			}
		}
		var startsSorted []int
		for p := range starts {
			startsSorted = append(startsSorted, p)
		}
		sort.Ints(startsSorted)
		if len(startsSorted) == 0 || startsSorted[0] != 1 {
			startsSorted = append([]int{1}, startsSorted...)
			starts[1] = "Front matter"
		}
		for i, from := range startsSorted {
			thru := pages
			if i+1 < len(startsSorted) {
				thru = startsSorted[i+1] - 1
			}
			if thru < from {
				continue
			}
			groups = append(groups, []string{fmt.Sprintf("%d-%d", from, thru)})
			titles = append(titles, starts[from])
		}
	} else {
		groups, err = pageGroups(c, pages)
		if err != nil {
			return err
		}
	}

	var files []string
	for i, group := range groups {
		label := strings.ReplaceAll(strings.Join(group, "_"), "-", "-")
		if i < len(titles) && titles[i] != "" {
			label = titles[i]
		}
		out := c.OutPath(fmt.Sprintf("%s-%s.pdf", baseName(in.Name), safeFileName(label)))
		if err := api.CollectFile(c.Ctx, in.Path, out, group, conf); err != nil {
			return fmt.Errorf("split page %s: %w", strings.Join(group, ","), err)
		}
		files = append(files, out)
		c.Progress(5+(i+1)*75/max(1, len(groups)), "Writing part "+strconv.Itoa(i+1))
	}
	for _, f := range files {
		if _, err := c.AddOutput(filepath.Base(f), "application/pdf", "pdf", f); err != nil {
			return err
		}
	}
	if len(files) > 1 {
		zipPath := c.OutPath(baseName(in.Name) + "-split.zip")
		if err := zipFiles(zipPath, files); err != nil {
			return err
		}
		if _, err := c.AddOutput(filepath.Base(zipPath), "application/zip", "zip", zipPath); err != nil {
			return err
		}
	}
	c.SetMeta("parts", len(files))
	c.SetMeta("pages", pages)
	c.Progress(100, "Ready")
	return nil
}

func removePages(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	pages, err := pageCount(in.Path, c.Password())
	if err != nil {
		return fmt.Errorf("%s: %w", in.Name, err)
	}
	sel, err := c.selectedPages("pages", pages)
	if err != nil {
		return err
	}
	if sel == nil {
		return fmt.Errorf("choose at least one page to remove")
	}
	selectedSet, err := api.PagesForSelection(pages, sel, false)
	if err != nil {
		return err
	}
	if len(selectedSet) >= pages {
		return fmt.Errorf("you cannot remove every page")
	}
	out := c.OutPath(baseName(in.Name) + "-edited.pdf")
	c.Progress(30, "Removing pages")
	if err := api.RemovePagesFile(c.Ctx, in.Path, out, sel, pdfConf(c.Password())); err != nil {
		return fmt.Errorf("remove pages failed: %w", err)
	}
	c.SetMeta("removed", len(selectedSet))
	c.SetMeta("pages", pages-len(selectedSet))
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func extractPages(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	pages, err := pageCount(in.Path, c.Password())
	if err != nil {
		return fmt.Errorf("%s: %w", in.Name, err)
	}
	sel, err := c.selectedPages("pages", pages)
	if err != nil {
		return err
	}
	if sel == nil {
		sel = []string{fmt.Sprintf("1-%d", pages)}
	}
	out := c.OutPath(baseName(in.Name) + "-extracted.pdf")
	c.Progress(30, "Extracting pages")
	if err := api.CollectFile(c.Ctx, in.Path, out, sel, pdfConf(c.Password())); err != nil {
		return fmt.Errorf("extract pages failed: %w", err)
	}
	n, _ := pageCount(out, "")
	c.SetMeta("pages", n)
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

// organizePDF rebuilds a document from an explicit page sequence.
func organizePDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	pages, err := pageCount(in.Path, c.Password())
	if err != nil {
		return fmt.Errorf("%s: %w", in.Name, err)
	}
	type item struct {
		Page   int `json:"page"`
		Rotate int `json:"rotate"`
	}
	var items []item
	for _, raw := range c.MapSlice("order") {
		page := intFromAny(raw["page"], 1)
		rot := intFromAny(raw["rotate"], 0)
		if page >= 1 && page <= pages {
			items = append(items, item{Page: page, Rotate: ((rot % 360) + 360) % 360})
		}
	}
	if len(items) == 0 {
		for p := 1; p <= pages; p++ {
			items = append(items, item{Page: p})
		}
	}
	if len(items) > 500 {
		return fmt.Errorf("this tool supports up to 500 output pages")
	}
	conf := pdfConf(c.Password())
	var parts []string
	for i, it := range items {
		pagePDF := c.TempPath(fmt.Sprintf("page-%04d.pdf", i))
		if err := api.CollectFile(c.Ctx, in.Path, pagePDF, []string{strconv.Itoa(it.Page)}, conf); err != nil {
			return fmt.Errorf("copy page %d: %w", it.Page, err)
		}
		if it.Rotate != 0 {
			rotated := c.TempPath(fmt.Sprintf("page-%04d-rot.pdf", i))
			if err := api.RotateFile(c.Ctx, pagePDF, rotated, it.Rotate, nil, conf); err != nil {
				return fmt.Errorf("rotate page %d: %w", it.Page, err)
			}
			pagePDF = rotated
		}
		parts = append(parts, pagePDF)
		if i%10 == 0 {
			c.Progress(5+i*65/max(1, len(items)), "Rebuilding page "+strconv.Itoa(i+1))
		}
	}
	out := c.OutPath(baseName(in.Name) + "-organized.pdf")
	c.Progress(80, "Assembling document")
	if err := api.MergeCreateFile(c.Ctx, parts, out, false, conf); err != nil {
		return fmt.Errorf("assemble pages: %w", err)
	}
	c.SetMeta("pages", len(items))
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func rotatePDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	pages, err := pageCount(in.Path, c.Password())
	if err != nil {
		return fmt.Errorf("%s: %w", in.Name, err)
	}
	angle := c.Int("angle", 90)
	if angle != 90 && angle != 180 && angle != 270 {
		return fmt.Errorf("rotation must be 90, 180 or 270 degrees")
	}
	sel, err := c.selectedPages("pages", pages)
	if err != nil {
		return err
	}
	out := c.OutPath(baseName(in.Name) + "-rotated.pdf")
	c.Progress(35, "Rotating pages")
	if err := api.RotateFile(c.Ctx, in.Path, out, angle, sel, pdfConf(c.Password())); err != nil {
		return fmt.Errorf("rotate failed: %w", err)
	}
	c.SetMeta("rotation", angle)
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func cropPDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	dims, pages, err := pageDims(in.Path, c.Password())
	if err != nil {
		return fmt.Errorf("%s: %w", in.Name, err)
	}
	// boxes are normalized fractions measured from the top-left of the page.
	boxes := c.MapSlice("boxes")
	type rect struct {
		page       int
		x, y, w, h float64
	}
	var rects []rect
	for _, m := range boxes {
		page := intFromAny(m["page"], 0)
		if page < 1 || page > pages {
			continue
		}
		x := floatFromAny(m["x"], 0)
		y := floatFromAny(m["y"], 0)
		w := floatFromAny(m["w"], 1)
		h := floatFromAny(m["h"], 1)
		x = clamp01(x)
		y = clamp01(y)
		if w <= 0 || h <= 0 {
			continue
		}
		if x+w > 1 {
			w = 1 - x
		}
		if y+h > 1 {
			h = 1 - y
		}
		rects = append(rects, rect{page, x, y, w, h})
	}
	if len(rects) == 0 {
		top := c.Float("top", 0) / 100
		bottom := c.Float("bottom", 0) / 100
		left := c.Float("left", 0) / 100
		right := c.Float("right", 0) / 100
		if top+bottom >= 0.9 || left+right >= 0.9 {
			return fmt.Errorf("margins are too large")
		}
		if top == 0 && bottom == 0 && left == 0 && right == 0 {
			return fmt.Errorf("set a crop area or margins")
		}
		for p := 1; p <= pages; p++ {
			rects = append(rects, rect{p, left, top, 1 - left - right, 1 - top - bottom})
		}
	}
	conf := pdfConf(c.Password())
	current := in.Path
	for i, r := range rects {
		d := dims[r.page-1]
		x0 := r.x * d.Width
		x1 := (r.x + r.w) * d.Width
		y1 := (1 - r.y) * d.Height
		y0 := (1 - r.y - r.h) * d.Height
		box := &model.Box{Rect: types.NewRectangle(x0, y0, x1, y1)}
		out := c.TempPath(fmt.Sprintf("crop-%03d.pdf", i))
		if err := api.CropFile(c.Ctx, current, out, []string{strconv.Itoa(r.page)}, box, conf); err != nil {
			return fmt.Errorf("crop page %d: %w", r.page, err)
		}
		current = out
		if i%5 == 0 {
			c.Progress(10+i*70/len(rects), "Cropping page "+strconv.Itoa(r.page))
		}
	}
	out := c.OutPath(baseName(in.Name) + "-cropped.pdf")
	if current != in.Path {
		if err := copyFile(current, out); err != nil {
			return err
		}
	} else {
		if err := copyFile(in.Path, out); err != nil {
			return err
		}
	}
	c.SetMeta("croppedPages", len(rects))
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func nupPDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	pages, err := pageCount(in.Path, c.Password())
	if err != nil {
		return fmt.Errorf("%s: %w", in.Name, err)
	}
	n := c.Int("perSheet", 2)
	desc := fmt.Sprintf("papersize:%s, border:%s, margin:%d, orientation:rd",
		c.Str("paper", "A4P"), onOff(c.Bool("border", false)), c.Int("margin", 10))
	nup, err := api.PDFNUpConfig(n, desc, pdfConf(c.Password()))
	if err != nil {
		return err
	}
	sel, err := c.selectedPages("pages", pages)
	if err != nil {
		return err
	}
	out := c.OutPath(baseName(in.Name) + fmt.Sprintf("-nup%d.pdf", n))
	c.Progress(30, "Imposing pages")
	if err := api.NUpFile(c.Ctx, []string{in.Path}, out, sel, nup, pdfConf(c.Password())); err != nil {
		return fmt.Errorf("n-up failed: %w", err)
	}
	outPages, _ := pageCount(out, "")
	c.SetMeta("sheets", outPages)
	c.SetMeta("perSheet", n)
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func bookletPDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	pages, err := pageCount(in.Path, c.Password())
	if err != nil {
		return fmt.Errorf("%s: %w", in.Name, err)
	}
	binding := c.Str("binding", "long")
	desc := fmt.Sprintf("papersize:%s, binding:%s, guides:%s, margin:%d",
		c.Str("paper", "A4P"), binding, onOff(c.Bool("guides", false)), c.Int("margin", 0))
	nup, err := api.PDFBookletConfig(2, desc, pdfConf(c.Password()))
	if err != nil {
		return err
	}
	out := c.OutPath(baseName(in.Name) + "-booklet.pdf")
	c.Progress(30, "Imposing booklet")
	if err := api.BookletFile(c.Ctx, []string{in.Path}, out, nil, nup, pdfConf(c.Password())); err != nil {
		return fmt.Errorf("booklet failed: %w", err)
	}
	outPages, _ := pageCount(out, "")
	c.SetMeta("sheets", outPages)
	c.SetMeta("sourcePages", pages)
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func onOff(b bool) string {
	if b {
		return "on"
	}
	return "off"
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func intFromAny(v any, fallback int) int {
	switch x := v.(type) {
	case json.Number:
		if n, err := x.Int64(); err == nil {
			return int(n)
		}
		if f, err := x.Float64(); err == nil {
			return int(f)
		}
	case float64:
		return int(x)
	case float32:
		return int(x)
	case int:
		return x
	case int64:
		return int(x)
	case string:
		n, err := strconv.Atoi(x)
		if err == nil {
			return n
		}
	}
	return fallback
}

func floatFromAny(v any, fallback float64) float64 {
	switch x := v.(type) {
	case json.Number:
		if f, err := x.Float64(); err == nil {
			return f
		}
	case float64:
		return x
	case float32:
		return float64(x)
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case string:
		f, err := strconv.ParseFloat(x, 64)
		if err == nil {
			return f
		}
	}
	return fallback
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := out.ReadFrom(in); err != nil {
		return err
	}
	return out.Close()
}
