import OpenAI from "openai";
import { prompt as basePrompt, buildPromptWithExamples, type FewShotExample } from "./prompt.js";

const openAiClient = new OpenAI({ apiKey: assertApiKey() });

function assertApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }
  return key;
}

export type AskTweetDecisionResult = {
  quote: string;
  approved: boolean;
  score: number;  // Percentile 0-100
  responseId: string;  // For conversation chain persistence
};

export type AskTweetDecisionOptions = {
  examples?: FewShotExample[];
  previousResponseId?: string | null;  // For conversation memory chain
};

export class MalformedResponseError extends Error {
  constructor(message: string, public rawResponse: string) {
    super(message);
    this.name = "MalformedResponseError";
  }
}

export async function askTweetDecision(
  tweetText: string,
  options: AskTweetDecisionOptions = {}
): Promise<AskTweetDecisionResult> {
  const { examples, previousResponseId } = options;

  const systemPrompt = examples?.length
    ? buildPromptWithExamples(examples)
    : basePrompt;

  const response = await openAiClient.responses.create({
    model: "gpt-5.1",
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: tweetText },
    ],
    reasoning: {
      effort: "high",
    },
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
  });

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
      throw new MalformedResponseError(
        `Percentile must be 0-100, got: ${score}`,
        quote
      );
    }
  }

  return { quote, approved: isApproved, score, responseId: response.id };
}

export { type FewShotExample } from "./prompt.js";
