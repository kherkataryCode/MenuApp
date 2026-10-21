// Static file server for /web with ETags, long-cache for fingerprinted assets and
// on-the-fly gzip/brotli (compressed once, then kept in memory).
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest', '.txt']);

export function createStatic(root, { production }) {
  const cache = new Map();
  async function load(file) {
    const st = await stat(file); const hit = cache.get(file);
    if (hit && hit.mtime === st.mtimeMs) return hit;
    const raw = await readFile(file); const ext = extname(file);
    const entry = { mtime: st.mtimeMs, raw, type: TYPES[ext] || 'application/octet-stream', etag: '"' + createHash('sha1').update(raw).digest('base64url').slice(0, 20) + '"' };
    if (COMPRESSIBLE.has(ext) && raw.length > 1024) { entry.br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }); entry.gz = gzipSync(raw, { level: 9 }); }
    cache.set(file, entry); return entry;
  }
  return async function serve(req, res, urlPath) {
    let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    const file = join(root, rel); if (!file.startsWith(root + sep) && file !== root) return false;
    let e; try { e = await load(file); } catch { return false; }
    const headers = { 'Content-Type': e.type, ETag: e.etag, Vary: 'Accept-Encoding',
      'Cache-Control': /\.html$/.test(file) ? 'no-cache' : (production ? 'public, max-age=3600, stale-while-revalidate=86400' : 'no-cache') };
    if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, headers); res.end(); return true; }
    const ae = String(req.headers['accept-encoding'] || ''); let body = e.raw;
    if (e.br && /\bbr\b/.test(ae)) { body = e.br; headers['Content-Encoding'] = 'br'; } else if (e.gz && /\bgzip\b/.test(ae)) { body = e.gz; headers['Content-Encoding'] = 'gzip'; }
    headers['Content-Length'] = body.length; res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : body); return true;
  };
}
