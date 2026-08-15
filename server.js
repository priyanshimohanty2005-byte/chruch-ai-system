import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  listServiceTypes,
  listPlans,
  getPlan,
  getPlanItems,
  createPlanItem,
} from "./lib/planningCenter.js";

const app = express();
app.use(express.json());

// One MCP server + transport per active session, kept in memory.
const transports = {};

function buildServer() {
  const server = new McpServer({
    name: "church-planning-center",
    version: "1.0.0",
  });

  server.registerTool(
    "list_service_types",
    {
      title: "List Planning Center service types",
      description:
        "Lists the service types configured in Planning Center Services (e.g. 'Sunday Morning', 'Youth Night'). You need a service_type_id to look up plans.",
      inputSchema: {},
    },
    async () => {
      const types = await listServiceTypes();
      return { content: [{ type: "text", text: JSON.stringify(types, null, 2) }] };
    }
  );

  server.registerTool(
    "list_plans",
    {
      title: "List upcoming plans for a service type",
      description:
        "Lists upcoming (or all) service plans for a given Planning Center service_type_id.",
      inputSchema: {
        service_type_id: z.string().describe("Planning Center service_type id"),
        only_future: z
          .boolean()
          .optional()
          .default(true)
          .describe("If true (default), only return upcoming plans."),
      },
    },
    async ({ service_type_id, only_future }) => {
      const plans = await listPlans(service_type_id, { onlyFuture: only_future });
      return { content: [{ type: "text", text: JSON.stringify(plans, null, 2) }] };
    }
  );

  server.registerTool(
    "get_plan",
    {
      title: "Get a single plan's details",
      description: "Returns the title, dates, and series info for one plan.",
      inputSchema: {
        service_type_id: z.string(),
        plan_id: z.string(),
      },
    },
    async ({ service_type_id, plan_id }) => {
      const plan = await getPlan(service_type_id, plan_id);
      return { content: [{ type: "text", text: JSON.stringify(plan, null, 2) }] };
    }
  );

  server.registerTool(
    "get_plan_items",
    {
      title: "Get the full order of service for a plan",
      description:
        "Returns every item in a plan's running order in sequence — headers, songs (with title/author), media, and other items. This is the data you need to build a ProPresenter playlist or Playback set list.",
      inputSchema: {
        service_type_id: z.string(),
        plan_id: z.string(),
      },
    },
    async ({ service_type_id, plan_id }) => {
      const items = await getPlanItems(service_type_id, plan_id);
      return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
    }
  );

  server.registerTool(
    "create_plan_item",
    {
      title: "Add an item to a plan's order of service",
      description:
        "Creates a new item (e.g. an announcement or header) in a plan's running order. Use this only after the person has confirmed the change — this writes directly to the church's live Planning Center plan.",
      inputSchema: {
        service_type_id: z.string(),
        plan_id: z.string(),
        title: z.string(),
        item_type: z
          .enum(["item", "header", "song", "media"])
          .optional()
          .default("item"),
        sequence: z.number().optional().describe("Position in the order, if known"),
      },
    },
    async ({ service_type_id, plan_id, title, item_type, sequence }) => {
      const created = await createPlanItem(service_type_id, plan_id, {
        title,
        itemType: item_type,
        sequence,
      });
      return { content: [{ type: "text", text: JSON.stringify(created, null, 2) }] };
    }
  );

  return server;
}

// --- AUTH TEMPORARILY DISABLED FOR INITIAL TESTING ---
// checkAuth() is no longer called below. Your server currently accepts
// requests from anyone who has the URL. Re-enable before real church use.
function checkAuth(req, res) {
  const expected = process.env.MCP_AUTH_TOKEN;
  if (!expected) {
    res.status(500).json({ error: "Server misconfigured: MCP_AUTH_TOKEN not set." });
    return false;
  }
  const header = req.headers["authorization"] || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// --- MCP endpoint: client-to-server messages, including session init ---
app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];
    let transport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) delete transports[transport.sessionId];
      };

      const server = buildServer();
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP POST error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error", data: String(err?.message || err) },
        id: null,
      });
    }
  }
});

// --- MCP endpoint: server-to-client stream (notifications) ---
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

// --- MCP endpoint: session termination ---
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

// Health check
app.get("/", (req, res) => {
  res.status(200).send("Church AI MCP server is running.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Church AI MCP server listening on port ${PORT}`);
});
