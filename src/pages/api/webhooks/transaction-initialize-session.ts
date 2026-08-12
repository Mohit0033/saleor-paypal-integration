import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "../../../saleor-app";
import { gql } from "urql";
import { razorpay } from "../../../lib/razorpay";

// Fallback type if codegen hasn't run (e.g. Docker build)
type TransactionInitializeSessionPayloadFragment = any;

const TransactionInitializeSessionPayload = gql`
  fragment TransactionInitializeSessionPayload on TransactionInitializeSession {
    action {
      amount
      currency
      actionType
    }
    data
    transaction {
      id
      name
      checkout {
        id
        email
        billingAddress {
          firstName
          lastName
          phone
        }
      }
    }
  }
`;

const TransactionInitializeSessionSubscription = gql`
  ${TransactionInitializeSessionPayload}
  subscription TransactionInitializeSession {
    event {
      ...TransactionInitializeSessionPayload
    }
  }
`;

export const transactionInitializeSessionWebhook =
  new SaleorSyncWebhook<TransactionInitializeSessionPayloadFragment>({
    name: "Razorpay Transaction Initialize",
    webhookPath: "/api/webhooks/transaction-initialize-session",
    event: "TRANSACTION_INITIALIZE_SESSION",
    apl: saleorApp.apl,
    query: TransactionInitializeSessionSubscription,
  });

export default transactionInitializeSessionWebhook.createHandler(
  async (req, res, ctx) => {
    const { payload, authData } = ctx;
    const { action, transaction } = payload;

    // Allowlist guard — reject unauthorized Saleor instances
    const ALLOWED_SALEOR_URL = process.env.ALLOWED_SALEOR_URL;
    if (ALLOWED_SALEOR_URL && authData.saleorApiUrl !== ALLOWED_SALEOR_URL) {
      console.error("Rejected unauthorized Saleor:", authData.saleorApiUrl);
      return res.status(403).json({ error: "Unauthorized Saleor instance" });
    }

    // Validate action type
    if (action.actionType !== "CHARGE") {
      return res.status(200).json({
        result: "CHARGE_FAILURE",
        amount: action.amount,
        pspReference: transaction?.pspReference || "unknown",
        message: "Only CHARGE strategy supported",
      });
    }

    try {
      const amountInPaise = Math.round(action.amount * 100);

      const order = await razorpay.orders.create({
        amount: amountInPaise,
        currency: action.currency,
        receipt: transaction?.id?.slice(-20) || `rcpt_${Date.now()}`,
        notes: {
          saleor_transaction_id: transaction?.id || "",
          saleor_checkout_id: transaction?.checkout?.id || "",
        },
      });

      return res.status(200).json({
        result: "CHARGE_ACTION_REQUIRED",
        amount: action.amount,
        pspReference: order.id,
        data: {
          razorpayOrderId: order.id,
          razorpayKeyId: process.env.RAZORPAY_KEY_ID,
          amount: amountInPaise,
          currency: action.currency,
          name: transaction?.name || "Saleor Store",
          prefill: {
            name: transaction?.checkout?.billingAddress
              ? `${transaction.checkout.billingAddress.firstName} ${transaction.checkout.billingAddress.lastName}`
              : undefined,
            contact: transaction?.checkout?.billingAddress?.phone || undefined,
            email: transaction?.checkout?.email || undefined,
          },
        },
      });
    } catch (error) {
      console.error("Razorpay order creation failed:", error);
      return res.status(200).json({
        result: "CHARGE_FAILURE",
        amount: action.amount,
        pspReference: `fail_${Date.now()}`,
        message: "Failed to create Razorpay order",
      });
    }
  }
);

export const config = {
  api: { bodyParser: false },
};