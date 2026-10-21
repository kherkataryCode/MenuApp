// Load the starter menu (15 photo cutouts + drawn drinks/desserts).
//   npm run seed            only when the menu is empty
//   npm run seed -- --force replace the whole menu (orders are kept)
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv, getConfig } from '../config.js';
import { openDb } from '../db/index.js';
import { createBus } from '../bus/index.js';
import { createRestaurant } from '../services/restaurant.js';

loadDotEnv(); const cfg = getConfig(); const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const db = await openDb(cfg.databaseUrl); const bus = await createBus(db); const svc = createRestaurant({ db, bus, cfg });
const force = process.argv.includes('--force');
if (!force && !await svc.isMenuEmpty()) { console.log('Menu already has items. Use --force to replace it.'); }
else {
  if (force) { await db.run('DELETE FROM items'); await db.run('DELETE FROM categories'); }
  const menu = JSON.parse(await readFile(join(ROOT, 'seed', 'menu.json'), 'utf8'));
  await svc.seed(menu, f => readFile(join(ROOT, 'seed', 'images', f)));
  console.log(`Seeded ${menu.categories.length} categories and ${menu.items.length} items.`);
}
await bus.close(); await db.close();
