import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "../../../saleor-app";
import { TransactionInitializeSessionPayloadFragment } from "../../../../generated/graphql";
import { gql } from "urql";
import { razorpay } from "../../../lib/razorpay";

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
    const { payload } = ctx;
    const { action, data, transaction } = payload;

    // ✅ 1. Validate action type — MOVED INSIDE THE HANDLER
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