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
  score: number;
};

export type AskTweetDecisionOptions = {
  examples?: FewShotExample[];
};

export async function askTweetDecision(
  tweetText: string,
  options: AskTweetDecisionOptions = {}
): Promise<AskTweetDecisionResult> {
  const systemPrompt = options.examples?.length
    ? buildPromptWithExamples(options.examples)
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
  });

  const quote = response.output_text?.trim() ?? "";
  const approved = !quote.startsWith("Rejected");
  const scoreMatch = quote.match(/Score: (\d+)/);
  const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;

  return { quote, approved, score };
}

export { type FewShotExample } from "./prompt.js";
