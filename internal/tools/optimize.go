package tools

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-pdf/fpdf"
	"github.com/pdfcpu/pdfcpu/pkg/api"
)

func init() {
	Register(&Tool{
		ID: "compress", Name: "Compress PDF", Group: "optimize",
		Description: "Shrink PDFs with quality presets and image downsampling.",
		Run:         compressPDF,
	})
	Register(&Tool{
		ID: "repair", Name: "Repair PDF", Group: "optimize",
		Description: "Rebuild broken cross-reference tables and recover content.",
		Run:         repairPDF,
	})
	Register(&Tool{
		ID: "ocr", Name: "OCR PDF", Group: "optimize",
		Description: "Make scanned pages searchable with Tesseract OCR.",
		Requires:    []string{"tesseract", "poppler"},
		Run:         ocrPDF,
	})
	Register(&Tool{
		ID: "pdfa", Name: "PDF to PDF/A", Group: "optimize",
		Description: "Convert to the ISO archiving profile PDF/A-2b.",
		Requires:    []string{"ghostscript"},
		Run:         pdfToPDFA,
	})
	Register(&Tool{
		ID: "flatten", Name: "Flatten PDF", Group: "optimize",
		Description: "Bake annotations, forms and transparency into page images.",
		Requires:    []string{"poppler"},
		Run:         flattenPDF,
	})
}

func compressPDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	level := c.Str("level", "balanced")
	preset := "/ebook"
	label := "balanced"
	switch level {
	case "extreme":
		preset, label = "/screen", "extreme"
	case "high":
		preset, label = "/ebook", "high"
	case "light":
		preset, label = "/printer", "light"
	}
	out := c.OutPath(baseName(in.Name) + "-compressed.pdf")
	c.Progress(10, "Analyzing document")
	var engineUsed string
	if c.Engines.Ghostscript {
		engineUsed = "ghostscript"
		args := []string{
			"-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.7",
			"-dPDFSETTINGS=" + preset, "-dNOPAUSE", "-dQUIET", "-dBATCH",
			"-dDetectDuplicateImages=true", "-dCompressFonts=true",
			"-dSubsetFonts=true", "-dAutoRotatePages=/None",
			"-sOutputFile=" + out,
		}
		if c.Password() != "" {
			args = append(args, "-sPDFPassword="+c.Password())
		}
		args = append(args, in.Path)
		c.Progress(30, "Recompressing images and fonts")
		if _, err := c.Engines.RunCommand(c.Ctx, c.Engines.GSPath, args...); err != nil {
			return fmt.Errorf("compression failed: %w", err)
		}
	} else {
		engineUsed = "pdfcpu"
		c.Progress(30, "Optimizing object streams")
		if err := api.OptimizeFile(c.Ctx, in.Path, out, pdfConf(c.Password()), nil); err != nil {
			return fmt.Errorf("compression failed: %w", err)
		}
	}
	c.Progress(85, "Comparing sizes")
	before := in.Size
	after := fileSizeOf(out)
	usedOriginal := false
	if after == 0 {
		return fmt.Errorf("compression produced an empty file")
	}
	if after >= before {
		// Never make a file bigger just to call it compressed.
		if err := copyFile(in.Path, out); err != nil {
			return err
		}
		after = fileSizeOf(out)
		usedOriginal = true
	}
	saved := float64(before-after) / float64(max64(before, 1)) * 100
	c.SetMeta("originalSize", before)
	c.SetMeta("compressedSize", after)
	c.SetMeta("savedPercent", round1(saved))
	c.SetMeta("level", label)
	c.SetMeta("engine", engineUsed)
	c.SetMeta("alreadyOptimal", usedOriginal)
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func repairPDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	out := c.OutPath(baseName(in.Name) + "-repaired.pdf")
	var notes []string
	success := false
	if c.Engines.QPDF {
		c.Progress(20, "Rebuilding PDF structure with qpdf")
		args := []string{"--object-streams=generate"}
		if c.Password() != "" {
			args = append(args, "--password="+c.Password())
		}
		args = append(args, in.Path, out)
		if _, err := c.Engines.RunCommand(c.Ctx, c.Engines.QPDFPath, args...); err == nil && fileSizeOf(out) > 0 {
			success = true
			notes = append(notes, "Rebuilt cross-reference table with qpdf")
		} else {
			notes = append(notes, "qpdf could not fully rebuild the file")
		}
	}
	if !success && c.Engines.Ghostscript {
		c.Progress(45, "Reinterpreting document with Ghostscript")
		args := []string{"-sDEVICE=pdfwrite", "-dPDFSETTINGS=/prepress", "-dNOPAUSE", "-dQUIET", "-dBATCH", "-sOutputFile=" + out}
		if c.Password() != "" {
			args = append(args, "-sPDFPassword="+c.Password())
		}
		args = append(args, in.Path)
		if _, err := c.Engines.RunCommand(c.Ctx, c.Engines.GSPath, args...); err == nil && fileSizeOf(out) > 0 {
			success = true
			notes = append(notes, "Reconstructed page content with Ghostscript")
		}
	}
	if !success {
		c.Progress(60, "Trying pdfcpu recovery")
		if err := api.OptimizeFile(c.Ctx, in.Path, out, pdfConf(c.Password()), nil); err == nil && fileSizeOf(out) > 0 {
			success = true
			notes = append(notes, "Rebuilt object streams with pdfcpu")
		}
	}
	if !success {
		return fmt.Errorf("the file is too damaged to recover automatically")
	}
	c.Progress(90, "Verifying recovered document")
	verifyErr := api.ValidateFile(c.Ctx, out, pdfConf(""), nil)
	if verifyErr != nil {
		notes = append(notes, "The recovered file opens but has minor validation warnings")
	} else {
		notes = append(notes, "Output validates as a readable PDF")
	}
	c.SetMeta("notes", notes)
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func pdfToPDFA(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	if c.Engines.ICCProfile == "" {
		return fmt.Errorf("no ICC color profile is available on this server; PDF/A conversion needs one")
	}
	out := c.OutPath(baseName(in.Name) + "-pdfa.pdf")
	args := []string{
		"-dPDFA=2", "-dBATCH", "-dNOPAUSE", "-dNOOUTERSAVE",
		"-sColorConversionStrategy=UseDeviceIndependentColor",
		"-sDEVICE=pdfwrite", "-dPDFACompatibilityPolicy=1",
		"-sPDFAICCProfile=" + c.Engines.ICCProfile,
		"-sOutputFile=" + out,
	}
	if c.Password() != "" {
		args = append(args, "-sPDFPassword="+c.Password())
	}
	args = append(args, in.Path)
	c.Progress(20, "Preparing PDF/A conversion")
	if _, err := c.Engines.RunCommand(c.Ctx, c.Engines.GSPath, args...); err != nil {
		// Some Ghostscript builds use the generic output profile flag.
		args2 := append([]string{}, args...)
		for i, a := range args2 {
			if strings.HasPrefix(a, "-sPDFAICCProfile=") {
				args2[i] = "-sOutputICCProfile=" + strings.TrimPrefix(a, "-sPDFAICCProfile=")
			}
		}
		c.Progress(35, "Retrying with alternate profile flag")
		if _, err2 := c.Engines.RunCommand(c.Ctx, c.Engines.GSPath, args2...); err2 != nil {
			return fmt.Errorf("PDF/A conversion failed: %w", err)
		}
	}
	if fileSizeOf(out) == 0 {
		return fmt.Errorf("PDF/A conversion produced an empty file")
	}
	c.SetMeta("profile", "PDF/A-2b")
	c.SetMeta("iccProfile", filepath.Base(c.Engines.ICCProfile))
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func ocrPDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	lang := c.Str("language", "eng")
	if lang == "" {
		lang = "eng"
	}
	for _, available := range c.Engines.OCRLangs {
		if available == lang {
			goto found
		}
	}
	return fmt.Errorf("OCR language %q is not installed on this server", lang)
found:
	pages, err := pageCount(in.Path, c.Password())
	if err != nil {
		return fmt.Errorf("%s: %w", in.Name, err)
	}
	if pages > 200 {
		return fmt.Errorf("OCR is limited to 200 pages per job")
	}
	sel, err := c.selectedPages("pages", pages)
	if err != nil {
		return err
	}
	if sel != nil {
		return fmt.Errorf("OCR currently processes the whole document; page subsets are not supported")
	}
	dpi := c.Int("dpi", 300)
	if dpi < 150 {
		dpi = 150
	}
	if dpi > 400 {
		dpi = 400
	}
	c.Progress(5, "Rendering pages for OCR")
	prefix := c.TempPath("ocr-page")
	args := []string{"-png", "-r", strconv.Itoa(dpi)}
	if c.Password() != "" {
		args = append(args, "-upw", c.Password())
	}
	args = append(args, in.Path, prefix)
	if _, err := c.Engines.RunCommand(c.Ctx, findTool("pdftoppm"), args...); err != nil {
		return fmt.Errorf("render pages: %w", err)
	}
	images, _ := filepath.Glob(prefix + "*.png")
	if len(images) == 0 {
		return fmt.Errorf("could not render any pages")
	}
	var pagePDFs []string
	for i, img := range images {
		outName := fmt.Sprintf("ocr-%03d", i+1)
		psm := c.Str("psm", "3")
		// Run Tesseract from the image directory with relative paths. Some
		// macOS/leptonica builds cannot reopen an absolute input path when the
		// process was launched by a Go parent.
		args := []string{filepath.Base(img), outName, "-l", lang, "--psm", psm, "pdf"}
		if _, err := c.Engines.RunCommandInDir(c.Ctx, filepath.Dir(img), c.Engines.TesseractPath, args...); err != nil {
			return fmt.Errorf("OCR page %d: %w", i+1, err)
		}
		pagePDFs = append(pagePDFs, filepath.Join(filepath.Dir(img), outName+".pdf"))
		c.Progress(10+(i+1)*75/len(images), fmt.Sprintf("Recognizing page %d of %d", i+1, len(images)))
	}
	out := c.OutPath(baseName(in.Name) + "-ocr.pdf")
	c.Progress(90, "Assembling searchable PDF")
	if err := api.MergeCreateFile(c.Ctx, pagePDFs, out, false, pdfConf("")); err != nil {
		return fmt.Errorf("assemble OCR pages: %w", err)
	}
	c.SetMeta("pages", pages)
	c.SetMeta("language", lang)
	c.SetMeta("dpi", dpi)
	c.SetMeta("searchable", true)
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	if c.Bool("alsoText", false) {
		var text strings.Builder
		for _, p := range pagePDFs {
			text.WriteString(readTextBestEffort(p))
			text.WriteString("\n\n")
		}
		txt := c.OutPath(baseName(in.Name) + "-ocr.txt")
		if err := writeText(txt, text.String()); err != nil {
			return err
		}
		if _, err := c.AddOutput(filepath.Base(txt), "text/plain; charset=utf-8", "text", txt); err != nil {
			return err
		}
	}
	c.Progress(100, "Ready")
	return nil
}

func flattenPDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	dims, pages, err := pageDims(in.Path, c.Password())
	if err != nil {
		return fmt.Errorf("%s: %w", in.Name, err)
	}
	if pages > 300 {
		return fmt.Errorf("flattening is limited to 300 pages per job")
	}
	dpi := c.Int("dpi", 200)
	if dpi < 100 {
		dpi = 100
	}
	if dpi > 400 {
		dpi = 400
	}
	c.Progress(10, "Rasterizing pages")
	prefix := c.TempPath("flat-page")
	args := []string{"-jpeg", "-jpegopt", "quality=90", "-r", strconv.Itoa(dpi)}
	if c.Password() != "" {
		args = append(args, "-upw", c.Password())
	}
	args = append(args, in.Path, prefix)
	if _, err := c.Engines.RunCommand(c.Ctx, findTool("pdftoppm"), args...); err != nil {
		return fmt.Errorf("render pages: %w", err)
	}
	images, _ := filepath.Glob(prefix + "*.jpg")
	if len(images) != pages {
		return fmt.Errorf("expected %d pages, rendered %d", pages, len(images))
	}
	pdf := fpdf.NewCustom(&fpdf.InitType{UnitStr: "pt", Size: fpdf.SizeType{Wd: dims[0].Width, Ht: dims[0].Height}, OrientationStr: "P"})
	pdf.SetMargins(0, 0, 0)
	pdf.SetAutoPageBreak(false, 0)
	pdf.SetCompression(true)
	for i, img := range images {
		pdf.AddPageFormat("P", fpdf.SizeType{Wd: dims[i].Width, Ht: dims[i].Height})
		opts := fpdf.ImageOptions{ImageType: "JPG", ReadDpi: false}
		pdf.ImageOptions(img, 0, 0, dims[i].Width, dims[i].Height, false, opts, 0, "")
		c.Progress(15+(i+1)*65/len(images), fmt.Sprintf("Flattening page %d of %d", i+1, len(images)))
	}
	out := c.OutPath(baseName(in.Name) + "-flattened.pdf")
	c.Progress(85, "Writing flattened PDF")
	if err := pdf.OutputFileAndClose(out); err != nil {
		return fmt.Errorf("write flattened PDF: %w", err)
	}
	c.SetMeta("pages", pages)
	c.SetMeta("dpi", dpi)
	c.SetMeta("rasterized", true)
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func fileSizeOf(path string) int64 {
	st, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return st.Size()
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func round1(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}

func readTextBestEffort(path string) string {
	text, err := readText(path, "")
	if err != nil {
		return ""
	}
	return text
}
