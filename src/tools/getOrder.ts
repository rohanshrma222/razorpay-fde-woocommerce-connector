import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WooCommerceClient } from "../woocommerceClient.js";
import { OrderNotFoundError } from "../types.js";

export function registerGetOrderTool(server: McpServer, client: WooCommerceClient) {
  server.registerTool(
    "get_order",
    {
      title: "Get WooCommerce Order",
      description:
        "Fetch a single WooCommerce order by its numeric ID. Read-only — cannot modify, cancel, or refund the order.",
      inputSchema: {
        order_id: z.number().int().positive().describe("WooCommerce numeric order ID."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ order_id }) => {
      try {
        const order = await client.getOrder(order_id);
        return {
          content: [{ type: "text", text: JSON.stringify(order, null, 2) }],
          structuredContent: order as unknown as Record<string, unknown>,
        };
      } catch (err) {
        if (err instanceof OrderNotFoundError) {
          return {
            content: [{ type: "text", text: `Order ${order_id} not found.` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: `Error fetching order: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );
}
