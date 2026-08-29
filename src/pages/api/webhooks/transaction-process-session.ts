import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "../../../saleor-app";
import { gql } from "urql";
import { captureOrder, PayPalError } from "../../../lib/paypal";

type TransactionProcessSessionPayloadFragment = any;

const TransactionProcessSessionPayload = gql`
  fragment TransactionProcessSessionPayload on TransactionProcessSession {
    action {
      amount
      currency
      actionType
    }
    data
    transaction {
      id
      pspReference
    }
  }
`;

const TransactionProcessSessionSubscription = gql`
  ${TransactionProcessSessionPayload}
  subscription TransactionProcessSession {
    event {
      ...TransactionProcessSessionPayload
    }
  }
`;

export const transactionProcessSessionWebhook =
  new SaleorSyncWebhook<TransactionProcessSessionPayloadFragment>({
    name: "PayPal Transaction Process",
    webhookPath: "/api/webhooks/transaction-process-session",
    event: "TRANSACTION_PROCESS_SESSION",
    apl: saleorApp.apl,
    query: TransactionProcessSessionSubscription,
  });

export default transactionProcessSessionWebhook.createHandler(
  async (req, res, ctx) => {
    const { payload, authData } = ctx;
    const { action, data, transaction } = payload;

    console.log("=== PROCESS WEBHOOK HIT ===");
    console.log("Action:", action.amount, action.currency, action.actionType);
    console.log("PSP Ref:", transaction?.pspReference);

    if (action.actionType !== "CHARGE") {
      console.log("ACTION TYPE REJECTED:", action.actionType);
      return res.status(200).json({
        result: "CHARGE_FAILURE",
        amount: String(action.amount),
        currency: action.currency,
        pspReference: transaction?.pspReference || "unknown",
        message: "Only CHARGE strategy supported",
      });
    }

    try {
      const { paypalOrderId } = (data as any) || {};

      if (!paypalOrderId) {
        console.log("MISSING PAYPAL ORDER ID");
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: String(action.amount),
          currency: action.currency,
          pspReference: transaction?.pspReference || `fail_${Date.now()}`,
          message: "Missing PayPal order ID",
        });
      }

      if (transaction?.pspReference && paypalOrderId !== transaction.pspReference) {
        console.log("ORDER ID MISMATCH");
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: String(action.amount),
          currency: action.currency,
          pspReference: transaction.pspReference,
          message: "PayPal order ID does not match transaction",
        });
      }

      console.log("Capturing PayPal order:", paypalOrderId);
      const capture = await captureOrder(paypalOrderId);
      console.log("Capture status:", capture.status);

      if (capture.status !== "COMPLETED") {
        console.log("STATUS NOT COMPLETED:", capture.status);
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: String(action.amount),
          currency: action.currency,
          pspReference: paypalOrderId,
          message: `PayPal payment not completed. Status: ${capture.status}`,
        });
      }

      // PayPal returns snake_case keys
      const capturePayment =
        capture.purchase_units?.[0]?.payments?.captures?.[0];

      if (!capturePayment) {
        console.log("NO CAPTURE DETAILS — full response:", JSON.stringify(capture, null, 2));
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: String(action.amount),
          currency: action.currency,
          pspReference: paypalOrderId,
          message: "No capture details in PayPal response",
        });
      }

      console.log("Capture details:", {
        captureId: capturePayment.id,
        capturedAmount: capturePayment.amount.value,
        capturedCurrency: capturePayment.amount.currency_code,
      });

      // Verify amount
      if (Math.abs(parseFloat(capturePayment.amount.value) - parseFloat(String(action.amount))) > 0.01) {
        console.log("AMOUNT MISMATCH");
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: String(action.amount),
          currency: action.currency,
          pspReference: paypalOrderId,
          message: "Payment amount mismatch",
        });
      }

      // Verify currency
      if (
        capturePayment.amount.currency_code.toUpperCase() !==
        action.currency.toUpperCase()
      ) {
        console.log("CURRENCY MISMATCH");
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: String(action.amount),
          currency: action.currency,
          pspReference: paypalOrderId,
          message: "Payment currency mismatch",
        });
      }

      console.log("✅ CHARGE_SUCCESS —", capturePayment.amount.value, capturePayment.amount.currency_code);
      return res.status(200).json({
        result: "CHARGE_SUCCESS",
        amount: capturePayment.amount.value,
        currency: capturePayment.amount.currency_code,
        pspReference: paypalOrderId,
        data: {
          paypalCaptureId: capturePayment.id,
          paypalOrderId: paypalOrderId,
          paypalStatus: capture.status,
          capturedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("❌ PayPal processing failed:", error);

      const message =
        error instanceof PayPalError
          ? `PayPal: ${error.message}`
          : "Internal processing error";

      return res.status(200).json({
        result: "CHARGE_FAILURE",
        amount: String(action.amount),
        currency: action.currency,
        pspReference: transaction?.pspReference || `fail_${Date.now()}`,
        message,
      });
    }
  }
);

export const config = {
  api: { bodyParser: false },
};