// Schéma D1 et purge des tables d'attente.
// Le schéma est aussi dans site/schema.sql (même contenu ; un test vérifie qu'ils ne divergent pas).

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    key_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    fetched_at TEXT,
    new_ids TEXT NOT NULL DEFAULT '[]',
    cookie_enc TEXT,
    cookie_updated_at TEXT,
    session_expired INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS cards (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (user_id, card_id)
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (user_id, card_id, tag)
  )`,
  `CREATE INDEX IF NOT EXISTS tags_by_tag ON tags (user_id, tag)`,
  `CREATE TABLE IF NOT EXISTS targets (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    items TEXT NOT NULL,
    source TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  )`,
  `CREATE TABLE IF NOT EXISTS refresh_staging (
    user_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    entries TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, page)
  )`,
  `CREATE TABLE IF NOT EXISTS import_staging (
    user_id TEXT NOT NULL,
    upload_id TEXT NOT NULL,
    part INTEGER NOT NULL,
    cards TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, upload_id, part)
  )`,
];

// Les morceaux en attente depuis plus d'une heure (import ou rafraîchissement abandonné) sont effacés.
export function purgeStaging(db) {
  const limit = new Date(Date.now() - 3600_000).toISOString();
  return [
    db.prepare('DELETE FROM import_staging WHERE created_at < ?1').bind(limit),
    db.prepare('DELETE FROM refresh_staging WHERE created_at < ?1').bind(limit),
  ];
}

// Une seule application du schéma par base et par instance (relancée si elle a échoué).
const ready = new WeakMap();

export function ensureSchema(db) {
  let p = ready.get(db);
  if (!p) {
    p = db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((err) => {
      ready.delete(db);
      throw err;
    });
    ready.set(db, p);
  }
  return p;
}
