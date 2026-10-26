// Package engine discovers external document-processing engines and runs
// them safely with argument vectors (never a shell).
package engine

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Engines describes the external tools available to PaperLab.
type Engines struct {
	Poppler     bool     `json:"poppler"`
	Ghostscript bool     `json:"ghostscript"`
	QPDF        bool     `json:"qpdf"`
	LibreOffice bool     `json:"libreoffice"`
	Tesseract   bool     `json:"tesseract"`
	Chrome      bool     `json:"chrome"`
	AI          bool     `json:"ai"`
	Translate   bool     `json:"translate"`
	OCRLangs    []string `json:"ocrLanguages"`

	PopplerPath     string `json:"-"`
	GSPath          string `json:"-"`
	QPDFPath        string `json:"-"`
	LibreOfficePath string `json:"-"`
	TesseractPath   string `json:"-"`
	ChromePath      string `json:"-"`
	ICCProfile      string `json:"-"`

	AIBaseURL         string `json:"-"`
	AIKey             string `json:"-"`
	AIModel           string `json:"-"`
	LibreTranslateURL string `json:"-"`

	Versions map[string]string `json:"versions"`
}

var (
	detectOnce sync.Once
	detected   *Engines
)

// Detect returns the process-wide engine inventory. Detection runs once.
func Detect() *Engines {
	detectOnce.Do(func() {
		detected = detect(os.Getenv("PAPERLAB_CHROME_PATH"), os.Getenv("PAPERLAB_LIBREOFFICE_PATH"))
	})
	return detected
}

// Refresh redetects engines (useful after installing dependencies).
func Refresh() *Engines {
	detected = detect(os.Getenv("PAPERLAB_CHROME_PATH"), os.Getenv("PAPERLAB_LIBREOFFICE_PATH"))
	return detected
}

func detect(chromeOverride, loOverride string) *Engines {
	e := &Engines{Versions: map[string]string{}}
	e.PopplerPath = find("pdftoppm")
	e.GSPath = find("gs", "gswin64c", "gswin32c")
	e.QPDFPath = find("qpdf")
	e.TesseractPath = find("tesseract")
	e.LibreOfficePath = find(loOverride, "soffice", "libreoffice")
	e.ChromePath = findChrome(chromeOverride)

	e.Poppler = e.PopplerPath != "" && find("pdftotext") != "" && find("pdfinfo") != ""
	e.Ghostscript = e.GSPath != ""
	e.QPDF = e.QPDFPath != ""
	e.LibreOffice = e.LibreOfficePath != ""
	e.Tesseract = e.TesseractPath != ""
	e.Chrome = e.ChromePath != ""
	e.AIBaseURL = strings.TrimRight(strings.TrimSpace(os.Getenv("PAPERLAB_AI_BASE_URL")), "/")
	e.AIKey = strings.TrimSpace(os.Getenv("PAPERLAB_AI_API_KEY"))
	e.AIModel = strings.TrimSpace(os.Getenv("PAPERLAB_AI_MODEL"))
	if e.AIModel == "" {
		e.AIModel = "gpt-4o-mini"
	}
	e.LibreTranslateURL = strings.TrimRight(strings.TrimSpace(os.Getenv("PAPERLAB_LIBRETRANSLATE_URL")), "/")
	e.AI = e.AIBaseURL != "" && e.AIModel != ""
	e.Translate = e.AI || e.LibreTranslateURL != ""

	if e.Tesseract {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		out, _ := Run(ctx, e.TesseractPath, "--list-langs")
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "List of available") {
				continue
			}
			e.OCRLangs = append(e.OCRLangs, line)
		}
	}
	e.ICCProfile = findICC()
	if e.PopplerPath != "" {
		e.Versions["poppler"] = version(e.PopplerPath, "-v")
	}
	if e.GSPath != "" {
		e.Versions["ghostscript"] = version(e.GSPath, "--version")
	}
	if e.QPDFPath != "" {
		e.Versions["qpdf"] = version(e.QPDFPath, "--version")
	}
	if e.TesseractPath != "" {
		e.Versions["tesseract"] = version(e.TesseractPath, "--version")
	}
	if e.LibreOfficePath != "" {
		e.Versions["libreoffice"] = version(e.LibreOfficePath, "--version")
	}
	if e.ChromePath != "" {
		e.Versions["chrome"] = version(e.ChromePath, "--version")
	}
	return e
}

// FindTool resolves a binary name or path.
func FindTool(name string) string { return find(name) }

func find(names ...string) string {
	for _, name := range names {
		if name == "" {
			continue
		}
		if strings.ContainsRune(name, os.PathSeparator) {
			if st, err := os.Stat(name); err == nil && !st.IsDir() {
				return name
			}
			continue
		}
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	return ""
}

func findChrome(override string) string {
	if p := find(override); p != "" {
		return p
	}
	candidates := []string{
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
		"/usr/bin/google-chrome",
		"/usr/bin/google-chrome-stable",
		"/opt/google/chrome/chrome",
	}
	if runtime.GOOS == "windows" {
		candidates = append(candidates,
			`C:\Program Files\Google\Chrome\Application\chrome.exe`,
			`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
		)
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	for _, n := range []string{"chrome", "chromium", "google-chrome"} {
		if p, err := exec.LookPath(n); err == nil {
			return p
		}
	}
	return ""
}

func findICC() string {
	candidates := []string{
		"/usr/share/color/icc/ghostscript/srgb.icc",
		"/usr/share/color/icc/sRGB.icc",
		"/usr/local/share/ghostscript/iccprofiles/default_rgb.icc",
		"/opt/homebrew/share/ghostscript/iccprofiles/default_rgb.icc",
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	// Homebrew installs versioned ghostscript directories.
	matches, _ := filepath.Glob("/opt/homebrew/share/ghostscript/*/iccprofiles/default_rgb.icc")
	if len(matches) > 0 {
		return matches[0]
	}
	matches, _ = filepath.Glob("/usr/share/ghostscript/*/iccprofiles/default_rgb.icc")
	if len(matches) > 0 {
		return matches[0]
	}
	return ""
}

var versionRe = regexp.MustCompile(`(?i)(\d+\.\d+(?:\.\d+)?)`)

func version(bin string, arg string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	out, _ := Run(ctx, bin, arg)
	if m := versionRe.FindString(string(out)); m != "" {
		return m
	}
	return "installed"
}

// Run executes a command with a bounded combined output buffer.
func Run(ctx context.Context, bin string, args ...string) (string, error) {
	return RunInDir(ctx, "", bin, args...)
}

// RunCommand is a convenience wrapper for tools holding an Engines value.
func (e *Engines) RunCommand(ctx context.Context, bin string, args ...string) (string, error) {
	return Run(ctx, bin, args...)
}

// RunCommandInDir executes a command with dir as its working directory.
func (e *Engines) RunCommandInDir(ctx context.Context, dir, bin string, args ...string) (string, error) {
	return RunInDir(ctx, dir, bin, args...)
}

// RunInDir executes a command in dir with a bounded combined output buffer.
func RunInDir(ctx context.Context, dir, bin string, args ...string) (string, error) {
	if bin == "" {
		return "", fmt.Errorf("engine not installed")
	}
	cmd := exec.CommandContext(ctx, bin, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	var buf bytes.Buffer
	limited := &limitedWriter{w: &buf, remaining: 128 * 1024}
	cmd.Stdout = limited
	cmd.Stderr = limited
	err := cmd.Run()
	out := strings.TrimSpace(buf.String())
	if err != nil {
		if ctx.Err() != nil {
			return out, fmt.Errorf("engine timed out: %w", ctx.Err())
		}
		if out == "" {
			return out, fmt.Errorf("%s: %w", filepath.Base(bin), err)
		}
		return out, fmt.Errorf("%s: %w: %s", filepath.Base(bin), err, tail(out, 1200))
	}
	return out, nil
}

type limitedWriter struct {
	w         *bytes.Buffer
	remaining int
}

func (l *limitedWriter) Write(p []byte) (int, error) {
	if l.remaining > 0 {
		n := len(p)
		if n > l.remaining {
			n = l.remaining
		}
		_, _ = l.w.Write(p[:n])
		l.remaining -= n
	}
	return len(p), nil
}

func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return "…" + s[len(s)-n:]
}

// Need returns a friendly error when a required engine is absent.
func (e *Engines) Need(name string) error {
	var ok bool
	switch name {
	case "poppler":
		ok = e.Poppler
	case "ghostscript":
		ok = e.Ghostscript
	case "qpdf":
		ok = e.QPDF
	case "libreoffice":
		ok = e.LibreOffice
	case "tesseract":
		ok = e.Tesseract
	case "chrome":
		ok = e.Chrome
	case "ai":
		ok = e.AI
	case "translate":
		ok = e.Translate
	case "pdfcpu":
		ok = true
	default:
		return fmt.Errorf("unknown engine %q", name)
	}
	if !ok {
		return fmt.Errorf("the %s engine is not installed on this server", name)
	}
	return nil
}
