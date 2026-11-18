/**
 * VeloceMcp: the MCP server, running in-process next to the doc-server (D9).
 *
 * One MCP `Server` per agent session (the SDK binds a server to one transport). Sessions reach
 * us over Streamable HTTP (`handleHttp`) or any SDK transport (`createServer().connect(...)`,
 * used by tests and, later, a stdio shim).
 *
 * Security: this class trusts its caller to have checked the request (Host/Origin headers
 * against DNS rebinding); `apps/server` does that for every route.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  isInitializeRequest,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { AgentOrigin } from "@veloce/core";
import type { RenderService, Workspace } from "@veloce/doc-server";
import type { PluginRegistry } from "@veloce/plugin-api";
import { INSTRUCTIONS } from "./docs.js";
import { deckSummary } from "./summary.js";
import { AgentSession, callTool, TOOLS, type ToolContext, toolInputSchema } from "./tools.js";

export interface VeloceMcpOptions {
  workspace: Workspace;
  registry: PluginRegistry;
  /** Headless renderer for lint measurements and previews; `null` disables visual checks. */
  render: RenderService | null;
  /** Why `render` is null (shown to agents), e.g. "Chromium isn't installed". */
  renderUnavailable?: string;
  serverInfo?: { name: string; version: string };
  /** Most concurrent HTTP sessions kept; the least recently used is closed beyond this. */
  maxSessions?: number;
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** `"Claude Code"` → `"agent:claude-code"`. */
export function agentOrigin(clientName: string | undefined): AgentOrigin {
  const id = (clientName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `agent:${id || "unknown"}`;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: Server;
  lastUsed: number;
}

export class VeloceMcp {
  readonly #options: VeloceMcpOptions;
  readonly #sessions = new Map<string, Session>();

  constructor(options: VeloceMcpOptions) {
    this.#options = options;
  }

  /** A new MCP server for one client session. Connect it to any MCP transport. */
  createServer(): Server {
    const { workspace, registry, render, renderUnavailable, serverInfo } = this.#options;
    const server = new Server(serverInfo ?? { name: "veloce", version: "0.0.0" }, {
      capabilities: { tools: {}, resources: {} },
      instructions: INSTRUCTIONS,
    });
    let origin: AgentOrigin | null = null;
    const session = new AgentSession();
    const context = (): ToolContext => {
      origin ??= agentOrigin(server.getClientVersion()?.name);
      return {
        workspace,
        registry,
        render,
        origin,
        session,
        ...(renderUnavailable && { renderUnavailable }),
      };
    };

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: toolInputSchema(tool) as { type: "object" },
        ...(tool.annotations && { annotations: tool.annotations }),
      })),
    }));
    server.setRequestHandler(
      CallToolRequestSchema,
      // ToolResult is a CallToolResult (text and image content); the SDK's own type is a wide union.
      async (request): Promise<CallToolResult> =>
        callTool(
          request.params.name,
          request.params.arguments,
          context(),
        ) as Promise<CallToolResult>,
    );
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        { uri: "deck://current/summary", name: "Current deck outline", mimeType: "text/plain" },
        {
          uri: "deck://current/theme",
          name: "Current deck theme tokens",
          mimeType: "application/json",
        },
      ],
    }));
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      const id = workspace.activeDeckId;
      const deck = id ? (await workspace.get(id)).deck : null;
      if (uri === "deck://current/summary") {
        const body = deck ? deckSummary(deck) : "No deck is open.";
        return { contents: [{ uri, mimeType: "text/plain", text: body }] };
      }
      if (uri === "deck://current/theme") {
        return {
          contents: [
            { uri, mimeType: "application/json", text: JSON.stringify(deck?.theme ?? null) },
          ],
        };
      }
      throw new Error(
        `Unknown resource ${uri}. Resources: deck://current/summary, deck://current/theme`,
      );
    });
    return server;
  }

  /** Handle one Streamable HTTP request to the MCP endpoint (POST/GET/DELETE). */
  async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const header = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(header) ? header[0] : header;
    const existing = sessionId ? this.#sessions.get(sessionId) : undefined;

    let body: unknown;
    if (req.method === "POST") {
      try {
        body = await readJson(req);
      } catch (error) {
        return jsonRpcError(
          res,
          400,
          -32700,
          error instanceof Error ? error.message : "Invalid JSON",
        );
      }
    }

    if (existing) {
      existing.lastUsed = Date.now();
      return existing.transport.handleRequest(req, res, body);
    }
    if (sessionId)
      return jsonRpcError(res, 404, -32001, "Session not found. Start a new session (initialize).");
    if (req.method !== "POST" || !isInitializeRequest(body)) {
      return jsonRpcError(
        res,
        400,
        -32000,
        "No session: the first request must be an initialize request.",
      );
    }

    const server = this.createServer();
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        this.#sessions.set(id, { transport, server, lastUsed: Date.now() });
        this.#evictIdleSessions();
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) this.#sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  get sessionCount(): number {
    return this.#sessions.size;
  }

  async close(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.all(sessions.map((s) => s.server.close().catch(() => {})));
  }

  #evictIdleSessions(): void {
    const max = this.#options.maxSessions ?? 64;
    if (this.#sessions.size <= max) return;
    const oldest = [...this.#sessions.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [id, session] of oldest.slice(0, this.#sessions.size - max)) {
      this.#sessions.delete(id);
      void session.server.close().catch(() => {});
    }
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES)
      throw new Error(`Request body too large (limit ${MAX_BODY_BYTES} bytes)`);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Request body isn't valid JSON");
  }
}

function jsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}
