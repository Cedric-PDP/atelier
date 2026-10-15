-- Schéma D1 du classeur. Appliqué aussi automatiquement par l'API au premier appel (site/functions/_lib/db.js,
-- même contenu : un test vérifie qu'ils ne divergent pas). À la main :
--   npx wrangler d1 execute <base> --remote --file site/schema.sql

-- Un compte par personne. La clé n'est gardée que par son SHA-256 (hex). new_ids = tableau JSON des cartes
-- apparues au dernier import. cookie_enc = cookie WikiMasters chiffré (AES-GCM, base64 de IV + texte chiffré).
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    key_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    fetched_at TEXT,
    new_ids TEXT NOT NULL DEFAULT '[]',
    cookie_enc TEXT,
    cookie_updated_at TEXT,
    session_expired INTEGER NOT NULL DEFAULT 0
);

-- Cartes possédées : data = Carte de l'API, en JSON, sans les étiquettes.
CREATE TABLE IF NOT EXISTS cards (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (user_id, card_id)
);

-- Étiquettes du classeur (gardées quand la carte disparaît de la collection).
CREATE TABLE IF NOT EXISTS tags (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (user_id, card_id, tag)
);

CREATE INDEX IF NOT EXISTS tags_by_tag ON tags (user_id, tag);

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
-- page -1 = statistiques du jeu. Effacées au bout d'une heure.
CREATE TABLE IF NOT EXISTS refresh_staging (
    user_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    entries TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, page)
);

-- Morceaux d'un import (POST /api/import par morceaux de 500 cartes) en attendant le dernier : un envoi à la fois par
-- utilisateur, part -1 = statistiques. Effacés au bout d'une heure.
CREATE TABLE IF NOT EXISTS import_staging (
    user_id TEXT NOT NULL,
    upload_id TEXT NOT NULL,
    part INTEGER NOT NULL,
    cards TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, upload_id, part)
);
