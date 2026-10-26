package tools

import (
	"archive/zip"
	"context"
	"encoding/xml"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/chromedp/chromedp"
	"github.com/go-pdf/fpdf"
	"github.com/xuri/excelize/v2"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
)

func init() {
	Register(&Tool{
		ID: "jpg-to-pdf", Name: "Image to PDF", Group: "convert",
		Description: "Turn JPG, PNG, WebP, GIF and TIFF images into a tidy PDF.",
		Run:         imagesToPDFTool,
	})
	Register(&Tool{
		ID: "word-to-pdf", Name: "Word to PDF", Group: "convert",
		Description: "Convert DOCX documents to PDF with layout-aware rendering.",
		Run:         wordToPDF,
	})
	Register(&Tool{
		ID: "powerpoint-to-pdf", Name: "PowerPoint to PDF", Group: "convert",
		Description: "Convert PPTX slide decks to PDF.",
		Run:         powerpointToPDF,
	})
	Register(&Tool{
		ID: "excel-to-pdf", Name: "Excel to PDF", Group: "convert",
		Description: "Convert XLSX workbooks to clean, paginated PDF tables.",
		Run:         excelToPDF,
	})
	Register(&Tool{
		ID: "html-to-pdf", Name: "HTML to PDF", Group: "convert",
		Description: "Render a web page or HTML file to PDF with headless Chrome.",
		Requires:    []string{"chrome"},
		AllowNoInput: true,
		Run:         htmlToPDF,
	})
	Register(&Tool{
		ID: "scan-to-pdf", Name: "Scan to PDF", Group: "convert",
		Description: "Clean up phone scans and combine them into one document.",
		Run:         scanToPDF,
	})
}

func imagesToPDFTool(c *Context) error {
	ins, err := c.requireFiles(1, ".jpg", ".jpeg", ".png", ".webp", ".gif", ".tif", ".tiff", ".bmp")
	if err != nil {
		return err
	}
	return imagesToPDF(c, ins, baseName(ins[0].Name), false)
}

func scanToPDF(c *Context) error {
	ins, err := c.requireFiles(1, ".jpg", ".jpeg", ".png", ".webp", ".gif", ".tif", ".tiff", ".bmp")
	if err != nil {
		return err
	}
	return imagesToPDF(c, ins, "scan", true)
}

// imagesToPDF lays out one image per page, preserving aspect ratio.
func imagesToPDF(c *Context, ins []Input, name string, scan bool) error {
	pageSize := strings.ToLower(c.Str("pageSize", "fit"))
	orientation := strings.ToLower(c.Str("orientation", "auto"))
	margin := c.Float("margin", 0)
	if margin < 0 {
		margin = 0
	}
	if margin > 120 {
		margin = 120
	}
	dpi := c.Float("dpi", 96)
	if dpi < 48 {
		dpi = 48
	}
	if dpi > 600 {
		dpi = 600
	}
	gray := scan && c.Bool("grayscale", true)
	contrast := 0.0
	if scan {
		contrast = c.Float("contrast", 1.15)
		if contrast < 0.5 {
			contrast = 0.5
		}
		if contrast > 2.5 {
			contrast = 2.5
		}
	}

	pdf := fpdf.NewCustom(&fpdf.InitType{UnitStr: "pt", Size: fpdf.SizeType{Wd: 595, Ht: 842}, OrientationStr: "P"})
	pdf.SetMargins(0, 0, 0)
	pdf.SetAutoPageBreak(false, 0)
	pdf.SetCompression(true)
	pdf.SetCreator("PaperLab", true)
	pdf.SetTitle(name, true)

	for i, in := range ins {
		imgPath := in.Path
		cfg, format, err := decodeImageConfig(in.Path)
		if err != nil {
			return fmt.Errorf("%s: unsupported or damaged image (%v)", in.Name, err)
		}
		if format == "webp" || format == "tiff" || format == "bmp" || gray || contrast != 1.0 {
			converted, err := convertImage(c, in.Path, i, gray, contrast)
			if err != nil {
				return fmt.Errorf("%s: %w", in.Name, err)
			}
			imgPath = converted
			cfg, _, _ = decodeImageConfig(converted)
		}
		pxW, pxH := float64(cfg.Width), float64(cfg.Height)
		if pxW <= 0 || pxH <= 0 {
			return fmt.Errorf("%s: could not read image dimensions", in.Name)
		}
		var pw, ph float64
		landscape := pxW > pxH
		switch pageSize {
		case "a4":
			pw, ph = 595.28, 841.89
		case "letter":
			pw, ph = 612, 792
		case "a3":
			pw, ph = 841.89, 1190.55
		default:
			pw, ph = pxW/dpi*72+margin*2, pxH/dpi*72+margin*2
		}
		if pageSize != "fit" {
			if (orientation == "landscape") || (orientation == "auto" && landscape) {
				pw, ph = ph, pw
			}
		}
		availW := pw - margin*2
		availH := ph - margin*2
		if availW <= 1 || availH <= 1 {
			return fmt.Errorf("the margin leaves no room for the image")
		}
		scale := availW / pxW
		if s := availH / pxH; s < scale {
			scale = s
		}
		w, h := pxW*scale, pxH*scale
		x := (pw - w) / 2
		y := (ph - h) / 2
		pdf.AddPageFormat("P", fpdf.SizeType{Wd: pw, Ht: ph})
		opts := fpdf.ImageOptions{ImageType: imageTypeFor(imgPath), ReadDpi: false, AllowNegativePosition: true}
		pdf.ImageOptions(imgPath, x, y, w, h, false, opts, 0, "")
		c.Progress(5+(i+1)*85/len(ins), fmt.Sprintf("Adding image %d of %d", i+1, len(ins)))
	}
	out := c.OutPath(name + "-images.pdf")
	if err := pdf.OutputFileAndClose(out); err != nil {
		return fmt.Errorf("write PDF: %w", err)
	}
	c.SetMeta("pages", len(ins))
	c.SetMeta("images", len(ins))
	c.SetMeta("scan", scan)
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func imageTypeFor(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg":
		return "JPG"
	case ".png":
		return "PNG"
	default:
		return "PNG"
	}
}

func convertImage(c *Context, path string, index int, gray bool, contrast float64) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	img, _, err := image.Decode(f)
	f.Close()
	if err != nil {
		return "", fmt.Errorf("decode image: %w", err)
	}
	b := img.Bounds()
	rgba := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			r, g, bl, a := img.At(b.Min.X+x, b.Min.Y+y).RGBA()
			if gray {
				lum := 0.299*float64(r>>8) + 0.587*float64(g>>8) + 0.114*float64(bl>>8)
				lum = (lum-128)*contrast + 128
				if lum < 0 {
					lum = 0
				}
				if lum > 255 {
					lum = 255
				}
				v := uint8(lum)
				rgba.Set(x, y, color.RGBA{v, v, v, uint8(a >> 8)})
			} else {
				rgba.Set(x, y, color.RGBA{uint8(r >> 8), uint8(g >> 8), uint8(bl >> 8), uint8(a >> 8)})
			}
		}
	}
	out := c.TempPath(fmt.Sprintf("image-%03d.png", index))
	of, err := os.Create(out)
	if err != nil {
		return "", err
	}
	if err := png.Encode(of, rgba); err != nil {
		of.Close()
		return "", err
	}
	return out, of.Close()
}

// ---------------------------------------------------------------------------
// Word

func wordToPDF(c *Context) error {
	ins, err := c.requireFiles(1, ".docx", ".doc", ".rtf", ".odt")
	if err != nil {
		return err
	}
	in := ins[0]
	out := c.OutPath(baseName(in.Name) + ".pdf")
	if c.Engines.LibreOffice {
		c.Progress(15, "Converting with LibreOffice")
		if err := libreOfficeConvert(c, in.Path, out); err != nil {
			return err
		}
	} else {
		if !strings.EqualFold(filepath.Ext(in.Name), ".docx") {
			return fmt.Errorf("legacy .doc/.rtf/.odt files need LibreOffice on this server; upload a .docx instead")
		}
		c.Progress(15, "Reading document structure")
		doc, err := parseDOCX(in.Path)
		if err != nil {
			return err
		}
		if err := renderTextDocument(c, out, doc, baseName(in.Name)); err != nil {
			return err
		}
	}
	c.SetMeta("engine", engineName(c.Engines.LibreOffice, "libreoffice", "native"))
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

type docBlock struct {
	Text    string
	Heading int
	Bullet  bool
}

func parseDOCX(path string) ([]docBlock, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return nil, fmt.Errorf("open DOCX: %w", err)
	}
	defer zr.Close()
	var body io.ReadCloser
	for _, f := range zr.File {
		if f.Name == "word/document.xml" {
			body, err = f.Open()
			if err != nil {
				return nil, err
			}
			break
		}
	}
	if body == nil {
		return nil, fmt.Errorf("this file is not a valid DOCX document")
	}
	defer body.Close()
	type textNode struct {
		Text string `xml:",chardata"`
	}
	type paraProps struct {
		Style string `xml:"pStyle,attr"`
	}
	type paragraph struct {
		Props paraProps `xml:"pPr"`
		Runs  []textNode `xml:"r>t"`
	}
	type document struct {
		Paragraphs []paragraph `xml:"body>p"`
	}
	var doc document
	if err := xml.NewDecoder(body).Decode(&doc); err != nil {
		return nil, fmt.Errorf("parse DOCX: %w", err)
	}
	var blocks []docBlock
	for _, p := range doc.Paragraphs {
		var b strings.Builder
		for _, r := range p.Runs {
			b.WriteString(r.Text)
		}
		text := strings.TrimSpace(b.String())
		if text == "" {
			continue
		}
		heading := 0
		style := strings.ToLower(p.Props.Style)
		if strings.HasPrefix(style, "heading") || strings.HasPrefix(style, "title") {
			fmt.Sscanf(style, "heading%d", &heading)
			if heading == 0 {
				heading = 1
			}
		}
		blocks = append(blocks, docBlock{Text: text, Heading: heading})
	}
	if len(blocks) == 0 {
		return nil, fmt.Errorf("no readable text found in this document")
	}
	return blocks, nil
}

func renderTextDocument(c *Context, out string, blocks []docBlock, title string) error {
	pdf := fpdf.New("P", "pt", "A4", "")
	pdf.SetMargins(64, 64, 64)
	pdf.SetAutoPageBreak(true, 64)
	pdf.SetCompression(true)
	pdf.SetTitle(title, true)
	pdf.SetCreator("PaperLab", true)
	regular := addOverlayFont(pdf, "")
	bold := addOverlayFont(pdf, "B")
	pdf.AddPage()
	pdf.SetFont(bold, styleFor(bold, "B"), 22)
	pdf.SetTextColor(24, 24, 27)
	pdf.MultiCell(0, 28, title, "", "L", false)
	pdf.Ln(14)
	for _, b := range blocks {
		if b.Heading > 0 {
			size := 18.0
			switch b.Heading {
			case 2:
				size = 15
			case 3, 4:
				size = 13
			}
			pdf.Ln(8)
			pdf.SetFont(bold, styleFor(bold, "B"), size)
			pdf.SetTextColor(24, 24, 27)
			pdf.MultiCell(0, size*1.35, b.Text, "", "L", false)
			pdf.Ln(4)
			continue
		}
		pdf.SetFont(regular, styleFor(regular, ""), 11)
		pdf.SetTextColor(48, 48, 52)
		if b.Bullet {
			pdf.MultiCell(0, 17, "•  "+b.Text, "", "L", false)
		} else {
			pdf.MultiCell(0, 17, b.Text, "", "L", false)
		}
		pdf.Ln(4)
	}
	if err := pdf.OutputFileAndClose(out); err != nil {
		return fmt.Errorf("write PDF: %w", err)
	}
	return nil
}

func styleFor(family, want string) string {
	if strings.HasPrefix(family, "Overlay") {
		return want
	}
	return ""
}

// ---------------------------------------------------------------------------
// PowerPoint

func powerpointToPDF(c *Context) error {
	ins, err := c.requireFiles(1, ".pptx", ".ppt", ".odp")
	if err != nil {
		return err
	}
	in := ins[0]
	out := c.OutPath(baseName(in.Name) + ".pdf")
	if c.Engines.LibreOffice {
		c.Progress(15, "Converting with LibreOffice")
		if err := libreOfficeConvert(c, in.Path, out); err != nil {
			return err
		}
	} else {
		if !strings.EqualFold(filepath.Ext(in.Name), ".pptx") {
			return fmt.Errorf("legacy .ppt/.odp files need LibreOffice on this server; upload a .pptx instead")
		}
		slides, err := parsePPTX(in.Path)
		if err != nil {
			return err
		}
		c.Progress(20, "Rendering slides")
		if err := renderSlides(c, out, slides, baseName(in.Name)); err != nil {
			return err
		}
	}
	c.SetMeta("engine", engineName(c.Engines.LibreOffice, "libreoffice", "native"))
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

type slideContent struct {
	Title string
	Lines []string
}

func parsePPTX(path string) ([]slideContent, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return nil, fmt.Errorf("open PPTX: %w", err)
	}
	defer zr.Close()
	var names []string
	for _, f := range zr.File {
		if strings.HasPrefix(f.Name, "ppt/slides/slide") && strings.HasSuffix(f.Name, ".xml") {
			names = append(names, f.Name)
		}
	}
	sort.Slice(names, func(i, j int) bool { return slideNumber(names[i]) < slideNumber(names[j]) })
	if len(names) == 0 {
		return nil, fmt.Errorf("this file is not a valid PPTX presentation")
	}
	var slides []slideContent
	for _, name := range names {
		var f *zip.File
		for _, candidate := range zr.File {
			if candidate.Name == name {
				f = candidate
				break
			}
		}
		if f == nil {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		type textNode struct {
			Text string `xml:",chardata"`
		}
		type paragraph struct {
			Runs []textNode `xml:"r>t"`
		}
		type shape struct {
			Paragraphs []paragraph `xml:"txBody>p"`
		}
		type spTree struct {
			Shapes []shape `xml:"sp"`
		}
		type slide struct {
			Tree spTree `xml:"cSld>spTree"`
		}
		var s slide
		err = xml.NewDecoder(rc).Decode(&s)
		rc.Close()
		if err != nil {
			continue
		}
		sc := slideContent{}
		for _, shape := range s.Tree.Shapes {
			for _, p := range shape.Paragraphs {
				var b strings.Builder
				for _, r := range p.Runs {
					b.WriteString(r.Text)
				}
				text := strings.TrimSpace(b.String())
				if text == "" {
					continue
				}
				if sc.Title == "" {
					sc.Title = text
				} else {
					sc.Lines = append(sc.Lines, text)
				}
			}
		}
		if sc.Title == "" && len(sc.Lines) == 0 {
			sc.Title = fmt.Sprintf("Slide %d", len(slides)+1)
		}
		slides = append(slides, sc)
	}
	return slides, nil
}

func slideNumber(name string) int {
	base := filepath.Base(name)
	base = strings.TrimSuffix(base, ".xml")
	base = strings.TrimPrefix(base, "slide")
	n, _ := strconv.Atoi(base)
	return n
}

func renderSlides(c *Context, out string, slides []slideContent, title string) error {
	pdf := fpdf.NewCustom(&fpdf.InitType{UnitStr: "pt", Size: fpdf.SizeType{Wd: 960, Ht: 540}, OrientationStr: "L"})
	pdf.SetMargins(64, 56, 64)
	pdf.SetAutoPageBreak(true, 56)
	pdf.SetCompression(true)
	pdf.SetTitle(title, true)
	pdf.SetCreator("PaperLab", true)
	regular := addOverlayFont(pdf, "")
	bold := addOverlayFont(pdf, "B")
	for i, s := range slides {
		pdf.AddPageFormat("L", fpdf.SizeType{Wd: 960, Ht: 540})
		pdf.SetFillColor(250, 248, 243)
		pdf.Rect(0, 0, 960, 540, "F")
		pdf.SetFillColor(37, 71, 255)
		pdf.Rect(64, 48, 46, 6, "F")
		pdf.SetXY(64, 80)
		pdf.SetFont(bold, styleFor(bold, "B"), 30)
		pdf.SetTextColor(24, 24, 27)
		pdf.MultiCell(832, 38, s.Title, "", "L", false)
		pdf.Ln(18)
		pdf.SetFont(regular, styleFor(regular, ""), 17)
		pdf.SetTextColor(62, 62, 70)
		for _, line := range s.Lines {
			pdf.SetX(64)
			pdf.MultiCell(832, 26, "•  "+line, "", "L", false)
			pdf.Ln(4)
		}
		pdf.SetFont(regular, styleFor(regular, ""), 10)
		pdf.SetTextColor(150, 150, 155)
		pdf.SetXY(64, 500)
		pdf.CellFormat(100, 20, fmt.Sprintf("%d / %d", i+1, len(slides)), "", 0, "L", false, 0, "")
		c.Progress(20+(i+1)*70/len(slides), fmt.Sprintf("Rendering slide %d of %d", i+1, len(slides)))
	}
	if err := pdf.OutputFileAndClose(out); err != nil {
		return fmt.Errorf("write PDF: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Excel

func excelToPDF(c *Context) error {
	ins, err := c.requireFiles(1, ".xlsx", ".xls", ".csv", ".ods")
	if err != nil {
		return err
	}
	in := ins[0]
	out := c.OutPath(baseName(in.Name) + ".pdf")
	if c.Engines.LibreOffice && !strings.EqualFold(filepath.Ext(in.Name), ".csv") {
		c.Progress(15, "Converting with LibreOffice")
		if err := libreOfficeConvert(c, in.Path, out); err != nil {
			return err
		}
	} else {
		if strings.EqualFold(filepath.Ext(in.Name), ".xls") || strings.EqualFold(filepath.Ext(in.Name), ".ods") {
			return fmt.Errorf("legacy .xls/.ods files need LibreOffice on this server; upload an .xlsx or .csv instead")
		}
		c.Progress(15, "Reading workbook")
		if err := renderSpreadsheet(c, in.Path, out, baseName(in.Name)); err != nil {
			return err
		}
	}
	c.SetMeta("engine", engineName(c.Engines.LibreOffice, "libreoffice", "native"))
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func renderSpreadsheet(c *Context, path, out, title string) error {
	var sheets [][]string
	var sheetNames []string
	if strings.EqualFold(filepath.Ext(path), ".csv") {
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		lines := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")
		var rows []string
		for _, l := range lines {
			if strings.TrimSpace(l) == "" {
				continue
			}
			rows = append(rows, l)
		}
		sheets = append(sheets, rows)
		sheetNames = append(sheetNames, "Sheet 1")
	} else {
		f, err := excelize.OpenFile(path)
		if err != nil {
			return fmt.Errorf("open workbook: %w", err)
		}
		defer f.Close()
		for _, name := range f.GetSheetList() {
			rows, err := f.GetRows(name)
			if err != nil {
				continue
			}
			var flat []string
			for _, row := range rows {
				flat = append(flat, strings.Join(row, "\t"))
			}
			if len(flat) == 0 {
				continue
			}
			sheets = append(sheets, flat)
			sheetNames = append(sheetNames, name)
		}
	}
	if len(sheets) == 0 {
		return fmt.Errorf("no readable cells found in this workbook")
	}
	pdf := fpdf.NewCustom(&fpdf.InitType{UnitStr: "pt", Size: fpdf.SizeType{Wd: 842, Ht: 595}, OrientationStr: "L"})
	pdf.SetMargins(36, 36, 36)
	pdf.SetAutoPageBreak(true, 36)
	pdf.SetCompression(true)
	pdf.SetTitle(title, true)
	pdf.SetCreator("PaperLab", true)
	regular := addOverlayFont(pdf, "")
	bold := addOverlayFont(pdf, "B")
	for si, sheet := range sheets {
		pdf.AddPageFormat("L", fpdf.SizeType{Wd: 842, Ht: 595})
		pdf.SetFont(bold, styleFor(bold, "B"), 16)
		pdf.SetTextColor(24, 24, 27)
		pdf.CellFormat(0, 24, sheetNames[si], "", 1, "L", false, 0, "")
		pdf.Ln(6)
		pdf.SetFont(regular, styleFor(regular, ""), 9)
		for ri, row := range sheet {
			if pdf.GetY() > 550 {
				pdf.AddPageFormat("L", fpdf.SizeType{Wd: 842, Ht: 595})
				pdf.SetFont(regular, styleFor(regular, ""), 9)
			}
			cells := strings.Split(row, "\t")
			if ri == 0 {
				pdf.SetFillColor(238, 241, 255)
				pdf.SetTextColor(30, 42, 110)
			} else {
				pdf.SetFillColor(255, 255, 255)
				pdf.SetTextColor(40, 40, 44)
			}
			widths := columnWidths(sheet, len(cells), 770)
			for ci, cell := range cells {
				if ci >= len(widths) {
					break
				}
				align := "L"
				if _, err := strconv.ParseFloat(strings.TrimSpace(cell), 64); err == nil && cell != "" {
					align = "R"
				}
				pdf.CellFormat(widths[ci], 15, truncateText(cell, widths[ci], 8.5), "B", 0, align, true, 0, "")
			}
			pdf.Ln(-1)
			if ri%30 == 0 {
				c.Progress(20+ri/len(sheet), fmt.Sprintf("Laying out %s", sheetNames[si]))
			}
		}
	}
	if err := pdf.OutputFileAndClose(out); err != nil {
		return fmt.Errorf("write PDF: %w", err)
	}
	return nil
}

func columnWidths(rows []string, cols int, total float64) []float64 {
	if cols == 0 {
		return nil
	}
	max := make([]int, cols)
	for i, row := range rows {
		if i > 200 {
			break
		}
		for j, cell := range strings.Split(row, "\t") {
			if j >= cols {
				break
			}
			if len(cell) > max[j] {
				max[j] = len(cell)
			}
		}
	}
	sum := 0
	for _, m := range max {
		if m < 6 {
			m = 6
		}
		if m > 42 {
			m = 42
		}
		sum += m
	}
	widths := make([]float64, cols)
	for i, m := range max {
		if m < 6 {
			m = 6
		}
		if m > 42 {
			m = 42
		}
		widths[i] = total * float64(m) / float64(maxInt(sum, 1))
	}
	return widths
}

func truncateText(s string, width, charWidth float64) string {
	maxChars := int(width / charWidth)
	if maxChars < 2 {
		maxChars = 2
	}
	r := []rune(s)
	if len(r) <= maxChars {
		return s
	}
	if maxChars <= 1 {
		return string(r[:1])
	}
	return string(r[:maxChars-1]) + "…"
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// ---------------------------------------------------------------------------
// HTML

func htmlToPDF(c *Context) error {
	if c.Engines.ChromePath == "" {
		return fmt.Errorf("headless Chrome is not available on this server")
	}
	var target string
	var cleanup func()
	if ins, err := c.requireFiles(1, ".html", ".htm"); err == nil {
		in := ins[0]
		abs, _ := filepath.Abs(in.Path)
		target = "file://" + filepath.ToSlash(abs)
	} else if raw := strings.TrimSpace(c.Str("url", "")); raw != "" {
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
			return fmt.Errorf("enter a valid http(s) URL")
		}
		target = u.String()
	} else {
		return fmt.Errorf("upload an HTML file or enter a URL")
	}
	if cleanup != nil {
		defer cleanup()
	}
	c.Progress(10, "Starting headless Chrome")
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath(c.Engines.ChromePath),
		chromedp.Flag("headless", true),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-dev-shm-usage", true),
	)
	allocCtx, cancelAlloc := chromedp.NewExecAllocator(c.Ctx, opts...)
	defer cancelAlloc()
	browserCtx, cancelBrowser := chromedp.NewContext(allocCtx)
	defer cancelBrowser()

	paper := strings.ToLower(c.Str("paper", "a4"))
	landscape := c.Bool("landscape", false)
	printBackground := c.Bool("background", true)
	margin := c.Float("margin", 12)
	scale := c.Float("scale", 1)
	if scale < 0.5 {
		scale = 0.5
	}
	if scale > 2 {
		scale = 2
	}
	width, height := 8.27, 11.69
	switch paper {
	case "letter":
		width, height = 8.5, 11
	case "a3":
		width, height = 11.69, 16.54
	case "a5":
		width, height = 5.83, 8.27
	}
	if landscape {
		width, height = height, width
	}
	var pdfBytes []byte
	var err error
	doErr := chromedp.Do(browserCtx,
		chromedp.Navigate(target),
		chromedp.WaitReady("body"),
		chromedp.Sleep(600*time.Millisecond),
	)
	if doErr != nil {
		return fmt.Errorf("render page: %w", doErr)
	}
	runCtx, cancelRun := context.WithTimeout(browserCtx, 90*time.Second)
	defer cancelRun()
	pdfOpts := []chromedp.PDFOption{
		chromedp.PDFPaper(chromedp.PaperSize{Width: width, Height: height}),
		chromedp.PDFMargins(margin/25.4, margin/25.4, margin/25.4, margin/25.4),
		chromedp.PDFScale(scale),
	}
	if printBackground {
		pdfOpts = append(pdfOpts, chromedp.PDFPrintBackground())
	}
	pdfBytes, err = chromedp.Run(runCtx, chromedp.PrintToPDF(pdfOpts...))
	if err != nil {
		return fmt.Errorf("render page: %w", err)
	}
	if len(pdfBytes) == 0 {
		return fmt.Errorf("Chrome produced an empty PDF")
	}
	name := "web-page"
	if ins, err := c.requireFiles(1, ".html", ".htm"); err == nil {
		name = baseName(ins[0].Name)
	} else if raw := c.Str("url", ""); raw != "" {
		if u, err := url.Parse(raw); err == nil && u.Host != "" {
			name = u.Host
		}
	}
	out := c.OutPath(safeFileName(name) + ".pdf")
	if err := os.WriteFile(out, pdfBytes, 0o600); err != nil {
		return err
	}
	c.SetMeta("source", target)
	c.SetMeta("paper", paper)
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

// ---------------------------------------------------------------------------
// Shared helpers

func libreOfficeConvert(c *Context, in, out string) error {
	dir := c.TempPath("lo-out")
	_ = os.MkdirAll(dir, 0o700)
	args := []string{"--headless", "--norestore", "--convert-to", "pdf", "--outdir", dir, in}
	if _, err := c.Engines.RunCommand(c.Ctx, c.Engines.LibreOfficePath, args...); err != nil {
		return fmt.Errorf("LibreOffice conversion failed: %w", err)
	}
	produced := filepath.Join(dir, strings.TrimSuffix(filepath.Base(in), filepath.Ext(in))+".pdf")
	if _, err := os.Stat(produced); err != nil {
		matches, _ := filepath.Glob(filepath.Join(dir, "*.pdf"))
		if len(matches) == 0 {
			return fmt.Errorf("LibreOffice did not produce a PDF")
		}
		produced = matches[0]
	}
	return copyFile(produced, out)
}

func engineName(available bool, name, fallback string) string {
	if available {
		return name
	}
	return fallback
}
