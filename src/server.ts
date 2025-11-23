import express from "express";
import path from "path";
import {
  createTweetStore,
  type HumanDecision,
  type TweetFilters,
} from "./tweetStore.js";

const PORT = Number(process.env.PORT) || 4000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const app = express();
const store = createTweetStore();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/api/tweets", (req, res) => {
  const password = req.query.password as string;
  if (ADMIN_PASSWORD && password !== ADMIN_PASSWORD) {
    return res.status(401).send("Unauthorized: Invalid or missing password.");
  }

  const { filters } = parseFilters(req.query);
  const tweets = store.list(filters);
  res.json(tweets);
});

app.get("/api/approved", (req, res) => {
  const { filters } = parseFilters(req.query);
  // Force approved=true for public endpoint
  filters.approved = true;
  const tweets = store.list(filters);
  res.json(tweets);
});

app.use(express.static(path.join(process.cwd(), "public")));

app.post("/tweets/:id/human-decision", (req, res) => {
  const { decision, password } = req.body as {
    decision?: string;
    password?: string;
  };

  if (ADMIN_PASSWORD && password !== ADMIN_PASSWORD) {
    return res.status(401).send("Unauthorized: Invalid or missing password.");
  }

  const normalized = normalizeDecision(decision);
  if (!normalized) {
    return res.status(400).send("Invalid decision. Use APPROVED or REJECTED.");
  }

  store.updateHumanDecision(req.params.id, normalized);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Tweet moderation dashboard running on http://localhost:${PORT}`);
});

process.on("SIGINT", () => {
  store.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  store.close();
  process.exit(0);
});

type FilterParseResult = {
  filters: TweetFilters;
};

function parseFilters(query: any): FilterParseResult {
  const approvedParam =
    typeof query.approved === "string" ? query.approved : "all";
  const humanParam =
    typeof query.humanDecision === "string" ? query.humanDecision : "all";

  const filters: TweetFilters = {};

  if (approvedParam === "true" || approvedParam === "false") {
    filters.approved = approvedParam === "true";
  }

  if (
    humanParam === "APPROVED" ||
    humanParam === "REJECTED" ||
    humanParam === "UNSET"
  ) {
    filters.humanDecision = humanParam as TweetFilters["humanDecision"];
  }

  return { filters };
}

function normalizeDecision(value?: string): HumanDecision | null {
  if (value === "APPROVED" || value === "REJECTED") {
    return value;
  }
  return null;
}
