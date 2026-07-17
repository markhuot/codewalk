import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { watch } from "node:fs";
import {
  addCommentToCurrentStep,
  clearServerInfo,
  currentReplies,
  getFocus,
  getSession,
  setServerInfo,
  stateDir,
  writeReply,
} from "./store.ts";
import { renderFragment, renderPage } from "./render/html.ts";
import type { LineComment } from "./types.ts";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function serve(port: number): { port: number; stop: () => void } {
  const clients = new Set<ServerResponse>();

  const broadcast = () => {
    for (const res of clients) {
      try {
        res.write(`event: update\ndata: 1\n\n`);
      } catch {
        clients.delete(res);
      }
    }
  };

  // Watch the state directory (recursively, so replies/ counts) so any CLI
  // mutation pushes a live update to every connected browser.
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const watcher = watch(stateDir(), { recursive: true }, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(broadcast, 60);
  });

  const fragment = () => renderFragment(getSession(), { focus: getFocus(), replies: currentReplies() });

  const html = (res: ServerResponse, body: string, cache = true) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...(cache ? {} : { "cache-control": "no-store" }) });
    res.end(body);
  };
  const json = (res: ServerResponse, status: number, obj: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (path === "/") return html(res, renderPage());
    if (path === "/fragment") return html(res, fragment(), false);
    if (path === "/api/health") return json(res, 200, { codewalk: true, pid: process.pid });
    if (path === "/api/session") return json(res, 200, getSession());

    // The browser "complete step" POSTs a submission: a message plus staged line
    // comments. It lands in the same inbox a pane reply would.
    if (path === "/api/reply" && req.method === "POST") {
      try {
        const data = JSON.parse((await readBody(req)) || "{}") as {
          text?: string;
          message?: string;
          stepId?: string | null;
          comments?: LineComment[];
        };
        const message = (data.message ?? data.text ?? "").trim();
        const comments = Array.isArray(data.comments) ? data.comments : [];
        if (!message && comments.length === 0) return json(res, 400, { ok: false, error: "empty" });
        const stepId = data.stepId ?? null;
        for (const c of comments) {
          const label = c.endLine && c.endLine > c.line ? `(lines ${c.line}–${c.endLine}) ${c.text}` : c.text;
          addCommentToCurrentStep({ file: c.file, line: c.line, side: c.side, body: label });
        }
        const reply = writeReply(message, { stepId, source: "web", comments });
        return json(res, 200, { ok: true, reply });
      } catch (e) {
        return json(res, 400, { ok: false, error: String(e) });
      }
    }

    if (path === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      req.socket.setTimeout(0); // never time out a long-lived SSE connection
      res.write(`event: update\ndata: hello\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  server.requestTimeout = 0; // don't kill the SSE stream
  server.on("error", (err) => {
    console.error(`codewalk server: ${err.message}`);
    process.exit(1);
  });
  server.listen(port);
  setServerInfo({ port, pid: process.pid });

  return {
    port,
    stop: () => {
      watcher.close();
      for (const res of clients) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
      server.close();
      clearServerInfo();
    },
  };
}
