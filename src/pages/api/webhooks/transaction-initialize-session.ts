import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "../../../saleor-app";
import { gql } from "urql";
import { createOrder, PayPalError } from "../../../lib/paypal";

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
      pspReference
      checkout {
        id
        email
        shippingAddress {
          firstName
          lastName
          streetAddress1
          streetAddress2
          city
          postalCode
          countryArea
          country {
            code
          }
          phone
        }
        billingAddress {
          firstName
          lastName
          phone
          country {
            code
          }
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
    name: "PayPal Transaction Initialize",
    webhookPath: "/api/webhooks/transaction-initialize-session",
    event: "TRANSACTION_INITIALIZE_SESSION",
    apl: saleorApp.apl,
    query: TransactionInitializeSessionSubscription,
  });

export default transactionInitializeSessionWebhook.createHandler(
  async (req, res, ctx) => {
    const { payload, authData } = ctx;
    const { action, transaction } = payload;

    // Allowlist guard
    const ALLOWED_SALEOR_URL = process.env.ALLOWED_SALEOR_URL;
    if (ALLOWED_SALEOR_URL && authData.saleorApiUrl !== ALLOWED_SALEOR_URL) {
      console.error("Rejected unauthorized Saleor:", authData.saleorApiUrl);
      return res.status(403).json({ error: "Unauthorized Saleor instance" });
    }

    if (action.actionType !== "CHARGE") {
      return res.status(200).json({
        result: "CHARGE_FAILURE",
        amount: action.amount,
        pspReference: transaction?.pspReference || "unknown",
        message: "Only CHARGE strategy supported",
      });
    }

    if (action.amount <= 0 || !action.currency) {
      return res.status(200).json({
        result: "CHARGE_FAILURE",
        amount: action.amount,
        pspReference: transaction?.pspReference || "unknown",
        message: `Invalid amount or currency: ${action.amount} ${action.currency}`,
      });
    }

    // Reuse existing PayPal order
    if (transaction?.pspReference) {
      return res.status(200).json({
        result: "CHARGE_ACTION_REQUIRED",
        amount: action.amount,
        pspReference: transaction.pspReference,
        data: {
          paypalOrderId: transaction.pspReference,
          paypalClientId: process.env.PAYPAL_CLIENT_ID || "",
        },
      });
    }

    try {
      // Build shipping address from Saleor checkout
      const addr = transaction?.checkout?.shippingAddress;
      const shipping = addr?.streetAddress1
        ? {
            fullName: [
              addr.firstName,
              addr.lastName,
            ]
              .filter(Boolean)
              .join(" ") || "Not provided",
            line1: addr.streetAddress1,
            line2: addr.streetAddress2 || undefined,
            city: addr.city || "",
            state: addr.countryArea || undefined,
            postalCode: addr.postalCode || "",
            countryCode: addr.country?.code || "US",
          }
        : undefined;

      console.log("[INIT] Creating PayPal order:", {
        amount: action.amount,
        currency: action.currency,
        checkoutId: transaction?.checkout?.id,
        hasShipping: !!shipping,
        shippingCountry: shipping?.countryCode,
      });

      const paypalOrder = await createOrder(
        String(action.amount),
        action.currency,
        transaction?.checkout?.id || "",
        shipping
      );

      console.log(
        `[INIT] PayPal order ${paypalOrder.id} — ${action.currency} ${action.amount}`
      );

      return res.status(200).json({
        result: "CHARGE_ACTION_REQUIRED",
        amount: action.amount,
        pspReference: paypalOrder.id,
        data: {
          paypalOrderId: paypalOrder.id,
          paypalClientId: process.env.PAYPAL_CLIENT_ID || "",
        },
      });
    } catch (error) {
      console.error("PayPal order creation failed:", error);

      const message =
        error instanceof PayPalError
          ? `PayPal: ${error.message}`
          : "Failed to create PayPal order";

      return res.status(200).json({
        result: "CHARGE_FAILURE",
        amount: action.amount,
        pspReference: `fail_${Date.now()}`,
        message,
      });
    }
  }
);

export const config = {
  api: { bodyParser: false },
};