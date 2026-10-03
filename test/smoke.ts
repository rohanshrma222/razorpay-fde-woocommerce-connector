import assert from "node:assert/strict";
import http from "node:http";
import "dotenv/config";
import { loadWooCommerceConfig, whoami, WooCommerceAuthError } from "../src/auth.js";
import { createWooCommerceClient } from "../src/woocommerceClient.js";
import { requestWithRetry } from "../src/rateLimiter.js";
import { OrderNotFoundError, WooCommerceHttpError } from "../src/types.js";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}: ${(err as Error).message}`);
    failed++;
    process.exitCode = 1;
  }
}

const config = loadWooCommerceConfig();
const client = createWooCommerceClient(config);

await test("whoami() succeeds with valid credentials", async () => {
  const result = await whoami(config);
  assert.equal(result.siteUrl, config.siteUrl);
});

let firstOrderId: number | undefined;

await test("listOrders() returns orders with the expected shape", async () => {
  const result = await client.listOrders({ page: 1 });
  assert.ok(Array.isArray(result.orders));
  assert.ok(result.orders.length > 0, "expected at least one seeded order");
  const first = result.orders[0];
  firstOrderId = first.id;
  for (const key of ["id", "status", "currency", "total", "customer", "lineItems", "dateCreated"]) {
    assert.ok(key in first, `missing key "${key}" on normalized order`);
  }
});

await test("listOrders({ status: 'cancelled' }) filters correctly", async () => {
  const result = await client.listOrders({ status: "cancelled" });
  for (const order of result.orders) {
    assert.equal(order.status, "cancelled");
  }
});

await test("getOrder(<real id>) returns the matching order", async () => {
  const orderId = Number(process.env.TEST_ORDER_ID) || firstOrderId;
  assert.ok(orderId, "no order id available to test against");
  const order = await client.getOrder(orderId);
  assert.equal(order.id, orderId);
});

await test("getOrder(<missing id>) throws OrderNotFoundError", async () => {
  await assert.rejects(() => client.getOrder(999999), OrderNotFoundError);
});

await test("searchOrders('Rahul') finds the seeded customer", async () => {
  const result = await client.searchOrders("Rahul");
  assert.ok(result.orders.length > 0);
  assert.ok(result.orders.some((o) => o.customer.firstName === "Rahul"));
});

await test("searchOrders(<no match>) returns an empty list, not an error", async () => {
  const result = await client.searchOrders("NoSuchCustomerXYZ123");
  assert.deepEqual(result.orders, []);
});

await test("bad credentials are rejected, not crashed on", async () => {
  const badConfig = { ...config, consumerKey: "ck_invalid", consumerSecret: "cs_invalid" };
  const badClient = createWooCommerceClient(badConfig);
  await assert.rejects(() => badClient.listOrders({ page: 1 }), WooCommerceHttpError);
  await assert.rejects(() => whoami(badConfig), WooCommerceAuthError);
});

await test("rate-limit retry path (simulated 429, since self-hosted WooCommerce has no native limiter)", async () => {
  let hitCount = 0;
  const server = http.createServer((_req, res) => {
    hitCount++;
    if (hitCount === 1) {
      res.writeHead(429, { "Retry-After": "1" });
      res.end("Too Many Requests");
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;

  const logs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => logs.push(args.join(" "));

  try {
    const res = await requestWithRetry(`http://localhost:${port}/`, { method: "GET" }, { maxRetries: 3 });
    assert.equal(res.status, 200);
    assert.equal(hitCount, 2, "expected exactly one retry");
  } finally {
    console.error = originalError;
    server.close();
  }

  const retryLog = logs.find((l) => l.includes("[retry] 429"));
  assert.ok(retryLog, "expected a [retry] 429 log line");
  console.log(`  (annotated evidence) ${retryLog}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
