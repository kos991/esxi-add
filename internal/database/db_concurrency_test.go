package database

import (
	"context"
	"path/filepath"
	"testing"
)

func TestSQLiteSettingsSurviveConnectionReplacement(t *testing.T) {
	db, err := InitDB(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	defer pool.Close()
	if pool.Stats().MaxOpenConnections != 1 {
		t.Fatal("expected serialized connections")
	}
	pool.SetMaxIdleConns(0)
	for i := 0; i < 3; i++ {
		conn, err := pool.Conn(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		var mode string
		var timeout int
		if err := conn.QueryRowContext(context.Background(), "PRAGMA journal_mode").Scan(&mode); err != nil {
			t.Fatal(err)
		}
		if err := conn.QueryRowContext(context.Background(), "PRAGMA busy_timeout").Scan(&timeout); err != nil {
			t.Fatal(err)
		}
		conn.Close()
		if mode != "wal" || timeout != 10000 {
			t.Fatalf("connection %d: mode=%s timeout=%d", i, mode, timeout)
		}
	}
}
