# WooCommerce MCP Connector

A read-only tool that lets an AI agent (Razorpay Agent Studio, Claude Desktop, or any other
[MCP](https://modelcontextprotocol.io)-compatible agent) look up orders from a WooCommerce
store — list them, fetch one by ID, search by customer — without ever being able to create,
change, or cancel anything.

Built as the Option 3 take-home for the Forward-Deployed Engineer, Agent Studio application.

---

## Quick start

This gets you from zero to "it's working" in about 5 minutes. You'll need
[Node.js](https://nodejs.org) (v18+) and [Docker Desktop](https://www.docker.com/products/docker-desktop/)
installed and running.

**1. Install dependencies**
```bash
npm install
```

**2. Spin up a disposable WooCommerce store** (no account/signup needed — it builds and seeds
itself automatically)
```bash
cd dev-store
docker compose up -d
docker compose logs -f init
```
Wait for it to finish (a minute or two the first time, while it downloads WordPress/WooCommerce).
You'll see output ending in something like this — **copy the two highlighted lines**:
```
Seeding fictional products/orders and generating API credentials...
Created 4 fictional orders.
CONSUMER_KEY=ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx      <-- copy this (yours will differ)
CONSUMER_SECRET=cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx   <-- copy this (yours will differ)
==================================================
 Setup complete.
 Store running at: http://localhost:8080
```
Press `Ctrl+C` to stop watching the logs (the store keeps running in the background).

**3. Add those credentials to your `.env`**
```bash
cd ..
cp .env.example .env
```
This creates a `.env` file with placeholder values:
```
WC_SITE_URL=http://localhost:8080
WC_CONSUMER_KEY=ck_your_consumer_key_here
WC_CONSUMER_SECRET=cs_your_consumer_secret_here
```
Open `.env` in any text editor and replace the two placeholder lines with the real values you
copied in step 2 — delete `your_consumer_key_here` / `your_consumer_secret_here` entirely and
paste in what was printed, keeping the `ck_`/`cs_` prefix:
```
WC_SITE_URL=http://localhost:8080
WC_CONSUMER_KEY=ck_a1b2c3d4e5f6...        <- the value YOU got in step 2, not this example
WC_CONSUMER_SECRET=cs_f6e5d4c3b2a1...     <- the value YOU got in step 2, not this example
```

**4. Run the automated test suite** — this is the fastest way to confirm everything works:
```bash
npm run smoke
```
You should see 9 lines of `PASS` and a final `9 passed, 0 failed`. If you see that, the
connector is fully working end to end. 🎉

---

## Trying it out yourself (interactive)

If you want to actually click a button and see a real response, rather than just reading test
output:

**1. Build and launch the MCP Inspector** (an official visual tool for poking at MCP servers)
```bash
npm run build
npx @modelcontextprotocol/inspector node dist/src/server.js
```
This opens a browser tab automatically (if it doesn't, copy the URL it prints — it looks like
`http://127.0.0.1:6274?MCP_INSPECTOR_API_TOKEN=...`).

**2. In the browser tab:** click **Connect** on the left, then open the **Tools** tab at the
top, then click **List Tools**. You'll see three: `list_orders`, `get_order`, `search_orders`.

**3. Click one and try these inputs:**

| Tool | Try this input | Expect |
|---|---|---|
| `list_orders` | *(leave empty)* | all 4 seeded orders |
| `list_orders` | `{"status": "cancelled"}` | just the cancelled one |
| `get_order` | `{"order_id": 14}` | Rahul Mehta's order |
| `get_order` | `{"order_id": 999999}` | a clean "not found" message, not a crash |
| `search_orders` | `{"query": "Priya"}` | Priya Nair's order |

---

## Running it for real (as an agent would)

Point any MCP client at `dist/src/server.js`. Example config (same shape Claude Desktop, MCP
Inspector, and Agent Studio all use):

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

Or just run it directly to see its startup log:
```bash
npm run dev
```
Success looks like:
```
Authenticated against WooCommerce store at http://localhost:8080
woocommerce-connector MCP server running on stdio
```
Bad or missing credentials fail loudly right here, before any tool is advertised — it never
silently starts half-broken.

---

## Troubleshooting

- **"Docker is not running" / connection refused** — open Docker Desktop and wait for it to
  fully start, then retry `docker compose up -d`.
- **Port 8080 already in use** — something else on your machine is using it; stop that, or
  change the `"8080:80"` port mapping in `dev-store/docker-compose.yml` and update `WC_SITE_URL`
  to match.
- **MCP Inspector errors with something about `zod/v4` or a missing module** — this is a
  broken cached install, not a problem with this project. Delete the npx cache
  (`%LOCALAPPDATA%\npm-cache\_npx` on Windows, `~/.npm/_npx` on Mac/Linux) and run the
  `npx @modelcontextprotocol/inspector ...` command again.
- **Inspector connects but shows "Missing WooCommerce credentials"** — make sure you ran
  `npx @modelcontextprotocol/inspector ...` from inside the project folder (`D:\projects\connector`),
  not some other directory — it needs to find `.env` relative to where it's launched from.
- **Want to start over completely** — `cd dev-store && docker compose down -v` wipes the store
  back to nothing; `docker compose up -d` rebuilds it fresh (you'll get a new API key).

---

## Tools reference

| Tool | Input | Returns |
|---|---|---|
| `list_orders` | `status?` (one of the WooCommerce order statuses), `page?` (default 1) | paginated list of normalized orders |
| `get_order` | `order_id` (number, required) | a single normalized order, or an `isError` result if not found |
| `search_orders` | `query` (string, required) | orders matching the customer name/email/order number |

See `CAPABILITIES.md` for the exact data shape and the full can/cannot boundary.

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
