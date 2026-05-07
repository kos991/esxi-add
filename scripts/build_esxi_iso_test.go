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

func TestBuildScriptLoadsDriverPackagesBeforeInjecting(t *testing.T) {
	content, err := os.ReadFile("build-esxi-iso.ps1")
	if err != nil {
		t.Fatalf("read build script: %v", err)
	}

	script := string(content)
	requiredSnippets := []string{
		"Add-EsxSoftwareDepot -DepotUrl $DriverPath",
		"Get-EsxSoftwarePackage -SoftwareDepot $depot",
		"Get-EsxSoftwarePackage -PackageUrl $DriverPath",
		"Add-EsxSoftwarePackage -ImageProfile $ImageProfile -SoftwarePackage $package -Force",
	}
	for _, snippet := range requiredSnippets {
		if !strings.Contains(script, snippet) {
			t.Fatalf("build script must contain %q so driver files are loaded as PowerCLI software packages", snippet)
		}
	}

	if strings.Contains(script, "Add-EsxSoftwarePackage -ImageProfile $custom.Name -SoftwarePackage $d -Force") {
		t.Fatalf("build script must not pass driver file paths directly to Add-EsxSoftwarePackage")
	}
}

func TestBuildScriptAllowsCommunityDriversAndUnsignedExports(t *testing.T) {
	content, err := os.ReadFile("build-esxi-iso.ps1")
	if err != nil {
		t.Fatalf("read build script: %v", err)
	}

	script := string(content)
	requiredSnippets := []string{
		"Set-EsxImageProfile -ImageProfile $custom.Name -AcceptanceLevel CommunitySupported",
		"Export-EsxImageProfile -ImageProfile $custom.Name -ExportToIso -FilePath $OutputPath -Force -NoSignatureCheck",
	}
	for _, snippet := range requiredSnippets {
		if !strings.Contains(script, snippet) {
			t.Fatalf("build script must contain %q for community driver ISO exports", snippet)
		}
	}
}
