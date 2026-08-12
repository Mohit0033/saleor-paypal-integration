import { createManifestHandler } from "@saleor/app-sdk/handlers/next";
import { AppManifest } from "@saleor/app-sdk/types";
import { transactionInitializeSessionWebhook } from "./webhooks/transaction-initialize-session";
import { transactionProcessSessionWebhook } from "./webhooks/transaction-process-session";

export default createManifestHandler({
  async manifestFactory({ appBaseUrl }) {
    const manifest: AppManifest = {
      name: process.env.APP_NAME || "Razorpay Payment App",
      id: process.env.APP_IDENTIFIER || "saleor.app.razorpay",
      version: process.env.APP_VERSION || "1.0.0",
      appUrl: appBaseUrl,
      tokenTargetUrl: `${appBaseUrl}/api/register`,
      permissions: ["HANDLE_PAYMENTS"],
      webhooks: [
        transactionInitializeSessionWebhook.getWebhookManifest(appBaseUrl),
        transactionProcessSessionWebhook.getWebhookManifest(appBaseUrl),
      ],
    };

    return manifest;
  },
});