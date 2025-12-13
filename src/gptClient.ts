import OpenAI from "openai";
import {
  prompt as basePrompt,
  buildPromptWithExamples,
  quickFilterPrompt,
  type FewShotExample,
} from "./prompt.js";

const openAiClient = new OpenAI({ apiKey: assertApiKey() });

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 3000;

function assertApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }
  return key;
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof OpenAI.APIError && error.status === 429) {
    return true;
  }
  return false;
}

function extractRetryDelay(error: unknown): number {
  if (error instanceof OpenAI.APIError && error.message) {
    const match = error.message.match(/try again in ([\d.]+)s/i);
    if (match) {
      return Math.ceil(parseFloat(match[1]) * 1000);
    }
  }
  return BASE_DELAY_MS;
}

async function withRetry<T>(operation: () => Promise<T>, context: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRateLimitError(error)) {
        throw error;
      }

      if (attempt === MAX_RETRIES) {
        break;
      }

      const delay = extractRetryDelay(error);
      console.log(
        `  Rate limited (${context}), waiting ${delay}ms before retry ${attempt + 1}/${MAX_RETRIES}...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export interface AskTweetDecisionResult {
  quote: string;
  approved: boolean;
  score: number; // Percentile 0-100
  responseId: string; // For conversation chain persistence
}

export interface AskTweetDecisionOptions {
  examples?: FewShotExample[];
  previousResponseId?: string | null; // For conversation memory chain
}

export interface QuickFilterResult {
  approved: boolean;
  rejectionReason?: string;
}

export class MalformedResponseError extends Error {
  constructor(
    message: string,
    public rawResponse: string
  ) {
    super(message);
    this.name = "MalformedResponseError";
  }
}

export async function askTweetDecision(
  tweetText: string,
  options: AskTweetDecisionOptions = {}
): Promise<AskTweetDecisionResult> {
  const { examples, previousResponseId } = options;

  const systemPrompt = examples?.length ? buildPromptWithExamples(examples) : basePrompt;

  const response = await withRetry(
    () =>
      openAiClient.responses.create({
        model: "gpt-5.1",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: tweetText },
        ],
        reasoning: {
          effort: "high",
        },
        truncation: "auto",
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      }),
    "R2 full evaluation"
  );

  const quote = response.output_text?.trim() ?? "";

  // Validate response format
  if (!quote) {
    throw new MalformedResponseError("Empty response from model", quote);
  }

  // Must start with "Approved" or "Rejected" (case-sensitive as per prompt)
  const isApproved = quote.startsWith("Approved");
  const isRejected = quote.startsWith("Rejected");

  if (!isApproved && !isRejected) {
    throw new MalformedResponseError(
      `Response must start with "Approved" or "Rejected", got: "${quote.slice(0, 50)}..."`,
      quote
    );
  }

  // Parse percentile for approved tweets
  let score = 0;
  if (isApproved) {
    const percentileMatch = quote.match(/Percentile:\s*(\d+)/i);
    if (!percentileMatch) {
      throw new MalformedResponseError(
        `Approved response missing Percentile field: "${quote.slice(0, 100)}..."`,
        quote
      );
    }
    score = parseInt(percentileMatch[1], 10);
    if (score < 0 || score > 100) {
      throw new MalformedResponseError(`Percentile must be 0-100, got: ${score}`, quote);
    }
  }

  return { quote, approved: isApproved, score, responseId: response.id };
}

export async function quickFilterTweet(tweetText: string): Promise<QuickFilterResult> {
  const response = await withRetry(
    () =>
      openAiClient.responses.create({
        model: "gpt-5.1",
        input: [
          { role: "system", content: quickFilterPrompt },
          { role: "user", content: tweetText },
        ],
        reasoning: {
          effort: "low",
        },
      }),
    "R1 quick filter"
  );

  const output = response.output_text?.trim() ?? "";

  if (!output) {
    throw new MalformedResponseError("Empty response from quick filter", output);
  }

  const isApproved = output.startsWith("Approved");
  const isRejected = output.startsWith("Rejected");

  if (!isApproved && !isRejected) {
    throw new MalformedResponseError(
      `Quick filter response must start with "Approved" or "Rejected", got: "${output.slice(0, 50)}..."`,
      output
    );
  }

  return {
    approved: isApproved,
    rejectionReason: isApproved ? undefined : output.replace(/^Rejected:\s*/i, "").trim(),
  };
}

export { type FewShotExample } from "./prompt.js";
