// Server-Sent Events: one long-lived HTTP response per browser. Works through
// proxies and load balancers, reconnects automatically, no extra library needed.
export function openStream(req, res, { onClose, retryMs = 3000 } = {}) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`retry: ${retryMs}\n\n`);
  const beat = setInterval(() => res.write(': ping\n\n'), 20_000);
  let open = true;
  const close = () => { if (!open) return; open = false; clearInterval(beat); onClose && onClose(); };
  req.on('close', close); res.on('error', close);
  return {
    send(event, data) { if (open) res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`); },
    end() { if (open) { res.end(); close(); } },
    get open() { return open; },
  };
}
