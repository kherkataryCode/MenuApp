export class HttpError extends Error {
  constructor(status, code, message, extra) { super(message || code); this.status = status; this.code = code; this.extra = extra; }
}
export const bad = (msg, code = 'bad_request') => new HttpError(400, code, msg);
export const unauthorized = (msg = 'Sign in required', code = 'unauthorized') => new HttpError(401, code, msg);
export const forbidden = (msg = 'Not allowed', code = 'forbidden') => new HttpError(403, code, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, 'not_found', msg);
export const conflict = (msg, code = 'conflict') => new HttpError(409, code, msg);
export const gone = (msg, code = 'gone') => new HttpError(410, code, msg);
export const tooMany = (retryAfter, msg = 'Too many requests. Slow down and try again.') => new HttpError(429, 'rate_limited', msg, { retryAfter });
