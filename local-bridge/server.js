#!/usr/bin/env node
// Local MCP server for ProPresenter.
//
// ProPresenter's API (v1, ProPresenter 7.9+) is served by the ProPresenter
// app itself on the local network of the presentation computer — e.g.
// http://192.168.1.50:1025 — it is not reachable from the internet, so the
// Render-hosted server cannot call it directly. This script instead runs
// via stdio and is launched locally by Claude Desktop or Claude Code on
// (or near) the same network as ProPresenter.
//
// Find your exact port/endpoints: ProPresenter > Settings > Network >
// "API Documentation" button. Endpoint shapes can differ slightly by
// version, so `call_propresenter_endpoint` below is a general-purpose
// passthrough you point at whatever your installed version documents.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const HOST = process.env.PROPRESENTER_HOST || "127.0.0.1";
const PORT = process.env.PROPRESENTER_PORT || "1025";
const BASE_URL = `http://${HOST}:${PORT}`;

async function callProPresenter(path, method = "GET", body) {
  const res = await fetch(`${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new Error(`ProPresenter API error ${res.status}: ${text.slice(0, 500)}`);
  }
  return parsed;
}

const server = new McpServer({
  name: "propresenter-local",
  version: "1.0.0",
});

server.registerTool(
  "get_propresenter_status",
  {
    title: "Get ProPresenter status",
    description:
      "Fetches ProPresenter's current status (active presentation, active look, etc.) via GET /v1/status/layers.",
    inputSchema: {},
  },
  async () => {
    const data = await callProPresenter("/v1/status/layers", "GET");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.registerTool(
  "get_propresenter_library",
  {
    title: "Get ProPresenter library",
    description: "Lists items in the ProPresenter library via GET /v1/library.",
    inputSchema: {},
  },
  async () => {
    const data = await callProPresenter("/v1/library", "GET");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.registerTool(
  "call_propresenter_endpoint",
  {
    title: "Call any ProPresenter API endpoint",
    description:
      "General-purpose passthrough to your local ProPresenter's REST API. Use this for anything not covered by the other tools. Check Settings > Network > API Documentation inside ProPresenter for the exact endpoint list and payload shapes for your installed version, since these can differ between ProPresenter releases.",
    inputSchema: {
      path: z.string().describe("e.g. /v1/presentation/active"),
      method: z.enum(["GET", "PUT", "POST", "DELETE"]).default("GET"),
      body: z.record(z.any()).optional().describe("JSON body for PUT/POST requests"),
    },
  },
  async ({ path, method, body }) => {
    const data = await callProPresenter(path, method, body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
