package database

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
)

func InitDB(path string) (*gorm.DB, error) {
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create database directory: %w", err)
		}
	}

	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	if err := migrateLegacyColumns(db); err != nil {
		return nil, err
	}
	if err := normalizeSQLiteDDL(db,
		"storage_buckets",
		"file_metadata",
		"build_tasks",
		"build_templates",
		"build_stats",
		"audit_logs",
	); err != nil {
		return nil, err
	}

	if err := db.AutoMigrate(
		&models.StorageBucket{},
		&models.FileMetadata{},
		&models.BuildTask{},
		&models.BuildTemplate{},
		&models.BuildStats{},
		&models.AuditLog{},
	); err != nil {
		return nil, fmt.Errorf("auto migrate database: %w", err)
	}

	return db, nil
}

func migrateLegacyColumns(db *gorm.DB) error {
	migrations := []struct {
		table     string
		oldColumn string
		newColumn string
	}{
		{table: "file_metadata", oldColumn: "es_xi_version", newColumn: "esxi_version"},
		{table: "file_metadata", oldColumn: "e_tag", newColumn: "etag"},
		{table: "build_tasks", oldColumn: "es_xi_version", newColumn: "esxi_version"},
		{table: "build_templates", oldColumn: "es_xi_version", newColumn: "esxi_version"},
	}

	for _, migration := range migrations {
		if !db.Migrator().HasTable(migration.table) || !db.Migrator().HasColumn(migration.table, migration.oldColumn) {
			continue
		}
		if !db.Migrator().HasColumn(migration.table, migration.newColumn) {
			if err := db.Exec(fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s", migration.table, migration.oldColumn, migration.newColumn)).Error; err != nil {
				return fmt.Errorf("rename legacy column %s.%s: %w", migration.table, migration.oldColumn, err)
			}
			continue
		}
		if err := db.Exec(
			fmt.Sprintf("UPDATE %s SET %s = %s WHERE (%s IS NULL OR %s = '') AND %s IS NOT NULL AND %s <> ''",
				migration.table,
				migration.newColumn,
				migration.oldColumn,
				migration.newColumn,
				migration.newColumn,
				migration.oldColumn,
				migration.oldColumn,
			),
		).Error; err != nil {
			return fmt.Errorf("copy legacy column %s.%s: %w", migration.table, migration.oldColumn, err)
		}
	}
	return nil
}

type sqliteColumnInfo struct {
	CID          int
	Name         string
	Type         string
	NotNull      int
	DefaultValue *string `gorm:"column:dflt_value"`
	PK           int
}

func normalizeSQLiteDDL(db *gorm.DB, tables ...string) error {
	for _, table := range tables {
		if !db.Migrator().HasTable(table) {
			continue
		}

		var createSQL string
		if err := db.Raw(
			"SELECT sql FROM sqlite_master WHERE type = ? AND tbl_name = ? AND name = ?",
			"table",
			table,
			table,
		).Scan(&createSQL).Error; err != nil {
			return fmt.Errorf("inspect sqlite ddl for %s: %w", table, err)
		}
		if !strings.Contains(createSQL, "\t") {
			continue
		}
		if err := rebuildSQLiteTableWithCleanDDL(db, table); err != nil {
			return err
		}
	}
	return nil
}

func rebuildSQLiteTableWithCleanDDL(db *gorm.DB, table string) error {
	var columns []sqliteColumnInfo
	if err := db.Raw("PRAGMA table_info(" + quoteSQLiteIdentifier(table) + ")").Scan(&columns).Error; err != nil {
		return fmt.Errorf("inspect sqlite columns for %s: %w", table, err)
	}
	if len(columns) == 0 {
		return nil
	}

	sort.Slice(columns, func(i, j int) bool { return columns[i].CID < columns[j].CID })

	tempTable := table + "__clean_ddl"
	if db.Migrator().HasTable(tempTable) {
		return fmt.Errorf("temporary sqlite migration table already exists: %s", tempTable)
	}

	definitions := make([]string, 0, len(columns)+1)
	columnNames := make([]string, 0, len(columns))
	var primaryKeyColumns []sqliteColumnInfo
	for _, column := range columns {
		if column.PK > 0 {
			primaryKeyColumns = append(primaryKeyColumns, column)
		}
		columnNames = append(columnNames, quoteSQLiteIdentifier(column.Name))
	}
	sort.Slice(primaryKeyColumns, func(i, j int) bool { return primaryKeyColumns[i].PK < primaryKeyColumns[j].PK })

	inlinePrimaryKey := len(primaryKeyColumns) == 1
	for _, column := range columns {
		definitions = append(definitions, sqliteColumnDefinition(column, inlinePrimaryKey))
	}
	if len(primaryKeyColumns) > 1 {
		pkNames := make([]string, 0, len(primaryKeyColumns))
		for _, column := range primaryKeyColumns {
			pkNames = append(pkNames, quoteSQLiteIdentifier(column.Name))
		}
		definitions = append(definitions, "PRIMARY KEY ("+strings.Join(pkNames, ",")+")")
	}

	quotedTable := quoteSQLiteIdentifier(table)
	quotedTempTable := quoteSQLiteIdentifier(tempTable)
	copyColumns := strings.Join(columnNames, ",")

	return runSQLiteWithoutForeignKeys(db, func() error {
		return db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Exec(fmt.Sprintf("CREATE TABLE %s (%s)", quotedTempTable, strings.Join(definitions, ","))).Error; err != nil {
				return fmt.Errorf("create clean sqlite table for %s: %w", table, err)
			}
			if err := tx.Exec(fmt.Sprintf("INSERT INTO %s (%s) SELECT %s FROM %s", quotedTempTable, copyColumns, copyColumns, quotedTable)).Error; err != nil {
				return fmt.Errorf("copy sqlite rows for %s: %w", table, err)
			}
			if err := tx.Exec("DROP TABLE " + quotedTable).Error; err != nil {
				return fmt.Errorf("drop old sqlite table %s: %w", table, err)
			}
			if err := tx.Exec(fmt.Sprintf("ALTER TABLE %s RENAME TO %s", quotedTempTable, quotedTable)).Error; err != nil {
				return fmt.Errorf("rename clean sqlite table for %s: %w", table, err)
			}
			return nil
		})
	})
}

func runSQLiteWithoutForeignKeys(db *gorm.DB, fn func() error) (err error) {
	var enabled int
	if scanErr := db.Raw("PRAGMA foreign_keys").Scan(&enabled).Error; scanErr != nil {
		return fmt.Errorf("inspect sqlite foreign keys: %w", scanErr)
	}
	if enabled == 1 {
		if execErr := db.Exec("PRAGMA foreign_keys = OFF").Error; execErr != nil {
			return fmt.Errorf("disable sqlite foreign keys: %w", execErr)
		}
		defer func() {
			if execErr := db.Exec("PRAGMA foreign_keys = ON").Error; err == nil && execErr != nil {
				err = fmt.Errorf("restore sqlite foreign keys: %w", execErr)
			}
		}()
	}
	return fn()
}

func sqliteColumnDefinition(column sqliteColumnInfo, inlinePrimaryKey bool) string {
	definition := quoteSQLiteIdentifier(column.Name)
	columnType := strings.TrimSpace(column.Type)
	if columnType != "" {
		definition += " " + columnType
	}
	if inlinePrimaryKey && column.PK > 0 {
		definition += " PRIMARY KEY"
		if strings.EqualFold(columnType, "INTEGER") {
			definition += " AUTOINCREMENT"
		}
	}
	if column.NotNull != 0 && column.PK == 0 {
		definition += " NOT NULL"
	}
	if column.DefaultValue != nil {
		definition += " DEFAULT " + *column.DefaultValue
	}
	return definition
}

func quoteSQLiteIdentifier(identifier string) string {
	return `"` + strings.ReplaceAll(identifier, `"`, `""`) + `"`
}
