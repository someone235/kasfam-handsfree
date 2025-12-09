import { TwitterApi } from "twitter-api-v2";

export type XTweet = {
  id: string;
  text: string;
  url: string;
  author: {
    username: string;
  };
};

type SearchOptions = {
  query?: string;
  maxResults?: number;
};

type OAuth1Credentials = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

const DEFAULT_QUERY = "kaspa -from:kaspaunchained -is:retweet lang:en";
const DEFAULT_MAX_RESULTS = 100;

function getCredentials(): OAuth1Credentials {
  const apiKey = process.env.X_API_KEY;
  const apiSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;

  const missing: string[] = [];
  if (!apiKey) missing.push("X_API_KEY");
  if (!apiSecret) missing.push("X_API_SECRET");
  if (!accessToken) missing.push("X_ACCESS_TOKEN");
  if (!accessTokenSecret) missing.push("X_ACCESS_TOKEN_SECRET");

  if (missing.length > 0) {
    throw new Error(
      `Missing X API credentials: ${missing.join(", ")}. ` +
      "Run the OAuth flow to generate access tokens."
    );
  }

  return {
    apiKey: apiKey!,
    apiSecret: apiSecret!,
    accessToken: accessToken!,
    accessTokenSecret: accessTokenSecret!,
  };
}

export function createXClient(credentials?: OAuth1Credentials) {
  const creds = credentials ?? getCredentials();

  const client = new TwitterApi({
    appKey: creds.apiKey,
    appSecret: creds.apiSecret,
    accessToken: creds.accessToken,
    accessSecret: creds.accessTokenSecret,
  });

  const readOnlyClient = client.readOnly;

  async function searchTweets(options: SearchOptions = {}): Promise<XTweet[]> {
    const query = options.query ?? DEFAULT_QUERY;
    const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;

    const result = await readOnlyClient.v2.search(query, {
      max_results: Math.min(maxResults, 100),
      "tweet.fields": ["author_id", "created_at"],
      expansions: ["author_id"],
      "user.fields": ["username"],
    });

    const users = new Map<string, string>();
    if (result.includes?.users) {
      for (const user of result.includes.users) {
        users.set(user.id, user.username);
      }
    }

    const tweets: XTweet[] = [];
    for (const tweet of result.data?.data ?? []) {
      const username = users.get(tweet.author_id ?? "") ?? "unknown";
      tweets.push({
        id: tweet.id,
        text: tweet.text,
        url: `https://x.com/${username}/status/${tweet.id}`,
        author: { username },
      });
    }

    return tweets;
  }

  async function getTweetsByIds(ids: string[]): Promise<XTweet[]> {
    if (ids.length === 0) {
      return [];
    }

    // Twitter API v2 supports up to 100 IDs per request
    const result = await readOnlyClient.v2.tweets(ids, {
      "tweet.fields": ["author_id", "created_at"],
      expansions: ["author_id"],
      "user.fields": ["username"],
    });

    const users = new Map<string, string>();
    if (result.includes?.users) {
      for (const user of result.includes.users) {
        users.set(user.id, user.username);
      }
    }

    const tweets: XTweet[] = [];
    for (const tweet of result.data ?? []) {
      const username = users.get(tweet.author_id ?? "") ?? "unknown";
      tweets.push({
        id: tweet.id,
        text: tweet.text,
        url: `https://x.com/${username}/status/${tweet.id}`,
        author: { username },
      });
    }

    return tweets;
  }

  return {
    searchTweets,
    getTweetsByIds,
  };
}

export type XClient = ReturnType<typeof createXClient>;
