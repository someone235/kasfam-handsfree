import express from "express";
import path from "path";
import {
  createTweetStore,
  type HumanDecision,
  type TweetFilters,
  type PaginationOptions,
} from "./tweetStore.js";

const PORT = Number(process.env.PORT) || 4000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const app = express();
const store = createTweetStore();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/api/tweets", (req, res) => {
  const password = req.query.password as string;
  const authorized = ADMIN_PASSWORD && password == ADMIN_PASSWORD;

  if (password && !authorized) {
    return res.status(401).send("Unauthorized: Invalid password.");
  }

  const { filters, pagination } = parseFilters(req.query);
  const { tweets, total, page, pageSize } = store.list(filters, pagination);

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
};

function parseFilters(query: any): FilterParseResult {
  const approvedParam =
    typeof query.approved === "string" ? query.approved : "all";
  const humanParam =
    typeof query.humanDecision === "string" ? query.humanDecision : "all";
  const pageParam = typeof query.page === "string" ? query.page : undefined;
  const pageSizeParam =
    typeof query.pageSize === "string" ? query.pageSize : undefined;

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

  const pagination: PaginationOptions = {};
  const parsedPage = parsePositiveInteger(pageParam);
  const parsedPageSize = parsePositiveInteger(pageSizeParam);

  if (parsedPage) pagination.page = parsedPage;
  if (parsedPageSize) pagination.pageSize = parsedPageSize;

  return { filters, pagination };
}

function normalizeDecision(value?: string): HumanDecision | null {
  if (value === "APPROVED" || value === "REJECTED") {
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
