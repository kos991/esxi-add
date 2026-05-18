package handlers

import (
	"bufio"
	"math"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/esxi-builder/esxi-iso-builder/internal/utils"
)

type SystemStatusHandler struct{}

type SystemStatus struct {
	Timestamp time.Time     `json:"timestamp"`
	Source    string        `json:"source"`
	CPU       CPUStatus     `json:"cpu"`
	Memory    MemoryStatus  `json:"memory"`
	Network   NetworkStatus `json:"network"`
}

type CPUStatus struct {
	Cores        int     `json:"cores"`
	UsagePercent float64 `json:"usage_percent"`
}

type MemoryStatus struct {
	TotalBytes   uint64  `json:"total_bytes"`
	UsedBytes    uint64  `json:"used_bytes"`
	FreeBytes    uint64  `json:"free_bytes"`
	UsagePercent float64 `json:"usage_percent"`
}

type NetworkStatus struct {
	RxBytes       uint64 `json:"rx_bytes"`
	TxBytes       uint64 `json:"tx_bytes"`
	RxBytesPerSec uint64 `json:"rx_bytes_per_sec"`
	TxBytesPerSec uint64 `json:"tx_bytes_per_sec"`
}

type cpuSample struct {
	idle  uint64
	total uint64
}

type networkSample struct {
	rxBytes uint64
	txBytes uint64
}

func NewSystemStatusHandler() *SystemStatusHandler {
	return &SystemStatusHandler{}
}

func (h *SystemStatusHandler) Get(c *fiber.Ctx) error {
	status := collectSystemStatus()
	return c.JSON(utils.SuccessResponse(status))
}

func collectSystemStatus() SystemStatus {
	status := SystemStatus{
		Timestamp: time.Now().UTC(),
		Source:    runtime.GOOS,
		CPU: CPUStatus{
			Cores: runtime.NumCPU(),
		},
	}

	if firstCPU, err := readLinuxCPUStat(); err == nil {
		firstNetwork, _ := readLinuxNetwork()
		start := time.Now()
		time.Sleep(120 * time.Millisecond)
		if secondCPU, err := readLinuxCPUStat(); err == nil {
			status.CPU.UsagePercent = roundPercent(cpuUsage(firstCPU, secondCPU))
			status.Source = "linux-procfs"
		}
		if secondNetwork, err := readLinuxNetwork(); err == nil {
			elapsed := time.Since(start).Seconds()
			status.Network = networkUsage(firstNetwork, secondNetwork, elapsed)
		}
	}

	if memory, err := readLinuxMemory(); err == nil {
		status.Memory = memory
		status.Source = "linux-procfs"
	} else {
		status.Memory = runtimeMemory()
	}

	return status
}

func readLinuxCPUStat() (cpuSample, error) {
	file, err := os.Open("/proc/stat")
	if err != nil {
		return cpuSample{}, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	if !scanner.Scan() {
		return cpuSample{}, scanner.Err()
	}
	fields := strings.Fields(scanner.Text())
	if len(fields) < 5 || fields[0] != "cpu" {
		return cpuSample{}, os.ErrInvalid
	}

	var values []uint64
	for _, field := range fields[1:] {
		value, err := strconv.ParseUint(field, 10, 64)
		if err != nil {
			return cpuSample{}, err
		}
		values = append(values, value)
	}

	var total uint64
	for _, value := range values {
		total += value
	}

	idle := values[3]
	if len(values) > 4 {
		idle += values[4]
	}

	return cpuSample{idle: idle, total: total}, nil
}

func cpuUsage(first, second cpuSample) float64 {
	totalDelta := second.total - first.total
	idleDelta := second.idle - first.idle
	if totalDelta == 0 || idleDelta > totalDelta {
		return 0
	}
	return float64(totalDelta-idleDelta) / float64(totalDelta) * 100
}

func readLinuxMemory() (MemoryStatus, error) {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return MemoryStatus{}, err
	}
	defer file.Close()

	values := map[string]uint64{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		values[strings.TrimSuffix(fields[0], ":")] = value * 1024
	}
	if err := scanner.Err(); err != nil {
		return MemoryStatus{}, err
	}

	total := values["MemTotal"]
	available := values["MemAvailable"]
	if total == 0 {
		return MemoryStatus{}, os.ErrInvalid
	}
	if available == 0 {
		available = values["MemFree"]
	}

	used := total - available
	return MemoryStatus{
		TotalBytes:   total,
		UsedBytes:    used,
		FreeBytes:    available,
		UsagePercent: roundPercent(float64(used) / float64(total) * 100),
	}, nil
}

func runtimeMemory() MemoryStatus {
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	total := stats.Sys
	used := stats.Alloc
	free := uint64(0)
	if total > used {
		free = total - used
	}
	usage := float64(0)
	if total > 0 {
		usage = float64(used) / float64(total) * 100
	}
	return MemoryStatus{
		TotalBytes:   total,
		UsedBytes:    used,
		FreeBytes:    free,
		UsagePercent: roundPercent(usage),
	}
}

func readLinuxNetwork() (networkSample, error) {
	file, err := os.Open("/proc/net/dev")
	if err != nil {
		return networkSample{}, err
	}
	defer file.Close()

	var sample networkSample
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.Contains(line, ":") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		name := strings.TrimSpace(parts[0])
		if name == "lo" {
			continue
		}
		fields := strings.Fields(parts[1])
		if len(fields) < 16 {
			continue
		}
		rxBytes, rxErr := strconv.ParseUint(fields[0], 10, 64)
		txBytes, txErr := strconv.ParseUint(fields[8], 10, 64)
		if rxErr != nil || txErr != nil {
			continue
		}
		sample.rxBytes += rxBytes
		sample.txBytes += txBytes
	}
	return sample, scanner.Err()
}

func networkUsage(first, second networkSample, elapsedSeconds float64) NetworkStatus {
	if elapsedSeconds <= 0 {
		elapsedSeconds = 1
	}
	return NetworkStatus{
		RxBytes:       second.rxBytes,
		TxBytes:       second.txBytes,
		RxBytesPerSec: perSecond(first.rxBytes, second.rxBytes, elapsedSeconds),
		TxBytesPerSec: perSecond(first.txBytes, second.txBytes, elapsedSeconds),
	}
}

func perSecond(first, second uint64, elapsedSeconds float64) uint64 {
	if second <= first {
		return 0
	}
	return uint64(float64(second-first) / elapsedSeconds)
}

func roundPercent(value float64) float64 {
	return math.Round(value*10) / 10
}
