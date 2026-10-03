import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WooCommerceClient } from "../woocommerceClient.js";

export function registerSearchOrdersTool(server: McpServer, client: WooCommerceClient) {
  server.registerTool(
    "search_orders",
    {
      title: "Search WooCommerce Orders",
      description:
        "Search orders by customer name, email, or order number. Read-only — cannot create, update, or cancel orders.",
      inputSchema: {
        query: z.string().min(1).describe("Search text — matches customer name, email, or order number."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query }) => {
      try {
        const result = await client.searchOrders(query);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error searching orders: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );
}
