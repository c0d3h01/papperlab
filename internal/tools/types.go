// Package tools implements every PaperLab document operation.
package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"paperlab/internal/engine"
)

// Input is a file uploaded for a job.
type Input struct {
	ID       string     `json:"id"`
	Name     string     `json:"name"`
	Path     string     `json:"-"`
	Size     int64      `json:"size"`
	MIME     string     `json:"mime"`
	Role     string     `json:"role"`
	Pages    int        `json:"pages,omitempty"`
	PageDims []PageSize `json:"pageSizes,omitempty"`
}

// Output is a produced file.
type Output struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"-"`
	Size int64  `json:"size"`
	MIME string `json:"mime"`
	Kind string `json:"kind"`
}

// PageSize is a page's dimensions in points.
type PageSize struct {
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// Context is passed to a tool's Run function.
type Context struct {
	Ctx     context.Context
	JobID   string
	Dir     string
	InDir   string
	OutDir  string
	Inputs  []Input
	Options map[string]any
	Meta    map[string]any
	Engines *engine.Engines

	progress func(int, string)
	mu       sync.Mutex
	outputs  []Output
}

// Progress reports completion percentage and a human message.
func (c *Context) Progress(percent int, message string) {
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	c.mu.Lock()
	fn := c.progress
	c.mu.Unlock()
	if fn != nil {
		fn(percent, message)
	}
}

// SetProgressFunc sets the progress callback.
func (c *Context) SetProgressFunc(fn func(int, string)) { c.progress = fn }

// AddOutput registers a produced file.
func (c *Context) AddOutput(name, mime, kind, path string) (Output, error) {
	st, err := os.Stat(path)
	if err != nil {
		return Output{}, fmt.Errorf("output %q: %w", name, err)
	}
	if st.IsDir() || st.Size() == 0 {
		return Output{}, fmt.Errorf("output %q is empty", name)
	}
	name = safeFileName(name)
	if name == "" {
		name = "result"
	}
	out := Output{
		ID:   fmt.Sprintf("o%d", len(c.outputs)+1),
		Name: name,
		Path: path,
		Size: st.Size(),
		MIME: mime,
		Kind: kind,
	}
	c.outputs = append(c.outputs, out)
	return out, nil
}

// Outputs returns registered outputs.
func (c *Context) Outputs() []Output {
	out := make([]Output, len(c.outputs))
	copy(out, c.outputs)
	return out
}

// TempPath returns a path inside the job's work directory.
func (c *Context) TempPath(parts ...string) string {
	all := append([]string{c.Dir, "work"}, parts...)
	p := filepath.Join(all...)
	_ = os.MkdirAll(filepath.Dir(p), 0o700)
	return p
}

// OutPath returns a path inside the job's output directory.
func (c *Context) OutPath(name string) string {
	p := filepath.Join(c.OutDir, safeFileName(name))
	_ = os.MkdirAll(filepath.Dir(p), 0o700)
	return p
}

// InputFile returns the first input, or an error.
func (c *Context) InputFile() (Input, error) {
	if len(c.Inputs) == 0 {
		return Input{}, fmt.Errorf("no file uploaded")
	}
	return c.Inputs[0], nil
}

// InputsByRole returns inputs matching a role.
func (c *Context) InputsByRole(role string) []Input {
	var out []Input
	for _, in := range c.Inputs {
		if in.Role == role {
			out = append(out, in)
		}
	}
	return out
}

// Tool describes one operation.
type Tool struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Group        string   `json:"group"`
	Description  string   `json:"description"`
	Requires     []string `json:"requires,omitempty"`
	Optional     []string `json:"optional,omitempty"`
	AI           bool     `json:"ai,omitempty"`
	AllowNoInput bool     `json:"allowNoInput,omitempty"`
	Run          func(*Context) error
}

// ToolInfo is the public inventory entry.
type ToolInfo struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Group       string   `json:"group"`
	Description string   `json:"description"`
	Requires    []string `json:"requires,omitempty"`
	Available   bool     `json:"available"`
	Engine      string   `json:"engine"`
	Reason      string   `json:"reason,omitempty"`
}

var (
	regMu sync.RWMutex
	reg   = map[string]*Tool{}
)

// Register adds a tool to the registry.
func Register(t *Tool) {
	regMu.Lock()
	defer regMu.Unlock()
	if _, exists := reg[t.ID]; exists {
		panic("duplicate tool id: " + t.ID)
	}
	reg[t.ID] = t
}

// Get returns a registered tool.
func Get(id string) (*Tool, bool) {
	regMu.RLock()
	defer regMu.RUnlock()
	t, ok := reg[id]
	return t, ok
}

// All returns all tools.
func All() []*Tool {
	regMu.RLock()
	defer regMu.RUnlock()
	out := make([]*Tool, 0, len(reg))
	for _, t := range reg {
		out = append(out, t)
	}
	return out
}

// Inventory reports tool availability for the current server.
func Inventory(e *engine.Engines) []ToolInfo {
	out := make([]ToolInfo, 0, len(reg))
	for _, t := range All() {
		info := ToolInfo{
			ID: t.ID, Name: t.Name, Group: t.Group,
			Description: t.Description, Requires: t.Requires,
			Available: true, Engine: "native",
		}
		for _, req := range t.Requires {
			if err := e.Need(req); err != nil {
				info.Available = false
				info.Engine = req
				info.Reason = err.Error()
				break
			}
		}
		if len(t.Requires) == 0 {
			info.Engine = "go"
		}
		if t.AI && !info.Available {
			info.Engine = "ai"
		}
		out = append(out, info)
	}
	return out
}

// Options helpers

func (c *Context) Str(key, fallback string) string {
	v, ok := c.Options[key]
	if !ok || v == nil {
		return fallback
	}
	switch x := v.(type) {
	case string:
		return x
	case json.Number:
		return x.String()
	default:
		return fmt.Sprint(x)
	}
}

func (c *Context) Int(key string, fallback int) int {
	v, ok := c.Options[key]
	if !ok || v == nil {
		return fallback
	}
	switch x := v.(type) {
	case float64:
		return int(x)
	case int:
		return x
	case json.Number:
		n, _ := x.Int64()
		return int(n)
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(x))
		if err == nil {
			return n
		}
	}
	return fallback
}

func (c *Context) Float(key string, fallback float64) float64 {
	v, ok := c.Options[key]
	if !ok || v == nil {
		return fallback
	}
	switch x := v.(type) {
	case float64:
		return x
	case int:
		return float64(x)
	case json.Number:
		f, _ := x.Float64()
		return f
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err == nil {
			return f
		}
	}
	return fallback
}

func (c *Context) Bool(key string, fallback bool) bool {
	v, ok := c.Options[key]
	if !ok || v == nil {
		return fallback
	}
	switch x := v.(type) {
	case bool:
		return x
	case string:
		b, err := strconv.ParseBool(strings.TrimSpace(x))
		if err == nil {
			return b
		}
	case float64:
		return x != 0
	case json.Number:
		return x.String() != "0"
	}
	return fallback
}

func (c *Context) Strings(key string) []string {
	v, ok := c.Options[key]
	if !ok || v == nil {
		return nil
	}
	switch x := v.(type) {
	case []string:
		return x
	case []any:
		out := make([]string, 0, len(x))
		for _, item := range x {
			out = append(out, fmt.Sprint(item))
		}
		return out
	case string:
		if strings.TrimSpace(x) == "" {
			return nil
		}
		parts := strings.Split(x, ",")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			out = append(out, strings.TrimSpace(p))
		}
		return out
	}
	return nil
}

func (c *Context) Ints(key string) []int {
	raw, ok := c.Options[key]
	if !ok || raw == nil {
		return nil
	}
	var out []int
	switch x := raw.(type) {
	case []any:
		for _, item := range x {
			switch n := item.(type) {
			case json.Number:
				if v, err := n.Int64(); err == nil {
					out = append(out, int(v))
				} else if f, err := n.Float64(); err == nil {
					out = append(out, int(f))
				}
			case float64:
				out = append(out, int(n))
			case float32:
				out = append(out, int(n))
			case int:
				out = append(out, n)
			case int64:
				out = append(out, int(n))
			case string:
				if v, err := strconv.Atoi(n); err == nil {
					out = append(out, v)
				}
			}
		}
	case []int:
		out = append(out, x...)
	case string:
		for _, p := range strings.Split(x, ",") {
			if v, err := strconv.Atoi(strings.TrimSpace(p)); err == nil {
				out = append(out, v)
			}
		}
	}
	return out
}

// Raw returns a raw option value.
func (c *Context) Raw(key string) any { return c.Options[key] }

// MapSlice decodes an option into []map[string]any.
func (c *Context) MapSlice(key string) []map[string]any {
	v, ok := c.Options[key]
	if !ok || v == nil {
		return nil
	}
	switch x := v.(type) {
	case []map[string]any:
		return x
	case []any:
		out := make([]map[string]any, 0, len(x))
		for _, item := range x {
			if m, ok := item.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	}
	return nil
}

func (c *Context) SetMeta(key string, value any) {
	if c.Meta == nil {
		c.Meta = map[string]any{}
	}
	c.Meta[key] = value
}

// MIMEForName returns a reasonable content type for a filename.
func MIMEForName(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".pdf":
		return "application/pdf"
	case ".zip":
		return "application/zip"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	case ".txt":
		return "text/plain; charset=utf-8"
	case ".md":
		return "text/markdown; charset=utf-8"
	case ".html":
		return "text/html; charset=utf-8"
	case ".json":
		return "application/json"
	case ".docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case ".pptx":
		return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	case ".xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case ".tif", ".tiff":
		return "image/tiff"
	default:
		return "application/octet-stream"
	}
}

func KindForName(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".pdf":
		return "pdf"
	case ".zip":
		return "zip"
	case ".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".gif":
		return "image"
	case ".txt", ".md":
		return "text"
	case ".json":
		return "json"
	case ".html":
		return "html"
	default:
		return "file"
	}
}

// SafeFileName returns a conservative filename for uploads and downloads.
func SafeFileName(name string) string { return safeFileName(name) }

func safeFileName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '.', r == '-', r == '_', r == ' ', r == '(', r == ')', r == '&', r == '+':
			b.WriteRune(r)
		case r > 127:
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	s := strings.TrimSpace(b.String())
	s = strings.TrimLeft(s, ".")
	if len(s) > 160 {
		ext := filepath.Ext(s)
		s = s[:160-len(ext)] + ext
	}
	return s
}

func baseName(name string) string {
	b := filepath.Base(name)
	return strings.TrimSuffix(b, filepath.Ext(b))
}
