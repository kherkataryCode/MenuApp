-- Hungry Mango schema v1. Portable between SQLite and PostgreSQL.
-- {{BLOB}} becomes BLOB on SQLite and BYTEA on PostgreSQL.

CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0,
  hidden      INTEGER NOT NULL DEFAULT 0,
  updated_at  BIGINT NOT NULL
);

CREATE TABLE items (
  id           TEXT PRIMARY KEY,
  category_id  TEXT NOT NULL REFERENCES categories(id),
  name         TEXT NOT NULL,
  price        INTEGER NOT NULL,
  veg          INTEGER NOT NULL DEFAULT 1,
  description  TEXT NOT NULL DEFAULT '',
  ingredients  TEXT NOT NULL DEFAULT '[]',
  image        TEXT NOT NULL DEFAULT '',
  anim         TEXT NOT NULL DEFAULT 'spin',
  available    INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0,
  updated_at   BIGINT NOT NULL
);
CREATE INDEX items_category ON items(category_id);

CREATE TABLE images (
  id          TEXT PRIMARY KEY,
  mime        TEXT NOT NULL,
  bytes       {{BLOB}} NOT NULL,
  size        INTEGER NOT NULL,
  created_at  BIGINT NOT NULL
);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  BIGINT NOT NULL
);

CREATE TABLE dining_tables (
  no               INTEGER PRIMARY KEY,
  current_session  TEXT
);

CREATE TABLE table_sessions (
  id          TEXT PRIMARY KEY,
  table_no    INTEGER NOT NULL,
  code        TEXT NOT NULL,
  status      TEXT NOT NULL,
  opened_at   BIGINT NOT NULL,
  closed_at   BIGINT,
  opened_by   TEXT
);
CREATE INDEX table_sessions_table ON table_sessions(table_no, opened_at);

CREATE TABLE guests (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  nick        TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  joined_at   BIGINT NOT NULL,
  UNIQUE (session_id, nick)
);
CREATE INDEX guests_session ON guests(session_id);

CREATE TABLE plate_lines (
  session_id  TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  guest_id    TEXT NOT NULL,
  qty         INTEGER NOT NULL,
  added_at    BIGINT NOT NULL,
  PRIMARY KEY (session_id, item_id, guest_id)
);

CREATE TABLE orders (
  id               TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL,
  table_no         INTEGER NOT NULL,
  status           TEXT NOT NULL,
  items            TEXT NOT NULL,
  subtotal         INTEGER NOT NULL,
  discount         INTEGER NOT NULL,
  gst              INTEGER NOT NULL,
  total            INTEGER NOT NULL,
  note             TEXT NOT NULL DEFAULT '',
  placed_by        TEXT NOT NULL,
  placed_emoji     TEXT NOT NULL DEFAULT '',
  idempotency_key  TEXT UNIQUE,
  created_at       BIGINT NOT NULL,
  updated_at       BIGINT NOT NULL
);
CREATE INDEX orders_session ON orders(session_id);
CREATE INDEX orders_created ON orders(created_at);

CREATE TABLE calls (
  table_no    INTEGER PRIMARY KEY,
  session_id  TEXT NOT NULL,
  type        TEXT NOT NULL,
  by_nick     TEXT NOT NULL,
  at          BIGINT NOT NULL
);

CREATE TABLE admin_users (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,
  pass_hash   TEXT NOT NULL,
  role        TEXT NOT NULL,
  disabled    INTEGER NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL
);

CREATE TABLE admin_sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  csrf        TEXT NOT NULL,
  created_at  BIGINT NOT NULL,
  expires_at  BIGINT NOT NULL,
  ip          TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX admin_sessions_user ON admin_sessions(user_id);

CREATE TABLE login_attempts (
  key         TEXT PRIMARY KEY,
  fails       INTEGER NOT NULL,
  locked_until BIGINT NOT NULL DEFAULT 0,
  updated_at  BIGINT NOT NULL
);

CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  at          BIGINT NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX audit_log_at ON audit_log(at);
