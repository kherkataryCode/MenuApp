// Event bus for live updates. In-memory for a single instance; PostgreSQL
// LISTEN/NOTIFY when several instances share one database, so an order placed on
// instance A reaches an admin connected to instance B.
import { EventEmitter } from 'node:events';
import { log } from '../lib/log.js';

export async function createBus(db) {
  const em = new EventEmitter(); em.setMaxListeners(0);
  const deliver = evt => em.emit('event', evt);
  if (db.kind !== 'postgres') {
    return { publish: async evt => deliver(evt), subscribe: fn => { em.on('event', fn); return () => em.off('event', fn); }, close: async () => {} };
  }
  const client = await db.pool.connect();
  await client.query('LISTEN hm_events');
  client.on('notification', m => { try { deliver(JSON.parse(m.payload)); } catch (e) { log.warn('bad bus payload', { err: String(e) }); } });
  client.on('error', e => log.error('bus connection error', { err: String(e) }));
  return {
    publish: async evt => { await db.pool.query('SELECT pg_notify($1, $2)', ['hm_events', JSON.stringify(evt)]); },
    subscribe: fn => { em.on('event', fn); return () => em.off('event', fn); },
    close: async () => { try { await client.query('UNLISTEN *'); } finally { client.release(); } },
  };
}
