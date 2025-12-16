import OpenAI from "openai";
import {
  prompt as basePrompt,
  buildPromptWithExamples,
  quickFilterPrompt,
  type FewShotExample,
} from "./prompt.js";
import { withRetry } from "./openaiRetry.js";

const openAiClient = new OpenAI({ apiKey: assertApiKey() });

function assertApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }
  return key;
}

export interface AskTweetDecisionResult {
  quote: string;
  approved: boolean;
  score: number; // Percentile 0-100
  responseId: string; // OpenAI response id
}

export interface AskTweetDecisionOptions {
  examples?: FewShotExample[];
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
  const { examples } = options;

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
