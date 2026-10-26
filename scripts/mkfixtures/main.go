package main

import (
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"

	"github.com/go-pdf/fpdf"
	"github.com/pdfcpu/pdfcpu/pkg/api"

	"paperlab/internal/ooxml"
)

func main() {
	dir := "testdata"
	_ = os.MkdirAll(dir, 0o755)
	makeImage(filepath.Join(dir, "sample-image.png"))
	makePDF(filepath.Join(dir, "sample.pdf"))
	makeForm(filepath.Join(dir, "form.pdf"))
	makeDocx(filepath.Join(dir, "sample.docx"))
	makePptx(filepath.Join(dir, "sample.pptx"))
	fmt.Println("fixtures written to", dir)
}

func makeImage(path string) {
	img := image.NewRGBA(image.Rect(0, 0, 640, 400))
	for y := 0; y < 400; y++ {
		for x := 0; x < 640; x++ {
			c := color.RGBA{uint8(240 + x/16), uint8(240 + y/20), 230, 255}
			if x > 80 && x < 560 && y > 100 && y < 300 {
				c = color.RGBA{uint8(20 + x/6), uint8(40 + y/5), 230, 255}
			}
			img.Set(x, y, c)
		}
	}
	f, _ := os.Create(path)
	defer f.Close()
	_ = png.Encode(f, img)
}

func makePDF(path string) {
	pdf := fpdf.New("P", "pt", "A4", "")
	pdf.SetMargins(56, 56, 56)
	pdf.SetAutoPageBreak(true, 56)
	pdf.SetTitle("Quarterly Field Report", true)
	pdf.SetAuthor("PaperLab Test Lab", true)
	pdf.SetCreator("PaperLab fixtures", true)
	pdf.AddPage()
	pdf.SetFont("Helvetica", "B", 24)
	pdf.MultiCell(0, 30, "Quarterly Field Report", "", "L", false)
	pdf.SetFont("Helvetica", "", 11)
	pdf.Ln(8)
	pdf.MultiCell(0, 16, "A practical document used to test every PaperLab workflow. It contains multiple pages, headings, body copy, and an embedded image.", "", "L", false)
	pdf.Ln(10)
	pdf.ImageOptions("testdata/sample-image.png", 56, pdf.GetY(), 483, 0, false, fpdf.ImageOptions{ImageType: "PNG"}, 0, "")
	pdf.Ln(220)
	pdf.SetFont("Helvetica", "B", 14)
	pdf.Cell(0, 20, "1. Observations")
	pdf.Ln(24)
	pdf.SetFont("Helvetica", "", 11)
	for _, s := range []string{
		"The pilot program reached twelve regional offices in the first quarter.",
		"Response times improved by roughly eighteen percent after the workflow update.",
		"Participants asked for clearer guidance on document retention and redaction.",
		"Support volume declined once self-service templates became available.",
	} {
		pdf.MultiCell(0, 16, "-  "+s, "", "L", false)
		pdf.Ln(2)
	}
	pdf.AddPage()
	pdf.SetFont("Helvetica", "B", 20)
	pdf.Cell(0, 26, "2. Regional summary")
	pdf.Ln(34)
	pdf.SetFont("Helvetica", "", 11)
	for i := 0; i < 18; i++ {
		pdf.MultiCell(0, 16, fmt.Sprintf("Region %02d reported steady progress across intake, review, and archival. The local team documented a concise set of follow-up actions and assigned owners for the next cycle.", i+1), "", "L", false)
		pdf.Ln(3)
	}
	pdf.AddPage()
	pdf.SetFont("Helvetica", "B", 20)
	pdf.Cell(0, 26, "3. Next steps")
	pdf.Ln(34)
	pdf.SetFont("Helvetica", "", 11)
	pdf.MultiCell(0, 16, "The next phase focuses on accessibility, measurable turnaround times, and a shared vocabulary for document handling. A working group will publish updated templates before the end of the month.", "", "L", false)
	pdf.Ln(12)
	pdf.SetFont("Helvetica", "B", 14)
	pdf.Cell(0, 20, "Contact")
	pdf.Ln(24)
	pdf.SetFont("Helvetica", "", 11)
	pdf.MultiCell(0, 16, "PaperLab Field Operations\n12 Example Street\nhello@example.com", "", "L", false)
	pdf.AddPage()
	pdf.SetFont("Helvetica", "B", 20)
	pdf.Cell(0, 26, "4. Appendix")
	pdf.Ln(34)
	pdf.SetFont("Helvetica", "", 10)
	for i := 0; i < 22; i++ {
		pdf.MultiCell(0, 15, fmt.Sprintf("Appendix note %02d: archival metadata, revision history, and review notes are recorded for traceability.", i+1), "", "L", false)
	}
	if err := pdf.OutputFileAndClose(path); err != nil {
		panic(err)
	}
}

func makeForm(path string) {
	js := `{"pages":{"1":{"content":{
		"text":[
			{"value":"PaperLab Intake Form","pos":[72,60],"font":{"name":"Helvetica","size":22}},
			{"value":"Full name","pos":[72,100],"font":{"name":"Helvetica","size":11}},
			{"value":"Email","pos":[72,170],"font":{"name":"Helvetica","size":11}},
			{"value":"Notes","pos":[72,240],"font":{"name":"Helvetica","size":11}}
		],
		"textfield":[
			{"id":"fullname","name":"Full name","pos":[72,118],"width":280,"height":28,"font":{"name":"Helvetica","size":12}},
			{"id":"email","name":"Email","pos":[72,188],"width":280,"height":28,"font":{"name":"Helvetica","size":12}},
			{"id":"notes","name":"Notes","pos":[72,258],"width":380,"height":90,"multiline":true,"font":{"name":"Helvetica","size":11}}
		],
		"checkbox":[{"id":"agree","name":"I agree","pos":[72,380],"width":16,"height":16}]
	}}}}`
	jsonPath := filepath.Join(os.TempDir(), "paperlab-form.json")
	_ = os.WriteFile(jsonPath, []byte(js), 0o600)
	if err := api.CreateFile(context.Background(), "", jsonPath, path, nil); err != nil {
		panic(err)
	}
}

func makeDocx(path string) {
	doc := ooxml.Doc{Title: "PaperLab Field Notes", Pages: [][]ooxml.Paragraph{
		{
			{Text: "Overview", Heading: 1},
			{Text: "This document tests the native Word renderer and the DOCX writer."},
			{Text: "Highlights", Heading: 2},
			{Text: "Fast local processing", Bullet: true},
			{Text: "Clear output", Bullet: true},
		},
		{
			{Text: "Second page", Heading: 1},
			{Text: "Page breaks and headings should survive conversion."},
		},
	}}
	if err := ooxml.WriteDOCX(path, doc); err != nil {
		panic(err)
	}
}

func makePptx(path string) {
	slides := []ooxml.Slide{
		{Title: "PaperLab in three minutes", Lines: []string{"Upload", "Choose a tool", "Download"}},
		{Title: "Built for real documents", Lines: []string{"Merge, split, compress", "Convert and OCR", "Edit, sign, redact"}},
	}
	if err := ooxml.WritePPTX(path, slides); err != nil {
		panic(err)
	}
}
