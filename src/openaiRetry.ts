import OpenAI from "openai";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 3000;

function isRateLimitError(error: unknown): boolean {
  return error instanceof OpenAI.APIError && error.status === 429;
}

function isQuotaOrBillingError(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) {
    return false;
  }

  const code = String(error.code ?? "").toLowerCase();
  const type = String(error.type ?? "").toLowerCase();
  const message = String(error.message ?? "").toLowerCase();

  return (
    code.includes("insufficient_quota") ||
    code.includes("billing_hard_limit_reached") ||
    type.includes("insufficient_quota") ||
    type.includes("billing_hard_limit_reached") ||
    message.includes("insufficient_quota") ||
    message.includes("billing") ||
    message.includes("hard limit")
  );
}

function extractRetryDelayMs(error: unknown): number {
  const message = error instanceof OpenAI.APIError ? String(error.message ?? "") : "";
  const match = message.match(/try again in ([\d.]+)s/i);
  if (match) {
    return Math.max(0, Math.ceil(parseFloat(match[1]) * 1000));
  }
  return BASE_DELAY_MS;
}

export async function withRetry<T>(operation: () => Promise<T>, context: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRateLimitError(error)) {
        throw error;
      }

      if (isQuotaOrBillingError(error)) {
        throw error;
      }

      if (attempt === MAX_RETRIES) {
        break;
      }

      const delay = extractRetryDelayMs(error);
      console.log(
        `  Rate limited (${context}), waiting ${delay}ms before retry ${attempt + 1}/${MAX_RETRIES}...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
