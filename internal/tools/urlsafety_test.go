package tools

import (
	"context"
	"testing"
)

func TestValidateRemoteURLBlocksLocalAddresses(t *testing.T) {
	blocked := []string{
		"http://127.0.0.1/",
		"http://10.0.0.1/",
		"http://169.254.169.254/latest/meta-data/",
		"http://192.168.1.1/",
		"http://0.0.0.0/",
		"http://100.64.0.1/",
		"http://[::1]/",
		"http://[fc00::1]/",
		"http://[fe80::1]/",
	}
	for _, raw := range blocked {
		if _, err := validateRemoteURL(context.Background(), raw, false); err == nil {
			t.Errorf("validateRemoteURL(%q) allowed a private address", raw)
		}
	}
}

func TestValidateRemoteURLAllowsPublicAddresses(t *testing.T) {
	allowed := []string{
		"http://1.1.1.1/",
		"https://[2606:4700:4700::1111]/",
	}
	for _, raw := range allowed {
		if _, err := validateRemoteURL(context.Background(), raw, false); err != nil {
			t.Errorf("validateRemoteURL(%q) = %v, want nil", raw, err)
		}
	}
}

func TestValidateRemoteURLAllowLocalFlag(t *testing.T) {
	if _, err := validateRemoteURL(context.Background(), "http://127.0.0.1:8080/", true); err != nil {
		t.Fatalf("allowLocal should permit loopback: %v", err)
	}
}

func TestValidateRemoteURLRejectsUnsafeURLs(t *testing.T) {
	bad := []string{
		"file:///etc/passwd",
		"ftp://example.com/file",
		"javascript:alert(1)",
		"http://user:pass@example.com/",
		"not a url",
	}
	for _, raw := range bad {
		if _, err := validateRemoteURL(context.Background(), raw, false); err == nil {
			t.Errorf("validateRemoteURL(%q) accepted an unsafe URL", raw)
		}
	}
}
