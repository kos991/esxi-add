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
		"Export-EsxImageProfile -ImageProfile $ImageProfile -ExportToIso -FilePath $OutputPath -Force -NoSignatureCheck",
	}
	for _, snippet := range requiredSnippets {
		if !strings.Contains(script, snippet) {
			t.Fatalf("build script must contain %q for community driver ISO exports", snippet)
		}
	}
}

func TestBuildScriptUsesBundleFirstExportForEsxi67(t *testing.T) {
	content, err := os.ReadFile("build-esxi-iso.ps1")
	if err != nil {
		t.Fatalf("read build script: %v", err)
	}

	script := string(content)
	requiredSnippets := []string{
		"$useBundleFirstExport = $ESXiVersion -match '^6\\.7'",
		"Export-EsxImageProfile -ImageProfile $ImageProfile -ExportToBundle -FilePath $bundlePath -Force -NoSignatureCheck",
		"Remove-EsxImageProfile -ImageProfile $ImageProfile",
		"Add-EsxSoftwareDepot -DepotUrl $bundlePath",
		"Get-EsxImageProfile -Name $ImageProfile",
		"Export-EsxImageProfile -ImageProfile $bundleProfile.Name -ExportToIso -FilePath $OutputPath -Force -NoSignatureCheck",
	}
	for _, snippet := range requiredSnippets {
		if !strings.Contains(script, snippet) {
			t.Fatalf("build script must contain %q so ESXi 6.7 exports via an offline bundle before ISO creation", snippet)
		}
	}

	if strings.Contains(script, "Get-EsxImageProfile -SoftwareDepot") {
		t.Fatalf("build script must not rely on Get-EsxImageProfile -SoftwareDepot because older PowerCLI ImageBuilder versions may not support it")
	}
}

func TestBuildScriptDetectsPowerCliPythonPath(t *testing.T) {
	content, err := os.ReadFile("build-esxi-iso.ps1")
	if err != nil {
		t.Fatalf("read build script: %v", err)
	}

	script := string(content)
	for _, snippet := range []string{
		"/usr/local/bin/python3",
		"/usr/bin/python3",
		"Set-PowerCLIConfiguration -Scope User -PythonPath $pythonPath",
	} {
		if !strings.Contains(script, snippet) {
			t.Fatalf("build script must contain %q so ImageBuilder can find Python in vmware/powerclicore", snippet)
		}
	}
}

func TestBuildScriptDoesNotDeleteBackendWorkDirBeforeUpload(t *testing.T) {
	content, err := os.ReadFile("build-esxi-iso.ps1")
	if err != nil {
		t.Fatalf("read build script: %v", err)
	}

	script := string(content)
	if strings.Contains(script, "Remove-Item -Path $WorkDir -Recurse") {
		t.Fatalf("build script must not delete $WorkDir because OutputPath is inside it and the backend uploads it after PowerShell exits")
	}
}

func TestBuildScriptVerifiesOutputIsoExistsBeforeSuccess(t *testing.T) {
	content, err := os.ReadFile("build-esxi-iso.ps1")
	if err != nil {
		t.Fatalf("read build script: %v", err)
	}

	script := string(content)
	requiredSnippets := []string{
		"Test-Path -LiteralPath $OutputPath",
		"ISO export did not create output file",
	}
	for _, snippet := range requiredSnippets {
		if !strings.Contains(script, snippet) {
			t.Fatalf("build script must contain %q so it does not report success when PowerCLI creates no ISO", snippet)
		}
	}
}
