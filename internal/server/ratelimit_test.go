package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"paperlab/internal/config"
)

func TestRateLimitMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{cfg: config.Config{RateLimitPerMin: 1}, limiter: newRateLimiter(1)}
	r := gin.New()
	r.Use(s.rateLimit())
	r.GET("/", func(c *gin.Context) { c.Status(http.StatusOK) })

	for i, want := range []int{http.StatusOK, http.StatusTooManyRequests} {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		if rec.Code != want {
			t.Fatalf("request %d: status = %d, want %d", i+1, rec.Code, want)
		}
	}
}
