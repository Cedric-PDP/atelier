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
-- à 0 quand il cesse de montrer ses cartes). last_sync = résumé de la dernière ligne du journal des synchros (sync_log,
-- JSON {at, kind, via, result, message}), lu par GET /api/me sans requête de plus.
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
    shared_targets INTEGER NOT NULL DEFAULT 0,
    last_sync TEXT,
    -- clé d'import (celle du favori) chiffrée (AES-GCM de COOKIE_SECRET) : chaque appareil du titulaire retrouve la même
    import_key_enc TEXT,
    -- pseudo dans le jeu, donné par le joueur (Réglages) : montré aux membres avec qui il partage, pour se trouver dans le jeu
    game_pseudo TEXT
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

-- Collections à compléter : items = tableau JSON de {title, description, image, status}. auto = ajout automatique
-- (« Refaire à chaque synchro » de la fenêtre « Ajouter par tags du jeu ») : JSON {rules:[{k:'gtag'|'cat'|'tag', v}],
-- skip:[titres exclus]} validé par targets.js (20 règles, 2 000 titres exclus au plus), NULL sans règle ; jamais montré
-- aux autres membres.
CREATE TABLE IF NOT EXISTS targets (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    items TEXT NOT NULL,
    source TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    auto TEXT,
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

-- Morceaux d'un import (POST /api/import, 500 cartes par morceau) en attendant le dernier : trois envois en cours au
-- plus par utilisateur (deux onglets, favori relié et clic), 40 morceaux et 8 Mo au plus chacun, part -1 = en-tête
-- (statistiques du jeu, exemplaires lus, début de la lecture…). Effacés au bout d'une heure.
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

-- Chat : un seul salon pour tous les classeurs du site (functions/_lib/chat.js). id = numéro du message (croissant,
-- jamais réutilisé) ; user_id = auteur ('' quand son classeur a été supprimé) ; text = texte brut, 500 caractères au
-- plus (vidé à la suppression) ; deleted = 1 : message supprimé, gardé vide comme marque pour que les pages ouvertes le
-- retirent ; rev = révision (unique, croissante), donnée à la création puis à la suppression, lue par
-- GET /api/chat?after=<rev> (index chat_by_rev). Les 2 000 plus récents seulement (purge à chaque envoi).
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    rev INTEGER NOT NULL
);

-- Marché (functions/_lib/market.js, lu et écrit par le favori dans la page du jeu, jamais par ce serveur dans le jeu).
-- Cotes des cartes, communes à tous les classeurs (des données du marché du jeu, liées à aucun joueur : pas de user_id) :
-- data = {"<rareté>[*]": {p, n, w, l, d}} (« * » : brillante ; p = médiane des 30 ventes les plus récentes, n = ventes
-- lues, w = médiane d'il y a 7 jours ou null, l et d = dernière vente) ; read_at = date de la lecture.
CREATE TABLE IF NOT EXISTS prices (
    card_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    read_at TEXT NOT NULL
);

-- Valeur d'un classeur, un point par jour (UTC), le dernier calcul du jour remplaçant les précédents : value = Σ cote
-- fiable × exemplaires, priced = cartes cotées, cards = cartes du classeur, at = heure du calcul. 400 jours gardés.
CREATE TABLE IF NOT EXISTS value_history (
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    value INTEGER NOT NULL,
    priced INTEGER NOT NULL,
    cards INTEGER NOT NULL,
    at TEXT NOT NULL,
    PRIMARY KEY (user_id, date)
);

-- État du marché d'un classeur : ids = titres des cartes qui manquent à ses collections -> card_id du jeu ("" : aucune
-- carte), relevés par son favori ; live = sa dernière lecture du marché (bonnes affaires, ses enchères et ventes),
-- effacée au bout de 7 jours ; quota_day / quota_n = cotes envoyées ce jour-là. user_id = '*' : quota de tout le site.
-- attempt = dernier essai de lecture du favori, texte JSON {start, v, auto, end, ok, why} (heures, version du favori,
-- message d'échec montré au joueur ; rien du jeu).
CREATE TABLE IF NOT EXISTS market (
    user_id TEXT PRIMARY KEY,
    ids TEXT NOT NULL DEFAULT '{}',
    live TEXT,
    live_at TEXT,
    quota_day TEXT,
    quota_n INTEGER NOT NULL DEFAULT 0,
    attempt TEXT
);

-- Journal des synchros (functions/_lib/synclog.js) : une ligne par synchro, réussie ou non, écrite par le serveur (import
-- du favori, synchro rapide, rafraîchissement par cookie) ou signalée par le favori (ses échecs avant tout envoi : session
-- du jeu expirée, erreur ou limite du jeu…). kind = full (lecture complète) | quick (synchro rapide) ; result = ok |
-- warn (lecture incomplète : rien retiré) | error ; message = texte lisible ; data = JSON (via : clic | relie | script |
-- cookie, nombres, durée, raison…). Une ligne identique à la précédente la met seulement à jour (data.repeat). Les 50
-- plus récentes par classeur, 30 jours au plus.
CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    result TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS tags_by_tag ON tags (user_id, tag);

CREATE UNIQUE INDEX IF NOT EXISTS users_by_import_key ON users (import_key_hash);

CREATE INDEX IF NOT EXISTS cards_by_rev ON cards (user_id, rev);

CREATE INDEX IF NOT EXISTS cards_gone_by_rev ON cards_gone (user_id, rev);

CREATE UNIQUE INDEX IF NOT EXISTS users_by_public_id ON users (public_id);

-- Chat : lecture des changements (?after=<rev>) ; limites d'envoi par classeur et effacement de ses messages.
CREATE UNIQUE INDEX IF NOT EXISTS chat_by_rev ON chat_messages (rev);

CREATE INDEX IF NOT EXISTS chat_by_user ON chat_messages (user_id, created_at);

-- Journal des synchros : lecture des plus récentes et élagage, par classeur.
CREATE INDEX IF NOT EXISTS sync_log_by_user ON sync_log (user_id, id);
