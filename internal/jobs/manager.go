// Package jobs runs document operations asynchronously with isolated,
// auto-expiring work directories.
package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"paperlab/internal/config"
	"paperlab/internal/engine"
	"paperlab/internal/tools"
)

// Job is one asynchronous document operation.
type Job struct {
	ID         string         `json:"id"`
	Tool       string         `json:"tool"`
	Status     string         `json:"status"`
	Progress   int            `json:"progress"`
	Message    string         `json:"message"`
	CreatedAt  time.Time      `json:"createdAt"`
	StartedAt  *time.Time     `json:"startedAt,omitempty"`
	FinishedAt *time.Time     `json:"finishedAt,omitempty"`
	Inputs     []tools.Input  `json:"inputs"`
	Outputs    []tools.Output `json:"outputs"`
	Meta       map[string]any `json:"meta,omitempty"`
	Error      string         `json:"error,omitempty"`

	dir    string
	cancel context.CancelFunc
	mu     sync.RWMutex
}

// OutputURL is filled when serializing for clients.
type OutputView struct {
	tools.Output
	URL string `json:"url"`
}

// JobView is the public representation of a job.
type JobView struct {
	ID         string         `json:"id"`
	Tool       string         `json:"tool"`
	Status     string         `json:"status"`
	Progress   int            `json:"progress"`
	Message    string         `json:"message"`
	CreatedAt  time.Time      `json:"createdAt"`
	StartedAt  *time.Time     `json:"startedAt,omitempty"`
	FinishedAt *time.Time     `json:"finishedAt,omitempty"`
	Inputs     []tools.Input  `json:"inputs"`
	Outputs    []OutputView   `json:"outputs"`
	Meta       map[string]any `json:"meta,omitempty"`
	Error      string         `json:"error,omitempty"`
}

// Manager owns all jobs.
type Manager struct {
	cfg     config.Config
	engines *engine.Engines
	mu      sync.RWMutex
	jobs    map[string]*Job
	stop    chan struct{}
}

// NewManager creates a job manager and starts its cleanup loop.
func NewManager(cfg config.Config, e *engine.Engines) *Manager {
	_ = os.MkdirAll(cfg.DataDir, 0o700)
	m := &Manager{
		cfg: cfg, engines: e,
		jobs: map[string]*Job{},
		stop: make(chan struct{}),
	}
	go m.cleanupLoop()
	return m
}

// Close stops the cleanup loop.
func (m *Manager) Close() {
	select {
	case <-m.stop:
	default:
		close(m.stop)
	}
}

func newID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate job id: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// Create moves uploaded files into a new job directory and starts it.
func (m *Manager) Create(toolID string, inputs []tools.Input, options map[string]any) (*Job, error) {
	tool, ok := tools.Get(toolID)
	if !ok {
		return nil, fmt.Errorf("unknown tool %q", toolID)
	}
	for _, req := range tool.Requires {
		if err := m.engines.Need(req); err != nil {
			return nil, err
		}
	}
	if len(inputs) == 0 && !tool.AllowNoInput {
		return nil, errors.New("no files uploaded")
	}
	if len(inputs) > m.cfg.MaxFiles {
		return nil, fmt.Errorf("at most %d files are allowed", m.cfg.MaxFiles)
	}

	id, err := newID()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(m.cfg.DataDir, id)
	inDir := filepath.Join(dir, "in")
	outDir := filepath.Join(dir, "out")
	if err := os.MkdirAll(inDir, 0o700); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(outDir, 0o700); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(dir, "work"), 0o700); err != nil {
		return nil, err
	}

	moved := make([]tools.Input, 0, len(inputs))
	for i := range inputs {
		in := inputs[i]
		name := fmt.Sprintf("f%d-%s", i+1, filepath.Base(in.Name))
		dest := filepath.Join(inDir, name)
		if err := os.Rename(in.Path, dest); err != nil {
			// Cross-device staging directories are possible; copy instead.
			if err := copyFile(in.Path, dest); err != nil {
				_ = os.RemoveAll(dir)
				return nil, err
			}
			_ = os.Remove(in.Path)
		}
		in.ID = fmt.Sprintf("f%d", i+1)
		in.Path = dest
		in.Size = fileSize(dest)
		if in.Role == "" {
			in.Role = "files"
		}
		moved = append(moved, in)
	}

	now := time.Now()
	job := &Job{
		ID: id, Tool: toolID, Status: "queued", Progress: 0,
		Message: "Waiting to start", CreatedAt: now,
		Inputs: moved, Outputs: []tools.Output{}, Meta: map[string]any{},
		dir: dir,
	}
	m.mu.Lock()
	m.jobs[id] = job
	m.mu.Unlock()

	go m.run(job, tool, options)
	return job, nil
}

func (m *Manager) run(job *Job, tool *tools.Tool, options map[string]any) {
	ctx, cancel := context.WithTimeout(context.Background(), m.cfg.JobTimeout)
	job.mu.Lock()
	job.cancel = cancel
	job.Status = "running"
	job.Message = "Starting"
	started := time.Now()
	job.StartedAt = &started
	job.mu.Unlock()
	defer cancel()

	tctx := &tools.Context{
		Ctx: ctx, JobID: job.ID, Dir: job.dir,
		InDir: filepath.Join(job.dir, "in"), OutDir: filepath.Join(job.dir, "out"),
		Inputs: job.Inputs, Options: options, Meta: map[string]any{},
		Engines: m.engines, AllowLocalURLs: m.cfg.AllowLocalURLs,
	}
	tctx.SetProgressFunc(func(p int, msg string) {
		job.mu.Lock()
		job.Progress = p
		if msg != "" {
			job.Message = msg
		}
		job.mu.Unlock()
	})

	var err error
	func() {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("internal processing error")
				log.Printf("job %s panic: %v", job.ID, r)
			}
		}()
		err = tool.Run(tctx)
	}()

	job.mu.Lock()
	finished := time.Now()
	job.FinishedAt = &finished
	job.Meta = tctx.Meta
	if job.Meta == nil {
		job.Meta = map[string]any{}
	}
	if err == nil && len(tctx.Outputs()) == 0 {
		err = errors.New("the operation produced no output")
	}
	if err != nil {
		job.Status = "error"
		job.Progress = 100
		job.Error = friendlyError(err)
		job.Message = "Could not finish"
		log.Printf("job %s (%s) failed: %v", job.ID, job.Tool, err)
	} else {
		job.Status = "done"
		job.Progress = 100
		job.Outputs = tctx.Outputs()
		job.Message = "Ready"
	}
	job.mu.Unlock()
}

func friendlyError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	if errors.Is(err, context.DeadlineExceeded) {
		return "The operation took too long. Try a smaller file or fewer pages."
	}
	if errors.Is(err, context.Canceled) {
		return "The operation was canceled."
	}
	if len(msg) > 600 {
		msg = msg[:600] + "…"
	}
	return msg
}

// Get returns a job by ID.
func (m *Manager) Get(id string) (*Job, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	j, ok := m.jobs[id]
	return j, ok
}

// Delete cancels and removes a job.
func (m *Manager) Delete(id string) bool {
	m.mu.Lock()
	job, ok := m.jobs[id]
	if ok {
		delete(m.jobs, id)
	}
	m.mu.Unlock()
	if !ok {
		return false
	}
	job.mu.Lock()
	if job.cancel != nil {
		job.cancel()
	}
	job.mu.Unlock()
	_ = os.RemoveAll(job.dir)
	return true
}

// Output resolves a downloadable output.
func (m *Manager) Output(jobID, outputID string) (*Job, tools.Output, bool) {
	job, ok := m.Get(jobID)
	if !ok {
		return nil, tools.Output{}, false
	}
	job.mu.RLock()
	defer job.mu.RUnlock()
	for _, out := range job.Outputs {
		if out.ID == outputID {
			return job, out, true
		}
	}
	return job, tools.Output{}, false
}

// View serializes a job for the API.
func (m *Manager) View(job *Job) JobView {
	job.mu.RLock()
	defer job.mu.RUnlock()
	outs := make([]OutputView, 0, len(job.Outputs))
	for _, o := range job.Outputs {
		outs = append(outs, OutputView{
			Output: o,
			URL:    fmt.Sprintf("/api/jobs/%s/files/%s", job.ID, o.ID),
		})
	}
	meta := job.Meta
	if meta == nil {
		meta = map[string]any{}
	}
	return JobView{
		ID: job.ID, Tool: job.Tool, Status: job.Status,
		Progress: job.Progress, Message: job.Message,
		CreatedAt: job.CreatedAt, StartedAt: job.StartedAt, FinishedAt: job.FinishedAt,
		Inputs: job.Inputs, Outputs: outs, Meta: meta, Error: job.Error,
	}
}

func (m *Manager) cleanupLoop() {
	t := time.NewTicker(5 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-m.stop:
			return
		case <-t.C:
			m.cleanup()
		}
	}
}

func (m *Manager) cleanup() {
	cutoff := time.Now().Add(-m.cfg.JobTTL)
	var remove []string
	m.mu.Lock()
	for id, job := range m.jobs {
		job.mu.RLock()
		created := job.CreatedAt
		status := job.Status
		job.mu.RUnlock()
		if created.Before(cutoff) && status != "running" {
			delete(m.jobs, id)
			remove = append(remove, job.dir)
		}
	}
	m.mu.Unlock()
	for _, dir := range remove {
		_ = os.RemoveAll(dir)
	}
	// Remove orphaned directories (for example after a crash).
	entries, _ := os.ReadDir(m.cfg.DataDir)
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err == nil && info.ModTime().Before(cutoff.Add(-time.Hour)) {
			m.mu.RLock()
			_, exists := m.jobs[e.Name()]
			m.mu.RUnlock()
			if !exists {
				_ = os.RemoveAll(filepath.Join(m.cfg.DataDir, e.Name()))
			}
		}
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := out.ReadFrom(in); err != nil {
		return err
	}
	return out.Sync()
}

func fileSize(path string) int64 {
	if st, err := os.Stat(path); err == nil {
		return st.Size()
	}
	return 0
}
