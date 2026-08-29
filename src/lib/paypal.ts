/**
 * PayPal REST API v2 wrapper.
 * No external dependency — uses native fetch with token caching.
 */

let cachedToken: { token: string; expiresAt: number } | null = null;

function getBaseUrl(): string {
  return process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(`${getBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PayPalError(
      `Auth failed: ${err.error_description || err.error || res.statusText}`,
      "AUTH_FAILED"
    );
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.token;
}

// ─── Shipping Address ───────────────────────────────────────────────

export interface PayPalShippingAddress {
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  countryCode: string;
}

// ─── Create Order ────────────────────────────────────────────────────

export async function createOrder(
  amount: string,
  currency: string,
  referenceId: string,
  shipping?: PayPalShippingAddress
): Promise<{ id: string; status: string }> {
  const token = await getAccessToken();

  const purchaseUnit: Record<string, unknown> = {
    reference_id: referenceId,
    amount: {
      currency_code: currency.toUpperCase(),
      value: formatAmount(amount),
    },
  };

  if (shipping) {
    purchaseUnit.shipping = {
      name: { full_name: shipping.fullName },
      address: {
        address_line_1: shipping.line1,
        ...(shipping.line2 ? { address_line_2: shipping.line2 } : {}),
        admin_area_2: shipping.city,
        ...(shipping.state ? { admin_area_1: shipping.state } : {}),
        postal_code: shipping.postalCode,
        country_code: shipping.countryCode.toUpperCase(),
      },
    };
  }

  const res = await fetch(`${getBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [purchaseUnit],
      application_context: {
        shipping_preference: shipping ? "SET_PROVIDED_ADDRESS" : "NO_SHIPPING",
        brand_name: process.env.APP_NAME || "Shriji Crafts",
        user_action: "PAY_NOW",
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PayPalError(
      `Create order failed: ${err.message || err.name || JSON.stringify(err)}`,
      "CREATE_ORDER_FAILED"
    );
  }

  const data = await res.json();
  return { id: data.id, status: data.status };
}

// ─── Capture Order ───────────────────────────────────────────────────

export interface CaptureResult {
  id: string;
  status: string;
  purchase_units: Array<{
    reference_id: string;
    payments: {
      captures: Array<{
        id: string;
        status: string;
        amount: { currency_code: string; value: string };
      }>;
    };
  }>;
}

export async function captureOrder(orderId: string): Promise<CaptureResult> {
  const token = await getAccessToken();

  const res = await fetch(
    `${getBaseUrl()}/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PayPalError(
      `Capture failed: ${err.message || err.name || JSON.stringify(err)}`,
      "CAPTURE_FAILED"
    );
  }

  return res.json();
}

// ─── Get Order ───────────────────────────────────────────────────────

export async function getOrder(orderId: string): Promise<CaptureResult> {
  const token = await getAccessToken();

  const res = await fetch(`${getBaseUrl()}/v2/checkout/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PayPalError(
      `Get order failed: ${err.message || err.name || JSON.stringify(err)}`,
      "GET_ORDER_FAILED"
    );
  }

  return res.json();
}

// ─── Refund Capture ──────────────────────────────────────────────────

export async function refundCapture(
  captureId: string,
  amount: string,
  currency: string
): Promise<{ id: string; status: string; amount: { currency_code: string; value: string } }> {
  const token = await getAccessToken();

  const res = await fetch(
    `${getBaseUrl()}/v2/payments/captures/${captureId}/refund`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: {
          currency_code: currency.toUpperCase(),
          value: formatAmount(amount),
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PayPalError(
      `Refund failed: ${err.message || err.name || JSON.stringify(err)}`,
      "REFUND_FAILED"
    );
  }

  return res.json();
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatAmount(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num) || num < 0) {
    throw new PayPalError(`Invalid amount: ${amount}`, "INVALID_AMOUNT");
  }
  return num.toFixed(2);
}

export class PayPalError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "PayPalError";
    this.code = code;
  }
}