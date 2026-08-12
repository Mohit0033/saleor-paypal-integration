# Saleor Razorpay Payment App

A production-ready **Razorpay** integration for [Saleor Commerce](https://saleor.io). Built on the official Saleor App Template with full security hardening.

---

## Features

- **Razorpay Checkout** — Native drop-in payment modal for cards, UPI, wallets
- **3D Secure Flow** — `CHARGE_ACTION_REQUIRED` → `CHARGE_SUCCESS` via Saleor's Transactions API
- **HMAC-SHA256 Signature Verification** — Every payment cryptographically verified
- **Amount / Currency / Order ID Binding** — Prevents payment substitution attacks
- **Docker Ready** — Single-command deployment on any server
- **Zero Cloud Lock-in** — Self-host on your own hardware or VPS

---

## Architecture

```
Storefront                    Saleor                     Your App (this repo)
   │                            │                              │
   ├─ transactionInitialize ───►├─ TRANSACTION_INITIALIZE ─────►├─ Creates Razorpay Order
   │                            │                              │
   │◄── CHARGE_ACTION_REQUIRED ◄├◄──── razorpayOrderId + key ───┤
   │                            │                              │
   │   [Razorpay Checkout Opens]                               │
   │                            │                              │
   ├─ transactionProcess ──────►├─ TRANSACTION_PROCESS ────────►├─ Verifies Signature
   │                            │                              ├─ Fetches Payment
   │◄──── CHARGE_SUCCESS ◄──────├◄─────────────────────────────┤
   │                            │                              │
   └─ checkoutComplete ────────►├─ Order Created ──────────────►├─ Done
```

---

## Quick Start

### Prerequisites

- [Saleor](https://saleor.io) 3.14+ (Cloud or self-hosted)
- [Node.js](https://nodejs.org/) 18.17+ and [pnpm](https://pnpm.io/) 9+
- Razorpay account ([Dashboard](https://dashboard.razorpay.com/))

### 1. Clone & Install

```bash
git clone https://github.com/Mohit0033/saleor-razorpay-app.git
cd saleor-razorpay-app
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
APP_IDENTIFIER=saleor.app.razorpay
```

### 3. Run Locally

```bash
pnpm dev        # http://localhost:3000
ngrok http 3000 # Expose for Saleor installation
```

Install in Saleor Dashboard → Apps → **Install external app** → paste `https://YOUR_NGROK_URL/api/manifest`.

---

## Production Deployment

### Option A: Docker (Recommended for Self-Hosting)

Requires Docker + Docker Compose.

```bash
# 1. Configure
mkdir -p data/auth data/logs
cp .env.example .env
# Edit .env with live keys

# 2. Build & Run
docker compose up -d --build

# 3. Expose via Cloudflare Tunnel (or reverse proxy)
# See: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
```

Manifest URL for Saleor:
```
https://pay.yourdomain.com/api/manifest
```

### Option B: Vercel (Serverless)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Mohit0033/saleor-razorpay-integration)

> **Note:** If using the default FileAPL, auth data won't persist across cold starts. Use [Upstash Redis](https://upstash.com) for production Vercel deployments.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RAZORPAY_KEY_ID` | ✅ | Razorpay Key ID (`rzp_live_...` or `rzp_test_...`) |
| `RAZORPAY_KEY_SECRET` | ✅ | Razorpay Key Secret |
| `APP_IDENTIFIER` | ✅ | Unique app ID. Default: `saleor.app.razorpay` |
| `CLOUDFLARE_TUNNEL_TOKEN` | ❌ | For Docker tunnel service. Omit if running tunnel on host |
| `UPSTASH_REDIS_REST_URL` | ❌ | Upstash Redis REST URL (for persistent APL) |
| `UPSTASH_REDIS_REST_TOKEN` | ❌ | Upstash Redis REST Token |

---

## Security

This app implements defense-in-depth for payment processing:

| Layer | Protection |
|-------|------------|
| **Webhook Authentication** | Saleor JWS signature verified by `@saleor/app-sdk` |
| **Payment Signature** | Razorpay HMAC-SHA256 signature verified server-side |
| **Order Binding** | `razorpayOrderId` must match the `pspReference` stored in Saleor |
| **Amount Verification** | Razorpay payment amount must equal Saleor transaction amount |
| **Currency Verification** | Razorpay payment currency must match Saleor transaction currency |
| **Action Type Guard** | Only `CHARGE` strategy supported; rejects `AUTHORIZATION` |
| **Sanitized Errors** | Raw Razorpay errors never leaked to client |

---

## Webhooks

| Event | File | Purpose |
|-------|------|---------|
| `TRANSACTION_INITIALIZE_SESSION` | `src/pages/api/webhooks/transaction-initialize-session.ts` | Creates Razorpay Order, returns checkout config |
| `TRANSACTION_PROCESS_SESSION` | `src/pages/api/webhooks/transaction-process-session.ts` | Verifies signature, confirms `CHARGE_SUCCESS` |

---

## Storefront Integration

Your storefront calls Saleor's `transactionInitialize` and `transactionProcess` mutations. The app handles all Razorpay-specific logic server-side.

```typescript
// Initialize → triggers app webhook → returns Razorpay order details
const init = await saleorClient.transactionInitialize({
  id: checkoutId,
  paymentGateway: { id: "saleor.app.razorpay", data: {} }
});

// Open Razorpay Checkout with init.data
// On success, call process → triggers verification webhook
const process = await saleorClient.transactionProcess({
  id: init.transaction.id,
  data: {
    razorpayPaymentId,
    razorpayOrderId,
    razorpaySignature
  }
});
```

See `src/components/checkout/gateways/RazorpayButton.tsx` for a complete React implementation.

---

## Development

```bash
# Install dependencies
pnpm install

# Generate GraphQL types
pnpm generate

# Start dev server
pnpm dev

# Lint
pnpm lint
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "A required field is missing in the extension's manifest" | Add `id`, `version`, `appUrl`, `tokenTargetUrl` to manifest |
| "An unexpected issue occurred when parsing manifest" | Check GraphQL subscription queries for invalid fields (e.g., `email` on `Address` instead of `Checkout`) |
| Webhook returns 400 on curl test | Expected — Saleor JWS signature is missing. SDK is working correctly |
| "App with the same identifier is already installed" | Change `APP_IDENTIFIER` temporarily, or wait for async uninstall |

---

## License

[MIT](./LICENSE)

---

## Contributing

Issues and PRs welcome. For major changes, please open an issue first to discuss what you would like to change.

---

Built with [Saleor App SDK](https://github.com/saleor/saleor-app-sdk) and [Razorpay](https://razorpay.com).
