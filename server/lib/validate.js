// Tiny schema validator: every request body passes through one of these before use.
import { bad } from './errors.js';
export const v = {
  str: (o = {}) => (x, k) => {
    if (x == null || x === '') { if (o.optional) return o.default ?? ''; throw bad(`${k} is required`); }
    if (typeof x !== 'string') throw bad(`${k} must be text`);
    const s = o.trim === false ? x : x.trim();
    if (!o.optional && !s) throw bad(`${k} is required`);
    if (s.length > (o.max ?? 200)) throw bad(`${k} is too long (max ${o.max ?? 200} characters)`);
    if (o.pattern && s && !o.pattern.test(s)) throw bad(`${k} has an invalid format`);
    return s;
  },
  int: (o = {}) => (x, k) => {
    if (x == null || x === '') { if (o.optional) return o.default; throw bad(`${k} is required`); }
    const n = Number(x); if (!Number.isInteger(n)) throw bad(`${k} must be a whole number`);
    if (n < (o.min ?? -Infinity) || n > (o.max ?? Infinity)) throw bad(`${k} must be between ${o.min} and ${o.max}`);
    return n;
  },
  bool: (o = {}) => (x, k) => { if (x == null) { if (o.optional) return o.default; throw bad(`${k} is required`); } if (typeof x !== 'boolean') throw bad(`${k} must be true or false`); return x; },
  oneOf: (vals, o = {}) => (x, k) => { if (x == null && o.optional) return o.default; if (!vals.includes(x)) throw bad(`${k} must be one of: ${vals.join(', ')}`); return x; },
  arr: (item, o = {}) => (x, k) => { if (x == null && o.optional) return o.default ?? []; if (!Array.isArray(x)) throw bad(`${k} must be a list`); if (x.length > (o.max ?? 50)) throw bad(`${k} has too many entries (max ${o.max ?? 50})`); return x.map((y, i) => item(y, `${k}[${i}]`)); },
  obj: (shape, o = {}) => (x, k = 'body') => {
    if (x == null && o.optional) return o.default;
    if (typeof x !== 'object' || x === null || Array.isArray(x)) throw bad(`${k} must be an object`);
    const out = {}; for (const [key, fn] of Object.entries(shape)) out[key] = fn(x[key], key); return out;
  },
};
export const check = (schema, input) => schema(input, 'body');
