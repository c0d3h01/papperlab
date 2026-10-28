// Package server exposes PaperLab's HTTP API and static frontend.
package server

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"paperlab/internal/config"
	"paperlab/internal/engine"
	"paperlab/internal/jobs"
	"paperlab/internal/tools"
)

// Version is the public API version.
const Version = "1.0.0"

// Server owns the router, job manager, and engine inventory.
type Server struct {
	cfg     config.Config
	engines *engine.Engines
	jobs    *jobs.Manager
	router  *gin.Engine
	limiter *rateLimiter
}

// New builds the PaperLab HTTP server.
func New(cfg config.Config, e *engine.Engines) *Server {
	if !cfg.ServeWeb {
		gin.SetMode(gin.ReleaseMode)
	}
	s := &Server{
		cfg: cfg, engines: e,
		jobs:    jobs.NewManager(cfg, e),
		limiter: newRateLimiter(cfg.RateLimitPerMin),
	}
	r := gin.New()
	r.MaxMultipartMemory = 32 << 20
	if err := r.SetTrustedProxies(cfg.TrustedProxies); err != nil {
		log.Printf("warning: invalid PAPERLAB_TRUSTED_PROXIES: %v; trusting no proxies", err)
		_ = r.SetTrustedProxies(nil)
	}
	r.Use(gin.Recovery(), s.requestID(), s.cors(), s.securityHeaders(), s.rateLimit(), s.accessLog())
	s.router = r
	s.routes()
	return s
}

// Handler returns the root HTTP handler.
func (s *Server) Handler() http.Handler { return s.router }

// Close releases job resources.
func (s *Server) Close() { s.jobs.Close() }

func (s *Server) routes() {
	api := s.router.Group("/api")
	api.Use(s.apiKey())
	{
		api.GET("/health", s.health)
		api.GET("/config", s.publicConfig)
		api.GET("/tools", s.listTools)
		api.POST("/jobs", s.createJob)
		api.GET("/jobs/:id", s.getJob)
		api.DELETE("/jobs/:id", s.deleteJob)
		api.GET("/jobs/:id/files/:fileID", s.getFile)
		api.POST("/inspect/pdf", s.inspectPDF)
		api.POST("/inspect/forms", s.inspectForms)
		api.POST("/analyze/redact", s.analyzeRedact)
		api.POST("/chat", s.chat)
	}
	if s.cfg.ServeWeb {
		s.serveWeb()
	} else {
		s.router.NoRoute(func(c *gin.Context) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		})
	}
}

func (s *Server) serveWeb() {
	webDir, err := filepath.Abs(s.cfg.WebDir)
	if err != nil {
		webDir = s.cfg.WebDir
	}
	index := filepath.Join(webDir, "index.html")
	if st, err := os.Stat(index); err != nil || st.IsDir() {
		log.Printf("warning: frontend index not found at %s", index)
	}
	s.router.Static("/assets", filepath.Join(webDir, "assets"))
	s.router.Static("/vendor", filepath.Join(webDir, "vendor"))
	for _, name := range []string{"favicon.svg", "favicon.ico", "manifest.webmanifest", "robots.txt", "sw.js"} {
		file := filepath.Join(webDir, name)
		if _, err := os.Stat(file); err == nil {
			n := name
			s.router.GET("/"+n, func(c *gin.Context) {
				if strings.HasSuffix(n, ".webmanifest") {
					c.Header("Content-Type", "application/manifest+json")
				}
				if strings.HasSuffix(n, ".js") || strings.HasSuffix(n, ".webmanifest") {
					c.Header("Cache-Control", "no-cache")
				}
				c.File(file)
			})
		}
	}
	s.router.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/api") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			c.JSON(http.StatusMethodNotAllowed, gin.H{"error": "method not allowed"})
			return
		}
		rel := strings.TrimPrefix(filepath.Clean("/"+path), "/")
		candidate := filepath.Join(webDir, filepath.FromSlash(rel))
		if rel != "" && strings.HasPrefix(candidate, webDir) {
			if st, err := os.Stat(candidate); err == nil && !st.IsDir() {
				if strings.HasPrefix(path, "/assets/") || strings.HasPrefix(path, "/vendor/") {
					c.Header("Cache-Control", "public, max-age=31536000, immutable")
				}
				c.File(candidate)
				return
			}
		}
		c.Header("Cache-Control", "no-cache")
		c.File(index)
	})
}

// ---------------------------------------------------------------------------
// Middleware

func (s *Server) requestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		b := make([]byte, 8)
		_, _ = rand.Read(b)
		c.Header("X-Request-ID", hex.EncodeToString(b))
		c.Next()
	}
}

func (s *Server) cors() gin.HandlerFunc {
	allowed := map[string]bool{}
	wildcard := false
	for _, o := range s.cfg.CORSOrigins {
		if o == "*" {
			wildcard = true
		}
		allowed[strings.TrimRight(o, "/")] = true
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" {
			if wildcard || allowed[strings.TrimRight(origin, "/")] {
				if wildcard {
					c.Header("Access-Control-Allow-Origin", "*")
				} else {
					c.Header("Access-Control-Allow-Origin", origin)
					c.Header("Vary", "Origin")
				}
				c.Header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
				c.Header("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization, X-Requested-With")
				c.Header("Access-Control-Max-Age", "86400")
			}
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func (s *Server) securityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("X-Frame-Options", "SAMEORIGIN")
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		c.Header("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self' 'wasm-unsafe-eval' https://apis.google.com https://accounts.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; frame-src https://docs.google.com https://drive.google.com https://accounts.google.com; worker-src 'self' blob:; manifest-src 'self'; form-action 'self'; frame-ancestors 'self'")
		c.Next()
	}
}

func (s *Server) accessLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/assets/") || strings.HasPrefix(path, "/vendor/") {
			return
		}
		log.Printf("%s %s %d %s", c.Request.Method, path, c.Writer.Status(), time.Since(start).Round(time.Millisecond))
	}
}

func (s *Server) apiKey() gin.HandlerFunc {
	key := strings.TrimSpace(s.cfg.APIKey)
	if key == "" {
		return func(c *gin.Context) { c.Next() }
	}
	return func(c *gin.Context) {
		if c.Request.URL.Path == "/api/health" {
			c.Next()
			return
		}
		got := c.GetHeader("X-API-Key")
		if got == "" {
			auth := c.GetHeader("Authorization")
			if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
				got = strings.TrimSpace(auth[7:])
			}
		}
		if subtle.ConstantTimeCompare([]byte(got), []byte(key)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "a valid API key is required"})
			return
		}
		c.Next()
	}
}

type rateLimiter struct {
	mu    sync.Mutex
	hits  map[string][]time.Time
	limit int
}

func newRateLimiter(limit int) *rateLimiter {
	if limit <= 0 {
		limit = 240
	}
	return &rateLimiter{hits: map[string][]time.Time{}, limit: limit}
}

func (r *rateLimiter) allow(key string) bool {
	now := time.Now()
	cutoff := now.Add(-time.Minute)
	r.mu.Lock()
	defer r.mu.Unlock()
	list := r.hits[key]
	kept := list[:0]
	for _, t := range list {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= r.limit {
		r.hits[key] = kept
		return false
	}
	r.hits[key] = append(kept, now)
	if len(r.hits) > 50000 {
		for k, v := range r.hits {
			if len(v) == 0 || v[len(v)-1].Before(cutoff) {
				delete(r.hits, k)
			}
		}
	}
	return true
}

func (s *Server) rateLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		if !s.limiter.allow(ip) {
			c.Header("Retry-After", "60")
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "too many requests, please slow down"})
			return
		}
		c.Next()
	}
}

// ---------------------------------------------------------------------------
// Handlers

func (s *Server) health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "ok", "version": Version, "time": time.Now().UTC(),
		"engines": s.engines,
	})
}

func (s *Server) publicConfig(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"name": "PaperLab", "version": Version,
		"maxUploadMB": s.cfg.MaxUploadMB, "maxFiles": s.cfg.MaxFiles,
		"jobTTLMinutes": int(s.cfg.JobTTL.Minutes()),
		"ai":            s.engines.AI, "translate": s.engines.Translate,
		"engines": gin.H{
			"poppler": s.engines.Poppler, "ghostscript": s.engines.Ghostscript,
			"qpdf": s.engines.QPDF, "libreoffice": s.engines.LibreOffice,
			"tesseract": s.engines.Tesseract, "chrome": s.engines.Chrome,
		},
		"ocrLanguages": s.engines.OCRLangs,
	})
}

func (s *Server) listTools(c *gin.Context) {
	inv := tools.Inventory(s.engines)
	sort.SliceStable(inv, func(i, j int) bool {
		if inv[i].Group != inv[j].Group {
			return inv[i].Group < inv[j].Group
		}
		return inv[i].Name < inv[j].Name
	})
	c.JSON(http.StatusOK, gin.H{"tools": inv, "count": len(inv)})
}

func (s *Server) createJob(c *gin.Context) {
	limit := s.cfg.MaxUploadMB * 1024 * 1024
	if limit <= 0 {
		limit = 250 << 20
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "could not read the upload: " + err.Error()})
		return
	}
	toolID := strings.TrimSpace(c.PostForm("tool"))
	if toolID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "choose a tool"})
		return
	}
	tool, ok := tools.Get(toolID)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown tool: " + toolID})
		return
	}
	options := map[string]any{}
	if raw := strings.TrimSpace(c.PostForm("options")); raw != "" {
		dec := json.NewDecoder(strings.NewReader(raw))
		dec.UseNumber()
		if err := dec.Decode(&options); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "options must be valid JSON: " + err.Error()})
			return
		}
	}
	stage, err := os.MkdirTemp(filepath.Join(s.cfg.DataDir, "staging"), "up-")
	if err != nil {
		_ = os.MkdirAll(filepath.Join(s.cfg.DataDir, "staging"), 0o700)
		stage, err = os.MkdirTemp(filepath.Join(s.cfg.DataDir, "staging"), "up-")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create a work directory"})
			return
		}
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.RemoveAll(stage)
		}
	}()

	var inputs []tools.Input
	total := int64(0)
	addGroup := func(field, role string) error {
		for i, fh := range form.File[field] {
			if fh.Size > limit {
				return fmt.Errorf("%s is larger than the %d MB limit", fh.Filename, s.cfg.MaxUploadMB)
			}
			total += fh.Size
			if total > limit {
				return fmt.Errorf("the upload exceeds the %d MB request limit", s.cfg.MaxUploadMB)
			}
			name := tools.SafeFileName(fh.Filename)
			if name == "" {
				name = fmt.Sprintf("%s-%d", field, i+1)
			}
			dest := filepath.Join(stage, fmt.Sprintf("%s-%02d-%s", role, i+1, name))
			src, err := fh.Open()
			if err != nil {
				return err
			}
			dst, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
			if err != nil {
				src.Close()
				return err
			}
			_, copyErr := io.Copy(dst, src)
			src.Close()
			dst.Close()
			if copyErr != nil {
				return copyErr
			}
			mimeType := fh.Header.Get("Content-Type")
			if mimeType == "" || mimeType == "application/octet-stream" {
				mimeType = tools.MIMEForName(name)
			}
			inputs = append(inputs, tools.Input{
				Name: name, Path: dest, Size: fh.Size, MIME: mimeType, Role: role,
			})
		}
		return nil
	}
	if err := addGroup("files", "files"); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := addGroup("file", "files"); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := addGroup("assets", "assets"); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(inputs) == 0 && !tool.AllowNoInput {
		c.JSON(http.StatusBadRequest, gin.H{"error": "upload at least one file"})
		return
	}
	if len(inputs) > s.cfg.MaxFiles {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("at most %d files are allowed", s.cfg.MaxFiles)})
		return
	}
	job, err := s.jobs.Create(toolID, inputs, options)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cleanup = false
	c.JSON(http.StatusAccepted, s.jobs.View(job))
}

func (s *Server) getJob(c *gin.Context) {
	job, ok := s.jobs.Get(c.Param("id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found or expired"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, s.jobs.View(job))
}

func (s *Server) deleteJob(c *gin.Context) {
	if !s.jobs.Delete(c.Param("id")) {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (s *Server) getFile(c *gin.Context) {
	_, out, ok := s.jobs.Output(c.Param("id"), c.Param("fileID"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	if _, err := os.Stat(out.Path); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "file expired"})
		return
	}
	c.Header("Content-Type", out.MIME)
	c.Header("X-Content-Type-Options", "nosniff")
	disposition := "attachment"
	if out.Kind == "pdf" || out.Kind == "image" || c.Query("inline") == "1" {
		disposition = "inline"
	}
	ascii := strings.Map(func(r rune) rune {
		if r < 32 || r > 126 || r == '"' || r == '\\' {
			return '_'
		}
		return r
	}, out.Name)
	c.Header("Content-Disposition", fmt.Sprintf("%s; filename=%q; filename*=UTF-8''%s", disposition, ascii, urlPathEscape(out.Name)))
	c.Header("Cache-Control", "private, max-age=3600")
	http.ServeFile(c.Writer, c.Request, out.Path)
}

func urlPathEscape(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~' {
			b.WriteByte(c)
		} else {
			b.WriteString(fmt.Sprintf("%%%02X", c))
		}
	}
	return b.String()
}

func (s *Server) saveUpload(c *gin.Context, field string) (string, func(), error) {
	limit := s.cfg.MaxUploadMB * 1024 * 1024
	if limit <= 0 {
		limit = 250 << 20
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	file, err := c.FormFile(field)
	if err != nil {
		return "", nil, fmt.Errorf("upload a file in the %q field", field)
	}
	if file.Size > limit {
		return "", nil, fmt.Errorf("file is larger than the %d MB limit", s.cfg.MaxUploadMB)
	}
	dir, err := os.MkdirTemp(filepath.Join(s.cfg.DataDir, "staging"), "inspect-")
	if err != nil {
		_ = os.MkdirAll(filepath.Join(s.cfg.DataDir, "staging"), 0o700)
		dir, err = os.MkdirTemp(filepath.Join(s.cfg.DataDir, "staging"), "inspect-")
		if err != nil {
			return "", nil, err
		}
	}
	cleanup := func() { _ = os.RemoveAll(dir) }
	name := tools.SafeFileName(file.Filename)
	if name == "" {
		name = "upload"
	}
	dest := filepath.Join(dir, name)
	if err := c.SaveUploadedFile(file, dest); err != nil {
		cleanup()
		return "", nil, err
	}
	return dest, cleanup, nil
}

func (s *Server) inspectPDF(c *gin.Context) {
	path, cleanup, err := s.saveUpload(c, "file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	defer cleanup()
	ins, err := tools.InspectPDF(path, c.PostForm("password"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, ins)
}

func (s *Server) inspectForms(c *gin.Context) {
	path, cleanup, err := s.saveUpload(c, "file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	defer cleanup()
	fields, err := tools.InspectForm(path, c.PostForm("password"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"fields": fields, "count": len(fields)})
}

func (s *Server) analyzeRedact(c *gin.Context) {
	path, cleanup, err := s.saveUpload(c, "file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	defer cleanup()
	var terms []string
	raw := c.PostForm("terms")
	if raw == "" {
		raw = "[]"
	}
	if err := json.Unmarshal([]byte(raw), &terms); err != nil {
		for _, t := range strings.Split(raw, ",") {
			if t = strings.TrimSpace(t); t != "" {
				terms = append(terms, t)
			}
		}
	}
	if len(terms) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provide at least one search term"})
		return
	}
	if len(terms) > 25 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at most 25 terms are supported"})
		return
	}
	boxes, err := tools.AnalyzeRedaction(path, c.PostForm("password"), terms)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"boxes": boxes, "count": len(boxes)})
}

func (s *Server) chat(c *gin.Context) {
	path, cleanup, err := s.saveUpload(c, "file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	defer cleanup()
	question := strings.TrimSpace(c.PostForm("question"))
	if question == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ask a question"})
		return
	}
	if len(question) > 4000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "the question is too long"})
		return
	}
	var history []tools.ChatMessage
	if raw := strings.TrimSpace(c.PostForm("history")); raw != "" {
		if err := json.Unmarshal([]byte(raw), &history); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "history must be valid JSON"})
			return
		}
		if len(history) > 20 {
			history = history[len(history)-20:]
		}
	}
	pages, err := tools.ExtractPagesText(path, c.PostForm("password"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ctx := c.Request.Context()
	timeout, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	answer, sources, used, err := tools.AnswerQuestion(timeout, s.engines, question, pages, history)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"answer": answer, "sources": sources, "engine": used,
		"pages": len(pages), "question": question,
	})
}
