package database

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
)

func TestInitDBMigratesLegacyESXiAndETagColumns(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "legacy.db")
	legacyDB, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		t.Fatalf("open legacy db: %v", err)
	}
	if err := legacyDB.Exec(`
CREATE TABLE file_metadata (
	id integer primary key autoincrement,
	created_at datetime,
	updated_at datetime,
	deleted_at datetime,
	storage_bucket_id integer,
	path text,
	type text,
	es_xi_version text,
	driver_category text,
	driver_type text,
	driver_name text,
	driver_description text,
	driver_version text,
	is_latest numeric,
	conflicts_with text,
	depends_on text,
	sha256 text,
	size integer,
	e_tag text,
	last_modified datetime
)`).Error; err != nil {
		t.Fatalf("create legacy file_metadata: %v", err)
	}
	if err := legacyDB.Exec(`INSERT INTO file_metadata (storage_bucket_id, path, type, es_xi_version, e_tag) VALUES (1, 'drivers/8.0/network/net.vib', 'driver', '8.0', 'legacy-etag')`).Error; err != nil {
		t.Fatalf("insert legacy metadata: %v", err)
	}
	sqlDB, err := legacyDB.DB()
	if err != nil {
		t.Fatalf("legacy sql db: %v", err)
	}
	_ = sqlDB.Close()

	db, err := InitDB(dbPath)
	if err != nil {
		t.Fatalf("init db: %v", err)
	}
	sqlDB, err = db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	defer sqlDB.Close()

	var metadata models.FileMetadata
	if err := db.First(&metadata, 1).Error; err != nil {
		t.Fatalf("find migrated metadata: %v", err)
	}
	if metadata.StorageBucketID != 1 ||
		metadata.Path != "drivers/8.0/network/net.vib" ||
		metadata.Type != "driver" ||
		metadata.ESXiVersion != "8.0" ||
		metadata.ETag != "legacy-etag" {
		var columns []struct {
			Name string
			Type string
		}
		_ = db.Raw("PRAGMA table_info(file_metadata)").Scan(&columns).Error
		t.Logf("columns: %+v", columns)
		var rows []map[string]any
		_ = db.Table("file_metadata").Find(&rows).Error
		t.Logf("rows: %+v", rows)
		t.Fatalf("legacy columns were not migrated: %+v", metadata)
	}
	if !db.Migrator().HasColumn(&models.FileMetadata{}, "md5") {
		t.Fatalf("md5 column was not migrated")
	}
}

func TestNormalizeSQLiteDDLHandlesReferencedTables(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "foreign-key.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	defer sqlDB.Close()

	if err := db.Exec("PRAGMA foreign_keys = ON").Error; err != nil {
		t.Fatalf("enable foreign keys: %v", err)
	}
	if err := db.Exec(`
CREATE TABLE storage_buckets (
	id integer primary key autoincrement,
	name text
)`).Error; err != nil {
		t.Fatalf("create storage_buckets: %v", err)
	}
	if err := db.Exec(`
CREATE TABLE file_metadata (
	id integer primary key autoincrement,
	storage_bucket_id integer,
	CONSTRAINT fk_file_metadata_storage_bucket FOREIGN KEY (storage_bucket_id) REFERENCES storage_buckets(id)
)`).Error; err != nil {
		t.Fatalf("create file_metadata: %v", err)
	}
	if err := db.Exec(`INSERT INTO storage_buckets (id, name) VALUES (1, 'local')`).Error; err != nil {
		t.Fatalf("insert storage bucket: %v", err)
	}
	if err := db.Exec(`INSERT INTO file_metadata (storage_bucket_id) VALUES (1)`).Error; err != nil {
		t.Fatalf("insert metadata: %v", err)
	}

	if err := normalizeSQLiteDDL(db, "storage_buckets"); err != nil {
		t.Fatalf("normalize referenced table: %v", err)
	}

	var bucketName string
	if err := db.Raw("SELECT name FROM storage_buckets WHERE id = 1").Scan(&bucketName).Error; err != nil {
		t.Fatalf("find storage bucket: %v", err)
	}
	if bucketName != "local" {
		t.Fatalf("storage bucket data was not preserved: %q", bucketName)
	}
}
