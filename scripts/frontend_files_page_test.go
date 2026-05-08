package scripts

import (
	"strings"
	"testing"
)

func TestFrontendFilesPageRequiresCloudPasteAssetSummary(t *testing.T) {
	filesPage := readTextFile(t, "../frontend/src/pages/FilesPage.tsx")

	requireFilesPageSnippets(t, filesPage, []string{
		"const allAssets = useMemo(",
		"...(depotsQuery.data ?? [])",
		"...(allDriversQuery.data ?? [])",
		"...(isoQuery.data ?? [])",
		"const assetCount = depotCount + driverCount + isoCount",
		`<Tabs.Trigger value="all"`,
		"files={allAssets}",
	})
}

func TestFrontendFilesPageRequiresStorageNodeOverviewWithProviderAndStatusLabels(t *testing.T) {
	filesPage := readTextFile(t, "../frontend/src/pages/FilesPage.tsx")

	requireFilesPageSnippets(t, filesPage, []string{
		"<StorageOverview bucket={selectedBucket}",
		"function StorageOverview(",
		"providerText(bucket)",
		"bucketType(bucket)",
		"bucket?.is_default",
		"bucket?.public_domain",
		"provider.label",
		"typeLabel",
		"Default",
	})
}

func TestFrontendFilesPageRequiresProviderStatusTagsAndPublicLinksForAllAssets(t *testing.T) {
	filesPage := readTextFile(t, "../frontend/src/pages/FilesPage.tsx")

	requireFilesPageSnippets(t, filesPage, []string{
		"cache_status",
		"cache_valid",
		"cacheStatusClass",
		"assetTypeLabel(file)",
		"assetTypeClass(file)",
		"canCopyPublicLink(file, bucket)",
		"copyPublicLink",
		"buildPublicObjectUrl(selectedBucket.public_domain, file.path)",
		"navigator.clipboard.writeText(link)",
	})

	if count := strings.Count(filesPage, "onCopy={copyPublicLink}"); count < 3 {
		t.Fatalf("FilesPage must wire copyPublicLink into Depot, Driver, and ISO tables, found %d uses", count)
	}
}

func TestFrontendFilesPageKeepsDepotDriverIsoUploadAndRefreshCapabilities(t *testing.T) {
	filesPage := readTextFile(t, "../frontend/src/pages/FilesPage.tsx")

	requireFilesPageSnippets(t, filesPage, []string{
		"listDepots(selectedBucketId as number)",
		"listDrivers(selectedBucketId as number, version, category)",
		"listISOs(selectedBucketId as number)",
		`<Tabs.Trigger value="depots"`,
		`<Tabs.Trigger value="drivers"`,
		`<Tabs.Trigger value="isos"`,
		`<option value="depot">Depot</option>`,
		`<option value="driver">Driver</option>`,
		`<option value="iso">ISO</option>`,
		"uploadFile(",
		"refreshFiles(selectedBucketId as number)",
		"queryClient.invalidateQueries({ queryKey: ['depots', selectedBucketId] })",
		"queryClient.invalidateQueries({ queryKey: ['drivers', selectedBucketId] })",
		"queryClient.invalidateQueries({ queryKey: ['isos', selectedBucketId] })",
	})
}

func requireFilesPageSnippets(t *testing.T, filesPage string, snippets []string) {
	t.Helper()

	for _, snippet := range snippets {
		if !strings.Contains(filesPage, snippet) {
			t.Fatalf("FilesPage must contain %q", snippet)
		}
	}
}
