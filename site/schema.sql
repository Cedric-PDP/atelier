-- Schéma D1 du classeur. Appliqué aussi automatiquement par l'API au premier appel (site/functions/_lib/db.js,
-- même contenu : un test vérifie qu'ils ne divergent pas ; les colonnes ajoutées depuis sont posées sur une base
-- existante par ALTER TABLE). À la main, sur une base neuve seulement (sur une ancienne base, l'index d'une colonne
-- ajoutée échouerait : laisser l'API la mettre à jour) :
--   npx wrangler d1 execute <base> --remote --file site/schema.sql

-- Un compte par personne. Les clés ne sont gardées que par leur SHA-256 (hex) : la clé principale (key_hash) et la
-- clé d'import du favori (import_key_hash, qui ne sert qu'à POST /api/import). new_ids = tableau JSON des cartes
-- apparues au dernier import. cookie_enc = cookie WikiMasters chiffré (AES-GCM, base64 de IV + texte chiffré).
-- prefs = préférences de l'interface (objet JSON de 4 Ko au plus, contenu libre). sync_state = dernière synchro
-- (JSON : compteurs du jeu, date du plus récent exemplaire lu, date de la dernière lecture complète), pour ne lire
-- ensuite que les nouveautés. cards_rev = révision de la liste des cartes (+1 par opération qui la change : import,
-- synchro rapide, étiquettes) ; cards_gone_floor = plus basse révision à partir de laquelle les cartes retirées
-- (cards_gone) sont toutes connues (relevée quand les plus anciennes sont élaguées). shared = 1 si le membre montre
-- ses cartes aux autres membres (partage choisi, réciproque) ; public_id = son identifiant pour les autres membres
-- (aléatoire, tiré à chaque activation du partage, NULL quand il ne partage pas), jamais l'id interne.
-- shared_targets = 1 s'il montre aussi ses collections à compléter (réglage à part, seulement avec shared = 1 ; remis
-- à 0 quand il cesse de montrer ses cartes).
CREATE TABLE IF NOT EXISTS users (
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
    shared_targets INTEGER NOT NULL DEFAULT 0
);

-- Cartes possédées : data = Carte de l'API, en JSON, sans les étiquettes. rev = révision (users.cards_rev) de son
-- dernier changement (données ou étiquettes).
CREATE TABLE IF NOT EXISTS cards (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    data TEXT NOT NULL,
    rev INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, card_id)
);

-- Cartes retirées de la collection par un import, avec la révision du retrait (lecture incrémentale de
-- GET /api/cards?since=…). Effacée quand la carte revient ; les plus anciennes sont élaguées (1 000 gardées au plus).
CREATE TABLE IF NOT EXISTS cards_gone (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    rev INTEGER NOT NULL,
    PRIMARY KEY (user_id, card_id)
);

-- Étiquettes du classeur (gardées quand la carte disparaît de la collection).
CREATE TABLE IF NOT EXISTS tags (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (user_id, card_id, tag)
);

-- Collections à compléter : items = tableau JSON de {title, description, image, status}.
CREATE TABLE IF NOT EXISTS targets (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    items TEXT NOT NULL,
    source TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
);

-- Pages lues par /api/refresh en attendant la dernière : entries = cartes partielles en JSON (une par exemplaire),
-- skipped = entrées invalides ignorées, page -1 = statistiques du jeu. Effacées au bout d'une heure.
CREATE TABLE IF NOT EXISTS refresh_staging (
    user_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    entries TEXT NOT NULL,
    skipped INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, page)
);

-- Morceaux d'un import (POST /api/import, 500 cartes par morceau) en attendant le dernier : un envoi à la fois par
-- utilisateur, 40 morceaux et 3 Mo au plus, part -1 = statistiques. Effacés au bout d'une heure.
CREATE TABLE IF NOT EXISTS import_staging (
    user_id TEXT NOT NULL,
    upload_id TEXT NOT NULL,
    part INTEGER NOT NULL,
    cards TEXT NOT NULL,
    skipped INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, upload_id, part)
);

-- Modifications de données faites une seule fois par base (db.js, MIGRATIONS).
CREATE TABLE IF NOT EXISTS migrations (
    name TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    applied_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tags_by_tag ON tags (user_id, tag);

CREATE UNIQUE INDEX IF NOT EXISTS users_by_import_key ON users (import_key_hash);

CREATE INDEX IF NOT EXISTS cards_by_rev ON cards (user_id, rev);

CREATE INDEX IF NOT EXISTS cards_gone_by_rev ON cards_gone (user_id, rev);

CREATE UNIQUE INDEX IF NOT EXISTS users_by_public_id ON users (public_id);
