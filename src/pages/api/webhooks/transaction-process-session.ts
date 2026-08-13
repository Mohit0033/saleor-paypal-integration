import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "../../../saleor-app";
import { gql } from "urql";
import { razorpay, verifyPaymentSignature } from "../../../lib/razorpay";

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

    console.log("=== WEBHOOK HIT ===");
    console.log("Event:", ctx.event);
    console.log("Saleor URL:", authData.saleorApiUrl);
    console.log("Payload action:", action);
    console.log("Payload data:", JSON.stringify(data));
    console.log("Transaction PSP Ref:", transaction?.pspReference);

    if (action.actionType !== "CHARGE") {
      console.log("ACTION TYPE REJECTED:", action.actionType);
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

      console.log("Received from frontend:", { razorpayPaymentId, razorpayOrderId, razorpaySignature: razorpaySignature ? "present" : "missing" });

      if (!razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
        console.log("MISSING CREDENTIALS");
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: action.amount,
          pspReference: transaction?.pspReference || `fail_${Date.now()}`,
          message: "Missing Razorpay payment credentials",
        });
      }

      console.log("Comparing order IDs:", { received: razorpayOrderId, expected: transaction?.pspReference });
      if (razorpayOrderId !== transaction?.pspReference) {
        console.log("ORDER ID MISMATCH");
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: action.amount,
          pspReference: transaction?.pspReference || "unknown",
          message: "Razorpay order ID does not match transaction",
        });
      }

      console.log("Verifying signature...");
      const isValid = verifyPaymentSignature(
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature
      );

      if (!isValid) {
        console.log("SIGNATURE INVALID");
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: action.amount,
          pspReference: transaction?.pspReference || razorpayOrderId,
          message: "Payment signature verification failed",
        });
      }

      // Fetch payment from Razorpay
      console.log("Fetching payment from Razorpay:", razorpayPaymentId);
      const payment = await razorpay.payments.fetch(razorpayPaymentId);
      console.log("Razorpay payment:", { status: payment.status, amount: payment.amount, currency: payment.currency, order_id: payment.order_id });

      // Verify payment belongs to expected order
      if (payment.order_id !== razorpayOrderId) {
        console.log("PAYMENT ORDER MISMATCH:", { paymentOrderId: payment.order_id, expected: razorpayOrderId });
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: action.amount,
          pspReference: transaction?.pspReference || razorpayOrderId,
          message: "Payment order mismatch",
        });
      }

      // Fetch the order WE created to verify amount (not payment amount, which may include fees)
      console.log("Fetching Razorpay order:", razorpayOrderId);
      const order = await razorpay.orders.fetch(razorpayOrderId);
      console.log("Razorpay order:", { amount: order.amount, currency: order.currency });

      const expectedAmount = Math.round(action.amount * 100);
      console.log("Amount check:", { expected: expectedAmount, orderAmount: order.amount });

      if (Number(order.amount) !== expectedAmount) {
        console.log("AMOUNT MISMATCH — Order amount doesn't match Saleor transaction");
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: action.amount,
          pspReference: transaction?.pspReference || razorpayOrderId,
          message: "Payment amount mismatch",
        });
      }

      // Also log if payment amount differs from order amount (fees, etc.)
      if (Number(payment.amount) !== Number(order.amount)) {
        console.log("NOTE: Payment amount differs from order amount (likely fees):", {
          orderAmount: order.amount,
          paymentAmount: payment.amount,
          difference: Number(payment.amount) - Number(order.amount)
        });
      }

      // Verify currency matches
      console.log("Currency check:", { expected: action.currency, received: payment.currency });
      if (payment.currency.toUpperCase() !== action.currency.toUpperCase()) {
        console.log("CURRENCY MISMATCH");
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: action.amount,
          pspReference: transaction?.pspReference || razorpayOrderId,
          message: "Payment currency mismatch",
        });
      }

      // Verify payment status
      console.log("Payment status:", payment.status);
      if (payment.status !== "captured" && payment.status !== "authorized") {
        console.log("STATUS NOT CAPTURED:", payment.status);
        return res.status(200).json({
          result: "CHARGE_FAILURE",
          amount: action.amount,
          pspReference: transaction?.pspReference || razorpayOrderId,
          message: `Payment status: ${payment.status}`,
        });
      }

      console.log("✅ ALL CHECKS PASSED — CHARGE_SUCCESS");
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
      console.error("❌ Razorpay processing failed:", error);
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