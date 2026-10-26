package tools

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/xuri/excelize/v2"

	"paperlab/internal/ooxml"
)

func init() {
	Register(&Tool{
		ID: "pdf-to-jpg", Name: "PDF to image", Group: "convert",
		Description: "Export pages as high-quality JPG or PNG images.",
		Requires:    []string{"poppler"},
		Run:         pdfToImages,
	})
	Register(&Tool{
		ID: "pdf-to-word", Name: "PDF to Word", Group: "convert",
		Description: "Turn a PDF into an editable Word document.",
		Requires:    []string{"poppler"},
		Run:         pdfToWord,
	})
	Register(&Tool{
		ID: "pdf-to-powerpoint", Name: "PDF to PowerPoint", Group: "convert",
		Description: "Create an editable slide deck from PDF pages.",
		Requires:    []string{"poppler"},
		Run:         pdfToPowerpoint,
	})
	Register(&Tool{
		ID: "pdf-to-excel", Name: "PDF to Excel", Group: "convert",
		Description: "Extract tables and text into a structured spreadsheet.",
		Requires:    []string{"poppler"},
		Run:         pdfToExcel,
	})
	Register(&Tool{
		ID: "pdf-to-text", Name: "PDF to text", Group: "convert",
		Description: "Extract clean, layout-aware plain text.",
		Requires:    []string{"poppler"},
		Run:         pdfToText,
	})
	Register(&Tool{
		ID: "pdf-to-markdown", Name: "PDF to Markdown", Group: "convert",
		Description: "Convert pages into structured Markdown with headings.",
		Requires:    []string{"poppler"},
		Run:         pdfToMarkdown,
	})
	Register(&Tool{
		ID: "extract-images", Name: "Extract images", Group: "convert",
		Description: "Pull every embedded image out of a PDF as a ZIP.",
		Run:         extractImages,
	})
}

func pdfToImages(c *Context) error {
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
	selected := map[int]bool{}
	if sel == nil {
		for p := 1; p <= pages; p++ {
			selected[p] = true
		}
	} else {
		set, err := api.PagesForSelection(pages, sel, false)
		if err != nil {
			return err
		}
		for p := range set {
			selected[p] = true
		}
	}
	format := strings.ToLower(c.Str("format", "jpg"))
	if format != "png" {
		format = "jpg"
	}
	dpi := c.Int("dpi", 150)
	if dpi < 72 {
		dpi = 72
	}
	if dpi > 400 {
		dpi = 400
	}
	if len(selected) > 300 {
		return fmt.Errorf("image export is limited to 300 pages per job")
	}
	prefix := c.TempPath("page")
	ppmFormat := format
	if ppmFormat == "jpg" {
		ppmFormat = "jpeg"
	}
	args := []string{"-" + ppmFormat, "-r", strconv.Itoa(dpi)}
	if format == "jpg" {
		quality := c.Int("quality", 88)
		if quality < 40 {
			quality = 40
		}
		if quality > 100 {
			quality = 100
		}
		args = append(args, "-jpegopt", fmt.Sprintf("quality=%d,progressive=y,optimize=y", quality))
	}
	if c.Password() != "" {
		args = append(args, "-upw", c.Password())
	}
	args = append(args, in.Path, prefix)
	c.Progress(10, "Rendering pages")
	if _, err := c.Engines.RunCommand(c.Ctx, findTool("pdftoppm"), args...); err != nil {
		return fmt.Errorf("render pages: %w", err)
	}
	images, _ := filepath.Glob(prefix + "*." + format)
	sortRendered(images)
	var files []string
	for _, img := range images {
		page := pageNumberFromRendered(img)
		if !selected[page] {
			continue
		}
		name := fmt.Sprintf("%s-page-%03d.%s", baseName(in.Name), page, format)
		dest := c.OutPath(name)
		if err := copyFile(img, dest); err != nil {
			return err
		}
		files = append(files, dest)
	}
	if len(files) == 0 {
		return fmt.Errorf("no pages were exported")
	}
	mime := "image/jpeg"
	if format == "png" {
		mime = "image/png"
	}
	if len(files) == 1 {
		if _, err := c.AddOutput(filepath.Base(files[0]), mime, "image", files[0]); err != nil {
			return err
		}
	} else {
		zipPath := c.OutPath(baseName(in.Name) + "-" + format + ".zip")
		c.Progress(80, "Packaging images")
		if err := zipFiles(zipPath, files); err != nil {
			return err
		}
		if _, err := c.AddOutput(filepath.Base(zipPath), "application/zip", "zip", zipPath); err != nil {
			return err
		}
	}
	c.SetMeta("pages", len(files))
	c.SetMeta("format", format)
	c.SetMeta("dpi", dpi)
	c.Progress(100, "Ready")
	return nil
}

var renderedNumber = regexp.MustCompile(`-(\d+)\.(jpg|png)$`)

func pageNumberFromRendered(path string) int {
	m := renderedNumber.FindStringSubmatch(path)
	if m == nil {
		return 0
	}
	n, _ := strconv.Atoi(m[1])
	return n
}

// sortRendered orders pdftoppm output by page number, not by filename text.
func sortRendered(paths []string) {
	sort.Slice(paths, func(i, j int) bool {
		ni, nj := pageNumberFromRendered(paths[i]), pageNumberFromRendered(paths[j])
		if ni != nj {
			return ni < nj
		}
		return paths[i] < paths[j]
	})
}

func pdfToText(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	c.Progress(20, "Extracting text")
	text, err := readText(in.Path, c.Password())
	if err != nil {
		return err
	}
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("this PDF has no text layer. Run OCR first to make it searchable")
	}
	out := c.OutPath(baseName(in.Name) + ".txt")
	if err := writeText(out, text); err != nil {
		return err
	}
	words := len(strings.Fields(text))
	c.SetMeta("words", words)
	c.SetMeta("characters", len(text))
	if _, err := c.AddOutput(filepath.Base(out), "text/plain; charset=utf-8", "text", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func pdfToMarkdown(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	c.Progress(15, "Reading document text")
	pages, err := readTextPages(in.Path, c.Password())
	if err != nil {
		return err
	}
	if len(pages) == 0 || strings.TrimSpace(strings.Join(pages, "")) == "" {
		return fmt.Errorf("this PDF has no text layer. Run OCR first to make it searchable")
	}
	var b strings.Builder
	b.WriteString("<!-- Converted from " + filepath.Base(in.Name) + " with PaperLab -->\n\n")
	for i, page := range pages {
		lines := strings.Split(strings.ReplaceAll(page, "\r\n", "\n"), "\n")
		prevBlank := true
		for _, raw := range lines {
			line := strings.TrimRight(raw, " \t")
			trimmed := strings.TrimSpace(line)
			if trimmed == "" {
				if !prevBlank {
					b.WriteString("\n")
				}
				prevBlank = true
				continue
			}
			if isPageFurniture(trimmed) {
				continue
			}
			switch {
			case markdownHeadingLevel(trimmed) > 0:
				level := markdownHeadingLevel(trimmed)
				b.WriteString(strings.Repeat("#", level) + " " + trimmed + "\n\n")
			case isBullet(trimmed):
				b.WriteString("- " + strings.TrimSpace(stripBullet(trimmed)) + "\n")
			default:
				b.WriteString(trimmed + " ")
			}
			prevBlank = false
		}
		if i < len(pages)-1 {
			b.WriteString("\n\n---\n\n")
		}
	}
	out := c.OutPath(baseName(in.Name) + ".md")
	if err := writeText(out, b.String()); err != nil {
		return err
	}
	c.SetMeta("pages", len(pages))
	c.SetMeta("format", "markdown")
	if _, err := c.AddOutput(filepath.Base(out), "text/markdown; charset=utf-8", "text", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func markdownHeadingLevel(line string) int {
	if len(line) > 90 {
		return 0
	}
	if strings.HasPrefix(line, "Chapter ") || strings.HasPrefix(line, "CHAPTER ") {
		return 1
	}
	if regexp.MustCompile(`^\d+(\.\d+)*\s+[A-Z]`).MatchString(line) && len(line) < 80 {
		dots := strings.Count(strings.Fields(line)[0], ".")
		return minInt(dots+1, 3)
	}
	if line == strings.ToUpper(line) && len([]rune(line)) > 3 && len([]rune(line)) < 70 && strings.IndexFunc(line, func(r rune) bool { return r >= 'A' && r <= 'Z' }) >= 0 {
		return 2
	}
	return 0
}

func isBullet(line string) bool {
	for _, prefix := range []string{"•", "·", "- ", "* ", "– "} {
		if strings.HasPrefix(line, prefix) {
			return true
		}
	}
	return regexp.MustCompile(`^\d+[.)]\s`).MatchString(line)
}

func stripBullet(line string) string {
	for _, prefix := range []string{"•", "·", "- ", "* ", "– "} {
		if strings.HasPrefix(line, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(line, prefix))
		}
	}
	return regexp.MustCompile(`^\d+[.)]\s`).ReplaceAllString(line, "")
}

func isPageFurniture(line string) bool {
	lower := strings.ToLower(strings.TrimSpace(line))
	if regexp.MustCompile(`^\d{1,4}$`).MatchString(lower) {
		return true
	}
	if strings.HasPrefix(lower, "page ") && len(lower) < 12 {
		return true
	}
	return false
}

func pdfToWord(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	c.Progress(15, "Reading document text")
	pages, err := readTextPages(in.Path, c.Password())
	if err != nil {
		return err
	}
	if len(pages) == 0 || strings.TrimSpace(strings.Join(pages, "")) == "" {
		return fmt.Errorf("this PDF has no text layer. Run OCR first to make it searchable")
	}
	var docPages [][]ooxml.Paragraph
	for _, page := range pages {
		var blocks []ooxml.Paragraph
		for _, raw := range strings.Split(page, "\n") {
			line := strings.TrimSpace(raw)
			if line == "" || isPageFurniture(line) {
				continue
			}
			heading := markdownHeadingLevel(line)
			blocks = append(blocks, ooxml.Paragraph{
				Text: line, Heading: heading, Bullet: isBullet(line),
			})
		}
		if len(blocks) > 0 {
			docPages = append(docPages, blocks)
		}
	}
	if len(docPages) == 0 {
		return fmt.Errorf("no readable text found")
	}
	out := c.OutPath(baseName(in.Name) + ".docx")
	c.Progress(55, "Building Word document")
	if err := ooxml.WriteDOCX(out, ooxml.Doc{Title: baseName(in.Name), Pages: docPages}); err != nil {
		return fmt.Errorf("write DOCX: %w", err)
	}
	c.SetMeta("pages", len(docPages))
	c.SetMeta("words", len(strings.Fields(strings.Join(pages, " "))))
	if _, err := c.AddOutput(filepath.Base(out), MIMEForName(out), "file", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func pdfToPowerpoint(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	pages, err := pageCount(in.Path, c.Password())
	if err != nil {
		return fmt.Errorf("%s: %w", in.Name, err)
	}
	if pages > 80 {
		return fmt.Errorf("slide export is limited to 80 pages per job")
	}
	dpi := c.Int("dpi", 120)
	if dpi < 72 {
		dpi = 72
	}
	if dpi > 200 {
		dpi = 200
	}
	prefix := c.TempPath("slide")
	args := []string{"-png", "-r", strconv.Itoa(dpi)}
	if c.Password() != "" {
		args = append(args, "-upw", c.Password())
	}
	args = append(args, in.Path, prefix)
	c.Progress(10, "Rendering slides")
	if _, err := c.Engines.RunCommand(c.Ctx, findTool("pdftoppm"), args...); err != nil {
		return fmt.Errorf("render slides: %w", err)
	}
	images, _ := filepath.Glob(prefix + "*.png")
	sortRendered(images)
	if len(images) == 0 {
		return fmt.Errorf("could not render any pages")
	}
	textPages, _ := readTextPages(in.Path, c.Password())
	var slides []ooxml.Slide
	for i, img := range images {
		slide := ooxml.Slide{Title: fmt.Sprintf("Page %d", i+1), Image: img}
		if i < len(textPages) {
			for _, line := range strings.Split(textPages[i], "\n") {
				line = strings.TrimSpace(line)
				if line == "" || isPageFurniture(line) {
					continue
				}
				slide.Lines = append(slide.Lines, line)
				if len(slide.Lines) >= 4 {
					break
				}
			}
		}
		slides = append(slides, slide)
		c.Progress(15+(i+1)*65/len(images), fmt.Sprintf("Preparing slide %d of %d", i+1, len(images)))
	}
	out := c.OutPath(baseName(in.Name) + ".pptx")
	c.Progress(85, "Building presentation")
	if err := ooxml.WritePPTX(out, slides); err != nil {
		return fmt.Errorf("write PPTX: %w", err)
	}
	c.SetMeta("slides", len(slides))
	if _, err := c.AddOutput(filepath.Base(out), MIMEForName(out), "file", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

var columnGap = regexp.MustCompile(`\s{2,}|\t+`)

func pdfToExcel(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	pages, err := readTextPages(in.Path, c.Password())
	if err != nil {
		return err
	}
	if len(pages) == 0 || strings.TrimSpace(strings.Join(pages, "")) == "" {
		return fmt.Errorf("this PDF has no text layer. Run OCR first to make it searchable")
	}
	if len(pages) > 100 {
		return fmt.Errorf("spreadsheet export is limited to 100 pages")
	}
	book := excelize.NewFile()
	defer book.Close()
	first := true
	for i, page := range pages {
		name := fmt.Sprintf("Page %d", i+1)
		if first {
			book.SetSheetName("Sheet1", name)
			first = false
		} else {
			if _, err := book.NewSheet(name); err != nil {
				return err
			}
		}
		row := 1
		for _, raw := range strings.Split(page, "\n") {
			line := strings.TrimRight(raw, " \t")
			if strings.TrimSpace(line) == "" {
				continue
			}
			cells := columnGap.Split(strings.TrimSpace(line), -1)
			for j, cell := range cells {
				axis, _ := excelize.CoordinatesToCellName(j+1, row)
				if err := book.SetCellStr(name, axis, strings.TrimSpace(cell)); err != nil {
					return err
				}
			}
			row++
			if row > 5000 {
				break
			}
		}
		book.SetColWidth(name, "A", "A", 34)
		book.SetColWidth(name, "B", "F", 22)
		c.Progress(20+(i+1)*60/len(pages), fmt.Sprintf("Building sheet %d of %d", i+1, len(pages)))
	}
	out := c.OutPath(baseName(in.Name) + ".xlsx")
	c.Progress(85, "Writing workbook")
	if err := book.SaveAs(out); err != nil {
		return fmt.Errorf("write XLSX: %w", err)
	}
	c.SetMeta("sheets", len(pages))
	if _, err := c.AddOutput(filepath.Base(out), MIMEForName(out), "file", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func extractImages(c *Context) error {
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
	dir := c.TempPath("embedded")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	c.Progress(15, "Scanning embedded images")
	err = api.ExtractImagesFile(c.Ctx, in.Path, dir, sel, pdfConf(c.Password()))
	entries, _ := os.ReadDir(dir)
	var files []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		files = append(files, filepath.Join(dir, e.Name()))
	}
	sort.Strings(files)
	if len(files) == 0 {
		if err != nil {
			return fmt.Errorf("extract images: %w", err)
		}
		return fmt.Errorf("this PDF contains no extractable images")
	}
	if len(files) == 1 {
		dest := c.OutPath(filepath.Base(files[0]))
		if err := copyFile(files[0], dest); err != nil {
			return err
		}
		if _, err := c.AddOutput(filepath.Base(dest), MIMEForName(dest), "image", dest); err != nil {
			return err
		}
	} else {
		var renamed []string
		for i, f := range files {
			dest := filepath.Join(dir, fmt.Sprintf("%s-image-%03d%s", baseName(in.Name), i+1, filepath.Ext(f)))
			_ = os.Rename(f, dest)
			renamed = append(renamed, dest)
		}
		zipPath := c.OutPath(baseName(in.Name) + "-images.zip")
		c.Progress(80, "Packaging images")
		if err := zipFiles(zipPath, renamed); err != nil {
			return err
		}
		if _, err := c.AddOutput(filepath.Base(zipPath), "application/zip", "zip", zipPath); err != nil {
			return err
		}
	}
	c.SetMeta("images", len(files))
	c.Progress(100, "Ready")
	return nil
}
