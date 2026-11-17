package builder

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
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
	DepotPath    string
	DriverPaths  []string
	OutputPath   string
	ESXiVersion  string
	WorkDir      string
	ImageProfile string
	RootPassword string
	InstallMode  string
	BootOptions  []string
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

	scriptPath, engine, err := e.SelectEngine(params.DepotPath)
	if err != nil {
		return err
	}
	if info, err := os.Stat(params.DepotPath); err != nil {
		return fmt.Errorf("实际输入不可访问: %w", err)
	} else if !info.Mode().IsRegular() {
		return fmt.Errorf("输入不是普通文件")
	}
	select {
	case progressChan <- BuildProgress{Percentage: -1, Message: fmt.Sprintf("实际输入: %s；构建引擎: %s；脚本: %s", params.DepotPath, engine, scriptPath)}:
	case <-ctx.Done():
		return ctx.Err()
	}
	var cmd *exec.Cmd
	if engine == "native" {
		args := []string{
			scriptPath,
			"--depot-path", params.DepotPath,
			"--driver-paths", strings.Join(params.DriverPaths, ","),
			"--output-path", params.OutputPath,
			"--esxi-version", params.ESXiVersion,
			"--work-dir", params.WorkDir,
		}
		if params.ImageProfile != "" {
			args = append(args, "--image-profile", params.ImageProfile)
		}
		if params.RootPassword != "" {
			args = append(args, "--root-password", params.RootPassword)
		}
		if params.InstallMode != "" {
			args = append(args, "--install-mode", params.InstallMode)
		}
		if len(params.BootOptions) > 0 {
			args = append(args, "--boot-options", strings.Join(params.BootOptions, ","))
		}
		cmd = exec.CommandContext(ctx, "bash", args...)
	} else {
		args := []string{
			"-File", scriptPath,
			"-DepotPath", params.DepotPath,
			"-DriverPaths", strings.Join(params.DriverPaths, ","),
			"-OutputPath", params.OutputPath,
			"-ESXiVersion", params.ESXiVersion,
			"-WorkDir", params.WorkDir,
			"-ImageProfileName", params.ImageProfile,
		}
		if params.RootPassword != "" {
			args = append(args, "-RootPassword", params.RootPassword)
		}
		if params.InstallMode != "" {
			args = append(args, "-InstallMode", params.InstallMode)
		}
		if len(params.BootOptions) > 0 {
			args = append(args, "-BootOptions", strings.Join(params.BootOptions, ","))
		}
		cmd = exec.CommandContext(ctx, e.pwshPath, args...)
	}

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

	// Cancellation must also release readers when a descendant inherits a pipe.
	readDone := make(chan struct{})
	defer close(readDone)
	go func() {
		select {
		case <-ctx.Done():
			_ = stdout.Close()
			_ = stderr.Close()
		case <-readDone:
		}
	}()

	var stdoutErr, stderrErr error
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		stdoutErr = scanOutputContext(ctx, stdout, progressChan, false)
	}()

	go func() {
		defer wg.Done()
		stderrErr = scanOutputContext(ctx, stderr, progressChan, true)
	}()

	// Wait closes StdoutPipe/StderrPipe. Drain both readers before calling it.
	wg.Wait()
	waitErr := cmd.Wait()

	if waitErr != nil {
		return fmt.Errorf("powershell build failed: %w", waitErr)
	}
	if stdoutErr != nil || stderrErr != nil {
		return fmt.Errorf("read powershell output: stdout=%v stderr=%v", stdoutErr, stderrErr)
	}

	return nil
}

type ImageProfile struct {
	Name            string `json:"name"`
	Vendor          string `json:"vendor"`
	AcceptanceLevel string `json:"acceptance_level"`
	CreationTime    string `json:"creation_time"`
	ModifiedTime    string `json:"modified_time"`
}

func (e *PowerShellExecutor) InspectImageProfiles(ctx context.Context, depotPath string) ([]ImageProfile, error) {
	scriptPath, engine, err := e.SelectEngine(depotPath)
	if err != nil {
		return nil, err
	}
	if engine == "native" {
		return []ImageProfile{}, nil
	}
	cmd := exec.CommandContext(
		ctx,
		e.pwshPath,
		"-File", scriptPath,
		"-Mode", "InspectProfiles",
		"-DepotPath", depotPath,
	)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("inspect image profiles: %w", err)
	}

	var profiles []ImageProfile
	if err := json.Unmarshal(output, &profiles); err == nil {
		return profiles, nil
	}

	var single ImageProfile
	if err := json.Unmarshal(output, &single); err != nil {
		return nil, fmt.Errorf("parse image profiles: %w", err)
	}
	if single.Name == "" {
		return []ImageProfile{}, nil
	}
	return []ImageProfile{single}, nil
}

// SelectEngine routes the supplied source, independent of the default script suffix.
func (e *PowerShellExecutor) SelectEngine(source string) (string, string, error) {
	switch strings.ToLower(filepath.Ext(source)) {
	case ".iso":
		script := e.scriptPath
		if !strings.HasSuffix(strings.ToLower(script), ".sh") {
			script = filepath.Join(filepath.Dir(script), "build-native-iso.sh")
		}
		return script, "native", nil
	case ".zip":
		script := e.scriptPath
		if strings.HasSuffix(strings.ToLower(script), ".sh") {
			script = filepath.Join(filepath.Dir(script), "build-esxi-iso.ps1")
		}
		return script, "powercli", nil
	default:
		return "", "", fmt.Errorf("构建源仅支持 ISO 或 Depot ZIP: %s", source)
	}
}

func scanOutput(reader io.Reader, progressChan chan<- BuildProgress, stderr bool) error {
	return scanOutputContext(context.Background(), reader, progressChan, stderr)
}

func scanOutputContext(ctx context.Context, reader io.Reader, progressChan chan<- BuildProgress, stderr bool) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		event := parseProgressLine(line)
		if stderr {
			event = BuildProgress{Percentage: -1, Message: line, IsError: true}
		}
		select {
		case progressChan <- event:
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	if err := scanner.Err(); err != nil {
		select {
		case progressChan <- BuildProgress{Percentage: -1, Message: err.Error(), IsError: true}:
		case <-ctx.Done():
			return ctx.Err()
		}
		// A too-long line must not leave the child blocked on a full pipe.
		_, _ = io.Copy(io.Discard, reader)
		return err
	}
	return nil
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
