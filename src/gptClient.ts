import OpenAI from "openai";
import { prompt as systemPrompt } from "./prompt.js";

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
};

export async function askTweetDecision(
  tweetText: string
): Promise<AskTweetDecisionResult> {
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

  return { quote, approved };
}
