// Chat : un seul salon pour tous les classeurs du site, visible par tous les membres. Contrat : SPEC.md, « Chat ».
// - Messages en texte brut (500 caractères au plus, retours à la ligne gardés ; jamais de HTML) ; auteur = nom ACTUEL
//   du classeur, lu à chaque lecture (jointure sur users) ; jamais l'id interne du compte (seulement `mine`).
// - Suppression par l'auteur seulement : le texte est vidé aussitôt et la ligne reste comme marque (`deleted`) pour que
//   les pages ouvertes retirent le message à leur relecture suivante. DELETE /api/me fait pareil pour tous ses messages
//   (et oublie l'auteur : user_id = '').
// - Clé principale seulement (le favori « Relier », qui ne porte qu'un jeton de liaison, n'y a pas accès : routeur).
//
// Coût D1 (gratuit : 5 M de lignes lues et 100 000 écrites par jour pour toute l'instance) :
// - chaque message a une révision `rev` (unique, croissante) donnée à sa création, puis à sa suppression ; une page
//   ouverte sur le chat demande ?after=<rev> toutes les 12 s : index chat_by_rev, seules les lignes changées sont lues
//   (aucune si rien n'a bougé, plus MAX(rev) et MAX(id) : une ligne chacun, optimisation min/max de SQLite) ;
// - GET /api/me (relu toutes les 60 s) n'ajoute que MAX(id) (une ligne, clé primaire) : de quoi afficher le badge ;
// - un envoi écrit le message (3 lignes avec ses deux index) et purge, dans le même lot, ce qui dépasse les 2 000
//   plus récents (le plus ancien, par la clé primaire) ; les limites sont contrôlées dans l'INSERT même (index
//   chat_by_user : 10 lignes au plus pour la minute, 300 pour la journée).
// - Collections citées (2026-10-20) : un lien du site vers une collection (#/ami/<id public>/<id> ou, la sienne,
//   #/collections/<id>) est rangé sous une forme stable, `\uE000c:<id du compte>/<id de la collection>\uE001` (l'id public
//   change à chaque réactivation du partage), et retraduit à chaque lecture pour celui qui lit : nom de la collection en
//   clair dans le texte (une page d'avant cette fonction le montre tel quel), et à part sa position, le prénom de son
//   propriétaire et de quoi l'ouvrir s'il en a le droit (voir citeRefs). L'id interne ne sort jamais du serveur.
// - Membres cités (2026-10-20) : de même, un lien vers le classeur d'un membre qui montre ses cartes (#/ami/<id public>)
//   est rangé sous la forme `\uE000u:<id du compte>\uE001`, rendu par son prénom actuel dans le texte et, à part (`members`,
//   qu'une page d'avant ignore), de quoi l'ouvrir et son pseudo dans le jeu pour un lecteur qui montre ses cartes.
// - Réponses (2026-10-23) : un message peut répondre à un autre (`reply_to`, son numéro, vérifié à l'envoi) ; à la
//   lecture, `reply` = l'auteur actuel et un extrait du message cité (citations rendues en clair, 140 caractères au plus),
//   ou `gone` s'il a été supprimé ou purgé depuis. Une requête de plus, seulement si les messages lus répondent à d'autres.
// - Réactions (2026-10-24) : un emoji parmi CHAT_REACTIONS, mis ou retiré par chaque membre (table chat_reactions, une
//   ligne par message, membre et emoji). Chaque changement donne au message une nouvelle révision : les pages ouvertes
//   le relisent par ?after=<rev>. `reacts` (leur nombre, tenu dans chat_messages) évite de chercher des réactions aux
//   messages qui n'en ont pas : une requête de plus à la lecture, seulement si un message lu en a.

import { HttpError, json } from './http.js';

export const CHAT_MAX_CHARS = 500; // en unités UTF-16, comme le maxlength du champ de la page
export const CHAT_KEEP = 2000; // messages gardés (les plus récents ; marques de suppression comprises)
export const CHAT_PAGE = 100; // messages par lecture
export const CHAT_PER_MINUTE = 10; // par classeur
export const CHAT_PER_DAY = 300; // par classeur, sur 24 h glissantes
export const CHAT_ROOM_PER_DAY = 1000; // pour tout le salon, sur 24 h glissantes (garde le quota d'écritures de D1)
// Réactions possibles (dans l'ordre du sélecteur de la page, qui a la même liste).
export const CHAT_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👀'];
export const REACT_PER_MINUTE = 30; // réactions mises ou retirées par classeur, fenêtre d'une minute
export const REACT_PER_DAY = 500; // et de 24 h

// Caractères de contrôle (sauf le retour à la ligne) et forçages de sens d'écriture (texte retourné pour tromper) :
// retirés. Les jointures d'emoji (U+200D) restent.
const CONTROLS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;
// Lien personnel d'un classeur (#cle=<clé>) : il ouvre le classeur de qui l'envoie, à qui le lit.
const PERSONAL_LINK = /#cle=[A-Za-z0-9_-]{20,}/;
const NEEDS_NFC = /\p{M}/u;
// Bornes des collections citées (caractères d'usage privé) : rangées par le serveur seulement, retirées du texte envoyé.
const REF_BOUNDS = /[\uE000\uE001]/g;
// c:<id du compte>/<id de la collection> (collection) ou u:<id du compte> (membre).
const REF_MARK = /\uE000(?:c:([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_-]{1,64})|u:([A-Za-z0-9_-]{1,64}))\uE001/g;
// Lien du site vers une collection : son hôte, puis l'id public du membre (absent pour #/collections/, la sienne) et l'id
// de la collection ; les paramètres de la vue (?filtre=…) font partie du lien, pas une ponctuation qui le suit.
const COL_LINK = /\bhttps?:\/\/([A-Za-z0-9.:[\]-]+)\/?#\/(?:ami\/([A-Za-z0-9_-]{1,64})|collections)\/([A-Za-z0-9_-]{1,64})(?:\?[\w=&%.~-]*[\w=&%~-])?(?![\w/-])/g;
// Lien du site vers le classeur d'un membre : #/ami/<id public>, sans collection (paramètres de la vue compris).
const USER_LINK = /\bhttps?:\/\/([A-Za-z0-9.:[\]-]+)\/?#\/ami\/([A-Za-z0-9_-]{1,64})(?:\?[\w=&%.~-]*[\w=&%~-])?(?![\w/-])/g;
export const CHAT_MAX_REFS = 5; // collections et membres cités par message (les suivants restent des liens)

// Texte d'un message : fins de ligne unifiées, tabulations en espaces, contrôles retirés, espaces de fin de ligne
// retirés, trois lignes vides ou plus réduites à une, bords retirés. 1 à 500 caractères.
export function cleanMessage(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Le message doit être un texte.');
  if (value.length > CHAT_MAX_CHARS * 4) throw new HttpError(400, `Message trop long : ${CHAT_MAX_CHARS} caractères au plus.`);
  let text = value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(CONTROLS, '').replace(REF_BOUNDS, '');
  if (NEEDS_NFC.test(text)) text = text.normalize('NFC');
  text = text.replace(/[  ]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new HttpError(400, 'Message vide : écris quelque chose avant d\'envoyer.');
  if (text.length > CHAT_MAX_CHARS) throw new HttpError(400, `Message trop long : ${CHAT_MAX_CHARS} caractères au plus (il en fait ${text.length}).`);
  if (PERSONAL_LINK.test(text)) {
    throw new HttpError(400, "Ce message contient un lien personnel de classeur (#cle=…) : il ouvrirait ton classeur à tous ceux qui le liraient. Retire-le avant d'envoyer.");
  }
  return text;
}

const COLUMNS = 'm.id, m.rev, m.deleted, m.text, m.created_at, m.reply_to, m.reacts, (m.user_id = ?1) AS mine, u.name AS author';
const FROM = 'chat_messages AS m LEFT JOIN users AS u ON u.id = m.user_id';
// Les plus récents (sans `before`) ou ceux d'avant un message (`before`), du plus récent au plus ancien ; marques de
// suppression sautées. Une ligne de plus que la page dit s'il en reste de plus anciens.
const LATEST = `SELECT ${COLUMNS} FROM ${FROM} WHERE m.deleted = 0 ORDER BY m.id DESC LIMIT ?2`;
const BEFORE = `SELECT ${COLUMNS} FROM ${FROM} WHERE m.deleted = 0 AND m.id < ?3 ORDER BY m.id DESC LIMIT ?2`;
// Ce qui a changé depuis une révision (messages nouveaux et supprimés), par l'index chat_by_rev.
const AFTER = `SELECT ${COLUMNS} FROM ${FROM} WHERE m.rev > ?3 ORDER BY m.rev LIMIT ?2`;
// Dernière révision et dernier numéro : deux sous-requêtes (une seule fonction MAX chacune), une ligne lue chacune.
const TOP = 'SELECT (SELECT MAX(rev) FROM chat_messages) AS rev, (SELECT MAX(id) FROM chat_messages) AS last_id';

// Envoi : le message n'est écrit que si les trois limites le permettent (contrôle et écriture dans la même requête :
// deux envois simultanés ne passent pas tous deux au-delà). Limite du salon : le 1 000e message le plus récent
// (par numéro) a-t-il moins de 24 h ? Une ligne lue, par la clé primaire.
const INSERT = `INSERT INTO chat_messages (user_id, text, created_at, deleted, rev, reply_to)
  SELECT ?1, ?2, ?3, 0, COALESCE((SELECT MAX(rev) FROM chat_messages), 0) + 1, ?9
  WHERE (SELECT COUNT(*) FROM (SELECT 1 FROM chat_messages WHERE user_id = ?1 AND created_at > ?4 LIMIT ?5)) < ?5
    AND (SELECT COUNT(*) FROM (SELECT 1 FROM chat_messages WHERE user_id = ?1 AND created_at > ?6 LIMIT ?7)) < ?7
    AND COALESCE((SELECT created_at FROM chat_messages WHERE id <= (SELECT MAX(id) FROM chat_messages) - ?8 ORDER BY id DESC LIMIT 1), '') <= ?6
  RETURNING id, created_at`;
// Purge : au-delà des 2 000 plus récents (par numéro). Les numéros ne sont jamais réutilisés (le plus récent n'est
// jamais effacé), donc au plus 2 000 lignes restent.
const PURGE = 'DELETE FROM chat_messages WHERE id <= (SELECT MAX(id) FROM chat_messages) - ?1';
// Et leurs réactions (par la clé primaire de chat_reactions ; MAX(id) ne change pas avec la purge).
const PURGE_REACTIONS = 'DELETE FROM chat_reactions WHERE message_id <= (SELECT MAX(id) FROM chat_messages) - ?1';
// Envoi refusé : quelle limite, et dans combien de temps elle se lève.
const LIMITS = `SELECT
  (SELECT COUNT(*) FROM (SELECT 1 FROM chat_messages WHERE user_id = ?1 AND created_at > ?2 LIMIT ?3)) AS minute,
  (SELECT MIN(created_at) FROM chat_messages WHERE user_id = ?1 AND created_at > ?2) AS minute_from,
  (SELECT COUNT(*) FROM (SELECT 1 FROM chat_messages WHERE user_id = ?1 AND created_at > ?4 LIMIT ?5)) AS day,
  (SELECT MIN(created_at) FROM chat_messages WHERE user_id = ?1 AND created_at > ?4) AS day_from,
  (SELECT created_at FROM chat_messages WHERE id <= (SELECT MAX(id) FROM chat_messages) - ?6 ORDER BY id DESC LIMIT 1) AS room_from`;

// Suppression d'un message par son auteur : texte vidé, nouvelle révision (les pages ouvertes le retirent).
const DELETE_OWN = `UPDATE chat_messages SET text = '', deleted = 1, reacts = 0, rev = (SELECT MAX(rev) FROM chat_messages) + 1
  WHERE id = ?1 AND user_id = ?2 AND deleted = 0`;

// DELETE /api/me : tous ses messages vidés et sans auteur ; ceux qui ne l'étaient pas déjà reçoivent une révision
// nouvelle et unique (max + numéro), pour disparaître aussi des pages ouvertes. Ses réactions sont retirées : les
// messages qui en avaient reçoivent aussi une révision nouvelle (après celles de ses messages) et leur nouveau compte ;
// les réactions des autres à ses messages partent avec eux. Rare : les réactions sont parcourues sans index par membre.
export function eraseChatOf(db, userId) {
  return [
    db.prepare(`UPDATE chat_messages SET text = '', user_id = '', reacts = 0,
        rev = CASE WHEN deleted = 0 THEN (SELECT MAX(rev) FROM chat_messages) + id ELSE rev END, deleted = 1
      WHERE user_id = ?1`).bind(userId),
    db.prepare(`UPDATE chat_messages SET rev = (SELECT MAX(rev) FROM chat_messages) + id,
        reacts = (SELECT COUNT(*) FROM chat_reactions AS r WHERE r.message_id = chat_messages.id AND r.user_id <> ?1)
      WHERE deleted = 0 AND id IN (SELECT message_id FROM chat_reactions WHERE user_id = ?1)`).bind(userId),
    db.prepare(`DELETE FROM chat_reactions WHERE user_id = ?1
      OR message_id IN (SELECT id FROM chat_messages WHERE deleted = 1 AND user_id = '')`).bind(userId),
  ];
}

// Message tel que la page le reçoit, ses citations rendues en clair dans le texte, jamais les bornes rangées (at, len :
// leur place dans le texte, en unités UTF-16), chaque liste seulement s'il y en a :
// - `refs`, ses collections : {at, len, name, owner, mine, pid, id} (pid et id : de quoi l'ouvrir, null si le lecteur ne
//   le peut pas) ou {at, len, gone: true} (effacée, ou que son propriétaire ne montre plus) ;
// - `members`, ses membres : {at, len, name, mine, pid, pseudo} (pid : de quoi ouvrir son classeur, pseudo : son pseudo
//   dans le jeu, null si le lecteur ne le peut pas) ou {at, len, gone: true} (classeur supprimé). À part de `refs` : une
//   page d'avant cette fonction n'en montre que le prénom, en texte.
// - `reply`, s'il répond à un message : {id, author, mine, text} (text = extrait, voir quote) ou {id, gone: true}.
const GONE_TEXT = 'collection non partagée';
const GONE_USER = 'classeur supprimé';
const NO_NAME = 'membre sans prénom';
function message(r, cited, quoted) {
  const out = { id: r.id, author: r.author ?? null, mine: !!r.mine, text: r.text, created_at: r.created_at };
  if (r.reply_to) out.reply = (quoted && quoted.get(r.reply_to)) || { id: r.reply_to, gone: true };
  if (!r.text.includes('\uE000')) return out;
  const refs = [];
  const members = [];
  let text = '';
  let last = 0;
  for (const m of r.text.matchAll(REF_MARK)) {
    text += r.text.slice(last, m.index);
    let shown;
    if (m[3]) {
      const u = (cited && cited.get('u:' + m[3])) || { gone: true };
      shown = u.gone ? GONE_USER : u.name || NO_NAME;
      members.push({ at: text.length, len: shown.length, ...(u.gone ? u : { ...u, name: shown }) });
    } else {
      const c = (cited && cited.get(m[1] + '/' + m[2])) || { gone: true };
      shown = c.gone ? GONE_TEXT : c.name;
      refs.push({ at: text.length, len: shown.length, ...c });
    }
    text += shown;
    last = m.index + m[0].length;
  }
  out.text = text + r.text.slice(last);
  if (refs.length) out.refs = refs;
  if (members.length) out.members = members;
  return out;
}

// Messages auxquels répondent ceux qui sont lus : une requête (clé primaire), seulement s'il y en a ; un message supprimé
// ou purgé n'en rend pas (il devient `gone`).
export const CHAT_QUOTE_CHARS = 140;
const QUOTED = `SELECT m.id, m.text, (m.user_id = ?1) AS mine, u.name AS author
  FROM json_each(?2) AS r JOIN chat_messages AS m ON m.id = r.value AND m.deleted = 0 LEFT JOIN users AS u ON u.id = m.user_id`;
// Extrait d'un message cité : citations rendues en clair (comme le message lui-même), cartes citées sans leurs crochets,
// espaces réduits, coupé au mot près à 140 caractères (sans couper un emoji en deux).
function quote(q, cited) {
  const text = message(q, cited).text.replace(/\[\[([^[\]\n]{1,300})\]\]/g, '$1').replace(/\s+/g, ' ').trim();
  const chars = Array.from(text);
  if (chars.length <= CHAT_QUOTE_CHARS) return text;
  const cut = chars.slice(0, CHAT_QUOTE_CHARS).join('');
  const space = cut.lastIndexOf(' ');
  return (space > CHAT_QUOTE_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd() + '…';
}
// Messages tels que la page les reçoit (même ordre que `rows`) : messages cités, puis collections et membres cités (ceux
// des extraits compris).
async function render(db, user, rows) {
  const ids = [...new Set(rows.map((r) => r.reply_to).filter(Boolean))];
  const [quotedRows, reactions] = await Promise.all([
    ids.length ? db.prepare(QUOTED).bind(user.id, JSON.stringify(ids)).all().then((x) => x.results) : [],
    reactionsOf(db, user, rows.filter((r) => r.reacts > 0).map((r) => r.id)),
  ]);
  const cited = await citeRefs(db, user, rows.concat(quotedRows));
  const quoted = new Map(quotedRows.map((q) => [q.id, { id: q.id, author: q.author ?? null, mine: !!q.mine, text: quote(q, cited) }]));
  return rows.map((r) => {
    const out = message(r, cited, quoted);
    if (reactions.has(r.id)) out.reactions = reactions.get(r.id);
    return out;
  });
}

// Réactions de messages, vues par `user` : numéro → [{emoji, n, mine, who}], chaque emoji dans l'ordre où il a été mis
// la première fois (à la même milliseconde : dans l'ordre de CHAT_REACTIONS) ; `who` = prénoms actuels des autres membres qui l'ont mis (lisibles par tout le salon, comme les
// auteurs), `mine` = tu l'as mis. Une requête (clé primaire de chat_reactions, puis users), seulement s'il y en a.
const REACTIONS = `SELECT r.message_id AS id, r.emoji, r.created_at AS at, (r.user_id = ?1) AS mine, u.name
  FROM json_each(?2) AS j JOIN chat_reactions AS r ON r.message_id = j.value LEFT JOIN users AS u ON u.id = r.user_id
  ORDER BY r.message_id, r.created_at, r.user_id`;
async function reactionsOf(db, user, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const { results } = await db.prepare(REACTIONS).bind(user.id, JSON.stringify(ids)).all();
  const first = new Map();
  for (const r of results) {
    if (!out.has(r.id)) out.set(r.id, []);
    const list = out.get(r.id);
    let e = list.find((x) => x.emoji === r.emoji);
    if (!e) { list.push(e = { emoji: r.emoji, n: 0, mine: false, who: [] }); first.set(e, r.at); }
    e.n++;
    if (r.mine) e.mine = true;
    else e.who.push(r.name || NO_NAME);
  }
  const order = (x, y) => (first.get(x) < first.get(y) ? -1 : first.get(x) > first.get(y) ? 1 : CHAT_REACTIONS.indexOf(x.emoji) - CHAT_REACTIONS.indexOf(y.emoji));
  for (const list of out.values()) list.sort(order);
  return out;
}

// Collections citées par des messages, vues par `user` : une requête (clés primaires de users et de targets), seulement
// s'il y en a. Celles des autres : nom et prénom du propriétaire tant qu'il les montre (lisibles par tout le salon,
// choix de l'utilisateur du 2026-10-20), l'id public de quoi l'ouvrir seulement si le lecteur montre ses cartes
// (réciprocité, comme GET /api/members/<id>/targets). Les siennes : toujours, avec leur id.
const CITED = `SELECT json_extract(r.value, '$[0]') AS uid, t.id AS tid, t.name, u.name AS owner, u.shared_targets AS st, u.public_id AS pid, u.shared
  FROM json_each(?1) AS r
  JOIN users AS u ON u.id = json_extract(r.value, '$[0]')
  JOIN targets AS t ON t.user_id = u.id AND t.id = json_extract(r.value, '$[1]')`;
// Membres cités : leur prénom (lisible par tout le salon, comme l'auteur d'un message) ; l'id public et le pseudo dans le
// jeu seulement s'il montre ses cartes et que le lecteur montre les siennes (comme GET /api/members). Une requête (clé
// primaire de users), seulement s'il y en a.
const CITED_USERS = `SELECT u.id AS uid, u.name, u.game_pseudo AS pseudo, u.public_id AS pid, u.shared
  FROM json_each(?1) AS r JOIN users AS u ON u.id = r.value`;
async function citeRefs(db, user, rows) {
  const keys = new Map();
  const uids = new Set();
  for (const r of rows) {
    for (const [, uid, tid, member] of (r.text || '').matchAll(REF_MARK)) {
      if (member) uids.add(member);
      else keys.set(uid + '/' + tid, [uid, tid]);
    }
  }
  if (!keys.size && !uids.size) return null;
  const [cols, people] = await Promise.all([
    keys.size ? db.prepare(CITED).bind(JSON.stringify([...keys.values()])).all() : { results: [] },
    uids.size ? db.prepare(CITED_USERS).bind(JSON.stringify([...uids])).all() : { results: [] },
  ]);
  const { results } = cols;
  const sees = !!(user.shared && user.public_id);
  const cited = new Map();
  for (const u of people.results) {
    const mine = u.uid === user.id;
    const open = !mine && sees && u.shared && u.pid;
    cited.set('u:' + u.uid, { name: u.name || '', mine, pid: open ? u.pid : null, pseudo: open && u.pseudo ? u.pseudo : null });
  }
  for (const c of results) {
    const mine = c.uid === user.id;
    if (!mine && !(c.shared && c.st)) continue;
    const pid = !mine && sees && c.pid ? c.pid : null;
    cited.set(c.uid + '/' + c.tid, { name: c.name, owner: c.owner ?? null, mine, pid, id: mine || pid ? c.tid : null });
  }
  return cited;
}

// Envoi : les liens du site (même hôte que la requête) vers une collection que l'auteur voit (la sienne, ou celle d'un
// membre qui montre ses collections), ou vers le classeur d'un membre qui montre ses cartes (le sien compris), deviennent
// leur forme stable ; les autres liens restent tels quels.
const OWNERS = `SELECT r.key AS k, t.user_id AS uid FROM json_each(?1) AS r
  JOIN targets AS t ON t.id = json_extract(r.value, '$[1]') AND t.user_id = CASE WHEN json_extract(r.value, '$[0]') = '' THEN ?2
    ELSE (SELECT id FROM users WHERE public_id = json_extract(r.value, '$[0]') AND shared = 1 AND shared_targets = 1) END`;
const USERS = 'SELECT r.key AS k, u.id AS uid FROM json_each(?1) AS r JOIN users AS u ON u.public_id = r.value AND u.shared = 1';
async function storeRefs(db, user, text, host) {
  const all = [];
  for (const m of text.matchAll(COL_LINK)) {
    if (m[1].toLowerCase() !== host) continue;
    const own = !m[2] || m[2] === user.public_id;
    all.push({ at: m.index, end: m.index + m[0].length, pid: own ? '' : m[2], tid: m[3] });
  }
  for (const m of text.matchAll(USER_LINK)) {
    if (m[1].toLowerCase() === host) all.push({ at: m.index, end: m.index + m[0].length, pid: m[2], tid: null });
  }
  // Les 5 premiers dans l'ordre du texte (les deux formes ne se chevauchent pas : un lien de membre n'a pas de « / »
  // après l'id public).
  const found = all.sort((a, b) => a.at - b.at).slice(0, CHAT_MAX_REFS);
  if (!found.length) return text;
  const cols = found.filter((f) => f.tid);
  const users = found.filter((f) => !f.tid);
  const [c, u] = await Promise.all([
    cols.length ? db.prepare(OWNERS).bind(JSON.stringify(cols.map((f) => [f.pid, f.tid])), user.id).all() : { results: [] },
    users.length ? db.prepare(USERS).bind(JSON.stringify(users.map((f) => f.pid))).all() : { results: [] },
  ]);
  const mark = new Map();
  for (const r of c.results) { const f = cols[Number(r.k)]; mark.set(f, `\uE000c:${r.uid}/${f.tid}\uE001`); }
  for (const r of u.results) mark.set(users[Number(r.k)], `\uE000u:${r.uid}\uE001`);
  let out = '';
  let last = 0;
  for (const f of found) {
    if (!mark.has(f)) continue;
    out += text.slice(last, f.at) + mark.get(f);
    last = f.end;
  }
  return out + text.slice(last);
}
const INT = /^\d{1,15}$/;
function intParam(params, name) {
  const v = params.get(name);
  if (v === null) return null;
  if (!INT.test(v)) throw new HttpError(400, `${name} doit être un entier positif.`);
  return Number(v);
}

// GET /api/chat : les 100 plus récents (`{messages, rev, last_id, older}`, du plus ancien au plus récent ; `rev` =
// curseur de la lecture suivante, `older` = il y en a de plus anciens) ; ?before=<id> : les 100 d'avant ce message
// (`{messages, older}`) ; ?after=<rev> : ce qui a changé depuis (`{messages, deleted:[id…], rev, last_id, more}` ;
// `more` = plus de 100 changements, `rev` = celle du dernier rendu ; `{reset:true, rev, last_id}` si la révision est
// inconnue : base recréée, tout relire).
export async function listChat(env, user, _body, request) {
  const params = new URL(request.url).searchParams;
  const after = intParam(params, 'after');
  const before = intParam(params, 'before');
  if (after !== null && before !== null) throw new HttpError(400, 'after ou before, pas les deux.');
  const db = env.DB;
  if (before !== null) {
    const { results } = await db.prepare(BEFORE).bind(user.id, CHAT_PAGE + 1, before).all();
    const rows = results.slice(0, CHAT_PAGE).reverse();
    return { messages: await render(db, user, rows), older: results.length > CHAT_PAGE };
  }
  // Curseur et messages dans la même transaction : un changement fait entre les deux revient à la lecture suivante.
  const [top, page] = await db.batch([
    db.prepare(TOP),
    after === null ? db.prepare(LATEST).bind(user.id, CHAT_PAGE + 1) : db.prepare(AFTER).bind(user.id, CHAT_PAGE + 1, after),
  ]);
  const head = top.results[0] || {};
  const rev = head.rev ?? 0;
  const lastId = head.last_id ?? 0;
  const rows = page.results;
  if (after !== null && after > rev) return { reset: true, rev, last_id: lastId };
  const kept = rows.slice(0, CHAT_PAGE);
  if (after === null) {
    return { messages: await render(db, user, kept.reverse()), rev, last_id: lastId, older: rows.length > CHAT_PAGE };
  }
  const more = rows.length > CHAT_PAGE;
  return {
    messages: await render(db, user, kept.filter((r) => !r.deleted)),
    deleted: kept.filter((r) => r.deleted).map((r) => r.id),
    rev: more ? kept[kept.length - 1].rev : rev,
    last_id: lastId,
    more,
  };
}

// POST /api/chat {text, reply_to?} → 201 {message} (ses liens de collection déjà cités, voir storeRefs) ; 400 (texte, lien
// personnel, classeur sans prénom, reply_to), 404 (le message auquel il répond n'existe plus), 429 (limites).
export async function postChat(env, user, body, request) {
  const typed = cleanMessage(body.text);
  if (!user.name) {
    throw new HttpError(400, "Donne d'abord un prénom à ton classeur (Réglages, « Ton prénom ») : c'est lui que les autres membres verront.");
  }
  const replyTo = body.reply_to ?? null;
  if (replyTo !== null && !(Number.isSafeInteger(replyTo) && replyTo > 0)) throw new HttpError(400, "reply_to doit être le numéro d'un message.");
  const db = env.DB;
  // Le message cité doit exister (une ligne, clé primaire) ; supprimé entre cette lecture et l'envoi, il devient `gone`.
  if (replyTo !== null && !(await db.prepare('SELECT 1 FROM chat_messages WHERE id = ?1 AND deleted = 0').bind(replyTo).first())) {
    throw new HttpError(404, "Le message auquel tu réponds n'existe plus (supprimé par son auteur ?).");
  }
  const now = Date.now();
  const at = new Date(now).toISOString();
  const minute = new Date(now - 60_000).toISOString();
  const day = new Date(now - 86_400_000).toISOString();
  const text = await storeRefs(db, user, typed, new URL(request.url).host.toLowerCase());
  const [ins] = await db.batch([
    db.prepare(INSERT).bind(user.id, text, at, minute, CHAT_PER_MINUTE, day, CHAT_PER_DAY, CHAT_ROOM_PER_DAY - 1, replyTo),
    db.prepare('UPDATE users SET chat_sent = chat_sent + 1 WHERE id = ?1 AND changes() > 0').bind(user.id),
    db.prepare(PURGE).bind(CHAT_KEEP),
    db.prepare(PURGE_REACTIONS).bind(CHAT_KEEP),
  ]);
  const row = ins.results[0];
  if (!row) throw await limitError(db, user, now, minute, day);
  const sent = { id: row.id, author: user.name, mine: true, text, created_at: row.created_at, reply_to: replyTo };
  return json({ message: (await render(db, user, [sent]))[0] }, 201);
}

async function limitError(db, user, now, minute, day) {
  const l = await db.prepare(LIMITS).bind(user.id, minute, CHAT_PER_MINUTE, day, CHAT_PER_DAY, CHAT_ROOM_PER_DAY - 1).first() || {};
  const wait = (from, span) => Math.max(1, Math.ceil((Date.parse(from) + span - now) / 1000));
  if (l.minute >= CHAT_PER_MINUTE) {
    const s = wait(l.minute_from, 60_000);
    return new HttpError(429, `Doucement : ${CHAT_PER_MINUTE} messages par minute au plus. Réessaie dans ${s} s.`, { retry_after: s });
  }
  if (l.day >= CHAT_PER_DAY) {
    return new HttpError(429, `Tu as envoyé ${CHAT_PER_DAY} messages en 24 heures : c'est la limite par classeur. Réessaie plus tard.`, { retry_after: wait(l.day_from, 86_400_000) });
  }
  if (l.room_from && l.room_from > day) {
    return new HttpError(429, `Le chat a reçu ${CHAT_ROOM_PER_DAY.toLocaleString('fr-FR')} messages en 24 heures, sa limite (pour rester dans le quota gratuit de la base) : réessaie plus tard.`,
      { retry_after: wait(l.room_from, 86_400_000) });
  }
  // Plus de limite atteinte entre-temps (des messages ont vieilli pendant la requête) : on peut réessayer.
  return new HttpError(429, 'Envoi refusé un instant : réessaie.', { retry_after: 1 });
}

// GET /api/chat/last (sans clé) → {last_at} : heure du dernier message d'un membre (null sans message), rien d'autre (ni
// texte, ni auteur, ni numéro). Sert à l'outil de publication des nouveautés (skill « publier ») : une annonce du chat
// (nouveautes.json) plus récente que lui est la dernière chose du fil. Lu par la clé primaire en partant de la fin
// (marques de suppression sautées).
export async function lastChat(env) {
  const row = await env.DB.prepare('SELECT created_at FROM chat_messages WHERE deleted = 0 ORDER BY id DESC LIMIT 1').first();
  return { last_at: row ? row.created_at : null };
}

// DELETE /api/chat/<id> : par son auteur seulement (403 sinon, 404 s'il n'existe plus). Déjà supprimé par lui : ok.
export async function deleteChat(env, user, _body, request) {
  const m = new URL(request.url).pathname.match(/\/chat\/(\d{1,15})\/?$/);
  if (!m) throw new HttpError(404, "Ce point d'accès n'existe pas.");
  const id = Number(m[1]);
  const db = env.DB;
  const res = await db.prepare(DELETE_OWN).bind(id, user.id).run();
  if (res.meta.changes) {
    await db.prepare('DELETE FROM chat_reactions WHERE message_id = ?1').bind(id).run();
    return { ok: true };
  }
  const row = await db.prepare('SELECT user_id, deleted FROM chat_messages WHERE id = ?1').bind(id).first();
  if (row && row.user_id === user.id) return { ok: true }; // déjà supprimé (double clic, autre onglet)
  if (!row || row.deleted) throw new HttpError(404, "Ce message n'existe plus.");
  throw new HttpError(403, 'Tu ne peux supprimer que tes propres messages.');
}

// Réactions : limites par classeur, dans deux fenêtres fixes (une minute, 24 h) tenues dans sa ligne de users (une écriture,
// pas de journal) ; le compte et l'écriture dans la même requête. Aucune ligne rendue : limite atteinte.
const REACT_LIMIT = `UPDATE users SET
    react_min = CASE WHEN react_min_at > ?2 THEN react_min + 1 ELSE 1 END,
    react_min_at = CASE WHEN react_min_at > ?2 THEN react_min_at ELSE ?4 END,
    react_day = CASE WHEN react_day_at > ?3 THEN react_day + 1 ELSE 1 END,
    react_day_at = CASE WHEN react_day_at > ?3 THEN react_day_at ELSE ?4 END
  WHERE id = ?1 AND (react_min_at IS NULL OR react_min_at <= ?2 OR react_min < ?5)
    AND (react_day_at IS NULL OR react_day_at <= ?3 OR react_day < ?6)
  RETURNING id`;
const REACT_ADD = `INSERT OR IGNORE INTO chat_reactions (message_id, user_id, emoji, created_at)
  SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM chat_messages WHERE id = ?1 AND deleted = 0)`;
const REACT_DROP = 'DELETE FROM chat_reactions WHERE message_id = ?1 AND user_id = ?2 AND emoji = ?3';
// Après un changement : nouvelle révision (les pages ouvertes relisent le message) et nouveau compte.
const REACT_TOUCH = `UPDATE chat_messages SET rev = (SELECT MAX(rev) FROM chat_messages) + 1,
    reacts = (SELECT COUNT(*) FROM chat_reactions WHERE message_id = ?1)
  WHERE id = ?1 AND deleted = 0`;

// POST /api/chat/<id>/react {emoji, on} → {id, reactions:[{emoji, n, mine, who}]} (les réactions du message après le
// changement, [] sans) : met (on: true) ou retire (on: false) sa réaction ; déjà mise ou déjà retirée : rien ne change
// (un double clic ne la retire pas). 400 (emoji hors de la liste, on manquant, classeur sans prénom), 404 (message
// supprimé ou purgé), 429 (limites).
export async function reactChat(env, user, body, request) {
  const m = new URL(request.url).pathname.match(/\/chat\/(\d{1,15})\/react\/?$/);
  if (!m) throw new HttpError(404, "Ce point d'accès n'existe pas.");
  const id = Number(m[1]);
  const emoji = body.emoji;
  if (!CHAT_REACTIONS.includes(emoji)) throw new HttpError(400, `Réaction inconnue : ${CHAT_REACTIONS.join(' ')}.`);
  if (typeof body.on !== 'boolean') throw new HttpError(400, 'on doit être true (mettre) ou false (retirer).');
  if (!user.name) {
    throw new HttpError(400, "Donne d'abord un prénom à ton classeur (Réglages, « Ton prénom ») : c'est lui que les autres membres verront.");
  }
  const db = env.DB;
  if (!(await db.prepare('SELECT 1 FROM chat_messages WHERE id = ?1 AND deleted = 0').bind(id).first())) {
    throw new HttpError(404, "Ce message n'existe plus (supprimé par son auteur ?).");
  }
  const now = Date.now();
  const at = new Date(now).toISOString();
  const minute = new Date(now - 60_000).toISOString();
  const day = new Date(now - 86_400_000).toISOString();
  if (!(await db.prepare(REACT_LIMIT).bind(user.id, minute, day, at, REACT_PER_MINUTE, REACT_PER_DAY).first())) {
    const l = await db.prepare('SELECT react_min, react_min_at, react_day, react_day_at FROM users WHERE id = ?1').bind(user.id).first() || {};
    const wait = (from, span) => Math.max(1, Math.ceil((Date.parse(from) + span - now) / 1000));
    if (l.react_day >= REACT_PER_DAY && l.react_day_at > day) {
      throw new HttpError(429, `Tu as mis ou retiré ${REACT_PER_DAY} réactions en 24 heures : c'est la limite par classeur. Réessaie plus tard.`,
        { retry_after: wait(l.react_day_at, 86_400_000) });
    }
    const s = l.react_min_at > minute ? wait(l.react_min_at, 60_000) : 1;
    throw new HttpError(429, `Doucement : ${REACT_PER_MINUTE} réactions par minute au plus. Réessaie dans ${s} s.`, { retry_after: s });
  }
  const res = body.on
    ? await db.prepare(REACT_ADD).bind(id, user.id, emoji, at).run()
    : await db.prepare(REACT_DROP).bind(id, user.id, emoji).run();
  if (res.meta.changes) await db.prepare(REACT_TOUCH).bind(id).run();
  const reactions = await reactionsOf(db, user, [id]);
  return { id, reactions: reactions.get(id) || [] };
}
