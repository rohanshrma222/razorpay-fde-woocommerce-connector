import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadWooCommerceConfig, whoami } from "./auth.js";
import { createWooCommerceClient } from "./woocommerceClient.js";
import { registerListOrdersTool } from "./tools/listOrders.js";
import { registerGetOrderTool } from "./tools/getOrder.js";
import { registerSearchOrdersTool } from "./tools/searchOrders.js";

async function main() {
  const config = loadWooCommerceConfig();
  await whoami(config);
  console.error(`Authenticated against WooCommerce store at ${config.siteUrl}`);

  const client = createWooCommerceClient(config, {
    timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 10000),
    maxRetries: Number(process.env.RATE_LIMIT_MAX_RETRIES ?? 3),
  });

  const server = new McpServer({ name: "woocommerce-connector", version: "0.1.0" });
  registerListOrdersTool(server, client);
  registerGetOrderTool(server, client);
  registerSearchOrdersTool(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("woocommerce-connector MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
