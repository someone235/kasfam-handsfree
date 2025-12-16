import { TwitterApi } from "twitter-api-v2";

export interface XTweet {
  id: string;
  text: string;
  url: string;
  author: {
    username: string;
  };
}

interface SearchOptions {
  query?: string;
  maxResults?: number;
}

interface OAuth1Credentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

interface XClientMethods {
  searchTweets: (options?: SearchOptions) => Promise<XTweet[]>;
  getTweetsByIds: (ids: string[]) => Promise<XTweet[]>;
}

const DEFAULT_QUERY = "kaspa -from:kaspaunchained -is:retweet lang:en";
const DEFAULT_MAX_RESULTS = 100;

function getCredentials(): OAuth1Credentials {
  const apiKey = process.env.X_API_KEY;
  const apiSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;

  const missing: string[] = [];
  if (!apiKey) {
    missing.push("X_API_KEY");
  }
  if (!apiSecret) {
    missing.push("X_API_SECRET");
  }
  if (!accessToken) {
    missing.push("X_ACCESS_TOKEN");
  }
  if (!accessTokenSecret) {
    missing.push("X_ACCESS_TOKEN_SECRET");
  }

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

export function createXClient(credentials?: OAuth1Credentials): XClientMethods {
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

    if (maxResults <= 0) {
      return [];
    }

    const perRequest = Math.min(Math.max(maxResults, 10), 100);

    let paginator = await readOnlyClient.v2.search(query, {
      max_results: perRequest,
      "tweet.fields": ["author_id", "created_at"],
      expansions: ["author_id"],
      "user.fields": ["username"],
    });

    const tweets: XTweet[] = [];
    const seen = new Set<string>();

    const addPage = (page: typeof paginator): void => {
      const users = new Map<string, string>();
      for (const user of page.includes?.users ?? []) {
        users.set(user.id, user.username);
      }

      for (const tweet of page.data?.data ?? []) {
        if (tweets.length >= maxResults) {
          return;
        }
        if (seen.has(tweet.id)) {
          continue;
        }
        seen.add(tweet.id);
        const username = users.get(tweet.author_id ?? "") ?? "unknown";
        tweets.push({
          id: tweet.id,
          text: tweet.text,
          url: `https://x.com/${username}/status/${tweet.id}`,
          author: { username },
        });
      }
    };

    addPage(paginator);
    while (!paginator.done && tweets.length < maxResults) {
      paginator = await paginator.next(perRequest);
      addPage(paginator);
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
