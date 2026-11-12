package queue

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/esxi-builder/esxi-iso-builder/internal/builder"
	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	"gorm.io/gorm"
)

// consumeProgress bounds log writes while continuing to deliver live events.
// It drains the channel even after a database error so the child cannot deadlock.
func (h *BuildTaskHandler) consumeProgress(ctx context.Context, taskID string, events <-chan builder.BuildProgress) error {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	var lines []string
	percentage := -1
	var firstErr error
	flush := func() {
		if len(lines) == 0 && percentage < 0 {
			return
		}
		updates := map[string]any{}
		if len(lines) > 0 {
			updates["log_output"] = gorm.Expr("COALESCE(log_output, '') || ?", strings.Join(lines, "\n")+"\n")
		}
		if percentage >= 0 {
			updates["progress"] = percentage
		}
		// Finish accepted log batches even when the build request is cancelled.
		persistCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		if err := h.db.WithContext(persistCtx).Model(&models.BuildTask{}).Where("task_id = ?", taskID).Updates(updates).Error; err != nil && firstErr == nil {
			firstErr = fmt.Errorf("persist build progress: %w", err)
		}
		lines = lines[:0]
		percentage = -1
	}
	for {
		select {
		case event, ok := <-events:
			if !ok {
				flush()
				return firstErr
			}
			if event.Message != "" {
				lines = append(lines, event.Message)
				if h.wsManager != nil {
					h.wsManager.BroadcastLog(taskID, event.Message)
				}
			}
			if event.Percentage >= 0 {
				percentage = event.Percentage
				// Only artifact persistence can complete the overall build.
				if percentage > 99 {
					percentage = 99
				}
				if h.wsManager != nil {
					h.wsManager.BroadcastProgress(taskID, percentage)
				}
			}
			if len(lines) >= 64 {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}
