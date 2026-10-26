// Command server runs the PaperLab API and static frontend.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"paperlab/internal/config"
	"paperlab/internal/engine"
	"paperlab/internal/server"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("paperlab ")

	cfg := config.Load()
	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		log.Fatalf("data directory: %v", err)
	}
	eng := engine.Detect()
	log.Printf("engines: poppler=%v ghostscript=%v qpdf=%v libreoffice=%v tesseract=%v chrome=%v ai=%v translate=%v",
		eng.Poppler, eng.Ghostscript, eng.QPDF, eng.LibreOffice, eng.Tesseract, eng.Chrome, eng.AI, eng.Translate)
	if len(eng.OCRLangs) > 0 {
		log.Printf("ocr languages: %v", eng.OCRLangs)
	}

	srv := server.New(cfg, eng)
	defer srv.Close()

	httpServer := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 20 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		log.Printf("listening on %s (web dir %s)", cfg.Addr, cfg.WebDir)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Printf("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}
