package queue

import "testing"

func TestBuildOutputFileNameSanitizesCustomName(t *testing.T) {
	got := buildOutputFileName(`..\nested\custom`, "8.0")
	if got != "custom.iso" {
		t.Fatalf("expected sanitized ISO name custom.iso, got %q", got)
	}
}
