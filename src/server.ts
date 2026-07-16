import { watch } from "node:fs";
import {
  clearServerInfo,
  currentId,
  getFocus,
  listReplies,
  loadWalk,
  setServerInfo,
  stateDir,
  writeReply,
} from "./store.ts";
import { renderFragment, renderPage } from "./render/html.ts";
import type { Walk } from "./types.ts";

function activeWalk(): Walk | null {
  const id = currentId();
  if (!id) return null;
  try {
    return loadWalk(id);
  } catch {
    return null;
  }
}

export function serve(port: number): { port: number; stop: () => void } {
  const clients = new Set<ReadableStreamDefaultController>();
  const encoder = new TextEncoder();

  const broadcast = () => {
    for (const ctrl of clients) {
      try {
        ctrl.enqueue(encoder.encode(`event: update\ndata: 1\n\n`));
      } catch {
        clients.delete(ctrl);
      }
    }
  };

  // Watch the state directory (recursively, so the replies/ subdir counts) so
  // any CLI mutation — a new step, a comment, a reply, a focus change — pushes a
  // live update to every connected browser.
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const watcher = watch(stateDir(), { recursive: true }, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(broadcast, 60);
  });

  const fragment = () => renderFragment(activeWalk(), { focus: getFocus(), replies: listReplies() });

  const server = Bun.serve({
    port,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/") {
        return new Response(renderPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      if (url.pathname === "/fragment") {
        return new Response(fragment(), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }

      if (url.pathname === "/api/walk") {
        return Response.json(activeWalk());
      }

      // The browser composer POSTs a comment here; it lands in the same inbox a
      // pane reply would, so the agent's blocking `walk await` picks it up.
      if (url.pathname === "/api/reply" && req.method === "POST") {
        try {
          const body = (await req.json()) as { text?: string; stepId?: string | null };
          const text = (body.text ?? "").trim();
          if (!text) return Response.json({ ok: false, error: "empty" }, { status: 400 });
          const reply = writeReply(text, { stepId: body.stepId ?? null, source: "web" });
          return Response.json({ ok: true, reply });
        } catch (e) {
          return Response.json({ ok: false, error: String(e) }, { status: 400 });
        }
      }

      if (url.pathname === "/events") {
        const stream = new ReadableStream({
          start(ctrl) {
            clients.add(ctrl);
            ctrl.enqueue(encoder.encode(`event: update\ndata: hello\n\n`));
          },
          cancel() {
            /* client list is pruned lazily on failed enqueue */
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      }

      return new Response("not found", { status: 404 });
    },
  });

  setServerInfo({ port: server.port ?? port, pid: process.pid });

  return {
    port: server.port ?? port,
    stop: () => {
      watcher.close();
      server.stop(true);
      clearServerInfo();
    },
  };
}
