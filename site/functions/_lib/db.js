// Schéma D1 et purge des tables d'attente.
// Le schéma est aussi dans site/schema.sql (même contenu ; un test vérifie qu'ils ne divergent pas).

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    key_hash TEXT NOT NULL UNIQUE,
    import_key_hash TEXT,
    created_at TEXT NOT NULL,
    fetched_at TEXT,
    new_ids TEXT NOT NULL DEFAULT '[]',
    cookie_enc TEXT,
    cookie_updated_at TEXT,
    session_expired INTEGER NOT NULL DEFAULT 0,
    prefs TEXT NOT NULL DEFAULT '{}',
    sync_state TEXT,
    cards_rev INTEGER NOT NULL DEFAULT 0,
    cards_gone_floor INTEGER NOT NULL DEFAULT 0,
    shared INTEGER NOT NULL DEFAULT 0,
    public_id TEXT,
    shared_targets INTEGER NOT NULL DEFAULT 0,
    last_sync TEXT,
    import_key_enc TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS cards (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    data TEXT NOT NULL,
    rev INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, card_id)
  )`,
  `CREATE TABLE IF NOT EXISTS cards_gone (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    rev INTEGER NOT NULL,
    PRIMARY KEY (user_id, card_id)
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (user_id, card_id, tag)
  )`,
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
    skipped INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, page)
  )`,
  `CREATE TABLE IF NOT EXISTS import_staging (
    user_id TEXT NOT NULL,
    upload_id TEXT NOT NULL,
    part INTEGER NOT NULL,
    cards TEXT NOT NULL,
    skipped INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, upload_id, part)
  )`,
  `CREATE TABLE IF NOT EXISTS migrations (
    name TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    rev INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS prices (
    card_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    read_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS value_history (
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    value INTEGER NOT NULL,
    priced INTEGER NOT NULL,
    cards INTEGER NOT NULL,
    at TEXT NOT NULL,
    PRIMARY KEY (user_id, date)
  )`,
  `CREATE TABLE IF NOT EXISTS market (
    user_id TEXT PRIMARY KEY,
    ids TEXT NOT NULL DEFAULT '{}',
    live TEXT,
    live_at TEXT,
    quota_day TEXT,
    quota_n INTEGER NOT NULL DEFAULT 0,
    attempt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    result TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS tags_by_tag ON tags (user_id, tag)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_by_import_key ON users (import_key_hash)`,
  `CREATE INDEX IF NOT EXISTS cards_by_rev ON cards (user_id, rev)`,
  `CREATE INDEX IF NOT EXISTS cards_gone_by_rev ON cards_gone (user_id, rev)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_by_public_id ON users (public_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS chat_by_rev ON chat_messages (rev)`,
  `CREATE INDEX IF NOT EXISTS chat_by_user ON chat_messages (user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS sync_log_by_user ON sync_log (user_id, id)`,
];

// Colonnes ajoutées après coup : une base créée par une version précédente les reçoit au premier appel.
const ADDED_COLUMNS = [
  ['users', 'import_key_hash', 'TEXT'],
  ['users', 'prefs', "TEXT NOT NULL DEFAULT '{}'"],
  ['users', 'sync_state', 'TEXT'],
  ['users', 'cards_rev', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'cards_gone_floor', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'shared', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'public_id', 'TEXT'],
  ['users', 'shared_targets', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'last_sync', 'TEXT'],
  ['users', 'import_key_enc', 'TEXT'],
  ['cards', 'rev', 'INTEGER NOT NULL DEFAULT 0'],
  ['refresh_staging', 'created_at', "TEXT NOT NULL DEFAULT ''"],
  ['refresh_staging', 'skipped', 'INTEGER NOT NULL DEFAULT 0'],
  ['import_staging', 'skipped', 'INTEGER NOT NULL DEFAULT 0'],
  ['market', 'attempt', 'TEXT'],
];

// Les morceaux en attente depuis plus d'une heure (import ou rafraîchissement abandonné) sont effacés.
export function purgeStaging(db) {
  const limit = new Date(Date.now() - 3600_000).toISOString();
  return [
    db.prepare('DELETE FROM import_staging WHERE created_at < ?1').bind(limit),
    db.prepare('DELETE FROM refresh_staging WHERE created_at < ?1').bind(limit),
  ];
}

// Tables, puis colonnes manquantes, puis index (un index sur une colonne ajoutée viendrait trop tôt sinon).
async function applySchema(db) {
  const tables = SCHEMA.filter((sql) => sql.startsWith('CREATE TABLE'));
  const indexes = SCHEMA.filter((sql) => !sql.startsWith('CREATE TABLE'));
  await db.batch(tables.map((sql) => db.prepare(sql)));
  for (const table of new Set(ADDED_COLUMNS.map(([t]) => t))) {
    const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
    const have = new Set(results.map((r) => r.name));
    for (const [t, column, type] of ADDED_COLUMNS) {
      if (t === table && !have.has(column)) await db.prepare(`ALTER TABLE ${t} ADD COLUMN ${column} ${type}`).run();
    }
  }
  await db.batch(indexes.map((sql) => db.prepare(sql)));
  await applyMigrations(db);
}

// Modifications de données à faire une seule fois par base. La ligne de `migrations` et la modification partent dans
// le même lot (une transaction) ; la modification ne s'applique que si cette ligne vient d'être posée par CE lot
// (run_id tiré au hasard) : deux instances qui démarrent ensemble ne la font qu'une fois, et jamais plus ensuite.
const MIGRATIONS = [
  // 2026-10-16, demande de l'administrateur : partage entre membres (cartes et collections) activé pour tous les
  // classeurs existants ; chacun peut le couper dans Réglages, et un nouveau classeur partage dès sa création.
  ['partage-par-defaut-2026-10-16', `UPDATE users SET shared = 1, shared_targets = 1,
     public_id = COALESCE(public_id, lower(hex(randomblob(9))))
     WHERE (shared = 0 OR shared_targets = 0)`],
];

async function applyMigrations(db) {
  for (const [name, sql] of MIGRATIONS) {
    const runId = crypto.randomUUID();
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO migrations (name, run_id, applied_at) VALUES (?1, ?2, ?3)').bind(name, runId, new Date().toISOString()),
      db.prepare(`${sql} AND EXISTS (SELECT 1 FROM migrations WHERE name = ?1 AND run_id = ?2)`).bind(name, runId),
    ]);
  }
}

// Une seule application du schéma par base et par instance (relancée si elle a échoué).
const ready = new WeakMap();

export function ensureSchema(db) {
  let p = ready.get(db);
  if (!p) {
    p = applySchema(db).catch((err) => {
      ready.delete(db);
      throw err;
    });
    ready.set(db, p);
  }
  return p;
}
