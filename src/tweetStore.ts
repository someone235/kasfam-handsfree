import Database, { Database as SqliteDatabase } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { applyMigrations } from "./migrations.js";

export type HumanDecision = "APPROVED" | "REJECTED";
export type GoldExampleType = "GOOD" | "BAD";

export type FrequencyState = "fresh" | "healthy" | "warm" | "hot";

export interface AuthorFrequency {
  postsLast7Days: number;
  postsLast30Days: number;
  frequencyState: FrequencyState;
}

export interface TweetRecord {
  id: string;
  text: string;
  quote: string;
  url: string;
  approved: boolean | null;
  score: number;
  createdAt: string;
  updatedAt: string | null;
  humanDecision: HumanDecision | null;
  goldExampleType: GoldExampleType | null;
  goldExampleCorrection: string | null;
  authorUsername: string | null;
}

export interface TweetRawInput {
  id: string;
  text: string;
  url: string;
  authorUsername?: string;
}

export interface TweetDecisionInput {
  id: string;
  text: string;
  quote: string;
  url: string;
  approved: boolean;
  score: number;
}

export interface TweetFilters {
  approved?: boolean;
  humanDecision?: HumanDecision | "UNSET";
  hasModelDecision?: boolean;
  goldExampleType?: GoldExampleType;
  hasGoldExample?: boolean;
}

export interface PaginationOptions {
  page?: number;
  pageSize?: number;
}

interface NormalizedPagination {
  page: number;
  pageSize: number;
  limit: number;
  offset: number;
}

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
  applyMigrations(db);

  return db;
}

function extractAuthorFromUrl(url: string): string | null {
  const match = url.match(/x\.com\/([^/]+)\/status/);
  return match?.[1] ?? null;
}

function computeFrequencyState(postsLast7Days: number, postsLast30Days: number): FrequencyState {
  if (postsLast7Days === 0 && postsLast30Days === 0) {
    return "fresh";
  }
  if (postsLast7Days >= 2) {
    return "hot";
  }
  if (postsLast30Days >= 3) {
    return "warm";
  }
  return "healthy";
}

export function createTweetStore() {
  const db = initDb();

  const upsertWithDecision = db.prepare(`
    INSERT INTO tweets (id, text, quote, url, approved, score, updatedAt)
    VALUES (@id, @text, @quote, @url, @approved, @score, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      text = excluded.text,
      quote = excluded.quote,
      url = excluded.url,
      approved = excluded.approved,
      score = excluded.score,
      updatedAt = datetime('now')
  `);

  const insertRaw = db.prepare(`
    INSERT INTO tweets (id, text, url, authorUsername)
    VALUES (@id, @text, @url, @authorUsername)
    ON CONFLICT(id) DO UPDATE SET
      text = excluded.text,
      url = excluded.url,
      authorUsername = COALESCE(excluded.authorUsername, tweets.authorUsername)
  `);

  return {
    saveRaw(tweet: TweetRawInput) {
      const authorUsername = tweet.authorUsername ?? extractAuthorFromUrl(tweet.url);
      insertRaw.run({ ...tweet, authorUsername });
    },
    save(decision: TweetDecisionInput) {
      upsertWithDecision.run({
        ...decision,
        approved: decision.approved ? 1 : 0,
      });
    },
    list(filters: TweetFilters = {}, pagination?: PaginationOptions) {
      const normalizedPagination = normalizePagination(pagination);
      const where: string[] = [];
      const params: Record<string, unknown> = {};

      if (filters.hasModelDecision === true) {
        where.push("approved IS NOT NULL");
      } else if (filters.hasModelDecision === false) {
        where.push("approved IS NULL");
      }

      if (typeof filters.approved === "boolean") {
        where.push("approved = @approved");
        params.approved = filters.approved ? 1 : 0;
      }

      if (filters.humanDecision === "APPROVED" || filters.humanDecision === "REJECTED") {
        where.push("humanDecision = @humanDecision");
        params.humanDecision = filters.humanDecision;
      } else if (filters.humanDecision === "UNSET") {
        where.push("humanDecision IS NULL");
      }

      if (filters.goldExampleType) {
        where.push("goldExampleType = @goldExampleType");
        params.goldExampleType = filters.goldExampleType;
      } else if (filters.hasGoldExample === true) {
        where.push("goldExampleType IS NOT NULL");
      } else if (filters.hasGoldExample === false) {
        where.push("goldExampleType IS NULL");
      }

      const baseQuery = `
        FROM tweets
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      `;

      const sql = `
        SELECT id, text, quote, url, approved, score, createdAt, updatedAt, humanDecision, goldExampleType, goldExampleCorrection, authorUsername
        ${baseQuery}
        ORDER BY datetime(COALESCE(updatedAt, createdAt)) DESC
        LIMIT @limit OFFSET @offset
      `;

      const rows = db.prepare(sql).all({
        ...params,
        limit: normalizedPagination.limit,
        offset: normalizedPagination.offset,
      }) as {
        id: string;
        text: string;
        quote: string;
        url: string;
        approved: number | null;
        score: number;
        createdAt: string;
        updatedAt: string | null;
        humanDecision: HumanDecision | null;
        goldExampleType: GoldExampleType | null;
        goldExampleCorrection: string | null;
        authorUsername: string | null;
      }[];

      const totalRow = db.prepare(`SELECT COUNT(*) as total ${baseQuery}`).get(params) as {
        total: number;
      };

      const tweets = rows.map((row) => ({
        ...row,
        approved: row.approved === null ? null : Boolean(row.approved),
        score: Number(row.score) || 0,
        updatedAt: row.updatedAt ?? null,
        humanDecision: row.humanDecision ?? null,
        goldExampleType: row.goldExampleType ?? null,
        goldExampleCorrection: row.goldExampleCorrection ?? null,
        authorUsername: row.authorUsername ?? null,
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
        SELECT id, text, quote, url, approved, score, createdAt, updatedAt, humanDecision, goldExampleType, goldExampleCorrection, authorUsername
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
            approved: number | null;
            score: number;
            createdAt: string;
            updatedAt: string | null;
            humanDecision: HumanDecision | null;
            goldExampleType: GoldExampleType | null;
            goldExampleCorrection: string | null;
            authorUsername: string | null;
          }
        | undefined;

      if (!row) {
        return null;
      }

      return {
        ...row,
        approved: row.approved === null ? null : Boolean(row.approved),
        score: Number(row.score) || 0,
        updatedAt: row.updatedAt ?? null,
        humanDecision: row.humanDecision ?? null,
        goldExampleType: row.goldExampleType ?? null,
        goldExampleCorrection: row.goldExampleCorrection ?? null,
        authorUsername: row.authorUsername ?? null,
      };
    },
    updateHumanDecision(id: string, decision: HumanDecision | null) {
      db.prepare(
        `
        UPDATE tweets
        SET humanDecision = @decision, updatedAt = datetime('now')
        WHERE id = @id
      `
      ).run({ id, decision });
    },
    has(id: string): boolean {
      const row = db.prepare("SELECT 1 FROM tweets WHERE id = @id").get({ id });
      return !!row;
    },
    hasModelDecision(id: string): boolean {
      const row = db
        .prepare("SELECT 1 FROM tweets WHERE id = @id AND approved IS NOT NULL")
        .get({ id });
      return !!row;
    },
    setGoldExample(id: string, type: GoldExampleType | null, correction?: string | null) {
      db.prepare(
        `
        UPDATE tweets
        SET goldExampleType = @type,
            goldExampleCorrection = @correction,
            updatedAt = datetime('now')
        WHERE id = @id
      `
      ).run({ id, type, correction: correction ?? null });
    },
    getGoldExamples(type?: GoldExampleType): TweetRecord[] {
      const sql = type
        ? `SELECT id, text, quote, url, approved, score, createdAt, updatedAt, humanDecision, goldExampleType, goldExampleCorrection, authorUsername
           FROM tweets WHERE goldExampleType = @type ORDER BY updatedAt DESC`
        : `SELECT id, text, quote, url, approved, score, createdAt, updatedAt, humanDecision, goldExampleType, goldExampleCorrection, authorUsername
           FROM tweets WHERE goldExampleType IS NOT NULL ORDER BY goldExampleType, updatedAt DESC`;

      const rows = db.prepare(sql).all(type ? { type } : {}) as {
        id: string;
        text: string;
        quote: string;
        url: string;
        approved: number | null;
        score: number;
        createdAt: string;
        updatedAt: string | null;
        humanDecision: HumanDecision | null;
        goldExampleType: GoldExampleType | null;
        goldExampleCorrection: string | null;
        authorUsername: string | null;
      }[];

      return rows.map((row) => ({
        ...row,
        approved: row.approved === null ? null : Boolean(row.approved),
        score: Number(row.score) || 0,
        updatedAt: row.updatedAt ?? null,
        humanDecision: row.humanDecision ?? null,
        goldExampleType: row.goldExampleType ?? null,
        goldExampleCorrection: row.goldExampleCorrection ?? null,
        authorUsername: row.authorUsername ?? null,
      }));
    },
    getAuthorFrequency(authorUsername: string): AuthorFrequency {
      const now7 = db
        .prepare(
          `
        SELECT COUNT(*) as cnt FROM tweets
        WHERE authorUsername = @authorUsername
          AND (approved = 1 OR humanDecision = 'APPROVED')
          AND datetime(COALESCE(updatedAt, createdAt)) >= datetime('now', '-7 days')
      `
        )
        .get({ authorUsername }) as { cnt: number };

      const now30 = db
        .prepare(
          `
        SELECT COUNT(*) as cnt FROM tweets
        WHERE authorUsername = @authorUsername
          AND (approved = 1 OR humanDecision = 'APPROVED')
          AND datetime(COALESCE(updatedAt, createdAt)) >= datetime('now', '-30 days')
      `
        )
        .get({ authorUsername }) as { cnt: number };

      const postsLast7Days = now7?.cnt ?? 0;
      const postsLast30Days = now30?.cnt ?? 0;

      return {
        postsLast7Days,
        postsLast30Days,
        frequencyState: computeFrequencyState(postsLast7Days, postsLast30Days),
      };
    },
    close() {
      db.close();
    },
  };
}

function normalizePagination(options?: PaginationOptions): NormalizedPagination {
  const page = Math.max(1, Math.floor(options?.page ?? 1));
  const requestedSize = Math.max(1, Math.floor(options?.pageSize ?? DEFAULT_PAGE_SIZE));
  const pageSize = Math.min(requestedSize, MAX_PAGE_SIZE);

  return {
    page,
    pageSize,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
}
