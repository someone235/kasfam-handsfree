# Kasfam Handsfree

This tool finds candidates to quote on Kaspa twitter, and suggests the text following to the quotation. You can edit the prompt that "judges" tweets in `src/prompt.ts`.

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
npm run dev
```

### Build and run compiled output

```bash
npm run build
npm start
```

### CLI Options

The app pulls all available tweets from the source(kaspa-news) and by default we will send them all to chatgpt for processing. You can limit the number of tweets processed by the LLM using the `--limit` flag. Useful for dev.

```bash
# process all tweets (default)
npm run dev

# process only the latest 50 tweets
npm run dev -- --limit 50
```

The system prompt lives in `src/prompt.ts`. Edit that file if you need a different tone or instruction set. The script prints the model's answer to stdout and falls back to dumping the raw response if no text output is available.

## Database migrations

A simple SQLite migration for storing tweet decisions is included in `migrations/001_create_tweets_table.sql`. Run it through npm (powered by the bundled [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) driver—no external sqlite binary needed):

```bash
# optional: export SQLITE_DB_PATH=/absolute/path/to/db.sqlite
npm run migrate

# or supply the db path as a positional argument
npm run migrate -- ./data/moderation.db
```

By default the script writes to `data/app.db`. All `.sql` files inside `migrations/` are executed in order, creating the `tweets` table with `id`, `text`, `quote`, `url`, `approved`, `createdAt`, and `humanDecision` columns (`id` remains unique via the primary key and index).

### Reset database

To completely reset the database (deletes all tweets and recreates the schema):

```bash
npm run reset-db
```

Ensure there are no other processes running.

## Moderation dashboard

Review stored tweets and adjust the human decision field via the built-in web UI:

```bash
# optional overrides
export SQLITE_DB_PATH=./data/app.db
export PORT=4000

npm run web
```

Then visit `http://localhost:4000`. Use the filter controls to narrow results by the model's `approved` status or by the `humanDecision` column (Approved, Rejected, or Unset). Each row exposes a dropdown that lets you set the human decision to `APPROVED` or `REJECTED`; changes persist immediately to the SQLite database.

### REST API

The moderation UI consumes the `/api/tweets` endpoint, which you can also call directly. Query parameters:

- `approved`: `true`, `false`, or omit for all results.
- `humanDecision`: `APPROVED`, `REJECTED`, `UNSET`, or omit.
- `page` (default `1`): 1-based page number.
- `pageSize` (default `20`, max `100`): number of rows per page.
- `password`: required if `ADMIN_PASSWORD` is set and you need access to the protected `quote` text.

The response includes the requested rows plus pagination metadata:

```json
{
  "data": [
    {
      "id": "...",
      "text": "...",
      "quote": "...",
      "url": "...",
      "approved": true,
      "createdAt": "2024-01-01T00:00:00Z",
      "humanDecision": "APPROVED"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 123,
    "totalPages": 7,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

Unauthorized callers still receive the metadata but the `quote` field is blank when the model has not yet approved the tweet.

### Docker image

You can also run the dashboard in Docker (uses the same SQLite file path inside the container unless overridden):

```bash
docker build -t kaspa-handsfree .
docker run -p 4000:4000 \
	-e OPENAI_API_KEY="$OPENAI_API_KEY" \
	-e SQLITE_DB_PATH=/data/app.db \
	-v "$(pwd)/data:/data" \
	kaspa-handsfree
```

The entrypoint automatically runs database migrations before starting `dist/server.js`. Customize `PORT`, `SQLITE_DB_PATH`, or mount an external SQLite file as needed.

### Docker Compose (persistent volume)

For a ready-to-run setup with an automatic named volume:

```bash
# launch the web dashboard
OPENAI_API_KEY=sk-your-key docker compose up --build web

# run the CLI processor
OPENAI_API_KEY=sk-your-key docker compose run processor
```

The `web` service exposes `http://localhost:4000` and stays running, while the `processor` service executes the GPT moderation loop defined in `dist/index.js`. Both share the `kaspa-data` volume, so database changes are visible between them.
