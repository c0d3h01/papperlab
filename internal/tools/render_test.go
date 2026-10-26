package tools

import "testing"

func TestSortRenderedOrdersByPageNumber(t *testing.T) {
	paths := []string{
		"/tmp/page-10.png",
		"/tmp/page-2.png",
		"/tmp/page-100.png",
		"/tmp/page-1.png",
	}
	sortRendered(paths)
	want := []int{1, 2, 10, 100}
	for i, path := range paths {
		if got := pageNumberFromRendered(path); got != want[i] {
			t.Fatalf("position %d is page %d, want %d (paths: %v)", i, got, want[i], paths)
		}
	}
}
