import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function resolveDbPath() {
  const inputPath =
    process.env.SQLITE_DB_PATH || process.argv[2] || "data/app.db";
  const resolved = path.resolve(inputPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

function getMigrationsDir() {
  const migrationsDir = path.resolve("migrations");
  if (!existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found at ${migrationsDir}`);
  }
  return migrationsDir;
}

function listMigrationFiles(migrationsDir) {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function applyMigration(db, filePath) {
  const sql = readFileSync(filePath, "utf8");
  try {
    db.exec(sql);
  } catch (error) {
    // Rollback any open transaction before continuing
    if (db.inTransaction) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
    }

    if (
      error instanceof Error &&
      /duplicate column name/i.test(error.message)
    ) {
      console.warn(`Skipping ${path.basename(filePath)}: ${error.message}`);
      return;
    }
    if (
      error instanceof Error &&
      /table .* already exists/i.test(error.message)
    ) {
      console.warn(`Skipping ${path.basename(filePath)}: ${error.message}`);
      return;
    }
    throw error;
  }
}

function main() {
  let db;
  try {
    const dbPath = resolveDbPath();
    const migrationsDir = getMigrationsDir();
    const migrations = listMigrationFiles(migrationsDir);

    if (migrations.length === 0) {
      console.info("No migration files found—nothing to do.");
      return;
    }

    db = new Database(dbPath);

    console.info(`Applying ${migrations.length} migration(s) to ${dbPath}...`);

    for (const file of migrations) {
      const fullPath = path.join(migrationsDir, file);
      console.info(`\n> Running ${file}`);
      applyMigration(db, fullPath);
    }

    console.info("\nAll migrations applied successfully.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}

main();
