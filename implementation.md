# Private Connector for a Merchant Tool — Implementation Plan

**Assignment:** Build a connector that lets an Agent Studio agent read tickets, orders, or
inventory from a chosen merchant tool (Freshdesk / Zoho Inventory / WooCommerce / Unicommerce).

**Chosen tool:** WooCommerce (orders). Reasoning: Freshdesk's trial signup requires a business
email domain, which blocked that path. WooCommerce is self-hosted (a WordPress plugin), so
there's no vendor account to sign up for at all — you run your own instance locally and
generate your own API credentials, with full control over sample data.

**Auth note (discovered during Stage 0):** WooCommerce's REST API only accepts simple Basic
Auth (Consumer Key as username, Secret as password) **over HTTPS**. Our local dev store runs
over plain HTTP (no reverse-SSL-proxy — an attempt to add one via Caddy hit an unrelated local
TLS/handshake issue and was abandoned as not worth the detour). Over plain HTTP, WooCommerce's
own documented fallback is **OAuth 1.0a "one-legged" authentication** — signing each request
with `oauth_consumer_key`/`oauth_signature`/etc. computed via HMAC-SHA1. This was verified
working end-to-end (see Stage 0 below) and conveniently satisfies the assignment's "OAuth ...
authentication flow" requirement directly, rather than just the API-key option.

**What "done" looks like:** a small MCP server, backed by a WooCommerce REST API client,
exposing `list_orders`, `get_order`, and `search_orders` as MCP tools — with auth, rate-limit
resilience, tests, and a capabilities doc.

**Note on rate limiting:** self-hosted WooCommerce has no built-in rate limiter (unlike a
hosted SaaS like Freshdesk) — throttling, if any, comes from the host/CDN in front of it. The
rate-limit/retry code is still built generically (429 + `Retry-After`, 5xx backoff) since that's
good practice for any real deployment, but it's validated against a simulated 429 response in
testing rather than a naturally-occurring one, and this is called out explicitly in the docs
rather than glossed over.

---

## Stage 0 — Local environment & account setup ✅ done

Actually built with Docker (no vendor signup, fully scripted, reproducible) instead of a GUI
installer like LocalWP:

- `dev-store/docker-compose.yml` — three services: `db` (MySQL 8), `wordpress`
  (`wordpress:php8.2-apache`, port 8080), `wpcli` (`wordpress:cli-php8.2`, run on demand).
- WordPress core installed via `wp core install` (wp-cli), WooCommerce plugin installed +
  activated via `wp plugin install woocommerce --activate`, pretty permalinks enabled
  (`wp rewrite structure '/%postname%/'`) — required for `/wp-json/*` routes to resolve at all.
- `dev-store/seed.php` (run via `wp eval-file`) — idempotent script that creates 3 fictional
  products and 4 fictional orders (varied statuses: processing/completed/pending/cancelled,
  fictional names/emails like `asha.demo@example.test`), and generates a **read-only** REST
  API Consumer Key/Secret pair directly in the `wp_woocommerce_api_keys` table.
- Credentials saved to `dev-store/.env` (git-ignored, never committed) as `WC_SITE_URL`,
  `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET`.
- Auth verified with a small Node script performing OAuth 1.0a one-legged signing (HMAC-SHA1
  over the request's method/URL/params, per WooCommerce's documented non-HTTPS auth method)
  against `GET http://localhost:8080/wp-json/wc/v3/orders` — returned `200` with the seeded
  fictional orders as JSON.
- WooCommerce REST API docs for the Orders endpoint (list, retrieve, parameters — `status`,
  `search`, `page`, `per_page`) and the OAuth1.0a auth spec:
  https://woocommerce.github.io/woocommerce-rest-api-docs/

To bring the store back up after a restart: `cd dev-store && docker compose up -d db wordpress`
(wp-admin at `http://localhost:8080/wp-admin`, user `admin` / pass `admin123` — throwaway local
dev credentials only).

**Exit criteria:** ✅ one successful authenticated API call returning sample orders as JSON.

---

## Stage 1 — Project setup

- Stack: Node.js + TypeScript using the official `@modelcontextprotocol/sdk`.
- Scaffold repo:
  ```
  connector/
    src/
      auth.ts
      woocommerceClient.ts
      rateLimiter.ts
      types.ts
      tools/
        listOrders.ts
        getOrder.ts
        searchOrders.ts
      server.ts
    test/
      smoke.ts
    .env.example
    README.md
    CAPABILITIES.md
    package.json
  ```
- `.env` (git-ignored) holds `WC_SITE_URL`, `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET`. Commit
  only `.env.example` with placeholder values.

**Exit criteria:** repo builds/runs with a placeholder "hello world" MCP server.

---

## Stage 2 — Authentication layer (`auth.ts`) ✅ done

- WooCommerce REST API auth over plain HTTP: **OAuth 1.0a one-legged authentication** —
  each request is signed with `oauth_consumer_key`, `oauth_nonce`, `oauth_signature_method`
  (`HMAC-SHA1`), `oauth_timestamp`, `oauth_version`, and `oauth_signature` (HMAC-SHA1 over the
  uppercased method + percent-encoded base URL + percent-encoded sorted param string, signed
  with `percentEncode(consumerSecret) + "&"`). No request token/authorization redirect step —
  it's "one-legged" because the consumer key/secret pair alone is the credential. Verified
  working in Stage 0 against the local dev store.
  (If a future deployment target serves WooCommerce over real HTTPS, this can simplify to
  plain HTTP Basic Auth with consumer key/secret as username/password — worth a one-line note
  in README.)
- Load `WC_SITE_URL` / `WC_CONSUMER_KEY` / `WC_CONSUMER_SECRET` from env, fail fast with a
  clear error if any are missing.
- Startup check: a signed `GET /wp-json/wc/v3/orders?per_page=1` call to confirm credentials
  work before the MCP server advertises any tools.

**Exit criteria:** running the server with bad credentials fails loudly and early; with good
credentials it logs confirmation (e.g. store name/URL) before accepting tool calls.

---

## Stage 3 — API client layer (`woocommerceClient.ts`)

Wrap the raw REST calls behind typed functions — this is the layer the MCP tools call, keeping
auth/rate-limiting/retry logic in one place:

- `listOrders({ page, perPage, status })` → GET `/wp-json/wc/v3/orders?page=&per_page=&status=`
- `getOrder(id)` → GET `/wp-json/wc/v3/orders/{id}`
- `searchOrders(query)` → GET `/wp-json/wc/v3/orders?search={query}` (WooCommerce's built-in
  order search — matches billing name/email, order number, etc.)
- Normalize responses into a small, stable internal shape (id, status, total, currency,
  customer {name, email}, line_items summary, date_created) rather than passing WooCommerce's
  full raw JSON straight through.

**Exit criteria:** a standalone script can list, get-by-id, and search orders using only this
module against the local WooCommerce instance.

---

## Stage 4 — Rate-limit & resilience handling (`rateLimiter.ts`)

- Single `requestWithRetry()` choke point every WooCommerce call goes through.
- On HTTP 429 (if a host/CDN in front of WooCommerce ever imposes one): back off and retry
  respecting `Retry-After`, up to a small max retry count, then surface a clean error.
- Exponential backoff for transient 5xx/network errors (self-hosted WordPress can genuinely
  hiccup under load, so this is the realistic failure mode to guard against here).
- Request timeout so a hung call doesn't block the agent indefinitely.
- Since local WooCommerce won't naturally throttle you, validate the 429 path with a small
  local test double (a stub server or mocked fetch returning 429 once) rather than depending
  on a real rate limit — call this out explicitly in README as the testing method used.

**Exit criteria:** the retry path is demonstrably exercised (via the simulated 429) without
crashing the process, and is visible in logs; real 5xx/timeout handling is exercised against
the live local instance where feasible.

---

## Stage 5 — MCP tool layer (`tools/*.ts`, `server.ts`)

- Register three read-only MCP tools, each with a JSON-schema input spec and a clear
  description:
  - `list_orders(status?, page?)` — paginated list, optionally filtered by order status
  - `get_order(order_id)` — single order lookup
  - `search_orders(query)` — search by customer name/email/order number
- Each tool handler calls the Stage-3 client, catches errors, and returns structured
  MCP-compliant results (not raw exceptions).
- Explicitly do **not** implement any write/update/delete tool (no `create_order`,
  `update_order_status`, etc.) — read-only by design, keeps the agent's blast radius small.
- Wire to stdio transport so it can be tested with the MCP Inspector or any MCP-compatible
  client (Agent Studio, Claude Desktop, etc.).

**Exit criteria:** `npx @modelcontextprotocol/inspector` (or equivalent) connects to the server
and successfully calls all three tools against the local WooCommerce instance.

---

## Stage 6 — Testing & validation

- `test/smoke.ts`: a plain script exercising each tool end-to-end against the local
  WooCommerce instance, printing pass/fail per case.
- Edge cases: order ID that doesn't exist, empty search results, missing/invalid credentials,
  and the simulated-429 retry path from Stage 4.
- Capture one annotated log snippet showing the retry logic firing (from the simulated case).

**Exit criteria:** all smoke tests pass; one annotated log snippet showing the retry path.

---

## Stage 7 — Documentation

1. **`README.md`** — setup and run instructions:
   - prerequisites (LocalWP or any local WordPress+WooCommerce setup), `.env` setup, how to
     start the server, how to connect an MCP client/inspector to it.
   - assumptions (self-hosted instance has no native rate limiter; retry logic validated via
     simulation), known limitations (single store, read-only, no OAuth flow needed since
     WooCommerce's key/secret model doesn't require one).
2. **`CAPABILITIES.md`** — what the agent can and cannot do:
   - Can: list orders, fetch an order by ID, search orders by customer/order-number — all
     read-only.
   - Cannot: create/update/cancel/refund orders, access other WooCommerce resources (customers,
     coupons, settings) beyond what's exposed, act outside the configured store, see data from
     any other WooCommerce instance.

**Exit criteria:** both docs exist and a stranger could follow the README to get the server
running against their own local WooCommerce instance in under 10 minutes.

---

## Stage 8 — Packaging & submission

- Scrub repo for secrets (`.env`, Consumer Key/Secret) — confirm `.gitignore` covers them;
  double-check no real credential ever got committed in history.
- Push to a public (or shareable) repo.
- Final pass: confirm the assignment's required elements are all clearly present — auth flow,
  list/get/search primitives, rate-limit handling, MCP tool spec, capabilities doc — and point
  to the exact file for each in the submission notes, including an honest note on how the
  rate-limit path was validated (simulated, since self-hosted WooCommerce has none natively).

**Exit criteria:** repo link + short cover note mapping each assignment requirement to where
it's implemented.

---

## Stretch (only if time remains after Stage 8)

- Add a `list_products` tool (inventory) to cover the assignment's "inventory" angle as well
  as orders, showing the pattern generalizes across WooCommerce resources.
- Add simple in-memory caching (e.g., 60s TTL on `list_orders`) to reduce redundant calls.
- Note in README how auth would change if targeting Zoho Inventory instead (full OAuth2
  authorization-code flow rather than a static key pair).
