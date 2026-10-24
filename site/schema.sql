-- Schéma D1 du classeur. Appliqué aussi automatiquement par l'API au premier appel (site/functions/_lib/db.js,
-- même contenu : un test vérifie qu'ils ne divergent pas ; les colonnes ajoutées depuis sont posées sur une base
-- existante par ALTER TABLE). À la main, sur une base neuve seulement (sur une ancienne base, l'index d'une colonne
-- ajoutée échouerait : laisser l'API la mettre à jour) :
--   npx wrangler d1 execute <base> --remote --file site/schema.sql

-- Un compte par personne. La clé principale n'est gardée que par son SHA-256 (hex, key_hash). new_ids = tableau JSON
-- des cartes apparues à la dernière lecture qui en a apporté. prefs = préférences de l'interface (objet JSON de 4 Ko au
-- plus, contenu libre). sync_state = dernière lecture de la collection (JSON : compte exact du jeu, date du plus récent
-- exemplaire, dernières lectures vérifiée et légère ; import.js). cards_rev = révision de la liste des cartes (+1 par
-- opération qui la change : lecture, étiquettes) ; cards_gone_floor = plus basse révision à partir de laquelle les cartes
-- retirées (cards_gone) sont toutes connues (relevée quand les plus anciennes sont élaguées). shared = 1 si le membre montre
-- ses cartes aux autres membres (partage choisi, réciproque) ; public_id = son identifiant pour les autres membres
-- (aléatoire, tiré à chaque activation du partage, NULL quand il ne partage pas), jamais l'id interne.
-- shared_targets = 1 s'il montre aussi ses collections à compléter (réglage à part, seulement avec shared = 1 ; remis
-- à 0 quand il cesse de montrer ses cartes). last_sync = résumé de la dernière ligne du journal des synchros (sync_log,
-- JSON {at, kind, via, result, message}), lu par GET /api/me sans requête de plus.
-- Session du jeu reliée (functions/_lib/game.js) : game_session_enc = JSON {access_token, refresh_token, expires_at, uid}
-- chiffré (AES-GCM de COOKIE_SECRET, donnée associée « game-session:<id> ») ; game_uid = id du joueur dans le jeu (un
-- compte du jeu, un classeur) ; game_session_v = version de la session (+1 à chaque liaison, renouvellement ou oubli :
-- comparer-échanger) ; game_session_at = liaison ou dernier renouvellement ; game_session_lost = pourquoi la session ne
-- sert plus (« révoquée », « illisible »), NULL sinon. sync_lock = bail d'une lecture en cours (collection ou marché),
-- heure ISO de fin ; sync_click_at = dernier « Rafraîchir » (un par minute) ; auto_sync = lectures automatiques permises ;
-- fast_sync = marché lu plus vite (essai choisi par le membre, coupé par défaut) ;
-- sync_fails = échecs d'affilée des lectures automatiques ; link_hash / link_until = SHA-256 et fin du jeton de liaison en
-- cours (favori « Relier ») ; wikibidous / wikibidous_at = solde de wikibidous du joueur lu dans le jeu à la dernière
-- synchro, et quand (NULL tant qu'il n'a pas été lu), montré aux membres avec qui il partage ses cartes ; auto_friend =
-- demandes d'ami du jeu envoyées seules aux autres membres reliés (case choisie, coupée par défaut) ; game_friends = sa
-- liste d'amis du jeu lue à la dernière vérification (JSON {at, list:[{uid, name, st, out}]}, friends.js).
-- Plus lues depuis le 2026-10-22, vidées par migration : cookie_enc, cookie_updated_at, session_expired (ancien cookie
-- collé), import_key_hash, import_key_enc (clé d'import de l'ancien favori).
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
    import_key_enc TEXT,
    -- pseudo dans le jeu, donné par le joueur (Réglages) ou lu dans le jeu à la liaison s'il est vide : montré aux membres
    -- avec qui il partage, pour se trouver dans le jeu
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
    game_friends TEXT
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

-- Cartes retirées de la collection par une lecture, avec la révision du retrait (lecture incrémentale de
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

-- Pages lues dans la base du jeu par une lecture de la collection, en attendant la dernière (refresh.js) : une page de
-- 1 000 exemplaires = deux lignes de 500 (page 2k et 2k+1 : une ligne D1 fait 2 Mo au plus) ; entries = cartes
-- partielles en JSON (une par exemplaire), skipped = entrées invalides ignorées. Effacées au bout d'une heure.
CREATE TABLE IF NOT EXISTS refresh_staging (
    user_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    entries TEXT NOT NULL,
    skipped INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, page)
);

-- Morceaux d'une collection à compléter de plus de 600 Ko (POST /api/targets/save avec upload) en attendant le dernier :
-- items = éléments en JSON sans les crochets, bytes = leur taille ; trois envois en cours au plus par utilisateur,
-- 1,7 Mo au plus chacun. Effacés au bout d'une heure, ou dès que la collection est écrite.
CREATE TABLE IF NOT EXISTS target_uploads (
    user_id TEXT NOT NULL,
    upload_id TEXT NOT NULL,
    part INTEGER NOT NULL,
    items TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, upload_id, part)
);

-- Modifications de données faites une seule fois par base (db.js, MIGRATIONS).
CREATE TABLE IF NOT EXISTS migrations (
    name TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    applied_at TEXT NOT NULL
);

-- Lectures automatiques (cron) : une ligne par cron (collection, market). running_until = bail de la passe en cours ;
-- skip_until = passes sautées jusque-là (après une limite du jeu) ; last_at / last_result = dernière passe, montrée par
-- GET /api/health.
CREATE TABLE IF NOT EXISTS cron_state (
    name TEXT PRIMARY KEY,
    running_until TEXT,
    skip_until TEXT,
    last_at TEXT,
    last_result TEXT
);

-- Chat : un seul salon pour tous les classeurs du site (functions/_lib/chat.js). id = numéro du message (croissant,
-- jamais réutilisé) ; user_id = auteur ('' quand son classeur a été supprimé) ; text = texte brut, 500 caractères au
-- plus (vidé à la suppression) ; deleted = 1 : message supprimé, gardé vide comme marque pour que les pages ouvertes le
-- retirent ; rev = révision (unique, croissante), donnée à la création puis à la suppression, lue par
-- GET /api/chat?after=<rev> (index chat_by_rev) ; reply_to = numéro du message auquel il répond (NULL sinon ; il peut
-- avoir été supprimé ou purgé depuis). Les 2 000 plus récents seulement (purge à chaque envoi).
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    rev INTEGER NOT NULL,
    reply_to INTEGER
);

-- Marché (functions/_lib/market.js ; lu par marketread.js avec la session du jeu du membre, sans rien écrire dans le jeu).
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
-- carte), relevés à chaque lecture du marché ; live = sa dernière lecture du marché (bonnes affaires, ses enchères et ventes),
-- effacée au bout de 7 jours ; quota_day / quota_n = cotes envoyées ce jour-là. user_id = '*' : quota de tout le site.
-- attempt = dernier essai de lecture du marché, texte JSON {start, v, auto, end, ok, why} (heures, version du lecteur,
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

-- Lectures du marché d'une carte à l'ouverture de sa fiche (functions/_lib/cardmarket.js), par membre : kind = card (base du
-- jeu) | site (détail d'une enchère sur le site du jeu) ; win = minute en cours (ISO, 16 caractères), n = lectures dans
-- cette minute ; blocked_until = pause après une limite du jeu (site seulement). Rien du jeu.
CREATE TABLE IF NOT EXISTS game_reads (
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    win TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    blocked_until TEXT,
    PRIMARY KEY (user_id, kind)
);

-- Demandes d'ami du jeu envoyées par le classeur (functions/_lib/friends.js), une par membre et par compte du jeu visé :
-- via = auto (lectures automatiques, case « Demandes d'ami automatiques ») | clic ; result = sent (demande envoyée) |
-- friends | pending (déjà amis, ou une demande déjà en cours, vu dans la liste d'amis du jeu) | error (réessayée après un
-- jour). Sert à ne jamais envoyer deux fois la même demande.
CREATE TABLE IF NOT EXISTS friend_requests (
    user_id TEXT NOT NULL,
    target_uid TEXT NOT NULL,
    at TEXT NOT NULL,
    via TEXT NOT NULL,
    result TEXT NOT NULL,
    PRIMARY KEY (user_id, target_uid)
);

-- Journal des synchros (functions/_lib/synclog.js) : une ligne par lecture de la collection, réussie ou non, et par
-- événement de la session du jeu, écrite par le serveur (une vérification légère sans changement n'en écrit pas).
-- kind = full (lecture complète) | session (session du jeu reliée, révoquée…) ; quick (ancienne synchro rapide) dans les
-- lignes d'avant le 2026-10-22 ; result = ok | warn (lecture non vérifiée : rien retiré) | error ; message = texte
-- lisible ; data = JSON (via : clic | cron | relier, nombres, durée…). Une ligne identique à la précédente la met
-- seulement à jour (data.repeat). Les 50 plus récentes par classeur, 30 jours au plus.
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

-- Session du jeu : un compte du jeu ne se relie qu'à un classeur ; jeton de liaison retrouvé par son SHA-256.
CREATE UNIQUE INDEX IF NOT EXISTS users_by_game_uid ON users (game_uid);

CREATE INDEX IF NOT EXISTS users_by_link ON users (link_hash);
