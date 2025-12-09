import "dotenv/config";
import express from "express";
import path from "path";
import {
  createTweetStore,
  type HumanDecision,
  type GoldExampleType,
  type TweetFilters,
  type PaginationOptions,
  type SortOptions,
  type SortField,
  type SortDirection,
} from "./tweetStore.js";
import { askTweetDecision, MalformedResponseError, type FewShotExample } from "./gptClient.js";

const PORT = Number(process.env.PORT) || 4000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const RESPONSE_ID_KEY = "previousResponseId";
const app = express();
const store = createTweetStore();

function loadFewShotExamples(): FewShotExample[] {
  const goldExamples = store.getGoldExamples();
  return goldExamples.map(ex => ({
    tweetText: ex.text,
    response: ex.quote,
    correction: ex.goldExampleCorrection ?? undefined,
    type: ex.goldExampleType!,
  }));
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// returns tweets with pagination (for admin.html)
app.get("/api/tweets", (req, res) => {
  const password = req.query.password as string;
  const authorized = !ADMIN_PASSWORD || password === ADMIN_PASSWORD;

  if (password && !authorized) {
    return res.status(401).send("Unauthorized: Invalid password.");
  }

  const { filters, pagination, sort } = parseFilters(req.query);
  // Public endpoint only shows tweets that have been processed by the model
  filters.hasModelDecision = true;
  const { tweets, total, page, pageSize } = store.list(filters, pagination, sort);

  const responseData = tweets.map((t) => ({
    ...t,
    quote: authorized || t.approved ? t.quote : "",
  }));

  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

  res.json({
    data: responseData,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  });
});

app.get("/api/admin/tweets", (req, res) => {
  const password = req.query.password as string;
  if (ADMIN_PASSWORD && password !== ADMIN_PASSWORD) {
    return res.status(401).send("Unauthorized: Invalid or missing password.");
  }

  const authorized = true;
  const { filters, pagination, sort } = parseFilters(req.query);
  const { tweets, total, page, pageSize } = store.list(filters, pagination, sort);

  const responseData = tweets.map((t) => ({
    ...t,
    quote: authorized || t.approved ? t.quote : "",
  }));

  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

  res.json({
    data: responseData,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  });
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

// process a single tweet through the AI model (for pending tweets)
app.post("/api/admin/tweets/:id/process", async (req, res) => {
  const { password } = req.body as { password?: string };

  if (ADMIN_PASSWORD && password !== ADMIN_PASSWORD) {
    return res.status(401).send("Unauthorized: Invalid or missing password.");
  }

  const tweet = store.get(req.params.id);
  if (!tweet) {
    return res.status(404).send("Tweet not found.");
  }

  if (tweet.approved !== null) {
    return res.status(400).send("Tweet already has a model decision.");
  }

  try {
    const fewShotExamples = loadFewShotExamples();
    const previousResponseId = store.getConfig(RESPONSE_ID_KEY);

    const { quote, approved, score, responseId } = await askTweetDecision(tweet.text, {
      examples: fewShotExamples,
      previousResponseId,
    });

    // Update conversation chain
    store.setConfig(RESPONSE_ID_KEY, responseId);

    store.save({
      id: tweet.id,
      text: tweet.text,
      url: tweet.url,
      quote: quote ?? "",
      approved,
      score,
    });

    res.json({ success: true, approved, quote, score });
  } catch (error) {
    if (error instanceof MalformedResponseError) {
      console.error("Malformed response from model:", error.message);
      return res.status(500).send(`Malformed AI response: ${error.message}`);
    }
    console.error("Error processing tweet:", error);
    res.status(500).send("Failed to process tweet through AI model.");
  }
});

// re-evaluate an already approved tweet
app.post("/tweets/:id/reeval", async (req, res) => {
  const { password } = (req.body ?? {}) as { password?: string };

  if (ADMIN_PASSWORD && password !== ADMIN_PASSWORD) {
    return res.status(401).send("Unauthorized: Invalid or missing password.");
  }

  const tweet = store.get(req.params.id);
  if (!tweet) {
    return res.status(404).send("Tweet not found.");
  }

  if (!tweet.approved) {
    return res.status(400).send("Cannot re-evaluate a rejected tweet.");
  }

  try {
    const fewShotExamples = loadFewShotExamples();
    const previousResponseId = store.getConfig(RESPONSE_ID_KEY);

    const { quote, approved, score, responseId } = await askTweetDecision(tweet.text, {
      examples: fewShotExamples,
      previousResponseId,
    });

    // Update conversation chain
    store.setConfig(RESPONSE_ID_KEY, responseId);

    if (!approved) {
      return res.status(500).send("Re-evaluation resulted in rejection");
    }

    store.save({
      id: tweet.id,
      text: tweet.text,
      url: tweet.url,
      quote,
      approved,
      score,
    });

    const updatedTweet = store.get(tweet.id);
    if (!updatedTweet) {
      return res
        .status(500)
        .send("Failed to load updated tweet after re-evaluation.");
    }

    res.json(updatedTweet);
  } catch (error) {
    if (error instanceof MalformedResponseError) {
      return res.status(500).send(`Malformed AI response: ${error.message}`);
    }
    const message =
      error instanceof Error ? error.message : "Unknown re-evaluation error";
    res.status(500).send(`Failed to re-evaluate tweet: ${message}`);
  }
});

// Set gold example status for a tweet
app.post("/api/admin/tweets/:id/gold-example", (req, res) => {
  const { type, password, correction } = req.body as {
    type?: string;
    password?: string;
    correction?: string;
  };

  if (ADMIN_PASSWORD && password !== ADMIN_PASSWORD) {
    return res.status(401).send("Unauthorized: Invalid or missing password.");
  }

  const normalized = normalizeGoldExampleType(type);
  if (type && !normalized) {
    return res.status(400).send("Invalid type. Use GOOD, BAD, or omit to clear.");
  }

  // BAD examples require a correction (the rejection reason)
  if (normalized === "BAD" && !correction) {
    return res.status(400).send("BAD examples require a correction (rejection reason).");
  }

  const tweet = store.get(req.params.id);
  if (!tweet) {
    return res.status(404).send("Tweet not found.");
  }

  // Only store correction for BAD examples, clear it otherwise
  const correctionToStore = normalized === "BAD" ? correction : null;
  store.setGoldExample(req.params.id, normalized, correctionToStore);
  res.json({ success: true, goldExampleType: normalized, goldExampleCorrection: correctionToStore });
});

// Get gold example counts (public)
app.get("/api/gold-examples/counts", (_req, res) => {
  const goodExamples = store.getGoldExamples("GOOD");
  const badExamples = store.getGoldExamples("BAD");

  res.json({
    good: goodExamples.length,
    bad: badExamples.length,
    maxPerType: 5,
    oldestGood: goodExamples.length > 0 ? goodExamples[goodExamples.length - 1]?.updatedAt : null,
    oldestBad: badExamples.length > 0 ? badExamples[badExamples.length - 1]?.updatedAt : null,
  });
});

// Get gold example counts (admin - same as public for now)
app.get("/api/admin/gold-examples/counts", (req, res) => {
  const password = req.query.password as string;
  if (ADMIN_PASSWORD && password !== ADMIN_PASSWORD) {
    return res.status(401).send("Unauthorized: Invalid or missing password.");
  }

  const goodExamples = store.getGoldExamples("GOOD");
  const badExamples = store.getGoldExamples("BAD");

  res.json({
    good: goodExamples.length,
    bad: badExamples.length,
    maxPerType: 5,
    oldestGood: goodExamples.length > 0 ? goodExamples[goodExamples.length - 1]?.updatedAt : null,
    oldestBad: badExamples.length > 0 ? badExamples[badExamples.length - 1]?.updatedAt : null,
  });
});

// Get all gold examples
app.get("/api/admin/gold-examples", (req, res) => {
  const password = req.query.password as string;
  if (ADMIN_PASSWORD && password !== ADMIN_PASSWORD) {
    return res.status(401).send("Unauthorized: Invalid or missing password.");
  }

  const type = req.query.type as string | undefined;
  const normalized = type ? normalizeGoldExampleType(type) : undefined;

  if (type && !normalized) {
    return res.status(400).send("Invalid type. Use GOOD or BAD.");
  }

  const examples = store.getGoldExamples(normalized ?? undefined);
  res.json({ data: examples });
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
  pagination: PaginationOptions;
  sort: SortOptions;
};

function parseFilters(query: any): FilterParseResult {
  const approvedParam =
    typeof query.approved === "string" ? query.approved : "all";
  const humanParam =
    typeof query.humanDecision === "string" ? query.humanDecision : "all";
  const goldParam =
    typeof query.goldExample === "string" ? query.goldExample : "all";
  const pageParam = typeof query.page === "string" ? query.page : undefined;
  const pageSizeParam =
    typeof query.pageSize === "string" ? query.pageSize : undefined;
  const orderByParam =
    typeof query.orderBy === "string" ? query.orderBy : undefined;
  const orderDirParam =
    typeof query.orderDir === "string" ? query.orderDir : undefined;

  const filters: TweetFilters = {};

  if (approvedParam === "true" || approvedParam === "false") {
    filters.approved = approvedParam === "true";
  } else if (approvedParam === "pending") {
    filters.hasModelDecision = false;
  }

  if (
    humanParam === "APPROVED" ||
    humanParam === "REJECTED" ||
    humanParam === "UNSET"
  ) {
    filters.humanDecision = humanParam as TweetFilters["humanDecision"];
  }

  if (goldParam === "GOOD" || goldParam === "BAD") {
    filters.goldExampleType = goldParam as TweetFilters["goldExampleType"];
  } else if (goldParam === "ANY") {
    filters.hasGoldExample = true;
  } else if (goldParam === "NONE") {
    filters.hasGoldExample = false;
  }

  const pagination: PaginationOptions = {};
  const parsedPage = parsePositiveInteger(pageParam);
  const parsedPageSize = parsePositiveInteger(pageSizeParam);

  if (parsedPage) pagination.page = parsedPage;
  if (parsedPageSize) pagination.pageSize = parsedPageSize;

  const sort: SortOptions = {};
  if (orderByParam === "score" || orderByParam === "createdAt" || orderByParam === "updatedAt") {
    sort.orderBy = orderByParam as SortField;
  }
  if (orderDirParam === "asc" || orderDirParam === "desc") {
    sort.orderDir = orderDirParam as SortDirection;
  }

  return { filters, pagination, sort };
}

function normalizeDecision(value?: string): HumanDecision | null {
  if (value === "APPROVED" || value === "REJECTED") {
    return value;
  }
  return null;
}

function normalizeGoldExampleType(value?: string): GoldExampleType | null {
  if (value === "GOOD" || value === "BAD") {
    return value;
  }
  return null;
}

function parsePositiveInteger(value?: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}
