package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/form"
)

func init() {
	Register(&Tool{
		ID: "fill-form", Name: "Fill PDF form", Group: "forms",
		Description: "Inspect AcroForm fields and fill them in without printing.",
		Run:         fillFormPDF,
	})
	Register(&Tool{
		ID: "export-form", Name: "Export form data", Group: "forms",
		Description: "Download a form's fields as JSON for filling or archiving.",
		Run:         exportFormPDF,
	})
}

// FormField is the provider-neutral field description returned by the API.
type FormField struct {
	ID        string   `json:"id"`
	Name      string   `json:"name,omitempty"`
	Type      string   `json:"type"`
	Value     any      `json:"value"`
	Default   any      `json:"default,omitempty"`
	Options   []string `json:"options,omitempty"`
	Pages     []int    `json:"pages,omitempty"`
	MaxLen    int      `json:"maxLen,omitempty"`
	Multiline bool     `json:"multiline,omitempty"`
	Editable  bool     `json:"editable,omitempty"`
	Multi     bool     `json:"multi,omitempty"`
	Locked    bool     `json:"locked,omitempty"`
}

// InspectForm reads a PDF's AcroForm fields.
func InspectForm(path, password string) ([]FormField, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	group, err := api.ExportForm(context.Background(), f, filepath.Base(path), pdfConf(password))
	if err != nil {
		return nil, fmt.Errorf("read form: %w", err)
	}
	var fields []FormField
	for _, frm := range group.Forms {
		for _, tf := range frm.TextFields {
			fields = append(fields, FormField{ID: tf.ID, Name: tf.Name, Type: "text", Value: tf.Value, Default: tf.Default, Pages: tf.Pages, MaxLen: tf.MaxLen, Multiline: tf.Multiline, Locked: tf.Locked})
		}
		for _, df := range frm.DateFields {
			fields = append(fields, FormField{ID: df.ID, Name: df.Name, Type: "date", Value: df.Value, Default: df.Default, Pages: df.Pages, Locked: df.Locked})
		}
		for _, cb := range frm.CheckBoxes {
			fields = append(fields, FormField{ID: cb.ID, Name: cb.Name, Type: "checkbox", Value: cb.Value, Default: cb.Default, Pages: cb.Pages, Locked: cb.Locked})
		}
		for _, rb := range frm.RadioButtonGroups {
			fields = append(fields, FormField{ID: rb.ID, Name: rb.Name, Type: "radio", Value: rb.Value, Default: rb.Default, Options: rb.Options, Pages: rb.Pages, Locked: rb.Locked})
		}
		for _, cb := range frm.ComboBoxes {
			fields = append(fields, FormField{ID: cb.ID, Name: cb.Name, Type: "combo", Value: cb.Value, Default: cb.Default, Options: cb.Options, Pages: cb.Pages, Editable: cb.Editable, Locked: cb.Locked})
		}
		for _, lb := range frm.ListBoxes {
			fields = append(fields, FormField{ID: lb.ID, Name: lb.Name, Type: "list", Value: lb.Values, Default: lb.Defaults, Options: lb.Options, Pages: lb.Pages, Multi: lb.Multi, Locked: lb.Locked})
		}
	}
	sort.SliceStable(fields, func(i, j int) bool {
		if len(fields[i].Pages) > 0 && len(fields[j].Pages) > 0 && fields[i].Pages[0] != fields[j].Pages[0] {
			return fields[i].Pages[0] < fields[j].Pages[0]
		}
		return fields[i].Name < fields[j].Name
	})
	return fields, nil
}

func fillFormPDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	f, err := os.Open(in.Path)
	if err != nil {
		return err
	}
	group, err := api.ExportForm(c.Ctx, f, filepath.Base(in.Path), pdfConf(c.Password()))
	f.Close()
	if err != nil {
		return fmt.Errorf("read form: %w", err)
	}
	total := 0
	for _, frm := range group.Forms {
		total += len(frm.TextFields) + len(frm.DateFields) + len(frm.CheckBoxes) + len(frm.RadioButtonGroups) + len(frm.ComboBoxes) + len(frm.ListBoxes)
	}
	if total == 0 {
		return fmt.Errorf("this PDF has no fillable form fields")
	}
	values, _ := c.Raw("values").(map[string]any)
	valuesJSON := strings.TrimSpace(c.Str("valuesJSON", ""))
	if len(values) == 0 && valuesJSON != "" {
		if err := json.Unmarshal([]byte(valuesJSON), &values); err != nil {
			return fmt.Errorf("form values are not valid JSON: %w", err)
		}
	}
	if len(values) == 0 {
		return fmt.Errorf("no form values were provided")
	}
	lookup := func(id, name string) (any, bool) {
		if v, ok := values[id]; ok {
			return v, true
		}
		if name != "" {
			if v, ok := values[name]; ok {
				return v, true
			}
		}
		// Case-insensitive fallback helps hand-written JSON.
		for k, v := range values {
			if strings.EqualFold(k, id) || (name != "" && strings.EqualFold(k, name)) {
				return v, true
			}
		}
		return nil, false
	}
	applied := 0
	for fi := range group.Forms {
		frm := &group.Forms[fi]
		for _, tf := range frm.TextFields {
			if v, ok := lookup(tf.ID, tf.Name); ok {
				tf.Value = fmt.Sprint(v)
				applied++
			}
		}
		for _, df := range frm.DateFields {
			if v, ok := lookup(df.ID, df.Name); ok {
				df.Value = fmt.Sprint(v)
				applied++
			}
		}
		for _, cb := range frm.CheckBoxes {
			if v, ok := lookup(cb.ID, cb.Name); ok {
				cb.Value = boolFromAny(v)
				applied++
			}
		}
		for _, rb := range frm.RadioButtonGroups {
			if v, ok := lookup(rb.ID, rb.Name); ok {
				rb.Value = fmt.Sprint(v)
				applied++
			}
		}
		for _, cb := range frm.ComboBoxes {
			if v, ok := lookup(cb.ID, cb.Name); ok {
				cb.Value = fmt.Sprint(v)
				applied++
			}
		}
		for _, lb := range frm.ListBoxes {
			if v, ok := lookup(lb.ID, lb.Name); ok {
				switch x := v.(type) {
				case []any:
					lb.Values = nil
					for _, item := range x {
						lb.Values = append(lb.Values, fmt.Sprint(item))
					}
				case []string:
					lb.Values = x
				default:
					lb.Values = []string{fmt.Sprint(v)}
				}
				applied++
			}
		}
	}
	if applied == 0 {
		return fmt.Errorf("none of the provided keys matched a form field")
	}
	data, err := json.Marshal(group)
	if err != nil {
		return err
	}
	out := c.OutPath(baseName(in.Name) + "-filled.pdf")
	c.Progress(45, "Filling form fields")
	if err := api.FillFormFile(c.Ctx, in.Path, writeTempJSON(c, data), out, pdfConf(c.Password())); err != nil {
		// Fall back to the reader/writer API when the file API rejects the JSON path.
		sf, err2 := os.Open(in.Path)
		if err2 != nil {
			return err
		}
		defer sf.Close()
		of, err3 := os.Create(out)
		if err3 != nil {
			return err3
		}
		defer of.Close()
		if err2 := api.FillForm(c.Ctx, sf, bytes.NewReader(data), of, pdfConf(c.Password())); err2 != nil {
			return fmt.Errorf("fill form: %w", err2)
		}
	}
	c.SetMeta("fields", applied)
	c.SetMeta("totalFields", total)
	if _, err := c.AddOutput(filepath.Base(out), "application/pdf", "pdf", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

func writeTempJSON(c *Context, data []byte) string {
	p := c.TempPath("form-values.json")
	_ = os.WriteFile(p, data, 0o600)
	return p
}

func exportFormPDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	fields, err := InspectForm(in.Path, c.Password())
	if err != nil {
		return err
	}
	if len(fields) == 0 {
		return fmt.Errorf("this PDF has no form fields")
	}
	payload := map[string]any{
		"source": filepath.Base(in.Name),
		"fields": fields,
		"values": func() map[string]any {
			m := map[string]any{}
			for _, f := range fields {
				m[f.ID] = f.Value
			}
			return m
		}(),
	}
	data, _ := json.MarshalIndent(payload, "", "  ")
	out := c.OutPath(baseName(in.Name) + "-form.json")
	if err := writeText(out, string(data)); err != nil {
		return err
	}
	c.SetMeta("fields", len(fields))
	if _, err := c.AddOutput(filepath.Base(out), "application/json", "json", out); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

var _ = form.JSON
