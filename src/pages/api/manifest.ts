import { createManifestHandler } from "@saleor/app-sdk/handlers/next";
import { AppManifest } from "@saleor/app-sdk/types";
import { transactionInitializeSessionWebhook } from "./webhooks/transaction-initialize-session";
import { transactionProcessSessionWebhook } from "./webhooks/transaction-process-session";

export default createManifestHandler({
  async manifestFactory({ appBaseUrl }) {
    const manifest: AppManifest = {
      name: "Razorpay Payment App",
      id: "saleor.app.razorpay",
      version: "1.0.0",
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