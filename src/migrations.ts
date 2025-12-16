import type { Database as SqliteDatabase } from "better-sqlite3";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_TABLE = "schema_migrations";

function defaultMigrationsDir(): string {
  const srcDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(srcDir, "..", "migrations");
}

function listMigrationFiles(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function ensureMigrationsTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      filename TEXT PRIMARY KEY,
      appliedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function hasMigrationRecorded(db: SqliteDatabase, filename: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM ${MIGRATIONS_TABLE} WHERE filename = ? LIMIT 1`)
    .get(filename);
  return !!row;
}

function recordMigration(db: SqliteDatabase, filename: string): void {
  db.prepare(`INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (filename) VALUES (?)`).run(filename);
}

function tableExists(db: SqliteDatabase, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName);
  return !!row;
}

interface ColumnInfo {
  name: string;
  notnull: number;
  dflt_value: string | null;
}

function getTweetColumnMap(db: SqliteDatabase): Map<string, ColumnInfo> {
  const rows = db.prepare("PRAGMA table_info(tweets)").all() as ColumnInfo[];
  const byName = new Map<string, ColumnInfo>();
  for (const row of rows) {
    byName.set(row.name, row);
  }
  return byName;
}

function isMigrationAlreadyAppliedBySchema(db: SqliteDatabase, filename: string): boolean {
  if (filename.startsWith("001_")) {
    return tableExists(db, "tweets");
  }

  const columns = getTweetColumnMap(db);
  if (columns.size === 0) {
    return false;
  }

  if (filename.startsWith("002_")) {
    return columns.has("score");
  }

  if (filename.startsWith("003_")) {
    const approved = columns.get("approved");
    const quote = columns.get("quote");
    return (
      approved?.notnull === 0 &&
      quote !== undefined &&
      quote.dflt_value !== null &&
      quote.dflt_value !== undefined
    );
  }

  if (filename.startsWith("004_")) {
    return columns.has("updatedAt");
  }

  if (filename.startsWith("005_")) {
    return columns.has("goldExampleType");
  }

  if (filename.startsWith("006_")) {
    return columns.has("goldExampleCorrection");
  }

  return false;
}

function applyMigration(db: SqliteDatabase, filePath: string): void {
  const sql = readFileSync(filePath, "utf8");
  try {
    db.exec(sql);
  } catch (error) {
    if (db.inTransaction) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
    }

    if (error instanceof Error && /duplicate column name/i.test(error.message)) {
      console.warn(`Skipping ${path.basename(filePath)}: ${error.message}`);
      return;
    }
    if (error instanceof Error && /table .* already exists/i.test(error.message)) {
      console.warn(`Skipping ${path.basename(filePath)}: ${error.message}`);
      return;
    }
    throw error;
  }
}

export interface ApplyMigrationsOptions {
  migrationsDir?: string;
  verbose?: boolean;
}

export interface ApplyMigrationsResult {
  appliedCount: number;
  total: number;
}

export function applyMigrations(
  db: SqliteDatabase,
  options: ApplyMigrationsOptions = {}
): ApplyMigrationsResult {
  const migrationsDir = options.migrationsDir ?? defaultMigrationsDir();
  if (!existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found at ${migrationsDir}`);
  }

  const migrations = listMigrationFiles(migrationsDir);
  if (migrations.length === 0) {
    return { appliedCount: 0, total: 0 };
  }

  ensureMigrationsTable(db);

  let appliedCount = 0;
  for (const file of migrations) {
    if (hasMigrationRecorded(db, file)) {
      continue;
    }

    if (isMigrationAlreadyAppliedBySchema(db, file)) {
      recordMigration(db, file);
      continue;
    }

    if (options.verbose) {
      console.info(`\n> Running ${file}`);
    }

    const fullPath = path.join(migrationsDir, file);
    applyMigration(db, fullPath);
    recordMigration(db, file);
    appliedCount += 1;
  }

  return { appliedCount, total: migrations.length };
}
