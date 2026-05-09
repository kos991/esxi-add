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
		"depotOptionLabel(option)",
		"selectedDepotOption?.bucket.name",
	} {
		if !strings.Contains(buildPage, snippet) {
			t.Fatalf("BuildPage must contain %q for mixed-storage depot selection", snippet)
		}
	}
}

func TestFrontendBuildPageFormatsDepotOptionsCompactly(t *testing.T) {
	buildPage := readTextFile(t, "../frontend/src/pages/BuildPage.tsx")

	for _, snippet := range []string{
		"function depotDisplayName",
		"function depotOptionLabel",
		"legacyDepotMatch",
		".match(/^ESXi(?:650|670)-?(\\d+)/i)",
		"return legacyDepotMatch[1]",
		".replace(/^VMware-ESXi-/i, '')",
		".replace(/[-_]?depot$/i, '')",
		"cacheBadge(option.file).label",
		"depotOptionLabel(option)",
		"depotDisplayName(selectedDepot)",
	} {
		if !strings.Contains(buildPage, snippet) {
			t.Fatalf("BuildPage must contain %q for compact Depot option formatting", snippet)
		}
	}

	for _, snippet := range []string{
		"function depotCacheIcon",
		"▣",
		"○",
		"↻",
	} {
		if strings.Contains(buildPage, snippet) {
			t.Fatalf("BuildPage should avoid decorative Depot option icon %q", snippet)
		}
	}
}
