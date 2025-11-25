import OpenAI from "openai";
import { prompt as systemPrompt } from "./prompt.js";

let openAiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openAiClient) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error("Missing OPENAI_API_KEY environment variable.");
    }
    openAiClient = new OpenAI({ apiKey: key });
  }
  return openAiClient;
}

export type AskResult = {
  quote?: string;
  approved: boolean;
};

export async function askModel(tweetText: string): Promise<AskResult> {
  const client = getClient();
  
  const response = await client.responses.create({
    model: "gpt-5.1",
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: tweetText },
    ],
    reasoning: {
      effort: "high",
    }
  });

  const quote = response.output_text?.trim();
  const approved = !quote?.startsWith("Rejected");
  return {
    quote,
    approved,
  };
}

