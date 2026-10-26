package tools

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
)

// PDFInspection is the metadata and layout summary used by the editor UI.
type PDFInspection struct {
	Pages       int        `json:"pages"`
	PageSizes   []PageSize `json:"pageSizes"`
	Title       string     `json:"title,omitempty"`
	Author      string     `json:"author,omitempty"`
	Subject     string     `json:"subject,omitempty"`
	Keywords    []string   `json:"keywords,omitempty"`
	Creator     string     `json:"creator,omitempty"`
	Producer    string     `json:"producer,omitempty"`
	Encrypted   bool       `json:"encrypted"`
	TextLayer   bool       `json:"textLayer"`
	TextPreview string     `json:"textPreview,omitempty"`
	Version     string     `json:"version,omitempty"`
	FileSize    int64      `json:"fileSize"`
}

// InspectPDF returns page sizes, metadata and a text-layer probe.
func InspectPDF(path, password string) (*PDFInspection, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := api.PDFInfo(context.Background(), f, path, nil, false, pdfConf(password))
	if err != nil {
		return nil, fmt.Errorf("read PDF: %w", err)
	}
	st, _ := os.Stat(path)
	ins := &PDFInspection{
		Pages: info.PageCount, Encrypted: info.Encrypted,
		Title: info.Title, Author: info.Author, Subject: info.Subject,
		Keywords: info.Keywords, Creator: info.Creator, Producer: info.Producer,
		Version: info.Version,
	}
	if st != nil {
		ins.FileSize = st.Size()
	}
	for dim := range info.PageDimensions {
		ins.PageSizes = append(ins.PageSizes, PageSize{Width: dim.Width, Height: dim.Height})
	}
	// PageDimensions is a set; preserve actual page order when possible.
	if dims, pages, err := pageDims(path, password); err == nil && pages == ins.Pages {
		ins.PageSizes = dims
	}
	if text, err := readText(path, password); err == nil {
		trimmed := strings.TrimSpace(text)
		ins.TextLayer = trimmed != ""
		if len(trimmed) > 1200 {
			trimmed = trimmed[:1200]
		}
		ins.TextPreview = trimmed
	}
	return ins, nil
}

// AnalyzeRedaction finds normalized boxes for search terms.
func AnalyzeRedaction(path, password string, terms []string) ([]redactBox, error) {
	boxes, err := findTextBoxes(path, password, terms)
	if err != nil {
		return nil, err
	}
	return boxes, nil
}

// ExtractPagesText returns per-page text for chat and summaries.
func ExtractPagesText(path, password string) ([]string, error) {
	return readTextPages(path, password)
}
