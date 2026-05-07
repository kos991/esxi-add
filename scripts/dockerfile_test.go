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
		"Set-PSRepository PSGallery -InstallationPolicy Trusted",
		"Install-Module -Name VMware.ImageBuilder -RequiredVersion 8.0.0.21610262",
		"Install-Module -Name VMware.PowerCLI",
		"-RequiredVersion 13.1.0.21624340",
		"-AcceptLicense",
		"COPY scripts/ ./scripts/",
	}

	for _, snippet := range requiredSnippets {
		if !strings.Contains(dockerfile, snippet) {
			t.Fatalf("Dockerfile must contain %q for in-container PowerShell builds", snippet)
		}
	}
}

func TestDockerContextIncludesPowerShellScripts(t *testing.T) {
	dockerignore := readTextFile(t, "../.dockerignore")

	for _, forbidden := range []string{
		"scripts/*.ps1",
		"scripts/",
	} {
		if strings.Contains(dockerignore, forbidden) {
			t.Fatalf(".dockerignore must not contain %q because the image needs build-esxi-iso.ps1 at runtime", forbidden)
		}
	}
}

func TestAllInOneImageDoesNotBundleMinIO(t *testing.T) {
	dockerfile := readTextFile(t, "../Dockerfile")
	entrypoint := readTextFile(t, "../docker/all-in-one-entrypoint.sh")

	for file, content := range map[string]string{
		"Dockerfile":                      dockerfile,
		"docker/all-in-one-entrypoint.sh": entrypoint,
	} {
		if strings.Contains(strings.ToLower(content), "minio") {
			t.Fatalf("%s must not include MinIO in the single-container runtime", file)
		}
	}
}

func TestComposePullsPublishedSingleImageByDefault(t *testing.T) {
	compose := readTextFile(t, "../docker-compose.yml")

	requiredSnippets := []string{
		"image: ${APP_IMAGE:-ghcr.io/kos991/esxi-add:latest}",
		"${APP_PORT:-8080}:8080",
		"STORAGE_TYPE: ${STORAGE_TYPE:-local}",
		"STORAGE_PATH: ${STORAGE_PATH:-/data/storage}",
	}
	for _, snippet := range requiredSnippets {
		if !strings.Contains(compose, snippet) {
			t.Fatalf("docker-compose.yml must contain %q", snippet)
		}
	}

	forbiddenSnippets := []string{
		"build:",
		"9000",
		"9001",
		"MINIO_",
		"DEFAULT_S3_ENDPOINT",
	}
	for _, snippet := range forbiddenSnippets {
		if strings.Contains(compose, snippet) {
			t.Fatalf("docker-compose.yml must not contain %q in pull-based single-image mode", snippet)
		}
	}
}

func TestBuildOverrideKeepsLocalImageBuildAvailable(t *testing.T) {
	override := readTextFile(t, "../docker-compose.build.yml")

	for _, snippet := range []string{
		"build:",
		"context: .",
		"dockerfile: Dockerfile",
	} {
		if !strings.Contains(override, snippet) {
			t.Fatalf("docker-compose.build.yml must contain %q", snippet)
		}
	}
}

func TestDockerWorkflowPublishesGHCRImage(t *testing.T) {
	workflow := readTextFile(t, "../.github/workflows/docker.yml")

	for _, snippet := range []string{
		"ghcr.io/kos991/esxi-add",
		"docker/login-action",
		"docker/build-push-action",
		"push: ${{ github.event_name == 'push' }}",
	} {
		if !strings.Contains(workflow, snippet) {
			t.Fatalf("docker workflow must contain %q", snippet)
		}
	}
}

func readTextFile(t *testing.T, path string) string {
	t.Helper()

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(content)
}
