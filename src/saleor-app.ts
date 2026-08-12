// src/saleor-app.ts
import { FileAPL } from "@saleor/app-sdk/APL";

let apl: any;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  try {
    const { UpstashAPL } = require("@saleor/app-sdk/APL");
    apl = new UpstashAPL({
      restURL: process.env.UPSTASH_REDIS_REST_URL,
      restToken: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    console.log("Using Upstash Redis APL");
  } catch {
    throw new Error("UpstashAPL not available. Run: pnpm add @saleor/app-sdk@latest");
  }
} else {
  apl = new FileAPL();
  console.log("Using FileAPL (local filesystem)");
}

export { apl };
export const saleorApp = { apl };