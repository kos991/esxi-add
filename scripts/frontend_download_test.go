package scripts

import (
	"strings"
	"testing"
)

func TestFrontendTaskDetailFallsBackToBackendArtifactDownload(t *testing.T) {
	taskDetail := readTextFile(t, "../frontend/src/pages/TaskDetailPage.tsx")

	for _, snippet := range []string{
		"getBuildArtifactUrl(task.task_id)",
		"localDownloadUrl",
		"remoteDownloadUrl",
		"copyArtifactLink",
		"Local Download",
		"Remote Download",
	} {
		if !strings.Contains(taskDetail, snippet) {
			t.Fatalf("TaskDetailPage must contain %q so completed builds can be downloaded with or without a public bucket domain", snippet)
		}
	}
}

func TestFrontendPublicObjectURLsDoNotIncludeBucketName(t *testing.T) {
	utils := readTextFile(t, "../frontend/src/utils.ts")
	taskDetail := readTextFile(t, "../frontend/src/pages/TaskDetailPage.tsx")
	filesPage := readTextFile(t, "../frontend/src/pages/FilesPage.tsx")

	for _, snippet := range []string{
		"buildPublicObjectUrl",
		"publicDomain.replace(/\\/$/, '')",
		"objectPath.replace(/^\\//, '')",
	} {
		if !strings.Contains(utils, snippet) {
			t.Fatalf("utils.ts must contain %q so public file links use public domain plus object path only", snippet)
		}
	}

	for _, check := range []struct {
		name    string
		content string
		want    string
	}{
		{
			name:    "TaskDetailPage",
			content: taskDetail,
			want:    "buildPublicObjectUrl(bucket.public_domain, task.output_iso)",
		},
		{
			name:    "FilesPage",
			content: filesPage,
			want:    "buildPublicObjectUrl(selectedBucket.public_domain, file.path)",
		},
	} {
		if !strings.Contains(check.content, check.want) {
			t.Fatalf("%s must contain %q", check.name, check.want)
		}
	}

	for _, forbidden := range []string{
		"${bucket.public_domain.replace(/\\/$/, '')}/${bucket.bucket_name}/${task.output_iso}",
		"${selectedBucket.public_domain.replace(/\\/$/, '')}/${selectedBucket.bucket_name}/${file.path}",
	} {
		if strings.Contains(taskDetail, forbidden) || strings.Contains(filesPage, forbidden) {
			t.Fatalf("public object URLs must not include bucket_name; found %q", forbidden)
		}
	}
}

func TestFrontendTaskDetailShowsLocalAndRemoteDownloadsBelowChecksum(t *testing.T) {
	taskDetail := readTextFile(t, "../frontend/src/pages/TaskDetailPage.tsx")

	shaIndex := strings.Index(taskDetail, "InfoBlock label=\"SHA256 checksum\"")
	localIndex := strings.Index(taskDetail, "href={localDownloadUrl}")
	remoteIndex := strings.Index(taskDetail, "href={remoteDownloadUrl}")
	if shaIndex == -1 {
		t.Fatal("TaskDetailPage must render the SHA256 checksum before artifact download actions")
	}
	if localIndex == -1 || remoteIndex == -1 {
		t.Fatal("TaskDetailPage must expose separate localDownloadUrl and remoteDownloadUrl actions")
	}
	if localIndex < shaIndex || remoteIndex < shaIndex {
		t.Fatal("ISO download buttons must be rendered below the SHA256 checksum")
	}

	for _, snippet := range []string{
		"getBuildArtifactUrl(task.task_id)",
		"buildPublicObjectUrl(bucket.public_domain, task.output_iso)",
		"href={localDownloadUrl}",
		"href={remoteDownloadUrl}",
		"Local Download",
		"Remote Download",
	} {
		if !strings.Contains(taskDetail, snippet) {
			t.Fatalf("TaskDetailPage must contain %q for separate local and remote ISO downloads", snippet)
		}
	}

	if strings.Contains(taskDetail, "const downloadUrl =") {
		t.Fatal("TaskDetailPage must not collapse local and remote artifact downloads into one downloadUrl")
	}
}

func TestFrontendTaskListShowsCompletedArtifactDownloadButton(t *testing.T) {
	tasksPage := readTextFile(t, "../frontend/src/pages/TasksPage.tsx")

	for _, snippet := range []string{
		"Download",
		"getBuildArtifactUrl(task.task_id)",
		"downloadTaskArtifact",
	} {
		if !strings.Contains(tasksPage, snippet) {
			t.Fatalf("TasksPage must contain %q so completed builds expose a direct ISO download action", snippet)
		}
	}
}
