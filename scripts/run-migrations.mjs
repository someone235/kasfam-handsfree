import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { applyMigrations } from "../dist/migrations.js";

function resolveDbPath() {
  const inputPath =
    process.env.SQLITE_DB_PATH || process.argv[2] || "data/app.db";
  const resolved = path.resolve(inputPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

function main() {
  let db;
  try {
    const dbPath = resolveDbPath();

    db = new Database(dbPath);
    console.info(`Applying migrations to ${dbPath}...`);
    const { appliedCount } = applyMigrations(db, { verbose: true });

    console.info(
      appliedCount > 0
        ? `\nApplied ${appliedCount} migration(s).`
        : "\nNo pending migrations—database is up to date."
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}

main();
