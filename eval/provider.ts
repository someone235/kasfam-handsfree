import OpenAI from "openai";
import type {
  ApiProvider,
  ProviderOptions,
  ProviderResponse,
  CallApiContextParams,
} from "promptfoo";
import { config as dotenvConfig } from "dotenv";

export default class TypedProvider implements ApiProvider {
  protected providerId: string;
  public config: Record<string, unknown>;

  // tied to openai, but later allow further expansion onto other LLM provider
  public openAIClient: OpenAI;

  constructor(options: ProviderOptions) {
    dotenvConfig();
    this.providerId = options.id || "eval-provider";
    this.config = options.config || {};
    this.openAIClient = new OpenAI();
  }

  id(): string {
    return this.providerId;
  }

  async callApi(
    prompt: string,
    context?: CallApiContextParams,
  ): Promise<ProviderResponse> {
    const tweetText = context?.vars?.tweet;

    if (!tweetText || typeof tweetText !== "string") {
      throw new Error(
        "Test cases should have 'tweet' variable defined as string.",
      );
    }

    const response = await this.openAIClient.responses.create({
      model: "gpt-5.1",
      input: [
        { role: "system", content: prompt },
        { role: "user", content: tweetText },
      ],
      reasoning: {
        effort: "high",
      },
    });

    return {
      output: response.output_text,
      tokenUsage: {
        total: response.usage?.total_tokens,
        prompt: response.usage?.input_tokens,
        completion: response.usage?.output_tokens,
      },
    };
  }
}
