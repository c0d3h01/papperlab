package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"paperlab/internal/config"
)

func TestRateLimitMiddlewareHTTP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{cfg: config.Config{RateLimitPerMin: 1}, limiter: newRateLimiter(1)}
	r := gin.New()
	r.Use(s.rateLimit())
	r.GET("/", func(c *gin.Context) { c.Status(http.StatusOK) })

	srv := httptest.NewServer(r)
	defer srv.Close()
	client := &http.Client{Timeout: 2 * time.Second}
	for i, want := range []int{http.StatusOK, http.StatusTooManyRequests} {
		resp, err := client.Get(srv.URL)
		if err != nil {
			t.Fatalf("request %d: %v", i+1, err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Fatalf("request %d: status = %d, want %d", i+1, resp.StatusCode, want)
		}
	}
}
