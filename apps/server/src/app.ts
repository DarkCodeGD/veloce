/**
 * The Veloce server: one local HTTP port serving
 *   /            the editor (static files)
 *   /render.html the headless render page (used by the render worker)
 *   /ws          live sync for editor tabs (WebSocket)
 *   /mcp         the MCP endpoint for AI agents (Streamable HTTP)
 *   /api/...     health, deck assets
 *
 * Security (it's a local server, but any website the user visits can try to reach it):
 * - Binds to loopback only by default.
 * - Every request's Host header must name this server (blocks DNS-rebinding attacks).
 * - Requests that carry an Origin (i.e. come from a browser page) must come from this server's
 *   own pages (blocks cross-site requests and cross-site WebSocket hijacking).
 * - Strict Content-Security-Policy on pages; assets are served with `sandbox`, so an SVG opened
 *   directly can't run scripts.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, sep } from "node:path";
import type { ServerMessage } from "@veloce/core";
import { type RenderService, SyncHub, type Workspace } from "@veloce/doc-server";
import { VeloceMcp } from "@veloce/mcp";
import type { PluginRegistry } from "@veloce/plugin-api";
import { WebSocketServer } from "ws";

export const VERSION = "0.0.0";

export interface VeloceServerOptions {
  workspace: Workspace;
  registry: PluginRegistry;
  /** Built editor (`apps/editor/dist`). Missing → a page explaining how to build it. */
  editorDir: string;
  /** Default 127.0.0.1. Only change this if you understand the risk: there's no login. */
  host?: string;
  /** Default 4321; 0 picks a free port. */
  port?: number;
  /** Builds the render service once the server's URL is known. `null` = no visual checks. */
  render?: ((baseUrl: string) => RenderService) | null;
  /** Extra browser origins allowed to call the server (e.g. the Vite dev server). */
  allowedOrigins?: string[];
  log?: (message: string) => void;
}

export interface VeloceServer {
  url: string;
  mcpUrl: string;
  server: Server;
  render: RenderService | null;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // the renderer sets inline styles on slide elements
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const ASSET_ROUTE = /^\/api\/decks\/([A-Za-z0-9_-]{1,64})\/assets\/([0-9a-f]{64})$/;

export async function startVeloceServer(options: VeloceServerOptions): Promise<VeloceServer> {
  const host = options.host ?? "127.0.0.1";
  const log = options.log ?? ((m: string) => console.log(m));
  const hub = new SyncHub(options.workspace);
  let render: RenderService | null = null;
  let mcp: VeloceMcp | null = null;
  let allowedHosts = new Set<string>();
  let allowedOrigins = new Set<string>();

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      log(
        `Request failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
      if (!res.headersSent) sendText(res, 500, "Internal error");
      else res.destroy();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const blocked = checkRequest(req);
    if (blocked) return sendText(res, 403, blocked);
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (path === "/mcp") {
      if (!mcp) return sendText(res, 503, "Starting up");
      return mcp.handleHttp(req, res);
    }
    if (path === "/api/health") {
      return sendJson(res, 200, { ok: true, name: "veloce", version: VERSION });
    }
    const asset = ASSET_ROUTE.exec(path);
    if (asset && req.method === "GET") return serveAsset(res, asset[1] ?? "", asset[2] ?? "");
    if (path.startsWith("/api/")) return sendText(res, 404, "Not found");
    if (req.method !== "GET" && req.method !== "HEAD")
      return sendText(res, 405, "Method not allowed");
    return serveStatic(res, path);
  }

  /** Returns a reason to refuse the request, or null if it's fine. */
  function checkRequest(req: IncomingMessage): string | null {
    const hostHeader = (req.headers.host ?? "").toLowerCase();
    if (!allowedHosts.has(hostHeader)) return "Forbidden: unexpected Host header";
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin.toLowerCase())) {
      return "Forbidden: cross-origin request";
    }
    return null;
  }

  async function serveAsset(res: ServerResponse, deckId: string, assetId: string): Promise<void> {
    if (!options.workspace.has(deckId)) return sendText(res, 404, "No such deck");
    const deck = await options.workspace.get(deckId);
    const info = deck.deck.assets[assetId];
    const bytes = deck.assetBytes(assetId);
    if (!info || !bytes) return sendText(res, 404, "No such asset");
    res.writeHead(200, {
      "content-type": info.mime,
      "content-length": bytes.length,
      // Content-addressed: the bytes behind this URL can never change.
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    res.end(bytes);
  }

  async function serveStatic(res: ServerResponse, path: string): Promise<void> {
    const root = normalize(options.editorDir);
    const decoded = safeDecode(path);
    const target = decoded === null ? null : normalize(join(root, decoded));
    if (!target || (target !== root && !target.startsWith(root + sep)))
      return sendText(res, 400, "Bad path");
    let file = target;
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = join(file, "index.html");
      info = await stat(file).catch(() => null);
    }
    if (!info?.isFile()) {
      if (extname(decoded ?? "")) return sendText(res, 404, "Not found");
      // App routes fall back to the editor shell.
      file = join(root, "index.html");
      info = await stat(file).catch(() => null);
      if (!info?.isFile()) return sendHtml(res, 503, NOT_BUILT_PAGE);
    }
    const type = MIME[extname(file)] ?? "application/octet-stream";
    const headers: Record<string, string | number> = {
      "content-type": type,
      "content-length": info.size,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": file.includes(`${sep}assets${sep}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    };
    if (type.startsWith("text/html")) headers["content-security-policy"] = PAGE_CSP;
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  }

  server.on("upgrade", (req, socket, head) => {
    const blocked = checkRequest(req);
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (blocked || path !== "/ws") {
      socket.end(`HTTP/1.1 ${blocked ? "403 Forbidden" : "404 Not Found"}\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const connection = hub.connect((message: ServerMessage) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
      });
      ws.on("message", (data, isBinary) => {
        if (isBinary) return;
        connection.receive(data.toString());
      });
      ws.on("close", () => connection.close());
      ws.on("error", () => connection.close());
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4321, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const { port } = server.address() as AddressInfo;
  const names =
    host === "127.0.0.1" || host === "localhost" || host === "::1"
      ? ["127.0.0.1", "localhost", "[::1]"]
      : [host];
  allowedHosts = new Set(names.map((n) => `${n}:${port}`));
  allowedOrigins = new Set(
    [...names.map((n) => `http://${n}:${port}`), ...(options.allowedOrigins ?? [])].map((o) =>
      o.toLowerCase(),
    ),
  );
  const url = `http://${host === "::1" ? "[::1]" : host}:${port}`;

  render = options.render ? options.render(url) : null;
  mcp = new VeloceMcp({
    workspace: options.workspace,
    registry: options.registry,
    render,
    ...(render === null && { renderUnavailable: "the server was started without a renderer" }),
    serverInfo: { name: "veloce", version: VERSION },
  });

  return {
    url,
    mcpUrl: `${url}/mcp`,
    server,
    render,
    async close() {
      for (const client of wss.clients) client.terminate();
      wss.close();
      await mcp?.close();
      await render?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await options.workspace.flush();
    },
  };
}

function safeDecode(path: string): string | null {
  try {
    const decoded = decodeURIComponent(path);
    return decoded.includes("\0") ? null : decoded;
  } catch {
    return null;
  }
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  res.end(text);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": PAGE_CSP,
  });
  res.end(html);
}

const NOT_BUILT_PAGE = `<!doctype html><meta charset="utf-8"><title>Veloce</title>
<body style="font:16px system-ui;padding:40px;max-width:640px">
<h1>The editor isn't built yet</h1>
<p>Run <code>pnpm build:editor</code> in the Veloce repo, then reload. The MCP endpoint at <code>/mcp</code> already works.</p>
</body>`;
