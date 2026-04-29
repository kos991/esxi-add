package websocket

import (
	"encoding/json"
	"sync"

	fws "github.com/gofiber/contrib/websocket"
)

type Manager struct {
	mu      sync.RWMutex
	clients map[string]map[*fws.Conn]bool
}

func NewManager() *Manager {
	return &Manager{clients: make(map[string]map[*fws.Conn]bool)}
}

func (m *Manager) Register(taskID string, conn *fws.Conn) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.clients[taskID]; !ok {
		m.clients[taskID] = make(map[*fws.Conn]bool)
	}
	m.clients[taskID][conn] = true
}

func (m *Manager) Unregister(taskID string, conn *fws.Conn) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if clients, ok := m.clients[taskID]; ok {
		delete(clients, conn)
		if len(clients) == 0 {
			delete(m.clients, taskID)
		}
	}
}

func (m *Manager) BroadcastLog(taskID, message string) {
	m.Broadcast(taskID, map[string]any{
		"type":    "log",
		"message": message,
	})
}

func (m *Manager) BroadcastProgress(taskID string, pct int) {
	m.Broadcast(taskID, map[string]any{
		"type":       "progress",
		"percentage": pct,
	})
}

func (m *Manager) Broadcast(taskID string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}

	m.mu.RLock()
	taskClients := m.clients[taskID]
	conns := make([]*fws.Conn, 0, len(taskClients))
	for conn := range taskClients {
		conns = append(conns, conn)
	}
	m.mu.RUnlock()

	for _, conn := range conns {
		if err := conn.WriteMessage(fws.TextMessage, data); err != nil {
			_ = conn.Close()
			m.Unregister(taskID, conn)
		}
	}
}
