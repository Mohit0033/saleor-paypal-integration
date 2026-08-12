import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "../../../saleor-app";
import { gql } from "urql";
import { razorpay, verifyPaymentSignature } from "../../../lib/razorpay";

// Fallback type if codegen hasn't run (e.g. Docker build)
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
    name: "Razorpay Transaction Process",
    webhookPath: "/api/webhooks/transaction-process-session",
    event: "TRANSACTION_PROCESS_SESSION",
    apl: saleorApp.apl,
    query: TransactionProcessSessionSubscription,
  });

export default transactionProcessSessionWebhook.createHandler(
  async (req, res, ctx) => {
    const { payload, authData } = ctx;
    const { action, data, transaction } = payload;

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
      const { razorpayPaymentId, razorpayOrderId, razorpaySignature } =
        (data as any) || {};

      // Validate input presence
      if (!razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: action.amount,
          pspReference: transaction?.pspReference || `fail_${Date.now()}`,
          message: "Missing Razorpay payment credentials",
        });
      }

      // Verify order ID matches the one we created
      if (razorpayOrderId !== transaction?.pspReference) {
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: action.amount,
          pspReference: transaction?.pspReference || "unknown",
          message: "Razorpay order ID does not match transaction",
        });
      }

      // Verify signature
      const isValid = verifyPaymentSignature(
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature
      );

      if (!isValid) {
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: action.amount,
          pspReference: transaction?.pspReference || razorpayOrderId,
          message: "Payment signature verification failed",
        });
      }

      // Fetch and validate payment from Razorpay
      const payment = await razorpay.payments.fetch(razorpayPaymentId);

      // Verify payment belongs to expected order
      if (payment.order_id !== razorpayOrderId) {
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: action.amount,
          pspReference: transaction?.pspReference || razorpayOrderId,
          message: "Payment order mismatch",
        });
      }

      // Verify amount matches (Razorpay amount is in paise/smallest unit)
      const expectedAmount = Math.round(action.amount * 100);
      if (parseInt(payment.amount) !== expectedAmount) {
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: action.amount,
          pspReference: transaction?.pspReference || razorpayOrderId,
          message: "Payment amount mismatch",
        });
      }

      // Verify currency matches
      if (payment.currency.toUpperCase() !== action.currency.toUpperCase()) {
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: action.amount,
          pspReference: transaction?.pspReference || razorpayOrderId,
          message: "Payment currency mismatch",
        });
      }

      // Verify payment status
      if (payment.status !== "captured" && payment.status !== "authorized") {
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: action.amount,
          pspReference: transaction?.pspReference || razorpayOrderId,
          message: `Payment status: ${payment.status}`,
        });
      }

      // All checks passed
      return res.status(200).json({
        result: "CHARGE_SUCCESS",
        amount: action.amount,
        pspReference: transaction?.pspReference || razorpayOrderId,
        data: {
          razorpayPaymentId,
          razorpayOrderId,
          paymentMethod: payment.method,
          capturedAt: payment.created_at,
        },
      });
    } catch (error) {
      console.error("Razorpay processing failed:", error);
      return res.status(200).json({
        result: "CHARGE_FAILURE",
        amount: action.amount,
        pspReference: transaction?.pspReference || `fail_${Date.now()}`,
        message: "Internal processing error",
      });
    }
  }
);

export const config = {
  api: { bodyParser: false },
};