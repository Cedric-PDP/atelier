// Partage entre membres du classeur. Un membre qui montre ses cartes (users.shared = 1 : réglage choisi, désactivé par
// défaut) voit celles des autres membres qui les montrent aussi : c'est réciproque. Ce qui est montré : le prénom, le
// nombre de cartes, la date de la dernière synchro, et pour chaque carte son id, son titre, sa rareté, le nombre
// d'exemplaires, si elle est brillante, son illustration et son adresse Wikipédia, et sa cote (cache commun des ventes du
// jeu, de quoi calculer la valeur de son classeur dans la page) ; son solde de wikibidous lu à la dernière synchro (de quoi
// en demander dans un échange). Jamais les étiquettes, les
// préférences, les clés, le cookie du jeu ni l'id interne du compte (ni les collections à compléter, sauf second réglage
// ci-dessous) : un membre est désigné par son identifiant public (users.public_id, tiré à chaque activation du partage,
// effacé à sa désactivation).
// Second réglage, à part (users.shared_targets, seulement avec le premier) : montrer aussi ses collections à compléter,
// réduites au nom de chaque collection et, pour chaque élément vérifié, à son titre, à son qid et à son drapeau
// d'intercalaire (GET /api/members/<id>/targets). Jamais leurs descriptions, images, statuts, source (recherche tapée,
// catégorie) ni dates : seulement si c'est une catégorie de Wikipédia suivie (kind).
// Le site montre qui a quoi ; il peut proposer un échange dans le jeu (trades.js), que l'ami accepte dans le jeu.

import { HttpError, raw } from './http.js';
import { decodeCursor, encodeCursor } from './cards.js';
import { randomToken } from './util.js';

const PAGE_SIZE = 1000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
// Collections d'un membre : pages d'au plus 512 Ko d'éléments rangés (plus la collection qui franchit ce seuil, 1,7 Mo
// au plus), réduites en SQL au titre et au qid : une réponse reste sous ~2 Mo, quelle que soit la taille du compte.
const TARGETS_PAGE_BYTES = 512 * 1024;

// PATCH /api/me {shared?, shared_targets?} : état du partage après la requête (validé), sans rien écrire.
// shared : à chaque activation, un nouvel identifiant public ; à la désactivation, il est effacé (un lien gardé par un
// autre membre ne mène plus à rien) et le partage des collections est coupé aussi (à rechoisir). shared_targets : seulement
// si l'on montre ses cartes (dans la même requête ou déjà), sinon 400.
export function patchSharing(user, body) {
  const hasShared = Object.hasOwn(body, 'shared');
  const hasTargets = Object.hasOwn(body, 'shared_targets');
  let shared = user.shared ? 1 : 0;
  let publicId = user.public_id || null;
  let sharedTargets = shared && user.shared_targets ? 1 : 0;
  if (hasShared) {
    if (typeof body.shared !== 'boolean') throw new HttpError(400, 'Le partage (shared) vaut true ou false.');
    if (!body.shared) {
      shared = 0;
      publicId = null;
    } else if (!shared || !publicId) {
      shared = 1;
      publicId = randomToken(9);
    }
  }
  if (hasTargets) {
    if (typeof body.shared_targets !== 'boolean') throw new HttpError(400, 'Le partage des collections (shared_targets) vaut true ou false.');
    if (body.shared_targets && !shared) {
      throw new HttpError(400, 'Pour montrer tes collections à compléter, montre d\'abord tes cartes : Réglages, « Partage entre membres ».');
    }
    sharedTargets = body.shared_targets ? 1 : 0;
  }
  if (!shared) sharedTargets = 0;
  return { touched: hasShared || hasTargets, shared, publicId, sharedTargets };
}

// Réciprocité : seul un membre qui montre ses cartes voit celles des autres.
function requireSharing(user) {
  if (!user.shared || !user.public_id) {
    throw new HttpError(403, 'Pour voir les cartes des autres membres, montre d\'abord les tiennes : Réglages, « Partage entre membres ».');
  }
}

// Les autres membres qui partagent (50 comptes au plus), nombre de cartes compté sur la clé primaire (user_id, card_id).
// Pour ceux qui montrent aussi leurs collections : leur nombre et la date du dernier changement (50 au plus, même clé
// primaire), de quoi ne les relire que si elles ont changé. Classeurs vides (ni carte ni collection) écartés : rien à
// y voir (2026-10-17, classeurs créés en double puis abandonnés).
const MEMBERS = `SELECT u.public_id AS id, u.name, u.game_pseudo AS pseudo, u.fetched_at, u.wikibidous AS wb, u.wikibidous_at AS wb_at,
    (SELECT COUNT(*) FROM cards AS c WHERE c.user_id = u.id) AS count,
    u.shared_targets AS st,
    CASE WHEN u.shared_targets = 1 THEN (SELECT COUNT(*) FROM targets AS t WHERE t.user_id = u.id) END AS t_count,
    CASE WHEN u.shared_targets = 1 THEN (SELECT MAX(t.updated_at) FROM targets AS t WHERE t.user_id = u.id) END AS t_at
  FROM users AS u WHERE u.shared = 1 AND u.public_id IS NOT NULL AND u.id <> ?1
    AND (EXISTS (SELECT 1 FROM cards AS c WHERE c.user_id = u.id) OR EXISTS (SELECT 1 FROM targets AS t WHERE t.user_id = u.id))
  ORDER BY u.created_at, u.public_id`;

// GET /api/members : targets = null si le membre ne montre pas ses collections, sinon {count, updated_at} ; wikibidous =
// {n, at} (solde lu dans le jeu à sa dernière synchro), ou null s'il n'a jamais été lu.
export async function listMembers(env, user) {
  requireSharing(user);
  const { results } = await env.DB.prepare(MEMBERS).bind(user.id).all();
  return {
    members: results.map((r) => ({
      id: r.id,
      name: r.name,
      pseudo: r.pseudo || null, // pseudo dans le jeu, s'il l'a donné (Réglages) : pour se trouver dans le jeu
      count: r.count,
      fetched_at: r.fetched_at,
      targets: r.st ? { count: r.t_count || 0, updated_at: r.t_at || null } : null,
      wikibidous: r.wb === null || r.wb === undefined ? null : { n: r.wb, at: r.wb_at || null },
    })),
  };
}

const MEMBER = 'SELECT public_id AS id, name, fetched_at FROM users WHERE public_id = ?1 AND shared = 1';
// Une page de 1 000 cartes par clé (card_id > dernière carte lue), comme GET /api/cards?part=…, réduites en SQL aux
// champs montrés (liste blanche : rien d'autre ne sort de cards.data, et les étiquettes ne sont jamais lues).
// Avec la cote de chaque carte (2026-10-16, valeur du classeur d'un ami) : la ligne du cache commun `prices` (des ventes
// du jeu, liées à aucun joueur), lue par sa clé primaire, rendue telle quelle dans `v` quand la carte en a une.
const MEMBER_PAGE = `SELECT c.card_id, json_object(
    'id', c.card_id,
    'title', json_extract(c.data, '$.title'),
    'rarity', json_extract(c.data, '$.rarity'),
    'count', json_extract(c.data, '$.count'),
    'shiny', json(CASE WHEN json_extract(c.data, '$.shiny') THEN 'true' ELSE 'false' END),
    'image', json_extract(c.data, '$.image'),
    'url', json_extract(c.data, '$.url')
  ) AS j, CASE WHEN p.data <> '{}' THEN p.data END AS v
  FROM cards AS c LEFT JOIN prices AS p ON p.card_id = c.card_id
  WHERE c.user_id = (SELECT id FROM users WHERE public_id = ?1 AND shared = 1) AND c.card_id > ?2
  ORDER BY c.card_id LIMIT ${PAGE_SIZE + 1}`;
// Une carte de la page : l'objet montré, plus sa cote (`v`, JSON rangé par market.js) quand elle en a une.
const memberCard = (r) => (r.v ? `${r.j.slice(0, -1)},"v":${r.v}}` : r.j);

// GET /api/members/<id>/cards?part=… : part = « 0 » (ou absent) pour la première page, puis le curseur next_part.
// 404 si ce membre n'existe pas ou ne partage pas (ou plus). Membre et page lus dans la même transaction.
export async function memberCards(env, user, _body, request) {
  requireSharing(user);
  const url = new URL(request.url);
  const m = /^\/api\/members\/([^/]+)\/cards\/*$/.exec(url.pathname);
  const id = m ? m[1] : '';
  const notFound = () => new HttpError(404, 'Ce membre ne montre pas (ou plus) ses cartes.');
  if (!ID.test(id)) throw notFound();
  const part = url.searchParams.get('part') ?? '0';
  const after = decodeCursor(part);
  const [member, page] = await env.DB.batch([
    env.DB.prepare(MEMBER).bind(id),
    env.DB.prepare(MEMBER_PAGE).bind(id, after),
  ]);
  const who = member.results[0];
  if (!who) throw notFound();
  const rows = page.results.length > PAGE_SIZE ? page.results.slice(0, PAGE_SIZE) : page.results;
  return {
    member: { id: who.id, name: who.name, fetched_at: who.fetched_at },
    cards: raw(`[${rows.map(memberCard).join(',')}]`),
    part,
    next_part: page.results.length > PAGE_SIZE ? encodeCursor(rows[rows.length - 1].card_id) : null,
  };
}

const MEMBER_T = 'SELECT public_id AS id, name, shared_targets AS st FROM users WHERE public_id = ?1 AND shared = 1';
// Une page de collections par clé (id > dernière lue) : `before` = taille rangée des collections qui la précèdent dans
// la page ; on garde celles qui commencent sous TARGETS_PAGE_BYTES (la première toujours), et la suivante revient sans
// contenu (j NULL) pour dire qu'il en reste. Chaque collection est réduite en SQL : nom, puis pour chaque élément vérifié
// (status ok) son titre, son qid s'il en a un et `sep: true` si c'est un intercalaire ; rien d'autre ne sort de targets
// (ni source, ni dates, ni descriptions, ni ajout automatique : colonne auto), sauf sa nature (kind) : 'category' pour
// une catégorie de Wikipédia suivie (source « wp:… »), sinon 'collection'.
const MEMBER_TARGETS = `WITH page AS (
    SELECT t.id, t.name, t.items, t.source,
      COALESCE(SUM(length(CAST(t.items AS BLOB))) OVER (ORDER BY t.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before
    FROM targets AS t
    WHERE t.user_id = (SELECT id FROM users WHERE public_id = ?1 AND shared = 1 AND shared_targets = 1) AND t.id > ?2
  )
  SELECT p.id, CASE WHEN p.before < ?3 THEN json_object(
      'id', p.id,
      'name', p.name,
      'kind', CASE WHEN substr(coalesce(p.source, ''), 1, 3) = 'wp:' THEN 'category' ELSE 'collection' END,
      'items', (SELECT json_group_array(json(CASE
          WHEN json_extract(e.value, '$.qid') IS NULL AND coalesce(json_type(e.value, '$.sep'), '') <> 'true'
            THEN json_object('title', json_extract(e.value, '$.title'))
          WHEN json_extract(e.value, '$.qid') IS NULL
            THEN json_object('title', json_extract(e.value, '$.title'), 'sep', json('true'))
          WHEN coalesce(json_type(e.value, '$.sep'), '') <> 'true'
            THEN json_object('title', json_extract(e.value, '$.title'), 'qid', json_extract(e.value, '$.qid'))
          ELSE json_object('title', json_extract(e.value, '$.title'), 'qid', json_extract(e.value, '$.qid'), 'sep', json('true')) END))
        FROM json_each(p.items) AS e
        WHERE e.type = 'object' AND json_type(e.value, '$.title') = 'text' AND coalesce(json_extract(e.value, '$.status'), 'ok') = 'ok')
    ) END AS j
  FROM page AS p
  WHERE p.before < ?3 OR p.id = (SELECT MIN(id) FROM page WHERE before >= ?3)
  ORDER BY p.id`;

// GET /api/members/<id>/targets?part=… : collections à compléter d'un membre qui les montre (part comme pour ses cartes).
// 403 si l'appelant ne montre pas ses cartes ; 404 si ce membre ne montre pas (ou plus) ses cartes ou ses collections.
export async function memberTargets(env, user, _body, request) {
  requireSharing(user);
  const url = new URL(request.url);
  const m = /^\/api\/members\/([^/]+)\/targets\/*$/.exec(url.pathname);
  const id = m ? m[1] : '';
  if (!ID.test(id)) throw new HttpError(404, 'Ce membre ne montre pas (ou plus) ses cartes.');
  const part = url.searchParams.get('part') ?? '0';
  const after = decodeCursor(part);
  const [member, page] = await env.DB.batch([
    env.DB.prepare(MEMBER_T).bind(id),
    env.DB.prepare(MEMBER_TARGETS).bind(id, after, TARGETS_PAGE_BYTES),
  ]);
  const who = member.results[0];
  if (!who) throw new HttpError(404, 'Ce membre ne montre pas (ou plus) ses cartes.');
  if (!who.st) throw new HttpError(404, 'Ce membre ne montre pas (ou plus) ses collections à compléter.');
  const rows = page.results.filter((r) => r.j !== null && r.j !== undefined);
  const more = rows.length < page.results.length;
  return {
    member: { id: who.id, name: who.name },
    targets: raw(`[${rows.map((r) => r.j).join(',')}]`),
    part,
    next_part: more && rows.length ? encodeCursor(rows[rows.length - 1].id) : null,
  };
}
