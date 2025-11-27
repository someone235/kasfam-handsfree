import type { PromptFunction } from "promptfoo";
import { prompt } from "../src/prompt";

const promptFunction: PromptFunction = async ({ vars, provider }) => {
  return prompt;
};

export default promptFunction;
