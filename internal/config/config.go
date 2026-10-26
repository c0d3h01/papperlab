package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds runtime configuration for the PaperLab API.
type Config struct {
	Addr            string
	WebDir          string
	DataDir         string
	ServeWeb        bool
	MaxUploadMB     int64
	MaxFiles        int
	JobTTL          time.Duration
	JobTimeout      time.Duration
	APIKey          string
	CORSOrigins     []string
	PublicURL       string
	AllowLocalURLs  bool
	AIBaseURL       string
	AIAPIKey        string
	AIModel         string
	LibreTranslate  string
	ChromePath      string
	LibreOfficePath string
	RateLimitPerMin int
}

func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	v, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(v) == "" {
		return fallback
	}
	b, err := strconv.ParseBool(strings.TrimSpace(v))
	if err != nil {
		return fallback
	}
	return b
}

func envInt(key string, fallback int) int {
	v, ok := os.LookupEnv(key)
	if !ok {
		return fallback
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil {
		return fallback
	}
	return n
}

// Load reads configuration from the environment.
func Load() Config {
	cors := []string{"*"}
	if raw := strings.TrimSpace(os.Getenv("PAPERLAB_CORS_ORIGINS")); raw != "" {
		cors = nil
		for _, s := range strings.Split(raw, ",") {
			if s = strings.TrimSpace(s); s != "" {
				cors = append(cors, s)
			}
		}
	}
	return Config{
		Addr:            env("PAPERLAB_ADDR", ":8080"),
		WebDir:          env("PAPERLAB_WEB_DIR", "web"),
		DataDir:         env("PAPERLAB_DATA_DIR", os.TempDir()+"/paperlab"),
		ServeWeb:        envBool("PAPERLAB_SERVE_WEB", true),
		MaxUploadMB:     int64(envInt("PAPERLAB_MAX_UPLOAD_MB", 250)),
		MaxFiles:        envInt("PAPERLAB_MAX_FILES", 30),
		JobTTL:          time.Duration(envInt("PAPERLAB_JOB_TTL_MIN", 120)) * time.Minute,
		JobTimeout:      time.Duration(envInt("PAPERLAB_JOB_TIMEOUT_MIN", 20)) * time.Minute,
		APIKey:          os.Getenv("PAPERLAB_API_KEY"),
		CORSOrigins:     cors,
		PublicURL:       strings.TrimRight(os.Getenv("PAPERLAB_PUBLIC_URL"), "/"),
		AllowLocalURLs:  envBool("PAPERLAB_ALLOW_LOCAL_URLS", false),
		AIBaseURL:       strings.TrimRight(os.Getenv("PAPERLAB_AI_BASE_URL"), "/"),
		AIAPIKey:        os.Getenv("PAPERLAB_AI_API_KEY"),
		AIModel:         env("PAPERLAB_AI_MODEL", "gpt-4o-mini"),
		LibreTranslate:  strings.TrimRight(os.Getenv("PAPERLAB_LIBRETRANSLATE_URL"), "/"),
		ChromePath:      os.Getenv("PAPERLAB_CHROME_PATH"),
		LibreOfficePath: os.Getenv("PAPERLAB_LIBREOFFICE_PATH"),
		RateLimitPerMin: envInt("PAPERLAB_RATE_LIMIT_PER_MIN", 240),
	}
}
