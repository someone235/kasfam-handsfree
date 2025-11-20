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

By default the script writes to `data/app.db`. All `.sql` files inside `migrations/` are executed in order, creating the `tweets` table with `id`, `text`, `quote`, `url`, `approved`, `createdAt`, and `humanDecision` columns (`id` remains unique via the primary key and index).

## Moderation dashboard

Review stored tweets and adjust the human decision field via the built-in web UI:

```bash
# optional overrides
export SQLITE_DB_PATH=./data/app.db
export PORT=4000

npm run web
```

Then visit `http://localhost:4000`. Use the filter controls to narrow results by the model's `approved` status or by the `humanDecision` column (Approved, Rejected, or Unset). Each row exposes a dropdown that lets you set the human decision to `APPROVED` or `REJECTED`; changes persist immediately to the SQLite database.

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

# run the CLI processor once (shares the same volume)
OPENAI_API_KEY=sk-your-key docker compose run processor
```

The `web` service exposes `http://localhost:4000` and stays running, while the `processor` service executes the GPT moderation loop defined in `dist/index.js`. Both share the `kaspa-data` volume, so database changes are visible between them.
