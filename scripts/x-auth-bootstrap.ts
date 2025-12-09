#!/usr/bin/env npx tsx
import "dotenv/config";
/**
 * 3-Legged OAuth 1.0a Flow using OOB (Out-of-Band) PIN method
 *
 * This generates access tokens for the X API. Run once to get tokens,
 * then add them to your .env file.
 *
 * Required env vars:
 *   X_API_KEY      - Your app's API Key (Consumer Key)
 *   X_API_SECRET   - Your app's API Secret (Consumer Secret)
 *
 * Output:
 *   X_ACCESS_TOKEN        - Add to .env
 *   X_ACCESS_TOKEN_SECRET - Add to .env
 */

import { TwitterApi } from "twitter-api-v2";
import * as readline from "readline";

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log("🔐 X API OAuth 1.0a Bootstrap (OOB/PIN Flow)");
  console.log("=".repeat(50));
  console.log();

  const apiKey = process.env.X_API_KEY;
  const apiSecret = process.env.X_API_SECRET;

  if (!apiKey || !apiSecret) {
    console.error("❌ Missing credentials. Set these env vars:");
    console.error("   X_API_KEY=your_api_key");
    console.error("   X_API_SECRET=your_api_secret");
    process.exit(1);
  }

  try {
    // Step 1: Create client and get request token
    console.log("📝 Step 1: Requesting authorization link...");
    const client = new TwitterApi({
      appKey: apiKey,
      appSecret: apiSecret,
    });

    const authLink = await client.generateAuthLink("oob");

    console.log();
    console.log("✅ Authorization URL generated!");
    console.log();
    console.log("📋 INSTRUCTIONS:");
    console.log("1. Open this URL in your browser:");
    console.log(`   ${authLink.url}`);
    console.log();
    console.log("2. Sign in with the account you want to authorize");
    console.log("3. Click 'Authorize app'");
    console.log("4. Copy the PIN code shown on the page");
    console.log();

    // Step 2: Get PIN from user
    const pin = await prompt("📥 Enter the PIN: ");

    if (!pin) {
      console.error("❌ No PIN provided");
      process.exit(1);
    }

    // Step 3: Exchange PIN for access tokens
    console.log();
    console.log("🔄 Exchanging PIN for access tokens...");

    const loginClient = new TwitterApi({
      appKey: apiKey,
      appSecret: apiSecret,
      accessToken: authLink.oauth_token,
      accessSecret: authLink.oauth_token_secret,
    });

    const { accessToken, accessSecret, screenName, userId } =
      await loginClient.login(pin);

    console.log();
    console.log("✅ Authorization successful!");
    console.log(`👤 Authorized account: @${screenName} (ID: ${userId})`);
    console.log();
    console.log("📋 Add these to your .env file:");
    console.log("-".repeat(50));
    console.log(`X_ACCESS_TOKEN=${accessToken}`);
    console.log(`X_ACCESS_TOKEN_SECRET=${accessSecret}`);
    console.log("-".repeat(50));
    console.log();
    console.log("🎉 Done! You can now use --source x-api");

  } catch (error) {
    console.error();
    console.error("❌ OAuth flow failed:", error);
    process.exit(1);
  }
}

main();
