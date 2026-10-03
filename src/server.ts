import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadWooCommerceConfig, whoami } from "./auth.js";

async function main() {
  const config = loadWooCommerceConfig();
  await whoami(config);
  console.error(`Authenticated against WooCommerce store at ${config.siteUrl}`);

  const server = new McpServer({ name: "woocommerce-connector", version: "0.1.0" });

  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Placeholder tool confirming the MCP server is wired up correctly.",
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text", text: "pong" }] })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("woocommerce-connector MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
