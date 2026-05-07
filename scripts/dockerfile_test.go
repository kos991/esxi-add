package scripts

import (
	"os"
	"strings"
	"testing"
)

func TestAllInOneImageIncludesPowerShellBuildRuntime(t *testing.T) {
	content, err := os.ReadFile("../Dockerfile")
	if err != nil {
		t.Fatalf("read Dockerfile: %v", err)
	}

	dockerfile := string(content)
	requiredSnippets := []string{
		"FROM mcr.microsoft.com/powershell:7.4-debian-12",
		"Install-Module -Name VMware.PowerCLI",
		"COPY scripts/ ./scripts/",
	}

	for _, snippet := range requiredSnippets {
		if !strings.Contains(dockerfile, snippet) {
			t.Fatalf("Dockerfile must contain %q for in-container PowerShell builds", snippet)
		}
	}
}
