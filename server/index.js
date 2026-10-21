// Entry point: node server/index.js (or npm start).
import { loadDotEnv, getConfig } from './config.js';
import { setLogLevel, log } from './lib/log.js';
import { createApp } from './app.js';

loadDotEnv();
const cfg = getConfig();
setLogLevel(cfg.logLevel);
const app = await createApp(cfg);
const port = await app.listen();
log.info('Hungry Mango is running', { port, db: app.ctx.db.kind, tables: cfg.tableCount, publicUrl: cfg.publicUrl || `http://localhost:${port}` });

let stopping = false;
async function shutdown(sig) {
  if (stopping) return; stopping = true; log.info('shutting down', { signal: sig });
  const force = setTimeout(() => process.exit(1), 10_000); force.unref();
  try { await app.close(); process.exit(0); } catch (e) { log.error('shutdown failed', { err: String(e) }); process.exit(1); }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', e => log.error('unhandledRejection', { err: String(e?.stack || e) }));
