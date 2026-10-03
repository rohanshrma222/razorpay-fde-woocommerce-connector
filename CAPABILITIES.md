# Connector Capabilities

What an AI agent can and cannot do through this connector. This is the actual enforced
boundary, not aspirational — every claim below is backed by the code having no path to do
otherwise (no write/update/delete endpoint is called anywhere in `src/`).

## Summary

Read-only WooCommerce order connector. Three MCP tools. No tool, input, or error path can
mutate store state.

## Tools exposed

| Tool | Input schema | Notes |
|---|---|---|
| `list_orders` | `{ status?: "pending"\|"processing"\|"on-hold"\|"completed"\|"cancelled"\|"refunded"\|"failed"\|"trash", page?: number (default 1) }` | paginated, 10 per page |
| `get_order` | `{ order_id: number }` | single order by WooCommerce ID |
| `search_orders` | `{ query: string }` | matches customer name, email, or order number |

## What the agent CAN do

- List orders, optionally filtered by status, with pagination
- Fetch a single order by its numeric ID
- Search orders by customer name, email, or order number
- See the following fields per order: ID, status, currency, total, customer name/email, line
  items (product name + quantity), creation date

## What the agent CANNOT do

- **Cannot create, update, cancel, or refund an order** — no such tool exists, and no code
  path issues anything other than an HTTP `GET`.
- **Cannot touch any other WooCommerce resource** — products, customers, coupons, store
  settings, payment gateways, etc. are all out of scope; the connector only ever calls the
  `/wp-json/wc/v3/orders` endpoint family.
- **Cannot see or act on more than one store** — credentials are fixed per server instance.
- **Cannot do free-text search over order notes or line-item contents** — `search_orders` is
  WooCommerce's built-in `search` parameter (name/email/order number only), not a full-text
  search engine.
- **Cannot bypass rate limits** — requests that hit a 429 wait and retry within a fixed budget;
  they never hammer the API past what the server allows.
- **Cannot access real customer data** — the connector itself doesn't restrict this, but the
  dev/test environment it ships with only ever contains fictional seeded data.

## Data exposed per order

```json
{
  "id": 14,
  "status": "completed",
  "currency": "USD",
  "total": "59.99",
  "customer": { "firstName": "Rahul", "lastName": "Mehta", "email": "rahul.demo@example.test" },
  "lineItems": [{ "name": "Fictional Mechanical Keyboard", "quantity": 1 }],
  "dateCreated": "2026-10-02T17:21:22"
}
```

No payment details, addresses, phone numbers, or internal order notes are exposed — WooCommerce's raw order object contains more than this; the connector normalizes it down to this fixed shape before it ever reaches the agent.

## Error behavior

So an orchestrating agent/LLM can reason about retry-vs-give-up without inspecting raw HTTP:

| Situation | What the agent sees |
|---|---|
| Order ID doesn't exist | Tool result with `isError: true`, text `"Order <id> not found."` |
| Search finds nothing | Normal (non-error) result with `orders: []` — empty is not a failure |
| Rate-limited (429) | Handled internally with backoff/retry; only surfaces to the agent if retries are exhausted |
| Store unreachable / 5xx | Retried internally; surfaces as an `isError: true` result with a plain-language message if retries are exhausted |
| Bad credentials | Server fails to start at all — the agent never even sees a tool advertised |

## Trust & safety boundary

No tool call, under any input, can mutate WooCommerce state. This matters specifically against
prompt injection: if a malicious ticket, order note, or other agent-visible text instructs the
agent to "cancel this order" or "mark it as refunded," there is no tool this connector exposes
that could carry that out. The blast radius of this connector, even if fully compromised by
adversarial input, is limited to reading order data it's already authorized to read.
