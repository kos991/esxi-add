package builder

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestExecuteBuildCancellationWithoutConsumer(t *testing.T) {
	shell, err := exec.LookPath("powershell.exe")
	if err != nil {
		shell, err = exec.LookPath("pwsh")
	}
	if err != nil {
		t.Skip("PowerShell not installed")
	}
	script := filepath.Join(t.TempDir(), "cancel.ps1")
	if err := os.WriteFile(script, []byte("while ($true) { [Console]::Out.WriteLine('output'); [Console]::Error.WriteLine('error') }"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := make(chan BuildProgress)
	done := make(chan error, 1)
	go func() { done <- NewPowerShellExecutor(shell, script).ExecuteBuild(ctx, &BuildParams{}, events) }()
	select {
	case <-events:
	case <-time.After(15 * time.Second):
		t.Fatal("no child output")
	}
	// Stop reading before cancellation: both sends and pipe reads must release.
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected cancellation failure")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("executor deadlocked after cancellation")
	}
}
