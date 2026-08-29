import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "../../../saleor-app";
import { gql } from "urql";
import { getOrder, refundCapture, PayPalError } from "../../../lib/paypal";

type TransactionRefundRequestedPayloadFragment = any;

const TransactionRefundRequestedPayload = gql`
  fragment TransactionRefundRequestedPayload on TransactionRefundRequested {
    action {
      amount
      currency
      actionType
    }
    transaction {
      id
      pspReference
      events {
        pspReference
        amount
        currency
        type
        data
      }
    }
  }
`;

const TransactionRefundRequestedSubscription = gql`
  ${TransactionRefundRequestedPayload}
  subscription TransactionRefundRequested {
    event {
      ...TransactionRefundRequestedPayload
    }
  }
`;

export const transactionRefundRequestedWebhook =
  new SaleorSyncWebhook<TransactionRefundRequestedPayloadFragment>({
    name: "PayPal Transaction Refund",
    webhookPath: "/api/webhooks/transaction-refund-requested",
    event: "TRANSACTION_REFUND_REQUESTED",
    apl: saleorApp.apl,
    query: TransactionRefundRequestedSubscription,
  });

export default transactionRefundRequestedWebhook.createHandler(
  async (req, res, ctx) => {
    const { payload, authData } = ctx;
    const { action, transaction } = payload;

    console.log("=== REFUND WEBHOOK HIT ===");
    console.log("Saleor URL:", authData.saleorApiUrl);
    console.log("Action:", action);
    console.log("Transaction PSP Ref:", transaction?.pspReference);
    console.log("Transaction Events:", JSON.stringify(transaction?.events));

    try {
      // ── 1. Validate action type ──
      if (action.actionType !== "REFUND") {
        console.log("ACTION TYPE REJECTED:", action.actionType);
        return res.status(200).json({
          result: "REFUND_FAILURE",
          amount: action.amount,
          pspReference: transaction?.pspReference || "unknown",
          message: `Unsupported action: ${action.actionType}`,
        });
      }

      if (action.amount <= 0) {
        console.log("INVALID REFUND AMOUNT:", action.amount);
        return res.status(200).json({
          result: "REFUND_FAILURE",
          amount: action.amount,
          pspReference: transaction?.pspReference || "unknown",
          message: `Invalid refund amount: ${action.amount}`,
        });
      }

      // ── 2. Find PayPal capture ID ──
      //    First: check CHARGE_SUCCESS event data (stored during process)
      //    Fallback: fetch PayPal order and extract from captures
      let captureId: string | null = null;

      for (const event of transaction?.events || []) {
        if (event.type === "CHARGE_SUCCESS" && event.data?.paypalCaptureId) {
          captureId = event.data.paypalCaptureId;
          console.log("Found capture ID from event data:", captureId);
          break;
        }
      }

      if (!captureId && transaction?.pspReference) {
        console.log(
          "Capture ID not in events, fetching from PayPal:",
          transaction.pspReference
        );
        try {
          const order = await getOrder(transaction.pspReference);
          captureId =
            order.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? null;
          console.log("Fetched capture ID from PayPal:", captureId);
        } catch (err) {
          console.error(
            "[REFUND] Failed to fetch PayPal order for capture ID:",
            err
          );
        }
      }

      if (!captureId) {
        console.log("COULD NOT FIND CAPTURE ID");
        return res.status(200).json({
          result: "REFUND_FAILURE",
          amount: action.amount,
          pspReference: transaction?.pspReference || "unknown",
          message: "Could not find PayPal capture ID for refund",
        });
      }

      // ── 3. Issue refund ──
      console.log("Issuing refund:", {
        captureId,
        amount: action.amount,
        currency: action.currency,
      });

      const refund = await refundCapture(
        captureId,
        String(action.amount),
        action.currency
      );

      console.log("✅ REFUND SUCCESS:", {
        refundId: refund.id,
        status: refund.status,
        amount: `${refund.amount.currency_code} ${refund.amount.value}`,
      });

      return res.status(200).json({
        result: "REFUND_SUCCESS",
        amount: parseFloat(refund.amount.value),
        pspReference: transaction?.pspReference,
        data: {
          paypalRefundId: refund.id,
          paypalCaptureId: captureId,
          paypalRefundStatus: refund.status,
        },
      });
    } catch (error) {
      console.error("❌ PayPal refund failed:", error);

      const message =
        error instanceof PayPalError
          ? `PayPal: ${error.message}`
          : "Internal processing error";

      return res.status(200).json({
        result: "REFUND_FAILURE",
        amount: action.amount,
        pspReference: transaction?.pspReference || `fail_${Date.now()}`,
        message,
      });
    }
  }
);

export const config = {
  api: { bodyParser: false },
};