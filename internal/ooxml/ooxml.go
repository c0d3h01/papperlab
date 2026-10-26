// Package ooxml writes small, valid DOCX and PPTX packages without external
// office suites. The generated files target the common Office/Google Docs
// feature set: headings, paragraphs, page breaks, slide titles, bullet text,
// and full-bleed slide images.
package ooxml

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"os"
	"strings"
)

// Paragraph is one block in a Word document.
type Paragraph struct {
	Text    string
	Heading int
	Bullet  bool
}

// Doc is a Word document split into pages.
type Doc struct {
	Title string
	Pages [][]Paragraph
}

func esc(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

func writeFile(zw *zip.Writer, name, content string) error {
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = w.Write([]byte(content))
	return err
}

// WriteDOCX writes a minimal but standards-compliant Word document.
func WriteDOCX(path string, doc Doc) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	zw := zip.NewWriter(f)

	contentTypes := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`
	rels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`
	docRels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
	styles := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="56"/><w:color w:val="18181B"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="280" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="18181B"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="220" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="18181B"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="180" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="18181B"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr></w:style>
</w:styles>`
	core := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>` + esc(doc.Title) + `</dc:title><dc:creator>PaperLab</dc:creator><cp:lastModifiedBy>PaperLab</cp:lastModifiedBy>
</cp:coreProperties>`

	var body strings.Builder
	body.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`)
	if doc.Title != "" {
		body.WriteString(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">` + esc(doc.Title) + `</w:t></w:r></w:p>`)
	}
	for pi, page := range doc.Pages {
		for _, p := range page {
			style := "Normal"
			if p.Heading == 1 {
				style = "Heading1"
			} else if p.Heading == 2 {
				style = "Heading2"
			} else if p.Heading >= 3 {
				style = "Heading3"
			}
			if p.Bullet {
				style = "ListBullet"
			}
			body.WriteString(`<w:p><w:pPr><w:pStyle w:val="` + style + `"/></w:pPr><w:r><w:t xml:space="preserve">`)
			text := p.Text
			if p.Bullet {
				text = "•  " + text
			}
			body.WriteString(esc(text))
			body.WriteString(`</w:t></w:r></w:p>`)
		}
		if pi < len(doc.Pages)-1 {
			body.WriteString(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`)
		}
	}
	body.WriteString(`<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`)

	for _, part := range []struct{ name, content string }{
		{"[Content_Types].xml", contentTypes},
		{"_rels/.rels", rels},
		{"word/_rels/document.xml.rels", docRels},
		{"word/document.xml", body.String()},
		{"word/styles.xml", styles},
		{"docProps/core.xml", core},
	} {
		if err := writeFile(zw, part.name, part.content); err != nil {
			return err
		}
	}
	return zw.Close()
}

// Slide is one presentation slide. When Image is non-empty it is embedded as a
// full-bleed background image (a PNG file path). Title and Lines are drawn on
// top with a translucent-free white text block for readability.
type Slide struct {
	Title string
	Lines []string
	Image string
}

// WritePPTX writes a 16:9 presentation with optional full-bleed images.
func WritePPTX(path string, slides []Slide) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	zw := zip.NewWriter(f)

	var overrides strings.Builder
	overrides.WriteString(`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>`)
	overrides.WriteString(`<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`)
	overrides.WriteString(`<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`)
	overrides.WriteString(`<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`)
	overrides.WriteString(`<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`)
	for i := range slides {
		overrides.WriteString(fmt.Sprintf(`<Override PartName="/ppt/slides/slide%d.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`, i+1))
	}
	contentTypes := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` + overrides.String() + `</Types>`
	rels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`

	var presSlides strings.Builder
	var presRels strings.Builder
	presRels.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`)
	presRels.WriteString(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`)
	presRels.WriteString(`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>`)
	for i := range slides {
		presSlides.WriteString(fmt.Sprintf(`<p:sldId id="%d" r:id="rId%d"/>`, 256+i, i+3))
		presRels.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide%d.xml"/>`, i+3, i+1))
	}
	presRels.WriteString(`</Relationships>`)
	presentation := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>` + presSlides.String() + `</p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`

	master := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`
	masterRels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`
	layout := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
	layoutRels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`
	theme := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="PaperLab"><a:themeElements>
<a:clrScheme name="PaperLab"><a:dk1><a:srgbClr val="18181B"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="3F3F46"/></a:dk2><a:lt2><a:srgbClr val="FAF8F3"/></a:lt2><a:accent1><a:srgbClr val="2547FF"/></a:accent1><a:accent2><a:srgbClr val="FF5C35"/></a:accent2><a:accent3><a:srgbClr val="0F9D6E"/></a:accent3><a:accent4><a:srgbClr val="E0B341"/></a:accent4><a:accent5><a:srgbClr val="8B5CF6"/></a:accent5><a:accent6><a:srgbClr val="0EA5E9"/></a:accent6><a:hlink><a:srgbClr val="2547FF"/></a:hlink><a:folHlink><a:srgbClr val="8B5CF6"/></a:folHlink></a:clrScheme>
<a:fontScheme name="PaperLab"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="PaperLab"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`

	for _, part := range []struct{ name, content string }{
		{"[Content_Types].xml", contentTypes},
		{"_rels/.rels", rels},
		{"ppt/presentation.xml", presentation},
		{"ppt/_rels/presentation.xml.rels", presRels.String()},
		{"ppt/slideMasters/slideMaster1.xml", master},
		{"ppt/slideMasters/_rels/slideMaster1.xml.rels", masterRels},
		{"ppt/slideLayouts/slideLayout1.xml", layout},
		{"ppt/slideLayouts/_rels/slideLayout1.xml.rels", layoutRels},
		{"ppt/theme/theme1.xml", theme},
	} {
		if err := writeFile(zw, part.name, part.content); err != nil {
			return err
		}
	}

	for i, s := range slides {
		relID := 2
		var slideRels strings.Builder
		slideRels.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`)
		slideRels.WriteString(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`)
		imageRel := ""
		if s.Image != "" {
			ext := strings.ToLower(strings.TrimPrefix(strings.ToLower(filepathExt(s.Image)), "."))
			mediaName := fmt.Sprintf("image%d.%s", i+1, ext)
			if err := copyZipFile(zw, "ppt/media/"+mediaName, s.Image); err != nil {
				return err
			}
			slideRels.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/%s"/>`, relID, mediaName))
			imageRel = fmt.Sprintf("rId%d", relID)
			relID++
		}
		slideRels.WriteString(`</Relationships>`)

		var tree strings.Builder
		tree.WriteString(`<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>`)
		if imageRel != "" {
			tree.WriteString(`<p:pic><p:nvPicPr><p:cNvPr id="2" name="Page image"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="` + imageRel + `"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`)
		}
		if s.Title != "" {
			tree.WriteString(textShape(3, 600000, 420000, 11000000, 900000, s.Title, 3000, true, "18181B"))
		}
		if len(s.Lines) > 0 {
			y := 1400000
			if s.Image != "" {
				// Keep text within the lower third over page images.
				y = 4600000
			}
			body := strings.Join(s.Lines, "\n")
			tree.WriteString(textShape(4, 600000, y, 11000000, 1800000, body, 1600, false, "27272A"))
		}
		tree.WriteString(`</p:spTree>`)
		slide := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld>` + tree.String() + `</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`

		if err := writeFile(zw, fmt.Sprintf("ppt/slides/slide%d.xml", i+1), slide); err != nil {
			return err
		}
		if err := writeFile(zw, fmt.Sprintf("ppt/slides/_rels/slide%d.xml.rels", i+1), slideRels.String()); err != nil {
			return err
		}
	}
	return zw.Close()
}

func textShape(id int, x, y, cx, cy int, text string, size int, bold bool, color string) string {
	b := "0"
	if bold {
		b = "1"
	}
	lines := strings.Split(text, "\n")
	var paras strings.Builder
	for _, line := range lines {
		paras.WriteString(`<a:p><a:r><a:rPr lang="en-US" sz="` + fmt.Sprint(size) + `" b="` + b + `" dirty="0"><a:solidFill><a:srgbClr val="` + color + `"/></a:solidFill><a:latin typeface="Aptos"/></a:rPr><a:t>` + esc(line) + `</a:t></a:r><a:endParaRPr lang="en-US" sz="` + fmt.Sprint(size) + `"/></a:p>`)
	}
	return fmt.Sprintf(`<p:sp><p:nvSpPr><p:cNvPr id="%d" name="Text %d"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="t"/><a:lstStyle/>%s</p:txBody></p:sp>`, id, id, x, y, cx, cy, paras.String())
}

func filepathExt(path string) string {
	i := strings.LastIndexByte(path, '.')
	if i < 0 {
		return ".png"
	}
	return path[i:]
}

func copyZipFile(zw *zip.Writer, name, src string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}
