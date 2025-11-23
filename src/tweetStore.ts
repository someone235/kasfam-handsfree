import Database, { Database as SqliteDatabase } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type HumanDecision = "APPROVED" | "REJECTED";

export type TweetRecord = {
  id: string;
  text: string;
  quote: string;
  url: string;
  approved: boolean;
  createdAt: string;
  humanDecision: HumanDecision | null;
};

export type TweetDecisionInput = {
  id: string;
  text: string;
  quote: string;
  url: string;
  approved: boolean;
};

export type TweetFilters = {
  approved?: boolean;
  humanDecision?: HumanDecision | "UNSET";
};

function resolveDbPath() {
  const inputPath = process.env.SQLITE_DB_PATH || "data/app.db";
  const resolved = path.resolve(inputPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

function initDb(): SqliteDatabase {
  const db = new Database(resolveDbPath());
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tweets (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      quote TEXT NOT NULL,
      url TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      humanDecision TEXT DEFAULT NULL CHECK(humanDecision IN ('APPROVED','REJECTED'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tweets_id ON tweets(id);
  `);
  return db;
}

export function createTweetStore() {
  const db = initDb();

  const upsert = db.prepare(`
    INSERT INTO tweets (id, text, quote, url, approved)
    VALUES (@id, @text, @quote, @url, @approved)
    ON CONFLICT(id) DO UPDATE SET
      text = excluded.text,
      quote = excluded.quote,
      url = excluded.url,
      approved = excluded.approved
  `);

  return {
    save(decision: TweetDecisionInput) {
      upsert.run({
        ...decision,
        approved: decision.approved ? 1 : 0,
      });
    },
    list(filters: TweetFilters = {}): TweetRecord[] {
      const where: string[] = [];
      const params: Record<string, unknown> = {};

      if (typeof filters.approved === "boolean") {
        where.push("approved = @approved");
        params.approved = filters.approved ? 1 : 0;
      }

      if (
        filters.humanDecision === "APPROVED" ||
        filters.humanDecision === "REJECTED"
      ) {
        where.push("humanDecision = @humanDecision");
        params.humanDecision = filters.humanDecision;
      } else if (filters.humanDecision === "UNSET") {
        where.push("humanDecision IS NULL");
      }

      const sql = `
        SELECT id, text, quote, url, approved, createdAt, humanDecision
        FROM tweets
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY datetime(createdAt) DESC
      `;

      const rows = db.prepare(sql).all(params) as Array<{
        id: string;
        text: string;
        quote: string;
        url: string;
        approved: number;
        createdAt: string;
        humanDecision: HumanDecision | null;
      }>;

      return rows.map((row) => ({
        ...row,
        approved: Boolean(row.approved),
        humanDecision: row.humanDecision ?? null,
      }));
    },
    updateHumanDecision(id: string, decision: HumanDecision | null) {
      db.prepare(
        `
        UPDATE tweets
        SET humanDecision = @decision
        WHERE id = @id
      `
      ).run({ id, decision });
    },
    has(id: string): boolean {
      const row = db
        .prepare("SELECT 1 FROM tweets WHERE id = @id")
        .get({ id });
      return !!row;
    },
    close() {
      db.close();
    },
  };
}
