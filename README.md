# Kasfam Handsfree

This tool finds candidates to quote on Kaspa twitter, and suggests the text following to the quotation. You can edit the prompt that "judges" tweets in `src/prompt.ts`.

## Prerequisites

- Node.js 18+
- An OpenAI API key with access to GPT-5.1
- (Optional) X API credentials for direct tweet fetching

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Required
OPENAI_API_KEY=sk-your-key

# Optional: X API OAuth 1.0a credentials (for --source x-api)
X_API_KEY=your-api-key
X_API_SECRET=your-api-secret
X_ACCESS_TOKEN=your-access-token
X_ACCESS_TOKEN_SECRET=your-access-token-secret
```

To generate X API access tokens, run the OAuth bootstrap script:

```bash
npx tsx scripts/x-auth-bootstrap.ts
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

The app fetches tweets from kaspa.news by default, or directly from X API if configured. Use `--source` to switch sources, `--limit` to cap how many tweets are processed, or `--tweet-id` to process specific tweets.

```bash
# process all tweets from kaspa.news (default)
npm run dev

# fetch from X API instead
npm run dev -- --source x-api

# fetch from both sources (deduplicated)
npm run dev -- --source both

# process only the latest 50 tweets
npm run dev -- --limit 50

# process a specific tweet by id (searches kaspa.news by default)
npm run dev -- --tweet-id 1992657727361868193

# process multiple tweets by id (comma-separated)
npm run dev -- --tweet-id 1992657727361868193,1992726968492786130,1992637633194016807

# fetch tweet directly from X API by id
npm run dev -- --tweet-id 1992657727361868193 --source x-api

# try kaspa.news first, fallback to X API if not found
npm run dev -- --tweet-id 1992657727361868193 --source both
```

**Note:** `--limit` only applies to feed fetching, not `--tweet-id`. When using `--tweet-id`:
- `--source kaspa-news` (default): searches kaspa.news only, errors if not found
- `--source x-api`: fetches directly from X API by ID
- `--source both`: tries kaspa.news first, falls back to X API for any missing IDs

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

### Gold Examples (Few-shot Learning)

Mark tweets as `GOOD` or `BAD` examples to help calibrate the model. The 5 most recent examples of each type are injected into the GPT prompt as few-shot examples. BAD examples require a rejection reason (e.g., "Rejected: price action focus").

In the admin UI, use the Gold Example dropdown on any tweet. Filter by gold example status using the filter controls.

### Scoring

Tweets receive a percentile-based score (0-100) indicating quality relative to previously evaluated tweets. The model maintains conversation memory to track score distribution and calibrate consistently. Click the Score/Created/Updated column headers in the admin view to sort.

### REST API

The moderation UI consumes the `/api/tweets` endpoint, which you can also call directly. Query parameters:

- `approved`: `true`, `false`, or omit for all results.
- `humanDecision`: `APPROVED`, `REJECTED`, `UNSET`, or omit.
- `goldExample`: `GOOD`, `BAD`, `ANY`, `NONE`, or omit.
- `orderBy`: `score`, `createdAt`, `updatedAt` (default).
- `orderDir`: `asc`, `desc` (default).
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
      "score": 75,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z",
      "humanDecision": "APPROVED",
      "goldExampleType": null,
      "goldExampleCorrection": null
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

## Important Notes

- Conversation memory is shared across CLI and server—avoid running parallel evaluations for consistent calibration
