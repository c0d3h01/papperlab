package tools

import "testing"

func TestSafeFileName(t *testing.T) {
	cases := map[string]string{
		"../../etc/passwd":               "passwd",
		`..\..\windows\system32\cmd.exe`: "cmd.exe",
		".hidden.pdf":                    "hidden.pdf",
		"report:2026?.pdf":               "report_2026_.pdf",
		"Quarterly Report (final).pdf":   "Quarterly Report (final).pdf",
		"  spaced  .pdf ":                "spaced  .pdf",
		"":                               "",
		"..":                             "",
		"a<b>c|d.pdf":                    "a_b_c_d.pdf",
	}
	for in, want := range cases {
		if got := safeFileName(in); got != want {
			t.Errorf("safeFileName(%q) = %q, want %q", in, got, want)
		}
	}
}
