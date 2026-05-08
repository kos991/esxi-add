package scripts

import (
	"strings"
	"testing"
)

func TestFrontendBuildPageUsesMixedStorageDepotSelection(t *testing.T) {
	buildPage := readTextFile(t, "../frontend/src/pages/BuildPage.tsx")

	for _, snippet := range []string{
		"useQueries",
		"mixedDepotOptions",
		"buildDepotOptionKey",
		"handleDepotSelection",
		"混合存储节点",
		"自动从所有存储节点识别",
		"listDepots(bucket.id, version)",
		"setBucketId(option.bucket.id)",
		"[{option.bucket.name}]",
		"selectedDepotOption?.bucket.name",
	} {
		if !strings.Contains(buildPage, snippet) {
			t.Fatalf("BuildPage must contain %q for mixed-storage depot selection", snippet)
		}
	}
}
