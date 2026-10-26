// Schéma D1 et purge des tables d'attente.
// Le schéma est aussi dans site/schema.sql (même contenu ; un test vérifie qu'ils ne divergent pas).

// users : les colonnes de l'ancien cookie collé et de la clé d'import du favori (cookie_*, session_expired, import_key_*)
// ne sont plus lues depuis le 2026-10-22, vidées par migration (MIGRATIONS).
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
    import_key_enc TEXT,
    game_pseudo TEXT,
    game_session_enc TEXT,
    game_uid TEXT,
    game_session_v INTEGER NOT NULL DEFAULT 0,
    game_session_at TEXT,
    game_session_lost TEXT,
    sync_lock TEXT,
    sync_click_at TEXT,
    auto_sync INTEGER NOT NULL DEFAULT 1,
    fast_sync INTEGER NOT NULL DEFAULT 0,
    sync_fails INTEGER NOT NULL DEFAULT 0,
    link_hash TEXT,
    link_until TEXT,
    wikibidous INTEGER,
    wikibidous_at TEXT,
    auto_friend INTEGER NOT NULL DEFAULT 0,
    game_friends TEXT,
    auto_wish INTEGER NOT NULL DEFAULT 0,
    wish_mode TEXT NOT NULL DEFAULT 'selected',
    wish_dirty INTEGER NOT NULL DEFAULT 0,
    wish_state TEXT,
    react_min INTEGER NOT NULL DEFAULT 0,
    react_min_at TEXT,
    react_day INTEGER NOT NULL DEFAULT 0,
    react_day_at TEXT
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
    auto TEXT,
    pos INTEGER,
    wish_sync INTEGER NOT NULL DEFAULT 0,
    auto_tag TEXT,
    auto_tag_id TEXT,
    auto_tag_baseline TEXT,
    auto_tag_state TEXT,
    auto_favorite INTEGER NOT NULL DEFAULT 0,
    auto_favorite_state TEXT,
    PRIMARY KEY (user_id, id)
  )`,
  `CREATE TABLE IF NOT EXISTS wish_missing (
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (user_id, title)
  )`,
  `CREATE TABLE IF NOT EXISTS wish_managed (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (user_id, card_id)
  )`,
  `CREATE TABLE IF NOT EXISTS refresh_staging (
    user_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    entries TEXT NOT NULL,
    skipped INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, page)
  )`,
  `CREATE TABLE IF NOT EXISTS target_uploads (
    user_id TEXT NOT NULL,
    upload_id TEXT NOT NULL,
    part INTEGER NOT NULL,
    items TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, upload_id, part)
  )`,
  `CREATE TABLE IF NOT EXISTS migrations (
    name TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS cron_state (
    name TEXT PRIMARY KEY,
    running_until TEXT,
    skip_until TEXT,
    last_at TEXT,
    last_result TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    rev INTEGER NOT NULL,
    reply_to INTEGER,
    reacts INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS chat_reactions (
    message_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
  ) WITHOUT ROWID`,
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
  `CREATE TABLE IF NOT EXISTS game_reads (
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    win TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    blocked_until TEXT,
    PRIMARY KEY (user_id, kind)
  )`,
  `CREATE TABLE IF NOT EXISTS friend_requests (
    user_id TEXT NOT NULL,
    target_uid TEXT NOT NULL,
    at TEXT NOT NULL,
    via TEXT NOT NULL,
    result TEXT NOT NULL,
    PRIMARY KEY (user_id, target_uid)
  )`,
  `CREATE TABLE IF NOT EXISTS game_titles (
    title TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    at TEXT NOT NULL
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
  `CREATE UNIQUE INDEX IF NOT EXISTS users_by_game_uid ON users (game_uid)`,
  `CREATE INDEX IF NOT EXISTS users_by_link ON users (link_hash)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS targets_by_auto_tag ON targets (user_id, json_extract(auto_tag, '$.key')) WHERE json_extract(auto_tag, '$.enabled') = 1`,
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
  ['users', 'game_pseudo', 'TEXT'],
  ['users', 'game_session_enc', 'TEXT'],
  ['users', 'game_uid', 'TEXT'],
  ['users', 'game_session_v', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'game_session_at', 'TEXT'],
  ['users', 'game_session_lost', 'TEXT'],
  ['users', 'sync_lock', 'TEXT'],
  ['users', 'sync_click_at', 'TEXT'],
  ['users', 'auto_sync', 'INTEGER NOT NULL DEFAULT 1'],
  ['users', 'fast_sync', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'sync_fails', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'link_hash', 'TEXT'],
  ['users', 'link_until', 'TEXT'],
  ['users', 'wikibidous', 'INTEGER'],
  ['users', 'wikibidous_at', 'TEXT'],
  ['users', 'auto_friend', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'game_friends', 'TEXT'],
  ['users', 'auto_wish', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'wish_mode', "TEXT NOT NULL DEFAULT 'selected'"],
  ['users', 'wish_dirty', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'wish_state', 'TEXT'],
  ['users', 'react_min', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'react_min_at', 'TEXT'],
  ['users', 'react_day', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'react_day_at', 'TEXT'],
  ['cards', 'rev', 'INTEGER NOT NULL DEFAULT 0'],
  ['targets', 'auto', 'TEXT'],
  ['targets', 'pos', 'INTEGER'],
  ['targets', 'wish_sync', 'INTEGER NOT NULL DEFAULT 0'],
  ['targets', 'auto_tag', 'TEXT'],
  ['targets', 'auto_tag_id', 'TEXT'],
  ['targets', 'auto_tag_baseline', 'TEXT'],
  ['targets', 'auto_tag_state', 'TEXT'],
  ['targets', 'auto_favorite', 'INTEGER NOT NULL DEFAULT 0'],
  ['targets', 'auto_favorite_state', 'TEXT'],
  ['refresh_staging', 'created_at', "TEXT NOT NULL DEFAULT ''"],
  ['refresh_staging', 'skipped', 'INTEGER NOT NULL DEFAULT 0'],
  ['market', 'attempt', 'TEXT'],
  ['chat_messages', 'reply_to', 'INTEGER'],
  ['chat_messages', 'reacts', 'INTEGER NOT NULL DEFAULT 0'],
];

// Les morceaux en attente depuis plus d'une heure (lecture de la collection ou collection à compléter en morceaux
// abandonnées) sont effacés.
export function purgeStaging(db) {
  const limit = new Date(Date.now() - 3600_000).toISOString();
  return [
    db.prepare('DELETE FROM refresh_staging WHERE created_at < ?1').bind(limit),
    db.prepare('DELETE FROM target_uploads WHERE created_at < ?1').bind(limit),
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
  // Ancien site : garder le mode global s'il était actif. Une base déjà passée au choix par collection garde ses choix.
  ['mode-souhaits-2026-10-25', `UPDATE users SET wish_mode = 'all' WHERE auto_wish = 1
     AND NOT EXISTS (SELECT 1 FROM migrations WHERE name = 'souhaits-par-collection-2026-10-25')`],
  // Reprend le réglage global de chaque membre pour toutes ses collections existantes (catégories comprises).
  // Réglage coupé : la nouvelle colonne reste à 0. Cette migration unique ne réécrit pas les choix faits ensuite.
  ['souhaits-par-collection-2026-10-25', `UPDATE targets SET wish_sync = 1
     WHERE user_id IN (SELECT id FROM users WHERE auto_wish = 1)`],
  ['souhaits-suivis-2026-10-25', `INSERT OR IGNORE INTO wish_managed (user_id, card_id, title)
     SELECT t.user_id, g.card_id, g.title FROM targets AS t
       CROSS JOIN json_each(t.items) AS i CROSS JOIN game_titles AS g
     WHERE t.wish_sync = 1 AND g.title = json_extract(i.value, '$.title') AND g.card_id <> ''`],
  // 2026-10-16, demande de l'administrateur : partage entre membres (cartes et collections) activé pour tous les
  // classeurs existants ; chacun peut le couper dans Réglages, et un nouveau classeur partage dès sa création.
  ['partage-par-defaut-2026-10-16', `UPDATE users SET shared = 1, shared_targets = 1,
     public_id = COALESCE(public_id, lower(hex(randomblob(9))))
     WHERE (shared = 0 OR shared_targets = 0)`],
  // 2026-10-22 : la collection est lue par le serveur avec une session du jeu reliée (game_session_enc) ; l'ancien cookie
  // collé et la clé d'import du favori ne servent plus.
  ['session-serveur-2026-10-22', `UPDATE users SET cookie_enc = NULL, cookie_updated_at = NULL, session_expired = 0, import_key_hash = NULL,
     import_key_enc = NULL WHERE (cookie_enc IS NOT NULL OR import_key_hash IS NOT NULL OR import_key_enc IS NOT NULL)`],
];

async function applyMigrations(db) {
  // Ne pas exécuter à nouveau le corps des migrations déjà terminées : même protégée
  // par EXISTS, une jointure coûteuse peut parcourir les données avant de tester ce garde.
  const applied = new Set((await db.prepare('SELECT name FROM migrations').all()).results.map((r) => r.name));
  for (const [name, sql] of MIGRATIONS) {
    if (applied.has(name)) continue;
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
