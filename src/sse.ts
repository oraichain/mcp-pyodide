import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express, { Request } from "ultimate-express";
import bodyParser from "body-parser";
import cors from "cors";
import { createMCPServer } from "./handlers/index.js";

const transports: Record<string, SSEServerTransport> = {};

function getClientIp(req: Request): string {
  return (
    req.get("x-forwarded-for")?.split(",")[0] ||
    req.get("x-real-ip") ||
    req.ip ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

export async function runSSEServer() {
  const app = express();

  // Enable CORS
  app.use(
    cors({
      origin: "*",
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type"],
    })
  );

  // Used to allow parsing of the body of the request
  app.use(bodyParser.json());

  app.get("/sse", async (req, res) => {
    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const server = createMCPServer();
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    transports[sessionId] = transport;
    transport.onclose = () => {
      logger.debug(`SSE transport closed for session ${sessionId}`);
      delete transports[sessionId];
    };
    await server.connect(transport);

    res.on("close", () => {
      logger.debug(`Client disconnected for session ${sessionId}`);
      delete transports[sessionId];
    });
  });

  app.post("/messages", async (req: Request, res) => {
    logger.debug("Received POST request to /messages");

    // Extract session ID from URL query parameter
    // In the SSE protocol, this is added by the client based on the endpoint event
    const sessionId = req.query.sessionId as string | undefined;

    if (!sessionId) {
      logger.error("No session ID provided in request URL");
      res.status(400).json({
        error: "No Connection",
        message: "Missing sessionId parameter",
      });
      return;
    }

    const transport = transports[sessionId];
    if (!transport) {
      logger.error(`No active transport found for session ID: ${sessionId}`);
      res.status(404).json({
        error: "No Connection",
        message: "No active SSE connection",
      });
      return;
    }
    try {
      // Parse the body and add the IP address
      const body = req.body;
      const params = req.body.params || {};
      params._meta = {
        ip: getClientIp(req),
        headers: req.headers,
      };
      const enrichedBody = {
        ...body,
        params,
      };

      await transport.handlePostMessage(req, res, enrichedBody);
    } catch (error) {
      logger.error("Error handling message:", error);
      res.status(500).json({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Handle 404s for all other routes
  app.use((req, res) => {
    res.status(404).json({
      error: "Not Found",
      message: `Route ${req.method} ${req.path} not found`,
      timestamp: new Date().toISOString(),
    });
  });

  const port = 3020;
  app.listen(port, () => {
    logger.info(
      `pyodide MCP Server running on SSE at http://localhost:${port}`
    );
  });
}
