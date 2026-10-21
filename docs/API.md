# HTTP API reference

Base URL: your `PUBLIC_URL`. All bodies are JSON (`Content-Type: application/json`) unless stated. All responses are JSON unless stated.

## Conventions

**Errors** always look like:

```json
{ "error": "wrong_code", "message": "That code doesn't match. Check the card on your table." }
```

`message` is written for end users and safe to show. Rate-limited responses (`429`) also include `retryAfter` (seconds) and a `Retry-After` header.

| Status | Meaning |
|---|---|
| 400 | Invalid input (`bad_request`, `empty_plate`, `bad_image`) |
| 401 | Not signed in / not joined (`unauthorized`, `not_joined`, `bad_credentials`) |
| 403 | Wrong code, missing CSRF header, or role not allowed (`wrong_code`, `csrf`, `forbidden`) |
| 404 | Not found |
| 409 | Conflict (`table_closed`, `already_open`, `not_open`, `sold_out`, `bad_transition`, `stale`, `category_not_empty`) |
| 410 | The table seating has ended (`session_closed`) |
| 413 / 415 | Body too large / not JSON |
| 429 | Rate limited (`rate_limited`) |

**Guest writes** (POST/PUT under `/api/tables/*/join` and `/api/session/*`) require header `x-hm: 1`.

**Admin writes** require header `x-csrf-token: <csrf>` (from sign-in or `/api/admin/me`).

**Cookies:** `hm_guest` (guest, set by join), `hm_admin` (staff, set by sign-in). Both HttpOnly.

---

## Public

### `GET /api/config`
`{ "name": "Hungry Mango", "tables": 12, "publicUrl": "https://menu.example.com" }`

### `GET /api/menu`
Visible categories and dishes, plus offers. Supports `If-None-Match` (returns 304).

```json
{
  "cats": [{ "id": "pizzas", "name": "Pizzas", "color": "#FFC531", "sort": 1, "hidden": false }],
  "items": [{ "id": "p1", "cat": "pizzas", "name": "Margherita Burrata Bloom", "price": 399, "veg": true,
              "desc": "...", "ings": [{ "e": "🍅", "l": "Tomato" }], "image": "/img/1a4a…", "anim": "spin",
              "available": true, "sort": 1 }],
  "offers": { "gst": 5, "free": { "on": true, "at": 1000, "item": "d3" },
              "combo": { "on": true, "a": "burgers", "b": "sips", "off": 40 },
              "big": { "on": true, "at": 2000, "pct": 10 } },
  "version": "9f2c…"
}
```

`image` is either `/img/<hash>` (a photo) or `d:<id>` (a drawn illustration rendered by the browser).

### `GET /img/:id`
The image bytes. `Cache-Control: public, max-age=31536000, immutable`.

### `GET /api/tables/:n/status`
`{ "table": 3, "open": true }`. Never reveals the code.

### `POST /api/tables/:n/join`
Body `{ "code": "4821" }`. Sets the `hm_guest` cookie.
→ `200 { "guest": { "id": "…", "nick": "Midnight Lassi", "emoji": "🥛" }, "table": 3 }`
Errors: `403 wrong_code`, `409 table_closed`, `429`.

---

## Guest (requires `hm_guest` cookie)

### `GET /api/session` — table snapshot
```json
{
  "table": 3,
  "me": { "id": "g1", "nick": "Midnight Lassi", "emoji": "🥛" },
  "guests": [{ "id": "g1", "nick": "Midnight Lassi", "emoji": "🥛", "joined_at": 1729500000000 }],
  "plate": [{ "item": "b1", "guest": "g1", "qty": 2 }],
  "bill": { "subtotal": 807, "combo": 40, "big": 0, "gst": 38, "total": 805,
            "offers": [{ "id": "combo", "label": "Combo deal ×1", "amount": -40 }],
            "freebies": [], "nudge": { "need": 193, "reward": "a free Masala Lemonade", "at": 1000 }, "...": "…" },
  "orders": [ /* see Order below */ ]
}
```
`410 session_closed` when the table has been closed.

### `POST /api/session/plate`
Body `{ "item": "b1", "delta": 1 }` (−50…50). Adds to *your own* line. → snapshot.

### `PUT /api/session/plate/:item/:guestId`
Body `{ "qty": 0 }` (0…50). Edits any line on the shared plate; 0 removes it. → snapshot.

### `POST /api/session/name`
Body `{}`. New random funny name, unique at the table. → snapshot.

### `POST /api/session/orders`
Body `{ "note": "less spicy" }` (≤140 chars). Optional header `Idempotency-Key: <uuid>`: retries with the same key return the same order.
→ `201 { "order": Order, "session": snapshot }`
Errors: `400 empty_plate`, `409 sold_out`, `410 session_closed`, `429` (cooldown).

### `POST /api/session/call`
Body `{ "type": "server" | "bill" }`.

### `GET /api/session/stream` — Server-Sent Events
Events: `hello`, `plate`, `guests`, `orders`, `menu`, `closed`. Payloads are empty or minimal; re-fetch `/api/session` or `/api/menu`.

### Order
```json
{ "id": "…", "table": 3, "session": "…", "status": "pending",
  "items": [{ "item": "b1", "name": "Classic Smash Cheeseburger", "qty": 1, "price": 329 },
            { "item": "d3", "name": "Masala Lemonade", "qty": 1, "price": 0, "free": true }],
  "bill": { "subtotal": 1029, "discount": 40, "gst": 49, "total": 1038 },
  "note": "", "by": "Midnight Lassi", "byEmoji": "🥛", "createdAt": 1729500000000, "updatedAt": 1729500000000 }
```
Statuses: `pending → cooking → ready → served`, `pending → rejected`; closing a table turns pending into `rejected` and the rest into `settled`.

---

## Admin: sign-in

### `POST /api/admin/login`
Body `{ "username": "owner", "password": "…" }` → `{ "user": { "id", "username", "role" }, "csrf": "…" }` and sets `hm_admin`.
Errors: `401 bad_credentials`, `429` (rate limit or lockout).

### `GET /api/admin/me`
`{ "user": {…}, "csrf": "…", "config": { "name", "tables", "publicUrl" } }`

### `POST /api/admin/logout`
### `POST /api/admin/password`
Body `{ "current": "…", "next": "…" }`. Signs out all your sessions.

## Admin: floor (owner or staff)

### `GET /api/admin/overview`
```json
{ "tables": [{ "no": 3, "open": true, "session": { "id": "…", "code": "4821", "openedAt": 0 },
               "guests": [{ "id", "nick", "emoji" }], "bill": 805, "call": { "type": "bill", "by": "…", "at": 0 } }],
  "orders": [ Order, … ],          // today's orders plus any still active
  "stats": { "seated": 1, "tables": 12, "pending": 0, "inKitchen": 1, "salesToday": 805 } }
```

| Method & path | Body | Does |
|---|---|---|
| `POST /api/admin/tables/:n/open` | `{}` | Opens a seating → `{ session, code }` |
| `POST /api/admin/tables/:n/code` | `{}` | New code for the current seating → `{ code }` |
| `POST /api/admin/tables/:n/close` | `{}` | Settle & close |
| `DELETE /api/admin/tables/:n/call` | — | Clear a "call server / bill" alert |
| `PATCH /api/admin/orders/:id` | `{ "status": "cooking" \| "ready" \| "served" \| "rejected" }` | Move an order (state machine enforced) |
| `POST /api/admin/items/:id/availability` | `{ "available": false }` | Sold-out switch (staff allowed) |
| `GET /api/admin/orders.csv?day=YYYY-MM-DD` | — | CSV of that day's orders (default today) |
| `GET /api/admin/stream` | — | SSE: `hello`, `floor` `{topic, table, created}`, `menu` |

## Admin: menu, offers, staff (owner only)

| Method & path | Body |
|---|---|
| `GET /api/admin/menu` | — (includes hidden categories) |
| `PUT /api/admin/categories/:id` | `{ "name", "color": "#RRGGBB", "sort"?, "hidden"? }` — creates or updates |
| `DELETE /api/admin/categories/:id` | — (409 if it still has dishes) |
| `PUT /api/admin/items/:id` | `{ "cat", "name", "price", "veg", "desc"?, "ings"?: [{e,l}], "image", "anim"?, "available"?, "sort"? }` |
| `DELETE /api/admin/items/:id` | — |
| `POST /api/admin/reorder` | `{ "kind": "cats" \| "items", "ids": [...] }` — sets sort order to the list order |
| `POST /api/admin/images` | Raw image bytes, `Content-Type: image/webp \| image/png \| image/jpeg` → `201 { "id", "url": "/img/<id>" }` |
| `PUT /api/admin/offers` | Offers object (as in `/api/menu`); values are clamped to safe ranges |
| `GET /api/admin/users` | — |
| `POST /api/admin/users` | `{ "username", "password", "role": "owner" \| "staff" }` |
| `PATCH /api/admin/users/:id` | `{ "disabled"?: bool, "password"?: string }` |
| `GET /api/admin/audit` | — last 200 entries |

Ids in paths: letters, digits, `-` and `_`, up to 40 characters.

## Operations

| Path | Purpose |
|---|---|
| `GET /healthz` | Process is up (liveness) |
| `GET /readyz` | Database reachable (readiness); 503 if not |
| `GET /metrics` | Prometheus metrics. Requires `Authorization: Bearer $METRICS_TOKEN` if set; 404 in production without a token |

Metrics include `hm_http_request_duration_seconds` (histogram by route and status), `hm_sse_clients`, `hm_orders_placed_total`, `hm_guest_joins_total`, `hm_process_resident_memory_bytes`.

## Example: a full order with curl

```bash
B=http://localhost:8080
# staff
curl -s -c staff.txt -H 'content-type: application/json' -d '{"username":"owner","password":"…"}' $B/api/admin/login | tee login.json
CSRF=$(node -p "require('./login.json').csrf")
CODE=$(curl -s -b staff.txt -H "x-csrf-token: $CSRF" -H 'content-type: application/json' -d '{}' $B/api/admin/tables/3/open | node -p "JSON.parse(require('fs').readFileSync(0)).code")
# guest
curl -s -c guest.txt -H 'x-hm: 1' -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}" $B/api/tables/3/join
curl -s -b guest.txt -H 'x-hm: 1' -H 'content-type: application/json' -d '{"item":"p1","delta":2}' $B/api/session/plate
curl -s -b guest.txt -H 'x-hm: 1' -H 'content-type: application/json' -H "Idempotency-Key: $(uuidgen)" -d '{}' $B/api/session/orders
```
