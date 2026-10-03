import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WooCommerceClient } from "../woocommerceClient.js";

const STATUS_VALUES = [
  "pending",
  "processing",
  "on-hold",
  "completed",
  "cancelled",
  "refunded",
  "failed",
  "trash",
] as const;

export function registerListOrdersTool(server: McpServer, client: WooCommerceClient) {
  server.registerTool(
    "list_orders",
    {
      title: "List WooCommerce Orders",
      description:
        "List orders from the WooCommerce store, optionally filtered by status. Read-only — cannot create, update, or cancel orders.",
      inputSchema: {
        status: z.enum(STATUS_VALUES).optional().describe("Filter by order status."),
        page: z.number().int().min(1).optional().default(1).describe("Page number, 1-indexed."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ status, page }) => {
      try {
        const result = await client.listOrders({ page, status });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error listing orders: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );
}
