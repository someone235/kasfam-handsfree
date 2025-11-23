import express from "express";
import {
  createTweetStore,
  type HumanDecision,
  type TweetFilters,
  type TweetRecord,
} from "./tweetStore.js";

const PORT = Number(process.env.PORT) || 4000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const app = express();
const store = createTweetStore();

app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  const { filters, rawApproved, rawHumanDecision } = parseFilters(req.query);
  const tweets = store.list(filters);
  res.send(
    renderPage(tweets, rawApproved, rawHumanDecision, req.originalUrl || "/")
  );
});

app.post("/tweets/:id/human-decision", (req, res) => {
  const { decision, redirect, password } = req.body as {
    decision?: string;
    redirect?: string;
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
  res.redirect(sanitizeRedirect(redirect));
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
  rawApproved: string;
  rawHumanDecision: string;
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

  return { filters, rawApproved: approvedParam, rawHumanDecision: humanParam };
}

function normalizeDecision(value?: string): HumanDecision | null {
  if (value === "APPROVED" || value === "REJECTED") {
    return value;
  }
  return null;
}

function sanitizeRedirect(value?: string) {
  if (typeof value === "string" && value.startsWith("/")) {
    return value;
  }
  return "/";
}

function renderPage(
  tweets: TweetRecord[],
  approvedFilter: string,
  humanFilter: string,
  redirectTarget: string
) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Kaspa Tweets</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; background: #0f172a; color: #e2e8f0; }
    a { color: #38bdf8; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { border: 1px solid #1e293b; padding: 0.5rem; vertical-align: top; }
    th { background: #1e293b; }
    tr:nth-child(even) { background: rgba(15, 23, 42, 0.6); }
    form { margin: 0; }
    select, button { font: inherit; }
    .filters { display: flex; gap: 1rem; align-items: center; }
    .filters select { min-width: 10rem; }
    .quote { white-space: pre-line; }
    .decision-form { display: flex; gap: 0.5rem; align-items: center; }
  </style>
</head>
<body>
  <h1>Kaspa Tweet Decisions</h1>
  <form class="filters" method="get">
    <label>
      Model approved:
      <select name="approved">
        ${renderOption("all", "All", approvedFilter)}
        ${renderOption("true", "Approved", approvedFilter)}
        ${renderOption("false", "Rejected", approvedFilter)}
      </select>
    </label>
    <label>
      Human decision:
      <select name="humanDecision">
        ${renderOption("all", "All", humanFilter)}
        ${renderOption("APPROVED", "Approved", humanFilter)}
        ${renderOption("REJECTED", "Rejected", humanFilter)}
        ${renderOption("UNSET", "Unset", humanFilter)}
      </select>
    </label>
    <button type="submit">Apply Filters</button>
  </form>

  <div style="margin-top: 1rem;">
    <label>
      Admin Password:
      <input type="password" id="admin-password" placeholder="Enter password" />
    </label>
  </div>

  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Tweet</th>
        <th>Quote</th>
        <th>URL</th>
        <th>Model Approved</th>
        <th>Human Decision</th>
        <th>Created</th>
      </tr>
    </thead>
    <tbody>
      ${tweets.map((tweet) => renderRow(tweet, redirectTarget)).join("")}
    </tbody>
  </table>

  <script>
    (function() {
      const passwordInput = document.getElementById('admin-password');
      
      // Load from local storage
      const saved = localStorage.getItem('kasfam_admin_password');
      if (saved) {
        passwordInput.value = saved;
        document.querySelectorAll('.hidden-password').forEach(el => {
          el.value = saved;
        });
      }

      // Save to local storage and update hidden fields
      passwordInput.addEventListener('input', (e) => {
        const val = e.target.value;
        localStorage.setItem('kasfam_admin_password', val);
        document.querySelectorAll('.hidden-password').forEach(el => {
          el.value = val;
        });
      });

      // Ensure the password sent is always the one in the input (safety net)
      document.querySelectorAll('.decision-form').forEach(form => {
        form.addEventListener('submit', () => {
          const hidden = form.querySelector('.hidden-password');
          hidden.value = passwordInput.value;
        });
      });
    })();
  </script>
</body>
</html>`;
}

function renderRow(tweet: TweetRecord, redirect: string) {
  const decisionValue = tweet.humanDecision ?? "";
  return `<tr>
    <td>${escapeHtml(tweet.id)}</td>
    <td>${escapeHtml(tweet.text)}</td>
    <td class="quote">${escapeHtml(tweet.quote)}</td>
    <td><a href="${escapeAttribute(
      tweet.url
    )}" target="_blank" rel="noreferrer">link</a></td>
    <td>${tweet.approved ? "✅" : "❌"}</td>
    <td>
      <form class="decision-form" method="post" action="/tweets/${encodeURIComponent(
        tweet.id
      )}/human-decision">
        <select name="decision" required>
          <option value="" disabled ${
            decisionValue ? "" : "selected"
          }>Choose…</option>
          <option value="APPROVED" ${
            decisionValue === "APPROVED" ? "selected" : ""
          }>APPROVED</option>
          <option value="REJECTED" ${
            decisionValue === "REJECTED" ? "selected" : ""
          }>REJECTED</option>
        </select>
        <input type="hidden" name="redirect" value="${escapeAttribute(
          redirect
        )}" />
        <input type="hidden" name="password" class="hidden-password" />
        <button type="submit">Save</button>
      </form>
    </td>
    <td>${escapeHtml(new Date(tweet.createdAt).toLocaleString())}</td>
  </tr>`;
}

function renderOption(value: string, label: string, current: string) {
  const selected = value === current ? "selected" : "";
  return `<option value="${value}" ${selected}>${label}</option>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value);
}
