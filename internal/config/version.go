package config

import (
	"os"
	"strings"
)

const DefaultAppVersion = "v1.0.1"

// ResolveAppVersion returns the normalized application version string.
// Branch names like "dev", "main", or "latest" fall back to DefaultAppVersion
// so CI branch builds still show the release version, while tagged builds
// (e.g. "v1.0.1" or "1.0.2") reflect the tag automatically.
func ResolveAppVersion(configured string) string {
	raw := strings.TrimSpace(configured)
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("APP_VERSION"))
	}
	if raw == "" {
		return DefaultAppVersion
	}

	switch strings.ToLower(raw) {
	case "dev", "main", "master", "latest":
		return DefaultAppVersion
	}

	if raw[0] >= '0' && raw[0] <= '9' && strings.Contains(raw, ".") {
		return "v" + raw
	}
	return raw
}
