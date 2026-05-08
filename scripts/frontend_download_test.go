package scripts

import (
	"strings"
	"testing"
)

func TestFrontendTaskDetailFallsBackToBackendArtifactDownload(t *testing.T) {
	taskDetail := readTextFile(t, "../frontend/src/pages/TaskDetailPage.tsx")

	for _, snippet := range []string{
		"getBuildArtifactUrl(task.task_id)",
		"publicDownloadUrl",
		"copyArtifactLink",
		"Download ISO",
	} {
		if !strings.Contains(taskDetail, snippet) {
			t.Fatalf("TaskDetailPage must contain %q so completed builds can be downloaded with or without a public bucket domain", snippet)
		}
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
