import OpenAI from "openai";
import { prompt as systemPrompt } from "./prompt.js";

function parseArgs(args: string[]) {
  const questionParts: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];

    if (current === "--question" || current === "-q") {
      const next = args[i + 1];
      if (!next) {
        throw new Error("--question requires a value");
      }
      questionParts.push(next);
      i += 1;
      continue;
    }

    if (current === "--help" || current === "-h") {
      printHelp();
      process.exit(0);
    }

    questionParts.push(current);
  }

  const question = questionParts.join(" ").trim();

  if (!question) {
    throw new Error(
      "Please provide a question (use --question or append it to the command)."
    );
  }

  return { question };
}

function printHelp() {
  console.log(`Usage: npm run dev -- [options] <question>

Options:
  -q, --question <text>   Question to ask GPT-5.1 (can also be passed as trailing args)
  -h, --help              Show this message
`);
}

function assertApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }
  return key;
}

async function main() {
  try {
    const { question } = parseArgs(process.argv.slice(2));
    const client = new OpenAI({ apiKey: assertApiKey() });

    console.info(`\nSending question to GPT-5.1...`);
    // console.info(`Prompt: ${systemPrompt}`);
    console.info(`Question: ${question}`);

    const response = await client.responses.create({
      model: "gpt-5.1",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
    });

    const text = response.output_text?.trim();

    if (!text) {
      console.warn("No textual output returned by the model.");
      if (response.output?.length) {
        console.dir(response.output, { depth: null });
      }
      process.exitCode = 2;
      return;
    }

    console.log("\n=== GPT-5.1 Response ===\n");
    console.log(text);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error("Unknown error", error);
    }
    process.exitCode = 1;
  }
}

main();
