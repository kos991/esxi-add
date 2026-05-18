package handlers

import (
	"encoding/json"

	"github.com/gofiber/contrib/websocket"
	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	ws "github.com/esxi-builder/esxi-iso-builder/internal/websocket"
)

type WebSocketHandler struct {
	db      *gorm.DB
	manager *ws.Manager
}

func NewWebSocketHandler(db *gorm.DB, manager *ws.Manager) *WebSocketHandler {
	return &WebSocketHandler{db: db, manager: manager}
}

// HandleTaskLogs: registers conn, sends historical log_output as type="history",
// then loops ReadMessage until error (client disconnect)
func (h *WebSocketHandler) HandleTaskLogs(conn *websocket.Conn) {
	taskID := conn.Params("id")
	h.manager.Register(taskID, conn)
	defer h.manager.Unregister(taskID, conn)
	defer conn.Close()

	var task models.BuildTask
	if err := h.db.Where("task_id = ?", taskID).First(&task).Error; err == nil && task.LogOutput != "" {
		payload, _ := json.Marshal(map[string]any{
			"type":    "history",
			"message": task.LogOutput,
		})
		_ = conn.WriteMessage(websocket.TextMessage, payload)
	}

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}
