package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"paperlab/internal/config"
)

func TestAPIKeyMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{cfg: config.Config{APIKey: "secret"}}
	r := gin.New()
	r.Use(s.apiKey())
	r.GET("/api/health", func(c *gin.Context) { c.Status(http.StatusOK) })
	r.GET("/api/tools", func(c *gin.Context) { c.Status(http.StatusOK) })

	cases := []struct {
		name    string
		path    string
		headers map[string]string
		want    int
	}{
		{"health is open", "/api/health", nil, http.StatusOK},
		{"missing key", "/api/tools", nil, http.StatusUnauthorized},
		{"wrong key", "/api/tools", map[string]string{"X-API-Key": "nope"}, http.StatusUnauthorized},
		{"header key", "/api/tools", map[string]string{"X-API-Key": "secret"}, http.StatusOK},
		{"bearer key", "/api/tools", map[string]string{"Authorization": "Bearer secret"}, http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			for key, value := range tc.headers {
				req.Header.Set(key, value)
			}
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d", rec.Code, tc.want)
			}
		})
	}
}

func TestSecurityHeadersIncludeCSP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{cfg: config.Config{}}
	r := gin.New()
	r.Use(s.securityHeaders())
	r.GET("/", func(c *gin.Context) { c.Status(http.StatusOK) })

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if got := rec.Header().Get("Content-Security-Policy"); got == "" {
		t.Fatal("Content-Security-Policy header is missing")
	}
}
