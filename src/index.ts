#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initializePyodide, createMCPServer } from "./handlers/index.js";
import { runSSEServer } from "./sse.js";
import { initLogger } from "./utils/logger.js";

global.logger = initLogger("Oraichain Pyiodide MCP Server");

async function runServer() {
  const args = process.argv.slice(2);
  const useSSE = args.includes("--sse");
  await initializePyodide();

  if (useSSE) {
    await runSSEServer();
  } else {
    const server = createMCPServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.error("Pyodide MCP Server running on stdio");
  }
}

// Main entry point
runServer().catch((error: unknown) => {
  logger.error("Fatal error starting server:", error);
  process.exit(1);
});
