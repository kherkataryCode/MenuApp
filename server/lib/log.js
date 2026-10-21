// Structured JSON logs (one line per event) — easy to ship to any log platform.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
let min = LEVELS[process.env.LOG_LEVEL || 'info'] ?? 20;
export function setLogLevel(l) { min = LEVELS[l] ?? min; }
function emit(level, msg, fields) {
  if (LEVELS[level] < min) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}
export const log = {
  debug: (m, f) => emit('debug', m, f), info: (m, f) => emit('info', m, f),
  warn: (m, f) => emit('warn', m, f), error: (m, f) => emit('error', m, f),
};
