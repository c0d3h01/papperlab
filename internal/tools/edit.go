package tools

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-pdf/fpdf"
	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

func init() {
	Register(&Tool{
		ID: "page-numbers", Name: "Page numbers", Group: "edit",
		Description: "Add elegant page numbers with position, size and format controls.",
		Run:         addPageNumbers,
	})
	Register(&Tool{
		ID: "watermark", Name: "Watermark", Group: "edit",
		Description: "Stamp text or an image over a PDF with precise opacity and rotation.",
		Run:         watermarkPDF,
	})
	Register(&Tool{
		ID: "edit", Name: "Edit PDF", Group: "edit",
		Description: "Add text, images, shapes and freehand marks to any page.",
		Run:         editPDF,
	})
	Register(&Tool{
		ID: "sign", Name: "Sign PDF", Group: "edit",
		Description: "Draw, type or upload a signature and place it on the page.",
		Run:         signPDF,
	})
	Register(&Tool{
		ID: "metadata", Name: "Edit metadata", Group: "edit",
		Description: "Inspect and rewrite title, author, subject, keywords and more.",
		Run:         editMetadata,
	})
}

func anchorFromString(pos string) types.Anchor {
	switch strings.ToLower(pos) {
	case "tl", "top-left":
		return types.TopLeft
	case "tc", "top-center":
		return types.TopCenter
	case "tr", "top-right":
		return types.TopRight
	case "l", "left":
		return types.Left
	case "r", "right":
		return types.Right
	case "bl", "bottom-left":
		return types.BottomLeft
	case "bc", "bottom-center":
		return types.BottomCenter
	case "br", "bottom-right":
		return types.BottomRight
	default:
		return types.Center
	}
}

func positionDesc(pos, color string, size int, opacity, rotation float64, offsetX, offsetY int, font string) string {
	if font == "" {
		font = "Helvetica"
	}
	desc := fmt.Sprintf("fontname:%s, points:%d, color:%s, pos:%s, offset:%d %d, opacity:%.2f",
		font, size, color, pos, offsetX, offsetY, opacity)
	if rotation != 0 {
		desc += fmt.Sprintf(", rotation:%.1f", rotation)
	}
	return desc
}

func addPageNumbers(c *Context) error {
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
	selected, err := api.PagesForSelection(pages, sel, true)
	if err != nil {
		return err
	}
	format := c.Str("format", "n")
	start := c.Int("start", 1)
	skipFirst := c.Bool("skipFirst", false)
	pos := c.Str("position", "bc")
	font := c.Str("font", "Helvetica")
	size := c.Int("fontSize", 11)
	color := c.Str("color", "#333333")
	opacity := c.Float("opacity", 1)
	offsetX := c.Int("offsetX", 0)
	offsetY := c.Int("offsetY", 24)
	if offsetY == 0 {
		offsetY = 24
	}
	conf := pdfConf(c.Password())
	wms := map[int]*model.Watermark{}
	number := start
	for p := 1; p <= pages; p++ {
		if !selected[p] {
			continue
		}
		if skipFirst && p == 1 {
			continue
		}
		label := ""
		switch format {
		case "n-of-total":
			label = fmt.Sprintf("%d / %d", number, pages)
		case "page-n-of-total":
			label = fmt.Sprintf("Page %d of %d", number, pages)
		case "n":
			label = strconv.Itoa(number)
		default:
			label = fmt.Sprintf("%d / %d", number, pages)
		}
		desc := positionDesc(pos, color, size, opacity, 0, offsetX, offsetY, font)
		wm, err := api.TextWatermark(c.Ctx, label, desc, true, false, types.POINTS, conf)
		if err != nil {
			return fmt.Errorf("configure page number: %w", err)
		}
		wms[p] = wm
		number++
	}
	if len(wms) == 0 {
		return fmt.Errorf("no pages selected")
	}
	out := c.OutPath(baseName(in.Name) + "-numbered.pdf")
	c.Progress(30, "Adding page numbers")
	if err := api.AddWatermarksMapFile(c.Ctx, in.Path, out, wms, conf); err != nil {
		return fmt.Errorf("add page numbers: %w", err)
	}
	c.SetMeta("numberedPages", len(wms))
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func watermarkPDF(c *Context) error {
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
	kind := c.Str("kind", "text")
	out := c.OutPath(baseName(in.Name) + "-watermarked.pdf")
	conf := pdfConf(c.Password())
	if kind == "image" {
		assets := c.InputsByRole("assets")
		if len(assets) == 0 {
			return fmt.Errorf("upload a watermark image")
		}
		img := assets[0]
		desc := fmt.Sprintf("pos:%s, offset:%d %d, scale:%.3f, opacity:%.2f, rot:%.1f",
			c.Str("position", "c"), c.Int("offsetX", 0), c.Int("offsetY", 0),
			c.Float("scale", 0.25), c.Float("opacity", 0.3), c.Float("rotation", 0))
		c.Progress(30, "Stamping image watermark")
		if err := api.AddImageWatermarksFile(c.Ctx, in.Path, out, sel, true, img.Path, desc, conf); err != nil {
			return fmt.Errorf("add image watermark: %w", err)
		}
		c.SetMeta("watermark", "image")
		c.SetMeta("image", img.Name)
	} else {
		text := strings.TrimSpace(c.Str("text", "CONFIDENTIAL"))
		if text == "" {
			return fmt.Errorf("enter watermark text")
		}
		rotation := c.Float("rotation", 45)
		diagonal := c.Bool("diagonal", true)
		if diagonal {
			rotation = 0
		}
		desc := positionDesc(c.Str("position", "c"), c.Str("color", "#ff5c35"),
			c.Int("fontSize", 48), c.Float("opacity", 0.25), rotation,
			0, 0, c.Str("font", "Helvetica"))
		if diagonal {
			desc += ", diagonal:1"
		}
		c.Progress(30, "Stamping text watermark")
		if err := api.AddTextWatermarksFile(c.Ctx, in.Path, out, sel, true, text, desc, conf); err != nil {
			return fmt.Errorf("add text watermark: %w", err)
		}
		c.SetMeta("watermark", "text")
		c.SetMeta("text", text)
	}
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

// overlayFontPath finds a Unicode font for editor overlays.
func overlayFontPath(bold bool) string {
	candidates := []string{}
	if bold {
		candidates = append(candidates, "web/assets/fonts/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
	} else {
		candidates = append(candidates, "web/assets/fonts/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
	}
	if bold {
		candidates = append(candidates, "/System/Library/Fonts/Supplemental/Arial Bold.ttf")
	} else {
		candidates = append(candidates, "/System/Library/Fonts/Supplemental/Arial Unicode.ttf")
	}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

func addOverlayFont(pdf *fpdf.Fpdf, style string) string {
	path := overlayFontPath(style == "B")
	if path == "" {
		return "Helvetica"
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return "Helvetica"
	}
	family := "Overlay"
	if style == "B" {
		family = "OverlayBold"
	}
	// AddUTF8FontFromBytes avoids fpdf's font-directory path handling, which
	// breaks when the configured directory is empty and the font path is absolute.
	pdf.AddUTF8FontFromBytes(family, style, data)
	return family
}

type overlayElement struct {
	Page       int       `json:"page"`
	Type       string    `json:"type"`
	X          float64   `json:"x"`
	Y          float64   `json:"y"`
	W          float64   `json:"w"`
	H          float64   `json:"h"`
	Text       string    `json:"text"`
	Color      string    `json:"color"`
	Fill       string    `json:"fill"`
	FontSize   float64   `json:"fontSize"`
	FontFamily string    `json:"fontFamily"`
	Bold       bool      `json:"bold"`
	Italic     bool      `json:"italic"`
	Opacity    float64   `json:"opacity"`
	LineWidth  float64   `json:"lineWidth"`
	Points     []float64 `json:"points"`
	Image      string    `json:"image"`
	Align      string    `json:"align"`
}

func decodeElements(c *Context) ([]overlayElement, error) {
	var out []overlayElement
	for _, m := range c.MapSlice("elements") {
		el := overlayElement{
			Page: intFromAny(m["page"], 1), Type: strFromAny(m["type"]),
			X: floatFromAny(m["x"], 0), Y: floatFromAny(m["y"], 0),
			W: floatFromAny(m["w"], 0.2), H: floatFromAny(m["h"], 0.05),
			Text: strFromAny(m["text"]), Color: strFromAny(m["color"]),
			Fill: strFromAny(m["fill"]), FontSize: floatFromAny(m["fontSize"], 18),
			FontFamily: strFromAny(m["fontFamily"]), Bold: boolFromAny(m["bold"]),
			Italic: boolFromAny(m["italic"]), Opacity: floatFromAny(m["opacity"], 1),
			LineWidth: floatFromAny(m["lineWidth"], 2), Image: strFromAny(m["image"]),
			Align: strFromAny(m["align"]),
		}
		if el.Opacity <= 0 || el.Opacity > 1 {
			el.Opacity = 1
		}
		if el.Type == "" || el.Type == "<nil>" {
			continue
		}
		for _, p := range sliceFromAny(m["points"]) {
			el.Points = append(el.Points, floatFromAny(p, 0))
		}
		out = append(out, el)
	}
	return out, nil
}

func editPDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	dims, pages, err := pageDims(in.Path, c.Password())
	if err != nil {
		return fmt.Errorf("%s: %w", in.Name, err)
	}
	elements, err := decodeElements(c)
	if err != nil {
		return err
	}
	if len(elements) == 0 {
		return fmt.Errorf("add at least one element before exporting")
	}
	c.Progress(10, "Preparing editor canvas")
	overlay := c.TempPath("edit-overlay.pdf")
	if err := buildOverlay(c, overlay, dims, pages, elements); err != nil {
		return err
	}
	out := c.OutPath(baseName(in.Name) + "-edited.pdf")
	c.Progress(70, "Baking edits into the document")
	if err := stampOverlay(c, in.Path, overlay, out); err != nil {
		return err
	}
	c.SetMeta("elements", len(elements))
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func buildOverlay(c *Context, overlay string, dims []PageSize, pages int, elements []overlayElement) error {
	pdf := fpdf.NewCustom(&fpdf.InitType{UnitStr: "pt", Size: fpdf.SizeType{Wd: dims[0].Width, Ht: dims[0].Height}, OrientationStr: "P"})
	pdf.SetMargins(0, 0, 0)
	pdf.SetAutoPageBreak(false, 0)
	pdf.SetCompression(true)
	// Register Unicode fonts once. Falls back to a core font.
	regular := addOverlayFont(pdf, "")
	bold := addOverlayFont(pdf, "B")
	for i := 0; i < pages; i++ {
		pdf.AddPageFormat("P", fpdf.SizeType{Wd: dims[i].Width, Ht: dims[i].Height})
		// fpdf drops trailing pages that never receive content. An empty text
		// cell keeps every overlay page addressable as a PDF stamp source.
		pdf.SetFont("Helvetica", "", 1)
		pdf.SetXY(0, 0)
		pdf.Cell(0, 0, "")
	}
	for idx, el := range elements {
		if el.Page < 1 || el.Page > pages {
			continue
		}
		pdf.SetPage(el.Page)
		page := dims[el.Page-1]
		x := el.X * page.Width
		y := el.Y * page.Height
		w := el.W * page.Width
		h := el.H * page.Height
		switch el.Type {
		case "text":
			size := el.FontSize
			if size < 6 {
				size = 18
			}
			useFamily := regular
			useStyle := ""
			if el.Bold {
				useFamily = bold
				useStyle = "B"
			}
			pdf.SetFont(useFamily, useStyle, size)
			r, g, b := parseHexRGB(el.Color, 17, 17, 17)
			pdf.SetTextColor(r, g, b)
			pdf.SetAlpha(el.Opacity, "Normal")
			pdf.SetXY(x, y)
			align := "L"
			if el.Align == "center" {
				align = "C"
			} else if el.Align == "right" {
				align = "R"
			}
			lineHeight := size * 1.25
			pdf.MultiCell(w, lineHeight, el.Text, "", align, false)
			pdf.SetAlpha(1, "Normal")
		case "rect", "highlight":
			r, g, b := parseHexRGB(el.Color, 37, 71, 255)
			fr, fg, fb := parseHexRGB(el.Fill, 255, 238, 0)
			pdf.SetDrawColor(r, g, b)
			pdf.SetFillColor(fr, fg, fb)
			pdf.SetLineWidth(el.LineWidth)
			pdf.SetAlpha(el.Opacity, "Normal")
			style := "D"
			if el.Type == "highlight" || el.Fill != "" {
				style = "DF"
			}
			pdf.Rect(x, y, w, h, style)
			pdf.SetAlpha(1, "Normal")
		case "ellipse":
			r, g, b := parseHexRGB(el.Color, 37, 71, 255)
			pdf.SetDrawColor(r, g, b)
			pdf.SetLineWidth(el.LineWidth)
			pdf.SetAlpha(el.Opacity, "Normal")
			pdf.Ellipse(x+w/2, y+h/2, w/2, h/2, 0, "D")
			pdf.SetAlpha(1, "Normal")
		case "line":
			r, g, b := parseHexRGB(el.Color, 37, 71, 255)
			pdf.SetDrawColor(r, g, b)
			pdf.SetLineWidth(el.LineWidth)
			pdf.SetAlpha(el.Opacity, "Normal")
			if len(el.Points) >= 4 {
				pdf.Line(el.Points[0]*page.Width, el.Points[1]*page.Height, el.Points[2]*page.Width, el.Points[3]*page.Height)
			} else {
				pdf.Line(x, y, x+w, y+h)
			}
			pdf.SetAlpha(1, "Normal")
		case "ink":
			if len(el.Points) < 4 {
				continue
			}
			r, g, b := parseHexRGB(el.Color, 17, 17, 17)
			pdf.SetDrawColor(r, g, b)
			pdf.SetLineWidth(el.LineWidth)
			pdf.SetAlpha(el.Opacity, "Normal")
			pdf.MoveTo(el.Points[0]*page.Width, el.Points[1]*page.Height)
			for i := 2; i+1 < len(el.Points); i += 2 {
				pdf.LineTo(el.Points[i]*page.Width, el.Points[i+1]*page.Height)
			}
			pdf.DrawPath("D")
			pdf.SetAlpha(1, "Normal")
		case "image", "signature":
			if el.Image == "" {
				continue
			}
			imgPath := c.TempPath(fmt.Sprintf("element-%03d.png", idx))
			if err := dataURLToFile(el.Image, imgPath); err != nil {
				return err
			}
			opts := fpdf.ImageOptions{ImageType: "PNG", ReadDpi: false, AllowNegativePosition: true}
			pdf.SetAlpha(el.Opacity, "Normal")
			pdf.ImageOptions(imgPath, x, y, w, h, false, opts, 0, "")
			pdf.SetAlpha(1, "Normal")
		}
	}
	// putpages uses the current page as the page count. Return to the last page
	// so every overlay page is written, including blank trailing pages.
	pdf.SetPage(pages)
	return pdf.OutputFileAndClose(overlay)
}

func stampOverlay(c *Context, base, overlay, out string) error {
	pages, err := pageCount(base, c.Password())
	if err != nil {
		return err
	}
	// qpdf overlays the source pages as ordinary form XObjects. Unlike a
	// pdfcpu watermark, the result keeps text selectable and avoids wrapping
	// the editor content in a watermark artifact.
	if c.Engines != nil && c.Engines.QPDF {
		args := []string{base, out}
		if pw := c.Password(); pw != "" {
			args = append(args, "--password="+pw)
		}
		args = append(args,
			"--overlay", "--file="+overlay,
			fmt.Sprintf("--from=1-%d", pages),
			fmt.Sprintf("--to=1-%d", pages),
			"--",
		)
		c.Progress(75, "Applying overlay")
		if _, err := c.Engines.RunCommand(c.Ctx, c.Engines.QPDFPath, args...); err == nil {
			if st, statErr := os.Stat(out); statErr == nil && st.Size() > 0 {
				return nil
			}
		}
	}
	conf := pdfConf(c.Password())
	wms := map[int]*model.Watermark{}
	var readers []*os.File
	defer func() {
		for _, f := range readers {
			_ = f.Close()
		}
	}()
	for p := 1; p <= pages; p++ {
		f, err := os.Open(overlay)
		if err != nil {
			return err
		}
		readers = append(readers, f)
		wm := model.DefaultWatermarkConfig()
		wm.Mode = model.WMPDF
		wm.PDF = f
		wm.PdfPageNrSrc = p
		wm.PdfMultiStartPageNrSrc = 1
		wm.PdfMultiStartPageNrDest = 1
		wm.OnTop = true
		wm.Pos = types.Center
		wm.Scale = 1
		wm.ScaleAbs = true
		wm.Opacity = 1
		wm.Diagonal = model.NoDiagonal
		wm.Rotation = 0
		wm.UserRotOrDiagonal = true
		wms[p] = wm
	}
	c.Progress(75, "Applying overlay")
	if err := api.AddWatermarksMapFile(c.Ctx, base, out, wms, conf); err == nil {
		return nil
	}
	// Fallback: apply one source page at a time. This is slower but works on
	// older pdfcpu releases that only support a single multi-stamp source.
	current := base
	for p := 1; p <= pages; p++ {
		f, err := os.Open(overlay)
		if err != nil {
			return err
		}
		tmp := c.TempPath(fmt.Sprintf("stamped-%04d.pdf", p))
		desc := "pos:c, scale:1 abs, opacity:1"
		err = api.AddPDFWatermarksForReadSeekerFile(c.Ctx, current, tmp, []string{strconv.Itoa(p)}, true, f, p, desc, conf)
		f.Close()
		if err != nil {
			return fmt.Errorf("stamp overlay page %d: %w", p, err)
		}
		current = tmp
		c.Progress(75+p*20/max(1, pages), fmt.Sprintf("Applying overlay %d/%d", p, pages))
	}
	return copyFile(current, out)
}

func signPDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	dims, pages, err := pageDims(in.Path, c.Password())
	if err != nil {
		return fmt.Errorf("%s: %w", in.Name, err)
	}
	placements := c.MapSlice("placements")
	if len(placements) == 0 {
		return fmt.Errorf("place your signature on at least one page")
	}
	var elements []overlayElement
	for _, m := range placements {
		el := overlayElement{
			Page: intFromAny(m["page"], 1), Type: "signature",
			X: floatFromAny(m["x"], 0.65), Y: floatFromAny(m["y"], 0.75),
			W: floatFromAny(m["w"], 0.25), H: floatFromAny(m["h"], 0.1),
			Image: strFromAny(m["image"]), Opacity: 1,
		}
		if el.Image == "" || el.Image == "<nil>" {
			continue
		}
		elements = append(elements, el)
	}
	if len(elements) == 0 {
		return fmt.Errorf("a signature image is required")
	}
	signer := strings.TrimSpace(c.Str("signer", ""))
	if signer == "" {
		signer = "PaperLab signer"
	}
	overlay := c.TempPath("signature-overlay.pdf")
	c.Progress(15, "Building signature overlay")
	if err := buildOverlay(c, overlay, dims, pages, elements); err != nil {
		return err
	}
	stamped := c.OutPath(baseName(in.Name) + "-signed.pdf")
	c.Progress(55, "Applying signature")
	if err := stampOverlay(c, in.Path, overlay, stamped); err != nil {
		return err
	}
	inputHash := sha256File(in.Path)
	now := time.Now()
	if c.Bool("certificatePage", true) {
		cert := c.TempPath("signature-certificate.pdf")
		if err := buildSignatureCertificate(cert, signer, c.Str("email", ""), c.Str("reason", "Approved"), now, inputHash); err != nil {
			return err
		}
		merged := c.TempPath("signed-with-certificate.pdf")
		c.Progress(80, "Adding signature certificate")
		if err := api.MergeCreateFile(c.Ctx, []string{stamped, cert}, merged, false, pdfConf("")); err != nil {
			return fmt.Errorf("append certificate: %w", err)
		}
		stamped = merged
	}
	finalOut := c.OutPath(baseName(in.Name) + "-signed.pdf")
	if stamped != finalOut {
		if err := copyFile(stamped, finalOut); err != nil {
			return err
		}
	}
	outputHash := sha256File(finalOut)
	safePlacements := make([]map[string]any, 0, len(elements))
	for _, el := range elements {
		safePlacements = append(safePlacements, map[string]any{
			"page": el.Page, "x": el.X, "y": el.Y, "w": el.W, "h": el.H,
		})
	}
	audit := map[string]any{
		"signer": signer, "email": c.Str("email", ""), "reason": c.Str("reason", "Approved"),
		"signedAt": now.UTC().Format(time.RFC3339), "document": filepath.Base(in.Name),
		"inputSha256": inputHash, "outputSha256": outputHash,
		"signatureType": "electronic signature (not a qualified digital signature)",
		"placements":    safePlacements,
	}
	auditBytes, _ := json.MarshalIndent(audit, "", "  ")
	auditPath := c.OutPath(baseName(in.Name) + "-signature-audit.json")
	if err := writeText(auditPath, string(auditBytes)); err != nil {
		return err
	}
	c.SetMeta("signer", signer)
	c.SetMeta("signedAt", now.UTC().Format(time.RFC3339))
	c.SetMeta("certificatePage", c.Bool("certificatePage", true))
	c.SetMeta("inputSha256", inputHash)
	if _, err := c.AddOutput(filepath.Base(finalOut), "application/pdf", "pdf", finalOut); err != nil {
		return err
	}
	if _, err := c.AddOutput(filepath.Base(auditPath), "application/json", "json", auditPath); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func buildSignatureCertificate(path, signer, email, reason string, at time.Time, hash string) error {
	pdf := fpdf.New("P", "pt", "A4", "")
	pdf.SetMargins(56, 56, 56)
	pdf.SetAutoPageBreak(true, 56)
	pdf.AddPage()
	pdf.SetFont("Helvetica", "B", 24)
	pdf.SetTextColor(17, 17, 17)
	pdf.CellFormat(0, 36, "Signature record", "", 1, "L", false, 0, "")
	pdf.SetFont("Helvetica", "", 11)
	pdf.SetTextColor(90, 90, 90)
	pdf.MultiCell(0, 16, "This page records an electronic signature applied with PaperLab. It is a visible, auditable signature, not a certificate-based qualified digital signature.", "", "L", false)
	pdf.Ln(20)
	rows := [][2]string{
		{"Signer", signer},
		{"Email", email},
		{"Reason", reason},
		{"Signed at", at.UTC().Format("2 Jan 2006 15:04:05 UTC")},
		{"Source SHA-256", hash},
	}
	for _, row := range rows {
		pdf.SetFont("Helvetica", "B", 9)
		pdf.SetTextColor(120, 120, 120)
		pdf.CellFormat(110, 22, strings.ToUpper(row[0]), "", 0, "L", false, 0, "")
		pdf.SetFont("Courier", "", 9)
		pdf.SetTextColor(17, 17, 17)
		pdf.MultiCell(0, 22, row[1], "", "L", false)
	}
	pdf.Ln(16)
	pdf.SetDrawColor(220, 220, 220)
	pdf.Line(56, pdf.GetY(), 539, pdf.GetY())
	pdf.Ln(18)
	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(120, 120, 120)
	pdf.MultiCell(0, 14, "Verify the output SHA-256 in the accompanying audit JSON. Keep both files together for a complete signature record.", "", "L", false)
	return pdf.OutputFileAndClose(path)
}

func editMetadata(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	conf := pdfConf(c.Password())
	info, _ := c.infoFor(in.Path, c.Password())
	old := map[string]string{}
	if info != nil {
		old = map[string]string{
			"Title": info.Title, "Author": info.Author, "Subject": info.Subject,
			"Creator": info.Creator, "Producer": info.Producer,
			"CreationDate": info.CreationDate, "ModificationDate": info.ModificationDate,
			"Keywords": strings.Join(info.Keywords, ", "),
		}
	}
	fields := map[string]string{
		"Title": c.Str("title", ""), "Author": c.Str("author", ""),
		"Subject": c.Str("subject", ""), "Creator": c.Str("creator", ""),
	}
	keywords := strings.TrimSpace(c.Str("keywords", ""))
	out := c.OutPath(baseName(in.Name) + "-metadata.pdf")
	c.Progress(20, "Rewriting document properties")
	props := map[string]string{}
	var remove []string
	for k, v := range fields {
		if strings.TrimSpace(v) == "" {
			if _, existed := old[k]; existed {
				remove = append(remove, k)
			}
			continue
		}
		props[k] = v
	}
	if len(props) > 0 {
		if err := api.AddPropertiesFile(c.Ctx, in.Path, out, props, conf); err != nil {
			return fmt.Errorf("update metadata: %w", err)
		}
	} else if err := copyFile(in.Path, out); err != nil {
		return err
	}
	current := out
	if len(remove) > 0 {
		tmp := c.TempPath("metadata-clean.pdf")
		if err := api.RemovePropertiesFile(c.Ctx, current, tmp, remove, conf); err != nil {
			return fmt.Errorf("remove metadata: %w", err)
		}
		current = tmp
	}
	if keywords != "" {
		tmp := c.TempPath("metadata-keywords.pdf")
		kw := strings.Split(keywords, ",")
		for i := range kw {
			kw[i] = strings.TrimSpace(kw[i])
		}
		if err := api.AddKeywordsFile(c.Ctx, current, tmp, kw, conf); err != nil {
			return fmt.Errorf("set keywords: %w", err)
		}
		current = tmp
	}
	if current != out {
		if err := copyFile(current, out); err != nil {
			return err
		}
	}
	c.SetMeta("before", old)
	c.SetMeta("after", map[string]string{
		"Title": c.Str("title", ""), "Author": c.Str("author", ""),
		"Subject": c.Str("subject", ""), "Keywords": keywords,
	})
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func parseHexRGB(raw string, dr, dg, db int) (int, int, int) {
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "#")
	if len(s) == 3 {
		s = string([]byte{s[0], s[0], s[1], s[1], s[2], s[2]})
	}
	if len(s) != 6 {
		return dr, dg, db
	}
	v, err := strconv.ParseUint(s, 16, 32)
	if err != nil {
		return dr, dg, db
	}
	return int((v >> 16) & 0xff), int((v >> 8) & 0xff), int(v & 0xff)
}

func boolFromAny(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		return strings.EqualFold(x, "true") || x == "1"
	case float64:
		return x != 0
	case json.Number:
		return x.String() != "0"
	}
	return false
}

func strFromAny(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}

func sliceFromAny(v any) []any {
	if s, ok := v.([]any); ok {
		return s
	}
	return nil
}

func sha256File(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	return hex.EncodeToString(h.Sum(nil))
}
