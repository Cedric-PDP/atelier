// Vérifie site/public/nouveautes.json avant un push (mêmes règles que la page : SPEC.md, « Nouveautés ») et dit si la
// dernière chose du fil du chat est déjà une annonce.
// Usage : node check_news.mjs <nouveautes.json> [<adresse du site, https://…>]
//   sort une ligne « OK … » ou les erreurs (code 1) ; avec l'adresse, une ligne « chat : … » d'après GET /api/chat/last.
import fs from 'node:fs';

const [file, site] = process.argv.slice(2);
const errs = [];
let d;
try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error('JSON illisible : ' + e.message); process.exit(1); }
const ROUTE = /^#\/(collections|categorie|page|cartes|amis|ami|marche|chat|maj|reglages|nouveautes)(\/|\?|$)/;
const str = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const versions = Array.isArray(d.versions) ? d.versions : (errs.push('versions doit être une liste'), []);
const chat = Array.isArray(d.chat) ? d.chat : (errs.push('chat doit être une liste'), []);
const ids = new Set();
for (const v of versions) {
  const where = `version ${JSON.stringify(v && v.id)}`;
  if (!str(v.id, 60)) errs.push(`${where} : id manquant ou trop long`);
  if (ids.has(v.id)) errs.push(`${where} : id en double`);
  ids.add(v.id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date || '') || Number.isNaN(Date.parse(v.date))) errs.push(`${where} : date AAAA-MM-JJ attendue`);
  if (!Array.isArray(v.sections) || !v.sections.length) errs.push(`${where} : aucune rubrique`);
  for (const g of v.sections || []) {
    if (!str(g.title, 120)) errs.push(`${where} : rubrique sans titre`);
    if (g.icon != null && !str(g.icon, 8)) errs.push(`${where} : icône trop longue (${g.icon})`);
    if (!Array.isArray(g.items) || !g.items.length) errs.push(`${where}, « ${g.title} » : aucune ligne (elle serait écartée)`);
    for (const it of g.items || []) {
      if (!str(it.text, 600)) errs.push(`${where}, « ${g.title} » : ligne vide ou de plus de 600 caractères`);
      if (it.to != null && !ROUTE.test(it.to)) errs.push(`${where} : lien interne inconnu ${it.to} (il serait retiré)`);
      if (it.to != null && !str(it.link, 60)) errs.push(`${where} : lien ${it.to} sans libellé (« Voir » par défaut)`);
    }
  }
}
const cids = new Set();
for (const m of chat) {
  const where = `annonce ${JSON.stringify(m && m.id)}`;
  if (!str(m.id, 60) || cids.has(m.id)) errs.push(`${where} : id manquant, trop long ou en double`);
  cids.add(m.id);
  if (Number.isNaN(Date.parse(m.at))) errs.push(`${where} : heure ISO attendue`);
  if (!str(m.text, 300)) errs.push(`${where} : texte vide ou de plus de 300 caractères`);
  if (m.version != null && !ids.has(m.version)) errs.push(`${where} : version ${m.version} inconnue`);
}
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
const latest = [...versions].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
const lastAnn = [...chat].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
console.log(`OK : ${versions.length} version(s), la plus récente ${latest ? latest.id : '—'} ; ${chat.length} annonce(s), la dernière ${lastAnn ? `${lastAnn.id} (${lastAnn.at})` : '—'}`);

if (site) {
  try {
    const r = await fetch(new URL('/api/chat/last', site), { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const { last_at: lastAt } = await r.json();
    if (lastAnn && (!lastAt || Date.parse(lastAnn.at) > Date.parse(lastAt))) {
      console.log(`chat : DÉJÀ UNE ANNONCE — la dernière chose du fil est l'annonce ${lastAnn.id} (${lastAnn.at}) ; dernier message d'un membre : ${lastAt || 'aucun'}`);
    } else {
      console.log(`chat : PAS D'ANNONCE EN DERNIER — dernier message d'un membre ${lastAt || 'aucun'}, dernière annonce ${lastAnn ? lastAnn.at : 'aucune'}`);
    }
  } catch (e) {
    console.log(`chat : INCONNU — GET /api/chat/last a échoué (${e.message}) : route pas encore déployée, adresse fausse ou réseau`);
  }
}
