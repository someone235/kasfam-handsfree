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
  score: number;
  createdAt: string;
  humanDecision: HumanDecision | null;
};

export type TweetDecisionInput = {
  id: string;
  text: string;
  quote: string;
  url: string;
  approved: boolean;
  score: number;
};

export type TweetFilters = {
  approved?: boolean;
  humanDecision?: HumanDecision | "UNSET";
};

export type PaginationOptions = {
  page?: number;
  pageSize?: number;
};

type NormalizedPagination = {
  page: number;
  pageSize: number;
  limit: number;
  offset: number;
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

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
      score INTEGER NOT NULL DEFAULT 0,
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
    INSERT INTO tweets (id, text, quote, url, approved, score)
    VALUES (@id, @text, @quote, @url, @approved, @score)
    ON CONFLICT(id) DO UPDATE SET
      text = excluded.text,
      quote = excluded.quote,
      url = excluded.url,
      approved = excluded.approved,
      score = excluded.score
  `);

  return {
    save(decision: TweetDecisionInput) {
      upsert.run({
        ...decision,
        approved: decision.approved ? 1 : 0,
      });
    },
    list(filters: TweetFilters = {}, pagination?: PaginationOptions) {
      const normalizedPagination = normalizePagination(pagination);
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

      const baseQuery = `
        FROM tweets
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      `;

      const sql = `
        SELECT id, text, quote, url, approved, score, createdAt, humanDecision
        ${baseQuery}
        ORDER BY datetime(createdAt) DESC
        LIMIT @limit OFFSET @offset
      `;

      const rows = db.prepare(sql).all({
        ...params,
        limit: normalizedPagination.limit,
        offset: normalizedPagination.offset,
      }) as Array<{
        id: string;
        text: string;
        quote: string;
        url: string;
        approved: number;
        score: number;
        createdAt: string;
        humanDecision: HumanDecision | null;
      }>;

      const totalRow = db
        .prepare(`SELECT COUNT(*) as total ${baseQuery}`)
        .get(params) as { total: number };

      const tweets = rows.map((row) => ({
        ...row,
        approved: Boolean(row.approved),
        score: Number(row.score) || 0,
        humanDecision: row.humanDecision ?? null,
      }));

      return {
        tweets,
        total: totalRow?.total ?? 0,
        page: normalizedPagination.page,
        pageSize: normalizedPagination.pageSize,
      };
    },
    get(id: string): TweetRecord | null {
      const row = db
        .prepare(
          `
        SELECT id, text, quote, url, approved, score, createdAt, humanDecision
        FROM tweets
        WHERE id = @id
      `
        )
        .get({ id }) as
        | {
            id: string;
            text: string;
            quote: string;
            url: string;
            approved: number;
            score: number;
            createdAt: string;
            humanDecision: HumanDecision | null;
          }
        | undefined;

      if (!row) {
        return null;
      }

      return {
        ...row,
        approved: Boolean(row.approved),
        score: Number(row.score) || 0,
        humanDecision: row.humanDecision ?? null,
      };
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
      const row = db.prepare("SELECT 1 FROM tweets WHERE id = @id").get({ id });
      return !!row;
    },
    close() {
      db.close();
    },
  };
}

function normalizePagination(
  options?: PaginationOptions
): NormalizedPagination {
  const page = Math.max(1, Math.floor(options?.page ?? 1));
  const requestedSize = Math.max(
    1,
    Math.floor(options?.pageSize ?? DEFAULT_PAGE_SIZE)
  );
  const pageSize = Math.min(requestedSize, MAX_PAGE_SIZE);

  return {
    page,
    pageSize,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
}
