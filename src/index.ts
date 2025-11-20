import Database, { Database as SqliteDatabase } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { prompt as systemPrompt } from "./prompt.js";

const openAiClient = new OpenAI({ apiKey: assertApiKey() });

function assertApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }
  return key;
}

async function ask(
  question: string
): Promise<{ quote?: string; approved: boolean }> {
  const response = await openAiClient.responses.create({
    model: "gpt-5.1",
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question },
    ],
  });

  const quote = response.output_text?.trim();
  const approved = !quote?.startsWith("Rejected");
  return {
    quote: quote,
    approved,
  };
}

type Tweet = {
  id: string;
  text: string;
  url: string;
};

type TweetDecision = Tweet & {
  quote: string;
  approved: boolean;
};

function resolveDbPath() {
  const inputPath = process.env.SQLITE_DB_PATH || "data/app.db";
  const resolved = path.resolve(inputPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

function ensureTweetsTable(db: SqliteDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tweets (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      quote TEXT NOT NULL,
      url TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_tweets_id ON tweets(id);
  `);
}

function createTweetStore() {
  const dbPath = resolveDbPath();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  ensureTweetsTable(db);

  const upsert = db.prepare(
    `INSERT INTO tweets (id, text, quote, url, approved)
     VALUES (@id, @text, @quote, @url, @approved)
     ON CONFLICT(id) DO UPDATE SET
       text = excluded.text,
       quote = excluded.quote,
       url = excluded.url,
       approved = excluded.approved`
  );

  return {
    save(decision: TweetDecision) {
      upsert.run({
        ...decision,
        approved: decision.approved ? 1 : 0,
      });
    },
    close() {
      db.close();
    },
  };
}

type TweetStore = ReturnType<typeof createTweetStore>;

async function getKaspaTweets(): Promise<Tweet[]> {
  const res = await fetch("https://kaspa.news/api/kaspa-tweets", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch kaspa tweets: ${res.status} ${res.statusText}`
    );
  }
  const response = await res.json();
  return response.tweets ?? [];
}

async function main() {
  let store: TweetStore | null = null;
  try {
    store = createTweetStore();
    const tweets = await getKaspaTweets();

    for (let tweet of tweets) {
      console.info(`\nSending question to GPT-5.1...`);
      const { quote, approved } = await ask(tweet.text);

      store.save({
        ...tweet,
        quote: quote ?? "",
        approved,
      });

      if (!approved) {
        continue;
      }

      console.info(`Question: ${tweet.text}`);

      console.log(`Approved status: ${approved}`);

      if (!quote) {
        console.warn("No textual output returned by the model.");
        process.exitCode = 2;
        return;
      }

      console.log("\n=== GPT-5.1 Response ===\n");
      console.log(quote);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error("Unknown error", error);
    }
    process.exitCode = 1;
  } finally {
    store?.close();
  }
}

main();
