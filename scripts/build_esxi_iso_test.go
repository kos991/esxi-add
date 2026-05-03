package scripts

import (
	"os"
	"strings"
	"testing"
)

func TestBuildScriptSkipsEmptyDriverPaths(t *testing.T) {
	content, err := os.ReadFile("build-esxi-iso.ps1")
	if err != nil {
		t.Fatalf("read build script: %v", err)
	}

	script := string(content)
	if !strings.Contains(script, "Where-Object { $_ -ne '' }") {
		t.Fatalf("build script must filter empty driver paths before injecting drivers")
	}
}
