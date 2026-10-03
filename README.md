# WooCommerce MCP Connector

A read-only [MCP](https://modelcontextprotocol.io) server that lets an AI agent (e.g. Razorpay
Agent Studio, Claude Desktop, or any other MCP client) list, fetch, and search orders from a
WooCommerce store — without ever being able to create, modify, or cancel anything.

Built as the Option 3 take-home for the Forward-Deployed Engineer, Agent Studio application.

## Overview

The connector is a small Node/TypeScript process speaking MCP over stdio. It authenticates to
WooCommerce's REST API, exposes three tools (`list_orders`, `get_order`, `search_orders`), and
handles rate limiting/timeouts/retries so a calling agent never has to deal with transient
failures itself.

## Prerequisites

- Node.js ≥ 18.17
- A WooCommerce store with REST API credentials (Consumer Key + Secret with **Read** permission)
- Docker, if you want to spin up the same disposable local store used to build and test this
  (see `dev-store/`) rather than pointing at a real WooCommerce site

## Setup

```bash
npm install
cp .env.example .env
# fill in WC_SITE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET
```

If you don't have a WooCommerce store handy, `dev-store/` brings up a disposable one via Docker
(MySQL + WordPress + WooCommerce, seeded with fictional products/orders):

```bash
cd dev-store
docker compose up -d db wordpress
docker compose run --rm --user root wpcli core install --url="http://localhost:8080" --title="MCP Demo Store" --admin_user=admin --admin_password=admin123 --admin_email=admin@example.test --skip-email
docker compose run --rm --user root wpcli plugin install woocommerce --activate
docker compose run --rm --user root wpcli rewrite structure '/%postname%/'
docker compose run --rm --user root wpcli rewrite flush
MSYS_NO_PATHCONV=1 docker compose run --rm --user root wpcli eval-file /seed.php
```

The last command prints a `CONSUMER_KEY`/`CONSUMER_SECRET` pair — put those (plus
`WC_SITE_URL=http://localhost:8080`) in your `.env`.

## Running the server

```bash
npm run dev      # run directly with tsx
# or
npm run build && npm start
```

On success, stderr shows:
```
Authenticated against WooCommerce store at http://localhost:8080
woocommerce-connector MCP server running on stdio
```

On bad or missing credentials, it fails fast with a clear error and a non-zero exit code
*before* any tool is advertised — it never silently starts in a half-authenticated state.

## Connecting an MCP client

Any stdio-based MCP client can run this as a subprocess. Example config block (the same shape
Claude Desktop, MCP Inspector, and most agent platforms use):

```json
{
  "mcpServers": {
    "woocommerce": {
      "command": "node",
      "args": ["/absolute/path/to/connector/dist/src/server.js"],
      "env": {
        "WC_SITE_URL": "http://localhost:8080",
        "WC_CONSUMER_KEY": "ck_...",
        "WC_CONSUMER_SECRET": "cs_..."
      }
    }
  }
}
```

## Tools reference

| Tool | Input | Returns |
|---|---|---|
| `list_orders` | `status?` (one of the WooCommerce order statuses), `page?` (default 1) | paginated list of normalized orders |
| `get_order` | `order_id` (number, required) | a single normalized order, or an `isError` result if not found |
| `search_orders` | `query` (string, required) | orders matching the customer name/email/order number |

See `CAPABILITIES.md` for the exact data shape and the full can/cannot boundary.

## Testing

```bash
npm run smoke
```

Runs `test/smoke.ts` — 9 cases covering the list/get/search happy paths, the not-found and
empty-search edge cases, bad-credential handling, and a simulated rate-limit retry. The retry
case prints the actual `[retry] 429 ...` log line it captured, as evidence the logic fires.

## Rate limits & resilience

Every request goes through a single retry layer (`src/rateLimiter.ts`):

- **HTTP 429** — waits for the `Retry-After` header (capped at 30s), retries, then gives up
  with a clear error after `RATE_LIMIT_MAX_RETRIES` (default 3) attempts.
- **HTTP 5xx / network error / timeout** — exponential backoff, same retry budget.
- **Everything else** (400/401/403/404) — returned immediately; retrying wouldn't help.
- Every request has a timeout (`REQUEST_TIMEOUT_MS`, default 10000ms) so a hung call can't
  block the calling agent indefinitely.

**Important assumption:** a self-hosted WooCommerce instance has no rate limiter of its own —
throttling only happens if a host/CDN in front of it adds one. There's nothing to trigger a
real 429 against the local dev store, so the retry path is validated with a small local stub
server that simulates one (see `test/smoke.ts`), not a naturally-occurring rate limit.

## Assumptions

- Auth uses **OAuth 1.0a one-legged signing**, not simple Basic Auth — WooCommerce only accepts
  Basic Auth with the consumer key/secret over HTTPS, and this connector was built and tested
  against a local store over plain HTTP. Against a real HTTPS-hosted WooCommerce store, Basic
  Auth with the same credentials would also work; the OAuth1.0a path works either way, so no
  code change is required to point this at a production store.
- `search_orders` uses WooCommerce's `search` query parameter, which matches customer name,
  email, and order number/key — it is not a full-text search over order notes or line items.
- Tested against WooCommerce 11.1.2 on WordPress with the `wp-json/wc/v3` REST API.

## Known limitations

- **Read-only.** No tool can create, update, cancel, or refund an order, and no handler ever
  issues anything but a `GET` request — by design, not by omission.
- Single store/credential pair per server instance — no multi-tenant support.
- No caching — every `list_orders`/`get_order`/`search_orders` call hits the live API.
- Only covers orders. A `list_products` tool (inventory) was scoped as a stretch goal but not
  built in this submission window.

## Security notes

- `.env` is git-ignored; only `.env.example` (placeholders) is committed.
- No real customer data is used anywhere — all seeded orders use fictional names and
  `@example.test` emails.
- Credentials are never logged; only the site URL is logged on successful auth.
