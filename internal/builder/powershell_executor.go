package builder

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"sync"
)

// PowerShellExecutor runs the build script and streams progress
type PowerShellExecutor struct {
	pwshPath   string
	scriptPath string
}

type BuildParams struct {
	DepotPath   string
	DriverPaths []string
	OutputPath  string
	ESXiVersion string
	WorkDir     string
}

type BuildProgress struct {
	Percentage int
	Message    string
	IsError    bool
}

func NewPowerShellExecutor(pwshPath, scriptPath string) *PowerShellExecutor {
	return &PowerShellExecutor{pwshPath: pwshPath, scriptPath: scriptPath}
}

// ExecuteBuild runs pwsh -File scriptPath with params, sends BuildProgress events to progressChan.
// Parses "[PROGRESS] 50 message", "[ERROR] message", "[SUCCESS] message" from stdout.
// Merges stderr as IsError=true lines.
// Closes progressChan when done. Returns error if exit code != 0.
func (e *PowerShellExecutor) ExecuteBuild(ctx context.Context, params *BuildParams, progressChan chan<- BuildProgress) error {
	defer close(progressChan)

	if params == nil {
		return fmt.Errorf("build params are required")
	}

	cmd := exec.CommandContext(
		ctx,
		e.pwshPath,
		"-File", e.scriptPath,
		"-DepotPath", params.DepotPath,
		"-DriverPaths", strings.Join(params.DriverPaths, ","),
		"-OutputPath", params.OutputPath,
		"-ESXiVersion", params.ESXiVersion,
		"-WorkDir", params.WorkDir,
	)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("create stdout pipe: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start powershell build: %w", err)
	}

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		scanOutput(stdout, progressChan, false)
	}()

	go func() {
		defer wg.Done()
		scanOutput(stderr, progressChan, true)
	}()

	waitErr := cmd.Wait()
	wg.Wait()

	if waitErr != nil {
		return fmt.Errorf("powershell build failed: %w", waitErr)
	}

	return nil
}

func scanOutput(reader io.Reader, progressChan chan<- BuildProgress, stderr bool) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		if stderr {
			progressChan <- BuildProgress{Percentage: -1, Message: line, IsError: true}
			continue
		}

		progressChan <- parseProgressLine(line)
	}

	if err := scanner.Err(); err != nil {
		progressChan <- BuildProgress{Percentage: -1, Message: err.Error(), IsError: true}
	}
}

func parseProgressLine(line string) BuildProgress {
	switch {
	case strings.HasPrefix(line, "[PROGRESS]"):
		payload := strings.TrimSpace(strings.TrimPrefix(line, "[PROGRESS]"))
		parts := strings.SplitN(payload, " ", 2)
		if len(parts) == 0 {
			return BuildProgress{Percentage: -1, Message: line}
		}

		pct, err := strconv.Atoi(strings.TrimSpace(parts[0]))
		if err != nil {
			return BuildProgress{Percentage: -1, Message: line}
		}

		message := ""
		if len(parts) > 1 {
			message = strings.TrimSpace(parts[1])
		}
		return BuildProgress{Percentage: pct, Message: message}
	case strings.HasPrefix(line, "[ERROR]"):
		return BuildProgress{Percentage: -1, Message: strings.TrimSpace(strings.TrimPrefix(line, "[ERROR]")), IsError: true}
	case strings.HasPrefix(line, "[SUCCESS]"):
		return BuildProgress{Percentage: -1, Message: strings.TrimSpace(strings.TrimPrefix(line, "[SUCCESS]"))}
	default:
		return BuildProgress{Percentage: -1, Message: line}
	}
}
