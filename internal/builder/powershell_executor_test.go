package builder

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestExecuteBuildDrainsPipes(t *testing.T) {
	shell, err := exec.LookPath("powershell.exe")
	if err != nil {
		shell, err = exec.LookPath("pwsh")
	}
	if err != nil {
		t.Skip("PowerShell not installed")
	}
	script := filepath.Join(t.TempDir(), "output.ps1")
	if err := os.WriteFile(script, []byte("1..200 | ForEach-Object { [Console]::Out.WriteLine(\"line-$_\"); [Console]::Error.WriteLine(\"stderr-$_\") }"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	events := make(chan BuildProgress)
	done := make(chan error, 1)
	go func() { done <- NewPowerShellExecutor(shell, script).ExecuteBuild(ctx, &BuildParams{}, events) }()
	stdout, stderr := 0, 0
	for event := range events {
		// Deliberately keep reading after the process has exited.
		time.Sleep(time.Millisecond)
		if strings.HasPrefix(event.Message, "line-") {
			stdout++
		} else if strings.HasPrefix(event.Message, "stderr-") {
			stderr++
		} else {
			t.Errorf("unexpected output: %+v", event)
		}
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if stdout != 200 || stderr != 200 {
		t.Fatalf("lost output: stdout=%d stderr=%d", stdout, stderr)
	}
}

func TestScanOutputReportsOversizedLineAndDrains(t *testing.T) {
	reader := strings.NewReader(strings.Repeat("x", 2*1024*1024))
	events := make(chan BuildProgress, 1)
	if err := scanOutput(reader, events, false); err == nil {
		t.Fatal("expected scanner error")
	}
	if reader.Len() != 0 {
		t.Fatal("pipe not drained")
	}
	if event := <-events; !event.IsError {
		t.Fatal("missing error event")
	}
}
