import { watch } from "node:fs";
import { currentId, loadWalk, stateDir } from "./store.ts";
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

  // Watch the state directory so any CLI mutation (a new step, a comment, a new
  // walk) pushes a live update to every connected browser.
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const watcher = watch(stateDir(), () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(broadcast, 60);
  });

  const server = Bun.serve({
    port,
    idleTimeout: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/") {
        return new Response(renderPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (url.pathname === "/fragment") {
        return new Response(renderFragment(activeWalk()), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      if (url.pathname === "/api/walk") {
        return Response.json(activeWalk());
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

  return {
    port: server.port ?? port,
    stop: () => {
      watcher.close();
      server.stop(true);
    },
  };
}
