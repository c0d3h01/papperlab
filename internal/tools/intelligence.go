package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/go-pdf/fpdf"
	"github.com/pdfcpu/pdfcpu/pkg/api"

	"paperlab/internal/engine"
)

func init() {
	Register(&Tool{
		ID: "summarize", Name: "AI Summarizer", Group: "ai",
		Description: "Summarize long documents into an overview and key points.",
		Optional:    []string{"ai"},
		AI:          true,
		Run:         summarizePDF,
	})
	Register(&Tool{
		ID: "translate", Name: "Translate PDF", Group: "ai",
		Description: "Translate a document into another language.",
		Requires:    []string{"translate"},
		Run:         translatePDF,
	})
	Register(&Tool{
		ID: "ask-pdf", Name: "Chat with PDF", Group: "ai",
		Description: "Ask questions and get answers grounded in the document.",
		Run:         askPDF,
	})
}

// ChatMessage is one turn in a document conversation.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// SummaryOptions controls summary length and voice.
type SummaryOptions struct {
	Length   string
	Language string
	Style    string
}

// SummaryResult is a generated summary.
type SummaryResult struct {
	Summary   string
	KeyPoints []string
	Engine    string
	Words     int
}

var (
	wordRe     = regexp.MustCompile(`[\p{L}\p{N}][\p{L}\p{N}'’-]*`)
	sentenceRe = regexp.MustCompile(`[^.!?…]+(?:[.!?…]+|$)`)
)

var stopwords = map[string]bool{
	"the": true, "and": true, "for": true, "that": true, "with": true, "this": true,
	"from": true, "have": true, "has": true, "are": true, "was": true, "were": true,
	"will": true, "would": true, "can": true, "could": true, "should": true,
	"but": true, "not": true, "you": true, "your": true, "they": true, "their": true,
	"them": true, "there": true, "then": true, "than": true, "into": true, "onto": true,
	"about": true, "which": true, "when": true, "where": true, "what": true, "who": true,
	"how": true, "all": true, "any": true, "also": true, "more": true, "most": true,
	"some": true, "such": true, "only": true, "other": true, "these": true, "those": true,
	"its": true, "it's": true, "our": true, "out": true, "one": true, "two": true,
	"been": true, "being": true, "each": true, "both": true, "because": true, "while": true,
	"does": true, "did": true, "doing": true, "use": true, "used": true, "using": true,
	"may": true, "might": true, "must": true, "shall": true, "very": true, "just": true,
}

func summarizePDF(c *Context) error {
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
	textPages, err := readTextPages(in.Path, c.Password())
	if err != nil {
		return err
	}
	if strings.TrimSpace(strings.Join(textPages, "")) == "" {
		return fmt.Errorf("this PDF has no text layer. Run OCR first, then summarize")
	}
	chosen := textPages
	if sel != nil {
		set, err := api.PagesForSelection(pages, sel, false)
		if err != nil {
			return err
		}
		var parts []string
		for i, p := range textPages {
			if set[i+1] {
				parts = append(parts, p)
			}
		}
		chosen = parts
	}
	text := strings.Join(chosen, "\n\n")
	opts := SummaryOptions{
		Length:   c.Str("length", "medium"),
		Language: c.Str("language", "auto"),
		Style:    c.Str("style", "paragraphs"),
	}
	c.Progress(20, "Reading the document")
	result, err := Summarize(c.Ctx, c.Engines, text, opts)
	if err != nil {
		return err
	}
	title := baseName(in.Name)
	c.Progress(60, "Writing summary")
	body := result.Summary
	if len(result.KeyPoints) > 0 {
		body += "\n\nKEY POINTS\n\n"
		for _, k := range result.KeyPoints {
			body += "•  " + k + "\n"
		}
	}
	pdfOut := c.OutPath(title + "-summary.pdf")
	if err := renderTextReport(c, pdfOut, "Document summary", title, body, result.Engine); err != nil {
		return err
	}
	txtOut := c.OutPath(title + "-summary.txt")
	if err := writeText(txtOut, result.Summary+"\n\nKEY POINTS\n\n"+strings.Join(result.KeyPoints, "\n")); err != nil {
		return err
	}
	c.SetMeta("summary", result.Summary)
	c.SetMeta("keyPoints", result.KeyPoints)
	c.SetMeta("engine", result.Engine)
	c.SetMeta("words", result.Words)
	if _, err := c.AddOutput(filepath.Base(pdfOut), "application/pdf", "pdf", pdfOut); err != nil {
		return err
	}
	if _, err := c.AddOutput(filepath.Base(txtOut), "text/plain; charset=utf-8", "text", txtOut); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

// Summarize produces a summary using the configured AI provider, falling back
// to a local extractive summarizer when no provider is available.
func Summarize(ctx context.Context, e *engine.Engines, text string, opts SummaryOptions) (SummaryResult, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return SummaryResult{}, fmt.Errorf("no text to summarize")
	}
	if e != nil && e.AI {
		if result, err := aiSummarize(ctx, e, text, opts); err == nil {
			return result, nil
		}
	}
	return localSummary(text, opts), nil
}

func aiSummarize(ctx context.Context, e *engine.Engines, text string, opts SummaryOptions) (SummaryResult, error) {
	words := opts.Length
	if words == "" {
		words = "medium"
	}
	instruction := "Write a clear, faithful summary of the document."
	switch strings.ToLower(opts.Length) {
	case "short":
		instruction += " Use 1 short paragraph (about 80 words)."
	case "long":
		instruction += " Use 4-6 substantial paragraphs."
	default:
		instruction += " Use 2-3 paragraphs (about 220 words)."
	}
	if opts.Style == "bullets" {
		instruction += " Prefer a short overview followed by bullets."
	}
	if opts.Language != "" && opts.Language != "auto" {
		instruction += " Write the summary in " + languageName(opts.Language) + "."
	}
	instruction += " Then add a section titled KEY POINTS with 5 concise bullets. Return plain text only, no Markdown fences."
	doc := truncateRunes(text, 60000)
	answer, err := aiComplete(ctx, e, "You summarize documents accurately without inventing facts.", instruction+"\n\nDOCUMENT:\n"+doc, 1400)
	if err != nil {
		return SummaryResult{}, err
	}
	summary, points := splitSummary(answer)
	if summary == "" {
		return SummaryResult{}, fmt.Errorf("the AI provider returned an empty summary")
	}
	return SummaryResult{Summary: summary, KeyPoints: points, Engine: "ai:" + e.AIModel, Words: len(strings.Fields(summary))}, nil
}

func splitSummary(raw string) (string, []string) {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, "\r\n", "\n"))
	idx := strings.Index(strings.ToUpper(raw), "KEY POINTS")
	summary := raw
	var points []string
	if idx >= 0 {
		summary = strings.TrimSpace(raw[:idx])
		rest := raw[idx:]
		for _, line := range strings.Split(rest, "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.EqualFold(strings.Trim(line, ":# "), "KEY POINTS") {
				continue
			}
			line = strings.TrimLeft(line, "-*•0123456789.) \t")
			if line != "" {
				points = append(points, line)
			}
		}
	}
	summary = strings.TrimSpace(strings.Trim(summary, "#* "))
	return summary, points
}

func localSummary(text string, opts SummaryOptions) SummaryResult {
	paragraphs := splitParagraphs(text)
	sentences := splitSentences(text)
	if len(sentences) == 0 {
		return SummaryResult{Summary: truncateRunes(text, 600), Engine: "local", Words: len(strings.Fields(text))}
	}
	target := 5
	switch strings.ToLower(opts.Length) {
	case "short":
		target = 3
	case "long":
		target = 10
	default:
		target = 6
	}
	if target > len(sentences) {
		target = len(sentences)
	}
	freq := wordFrequencies(text)
	type scored struct {
		idx   int
		score float64
		text  string
	}
	ranked := make([]scored, 0, len(sentences))
	for i, s := range sentences {
		words := wordRe.FindAllString(strings.ToLower(s), -1)
		if len(words) < 4 {
			continue
		}
		score := 0.0
		for _, w := range words {
			if stopwords[w] {
				continue
			}
			score += freq[w]
		}
		score /= math.Sqrt(float64(len(words)) + 1)
		// Early sentences often carry the thesis.
		if i < 3 {
			score *= 1.18
		}
		if len(words) > 60 {
			score *= 0.8
		}
		ranked = append(ranked, scored{i, score, strings.TrimSpace(s)})
	}
	if len(ranked) == 0 {
		return SummaryResult{Summary: truncateRunes(text, 600), Engine: "local"}
	}
	sort.SliceStable(ranked, func(i, j int) bool { return ranked[i].score > ranked[j].score })
	var chosen []scored
	seen := map[string]bool{}
	for _, r := range ranked {
		key := strings.ToLower(strings.Join(strings.Fields(r.text)[:minInt(6, len(strings.Fields(r.text)))], " "))
		if seen[key] {
			continue
		}
		seen[key] = true
		chosen = append(chosen, r)
		if len(chosen) >= target {
			break
		}
	}
	sort.SliceStable(chosen, func(i, j int) bool { return chosen[i].idx < chosen[j].idx })
	var summary strings.Builder
	if len(paragraphs) > 0 {
		summary.WriteString(truncateRunes(strings.TrimSpace(paragraphs[0]), 260))
		summary.WriteString("\n\n")
	}
	for _, s := range chosen {
		summary.WriteString(s.text)
		summary.WriteString(" ")
	}
	var points []string
	for i, r := range ranked {
		if i >= 5 {
			break
		}
		points = append(points, truncateRunes(strings.TrimSpace(r.text), 190))
	}
	return SummaryResult{
		Summary: strings.TrimSpace(summary.String()), KeyPoints: points,
		Engine: "local extractive", Words: len(strings.Fields(text)),
	}
}

func splitParagraphs(text string) []string {
	raw := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n\n")
	var out []string
	for _, p := range raw {
		p = strings.Join(strings.Fields(p), " ")
		if len(p) > 40 {
			out = append(out, p)
		}
	}
	return out
}

func splitSentences(text string) []string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	var out []string
	for _, block := range strings.Split(text, "\n") {
		block = strings.TrimSpace(block)
		if block == "" {
			continue
		}
		for _, s := range sentenceRe.FindAllString(block, -1) {
			s = strings.TrimSpace(s)
			if len([]rune(s)) >= 25 {
				out = append(out, s)
			}
		}
	}
	return out
}

func wordFrequencies(text string) map[string]float64 {
	freq := map[string]float64{}
	for _, w := range wordRe.FindAllString(strings.ToLower(text), -1) {
		if len(w) < 3 || stopwords[w] {
			continue
		}
		freq[w]++
	}
	return freq
}

func translatePDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	target := strings.TrimSpace(c.Str("target", "es"))
	if !regexp.MustCompile(`^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$`).MatchString(target) {
		return fmt.Errorf("choose a valid target language")
	}
	pages, err := readTextPages(in.Path, c.Password())
	if err != nil {
		return err
	}
	text := strings.Join(pages, "\n\n")
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("this PDF has no text layer. Run OCR first, then translate")
	}
	if len([]rune(text)) > 180000 {
		return fmt.Errorf("translation is limited to about 180,000 characters per job")
	}
	c.Progress(15, "Translating text")
	translated, used, err := Translate(c.Ctx, c.Engines, text, target, c.Str("source", "auto"))
	if err != nil {
		return err
	}
	if strings.TrimSpace(translated) == "" {
		return fmt.Errorf("the translation service returned no text")
	}
	lang := languageName(target)
	pdfOut := c.OutPath(baseName(in.Name) + "-" + target + ".pdf")
	c.Progress(65, "Building translated document")
	if err := renderTextReport(c, pdfOut, "Translated document · "+lang, baseName(in.Name), translated, used); err != nil {
		return err
	}
	txtOut := c.OutPath(baseName(in.Name) + "-" + target + ".txt")
	if err := writeText(txtOut, translated); err != nil {
		return err
	}
	c.SetMeta("target", target)
	c.SetMeta("targetName", lang)
	c.SetMeta("engine", used)
	c.SetMeta("characters", len([]rune(translated)))
	if _, err := c.AddOutput(filepath.Base(pdfOut), "application/pdf", "pdf", pdfOut); err != nil {
		return err
	}
	if _, err := c.AddOutput(filepath.Base(txtOut), "text/plain; charset=utf-8", "text", txtOut); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

// Translate translates text with the AI provider or LibreTranslate.
func Translate(ctx context.Context, e *engine.Engines, text, target, source string) (string, string, error) {
	if e == nil {
		return "", "", fmt.Errorf("no translation engine is configured")
	}
	if e.AI {
		var out strings.Builder
		for _, chunk := range chunkText(text, 12000) {
			prompt := fmt.Sprintf("Translate the following text into %s (%s). Preserve paragraph breaks, numbers and proper nouns. Return only the translation, without commentary.\n\n%s", languageName(target), target, chunk)
			res, err := aiComplete(ctx, e, "You are a professional translator. You never add commentary.", prompt, 4000)
			if err != nil {
				return "", "", fmt.Errorf("translation failed: %w", err)
			}
			out.WriteString(strings.TrimSpace(res))
			out.WriteString("\n\n")
		}
		return strings.TrimSpace(out.String()), "ai:" + e.AIModel, nil
	}
	if e.LibreTranslateURL != "" {
		var out strings.Builder
		for _, chunk := range chunkText(text, 3500) {
			translated, err := libreTranslate(ctx, e.LibreTranslateURL, chunk, target, source)
			if err != nil {
				return "", "", err
			}
			out.WriteString(translated)
			out.WriteString("\n\n")
		}
		return strings.TrimSpace(out.String()), "libretranslate", nil
	}
	return "", "", fmt.Errorf("translation needs an AI provider or LibreTranslate URL on the server")
}

func libreTranslate(ctx context.Context, base, text, target, source string) (string, error) {
	if source == "" {
		source = "auto"
	}
	payload, _ := json.Marshal(map[string]string{"q": text, "source": source, "target": target, "format": "text"})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/translate", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("translation service: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("translation service returned %d: %s", resp.StatusCode, truncateRunes(string(body), 300))
	}
	var parsed struct {
		TranslatedText string `json:"translatedText"`
		Error          string `json:"error"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("translation service response: %w", err)
	}
	if parsed.Error != "" {
		return "", fmt.Errorf("translation service: %s", parsed.Error)
	}
	return parsed.TranslatedText, nil
}

func askPDF(c *Context) error {
	ins, err := c.requirePDFs(1)
	if err != nil {
		return err
	}
	in := ins[0]
	question := strings.TrimSpace(c.Str("question", ""))
	if question == "" {
		return fmt.Errorf("enter a question about the document")
	}
	pages, err := readTextPages(in.Path, c.Password())
	if err != nil {
		return err
	}
	answer, sources, used, err := AnswerQuestion(c.Ctx, c.Engines, question, pages, nil)
	if err != nil {
		return err
	}
	payload := map[string]any{"question": question, "answer": answer, "sources": sources, "engine": used}
	data, _ := json.MarshalIndent(payload, "", "  ")
	jsonOut := c.OutPath(baseName(in.Name) + "-answer.json")
	if err := writeText(jsonOut, string(data)); err != nil {
		return err
	}
	txtOut := c.OutPath(baseName(in.Name) + "-answer.txt")
	body := answer
	if len(sources) > 0 {
		body += "\n\nSources:\n" + strings.Join(sources, "\n")
	}
	if err := writeText(txtOut, body); err != nil {
		return err
	}
	c.SetMeta("question", question)
	c.SetMeta("answer", answer)
	c.SetMeta("sources", sources)
	c.SetMeta("engine", used)
	if _, err := c.AddOutput(filepath.Base(jsonOut), "application/json", "json", jsonOut); err != nil {
		return err
	}
	if _, err := c.AddOutput(filepath.Base(txtOut), "text/plain; charset=utf-8", "text", txtOut); err != nil {
		return err
	}
	c.Progress(100, "Ready")
	return nil
}

// AnswerQuestion answers a question using document text, with page citations.
func AnswerQuestion(ctx context.Context, e *engine.Engines, question string, pages []string, history []ChatMessage) (string, []string, string, error) {
	text := strings.Join(pages, "\n\n")
	if strings.TrimSpace(text) == "" {
		return "", nil, "", fmt.Errorf("this PDF has no text layer. Run OCR first")
	}
	relevant := rankPassages(question, pages, 8)
	if e != nil && e.AI {
		var contextText strings.Builder
		for _, p := range relevant {
			contextText.WriteString(fmt.Sprintf("[page %d] %s\n\n", p.Page, truncateRunes(p.Text, 4000)))
		}
		var convo strings.Builder
		for _, m := range history {
			if m.Role == "user" || m.Role == "assistant" {
				convo.WriteString(m.Role + ": " + truncateRunes(m.Content, 1500) + "\n")
			}
		}
		system := "You answer questions using only the supplied document excerpts. If the answer is not in the excerpts, say you could not find it. Cite page numbers in square brackets like [page 3]. Be concise and precise."
		prompt := "DOCUMENT EXCERPTS:\n" + contextText.String()
		if convo.Len() > 0 {
			prompt += "\nCONVERSATION SO FAR:\n" + convo.String()
		}
		prompt += "\nQUESTION: " + question
		answer, err := aiComplete(ctx, e, system, prompt, 1200)
		if err == nil && strings.TrimSpace(answer) != "" {
			return strings.TrimSpace(answer), citationsFromAnswer(answer), "ai:" + e.AIModel, nil
		}
	}
	if len(relevant) == 0 {
		return "I could not find anything relevant in this document.", nil, "local retrieval", nil
	}
	var b strings.Builder
	b.WriteString("Here is what the document says:\n\n")
	var sources []string
	seen := map[int]bool{}
	for i, p := range relevant {
		if i >= 3 {
			break
		}
		b.WriteString("“" + truncateRunes(strings.TrimSpace(p.Text), 520) + "”\n")
		b.WriteString(fmt.Sprintf("— page %d\n\n", p.Page))
		if !seen[p.Page] {
			seen[p.Page] = true
			sources = append(sources, fmt.Sprintf("Page %d", p.Page))
		}
	}
	b.WriteString("This answer is extracted from the document. Connect an AI provider for a synthesized response.")
	return b.String(), sources, "local retrieval", nil
}

type passage struct {
	Page  int
	Text  string
	Score float64
}

func rankPassages(question string, pages []string, limit int) []passage {
	terms := map[string]bool{}
	for _, w := range wordRe.FindAllString(strings.ToLower(question), -1) {
		if len(w) > 2 && !stopwords[w] {
			terms[w] = true
		}
	}
	var out []passage
	for pi, page := range pages {
		paras := splitParagraphs(page)
		if len(paras) == 0 {
			paras = []string{page}
		}
		for _, para := range paras {
			lower := strings.ToLower(para)
			score := 0.0
			for term := range terms {
				if strings.Contains(lower, term) {
					score += 1
					if strings.Contains(lower, " "+term+" ") {
						score += 0.4
					}
				}
			}
			if score > 0 {
				out = append(out, passage{Page: pi + 1, Text: para, Score: score})
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

var citationRe = regexp.MustCompile(`\[page\s*(\d+)\]`)

func citationsFromAnswer(answer string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range citationRe.FindAllStringSubmatch(strings.ToLower(answer), -1) {
		key := "Page " + m[1]
		if !seen[key] {
			seen[key] = true
			out = append(out, key)
		}
	}
	return out
}

// aiComplete calls an OpenAI-compatible chat completions endpoint.
func aiComplete(ctx context.Context, e *engine.Engines, system, prompt string, maxTokens int) (string, error) {
	if e == nil || e.AIBaseURL == "" {
		return "", fmt.Errorf("no AI provider configured")
	}
	endpoint := e.AIBaseURL
	if strings.HasSuffix(endpoint, "/chat/completions") {
		// already complete
	} else if strings.HasSuffix(endpoint, "/v1") {
		endpoint += "/chat/completions"
	} else {
		endpoint += "/v1/chat/completions"
	}
	payload := map[string]any{
		"model": e.AIModel,
		"messages": []map[string]string{
			{"role": "system", "content": system},
			{"role": "user", "content": prompt},
		},
		"temperature": 0.2,
	}
	if maxTokens > 0 {
		payload["max_tokens"] = maxTokens
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if e.AIKey != "" {
		req.Header.Set("Authorization", "Bearer "+e.AIKey)
	}
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("AI provider: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("AI provider returned %d: %s", resp.StatusCode, truncateRunes(string(raw), 300))
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", fmt.Errorf("AI provider response: %w", err)
	}
	if parsed.Error.Message != "" {
		return "", fmt.Errorf("AI provider: %s", parsed.Error.Message)
	}
	if len(parsed.Choices) == 0 {
		return "", fmt.Errorf("AI provider returned no choices")
	}
	return parsed.Choices[0].Message.Content, nil
}

func chunkText(text string, size int) []string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	var chunks []string
	var current strings.Builder
	for _, para := range strings.Split(text, "\n\n") {
		if current.Len()+len(para) > size && current.Len() > 0 {
			chunks = append(chunks, strings.TrimSpace(current.String()))
			current.Reset()
		}
		if len(para) > size {
			// Hard-split an oversized paragraph on sentence boundaries.
			for _, s := range splitSentences(para) {
				if current.Len()+len(s) > size && current.Len() > 0 {
					chunks = append(chunks, strings.TrimSpace(current.String()))
					current.Reset()
				}
				current.WriteString(s)
				current.WriteString(" ")
			}
			continue
		}
		current.WriteString(para)
		current.WriteString("\n\n")
	}
	if current.Len() > 0 {
		chunks = append(chunks, strings.TrimSpace(current.String()))
	}
	return chunks
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

var languageNames = map[string]string{
	"en": "English", "es": "Spanish", "fr": "French", "de": "German", "it": "Italian",
	"pt": "Portuguese", "nl": "Dutch", "pl": "Polish", "ru": "Russian", "uk": "Ukrainian",
	"tr": "Turkish", "ar": "Arabic", "he": "Hebrew", "hi": "Hindi", "bn": "Bengali",
	"ta": "Tamil", "te": "Telugu", "mr": "Marathi", "gu": "Gujarati", "pa": "Punjabi",
	"ur": "Urdu", "zh": "Chinese", "zh-CN": "Chinese (Simplified)", "zh-TW": "Chinese (Traditional)",
	"ja": "Japanese", "ko": "Korean", "vi": "Vietnamese", "th": "Thai", "id": "Indonesian",
	"ms": "Malay", "sv": "Swedish", "da": "Danish", "no": "Norwegian", "fi": "Finnish",
	"cs": "Czech", "sk": "Slovak", "hu": "Hungarian", "ro": "Romanian", "el": "Greek",
	"bg": "Bulgarian", "hr": "Croatian", "sr": "Serbian", "sl": "Slovenian", "lt": "Lithuanian",
	"lv": "Latvian", "et": "Estonian", "fa": "Persian", "sw": "Swahili", "af": "Afrikaans",
}

// LanguageName returns a human-readable language name.
func LanguageName(code string) string { return languageName(code) }

func languageName(code string) string {
	if name, ok := languageNames[code]; ok {
		return name
	}
	if name, ok := languageNames[strings.ToLower(code)]; ok {
		return name
	}
	return code
}

func renderTextReport(c *Context, path, heading, source, body, footer string) error {
	pdf := fpdf.New("P", "pt", "A4", "")
	pdf.SetMargins(64, 64, 64)
	pdf.SetAutoPageBreak(true, 64)
	pdf.SetCompression(true)
	pdf.SetCreator("PaperLab", true)
	regular := addOverlayFont(pdf, "")
	bold := addOverlayFont(pdf, "B")
	pdf.AddPage()
	pdf.SetFillColor(37, 71, 255)
	pdf.Rect(64, 56, 42, 5, "F")
	pdf.SetXY(64, 76)
	pdf.SetFont(bold, styleFor(bold, "B"), 22)
	pdf.SetTextColor(24, 24, 27)
	pdf.MultiCell(0, 28, heading, "", "L", false)
	pdf.Ln(2)
	pdf.SetFont(regular, styleFor(regular, ""), 10)
	pdf.SetTextColor(120, 120, 125)
	pdf.MultiCell(0, 15, source+"  ·  generated by PaperLab", "", "L", false)
	pdf.Ln(16)
	for _, para := range strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n") {
		line := strings.TrimSpace(para)
		if line == "" {
			pdf.Ln(8)
			continue
		}
		if strings.EqualFold(line, "KEY POINTS") {
			pdf.Ln(6)
			pdf.SetFont(bold, styleFor(bold, "B"), 13)
			pdf.SetTextColor(24, 24, 27)
			pdf.MultiCell(0, 18, "Key points", "", "L", false)
			pdf.Ln(4)
			continue
		}
		pdf.SetFont(regular, styleFor(regular, ""), 11)
		pdf.SetTextColor(48, 48, 52)
		pdf.MultiCell(0, 17, line, "", "L", false)
		pdf.Ln(2)
	}
	pdf.SetY(-56)
	pdf.SetFont(regular, styleFor(regular, ""), 8)
	pdf.SetTextColor(150, 150, 155)
	pdf.CellFormat(0, 12, "PaperLab · "+footer, "", 0, "R", false, 0, "")
	if err := pdf.OutputFileAndClose(path); err != nil {
		return fmt.Errorf("write report: %w", err)
	}
	return nil
}

var _ = unicode.IsLetter
var _ = os.Remove
