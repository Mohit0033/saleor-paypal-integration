# syntax=docker/dockerfile:1
FROM node:22-alpine AS base

WORKDIR /app

FROM base AS deps
COPY package.json ./
# Added package-lock.json to ensure consistent dependencies
COPY package-lock.json* ./
# Added dedupe to fix the @urql/core TypeScript mismatch
RUN npm install && npm dedupe

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]