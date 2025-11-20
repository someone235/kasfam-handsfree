# Handsfree GPT-5.1 CLI

Ask GPT-5.1 anything from your terminal using the official OpenAI JavaScript SDK and a fixed system prompt defined in `src/prompt.ts`.

## Prerequisites

- Node.js 18+
- An OpenAI API key with access to GPT-5.1

## Setup

```bash
npm install
```

Set your API key (add this to your shell profile for convenience):

```bash
export OPENAI_API_KEY="sk-your-key"
```

## Usage

### Development mode (TypeScript directly)

```bash
npm run dev -- --question "Why is async IO helpful?"
```

### Build and run compiled output

```bash
npm run build
npm start -- "Give me today's top ML headline"
```

Command-line options:

- `-q, --question <text>` Question to send (you can also append the question after the options)
- `-h, --help` Show inline usage info

The system prompt lives in `src/prompt.ts`. Edit that file if you need a different tone or instruction set. The script prints the model's answer to stdout and falls back to dumping the raw response if no text output is available.

## Database migrations

A simple SQLite migration for storing tweet decisions is included in `migrations/001_create_tweets_table.sql`. Run it through npm (powered by the bundled [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) driver—no external sqlite binary needed):

```bash
# optional: export SQLITE_DB_PATH=/absolute/path/to/db.sqlite
npm run migrate

# or supply the db path as a positional argument
npm run migrate -- ./data/moderation.db
```

By default the script writes to `data/app.db`. All `.sql` files inside `migrations/` are executed in order, creating the `tweets` table with `id`, `text`, `url`, `approved`, and `createdAt` columns (`id` remains unique via the primary key and index).
