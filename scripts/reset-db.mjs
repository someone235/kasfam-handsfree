import Database from "better-sqlite3";
import { unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

function resolveDbPath() {
  const inputPath = process.env.SQLITE_DB_PATH || "data/app.db";
  return path.resolve(inputPath);
}

async function main() {
  try {
    const dbPath = resolveDbPath();
    
    console.log("Resetting database...");
    
    // close any existing connections by deleting the db files
    const files = [dbPath, `${dbPath}-shm`, `${dbPath}-wal`];
    
    for (const file of files) {
      if (existsSync(file)) {
        console.log(`Deleting ${path.basename(file)}...`);
        unlinkSync(file);
      }
    }
    
    console.log("\nRunning migrations...");
    await execAsync("npm run migrate");
    
    console.log("\nDatabase reset complete!");
  } catch (error) {
    console.error("Error resetting database:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

main();

