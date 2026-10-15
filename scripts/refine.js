// Affine les catégories trop larges : étiquettes fines par carte (nature la plus précise, genres, lieu) et albums
// fins à compléter, tirés des relations des cartes possédées (réalisateur, auteur, interprète, série, taxon parent,
// lieu, ensemble). Tout vient de Wikidata (query.wikidata.org, par lots), mis en cache dans cache/refine.json.
// Usage : node scripts/refine.js [--refresh] [--retry] [--plan]   (--refresh : tout réinterroger ; --retry : reprendre
// les albums dont la sonde a échoué ; --plan : lister les albums candidats sans les sonder)  -> data/refined.json
const fs = require('fs');
const path = require('path');
const { sparql, qid, chunks } = require('../lib/net.js');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'cache', 'refine.json');
const OUT = path.join(ROOT, 'data', 'refined.json');
const REFRESH = process.argv.includes('--refresh');
const RETRY = process.argv.includes('--retry');
const PLAN = process.argv.includes('--plan');
const load = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const save = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o)); };
const log = (...a) => console.log(...a);
const progress = (s) => process.stdout.write(s + '                    \r');
const vals = (ids) => ids.map((id) => 'wd:' + id).join(' ');

const FR = '?a schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> ; schema:name ?title .';
const DESC = 'OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc) = "fr") }';
const LIMIT = 1000; // un album complet compte au plus 1 000 articles ; la sonde en demande LIMIT + 1
const MIN = 3;

// Relations qui font un album, dans l'ordre de priorité (un doublon garde la première).
const RELS = ['P57', 'P50', 'P175', 'P179', 'P171', 'P131', 'P361'];
const HUMAN = 'Q5';
const TAXON = 'Q16521';
const FILM = 'Q11424';
const GENUS = 'Q34740';
const SPECIES = 'Q7432';
const HOMONYMY = new Set(['Q4167410', 'Q22808320']);
const DEPTS = ['Q6465', 'Q202216']; // département français, département d'outre-mer
// Natures qui ne décrivent pas un sujet (pages techniques) : jamais la base d'un album.
const NO_ALBUM = new Set([...HOMONYMY, 'Q13406463', 'Q4167836', 'Q11266439']);
// Natures « œuvre écrite » : l'album d'un auteur s'appelle alors simplement « Œuvres de … ».
const WRITTEN = new Set(['Q7725634', 'Q47461344', 'Q571', 'Q8261']);
const PER_ITEM_RELS = [...RELS, 'P136', 'P105'];

// --- Français : pluriels, « de », noms d'albums ---------------------------------------------------------------
const STOP = new Set(['de', 'du', 'des', 'à', 'au', 'aux', 'en', 'dans', 'sur', 'pour', 'par', 'avec', 'sans', 'le', 'la', 'les', 'entre', 'sous', 'chez', 'contre', 'vers', 'selon']);
const INVAR = new Set(['ou', 'et', 'non', 'vidéo', 'web', 'audio', 'standard', 'type']);
const PREFIX = new Set(['non', 'sous', 'semi', 'demi', 'quasi', 'pseudo', 'néo', 'anti', 'ex', 'super', 'pré', 'post', 'auto', 'mi', 'micro', 'méga', 'proto']);
const AL_S = new Set(['festival', 'carnaval', 'récital', 'chacal', 'régal', 'bal', 'cal', 'natal', 'naval', 'fatal', 'banal', 'final']);
const AIL_AUX = new Set(['bail', 'corail', 'émail', 'soupirail', 'travail', 'vitrail', 'vantail']);
const OU_X = new Set(['bijou', 'caillou', 'chou', 'genou', 'hibou', 'joujou', 'pou']);
const EU_S = new Set(['pneu', 'bleu', 'landau', 'émeu']);
function pluralWord(w) {
  const lw = w.toLowerCase();
  if (INVAR.has(lw) || /[sxz]$/i.test(w)) return w;
  if (AL_S.has(lw)) return w + 's';
  if (/al$/i.test(w)) return w.slice(0, -2) + 'aux';
  if (AIL_AUX.has(lw)) return w.slice(0, -3) + 'aux';
  if (/(eau|au|eu)$/i.test(w) && !EU_S.has(lw)) return w + 'x';
  if (OU_X.has(lw)) return w + 'x';
  return w + 's';
}
// Mot composé : « non-urbaine » -> « non-urbaines », « clocher-tour » -> « clochers-tours ».
function pluralToken(p) {
  if (!p.includes('-')) return pluralWord(p);
  const parts = p.split('-');
  if (PREFIX.has(parts[0].toLowerCase())) return [...parts.slice(0, -1), pluralWord(parts[parts.length - 1])].join('-');
  return parts.map((x) => (x.length >= 3 && !STOP.has(x.toLowerCase()) ? pluralWord(x) : x)).join('-');
}
// Met au pluriel le groupe nominal de tête (jusqu'à la première préposition) : « gare ferroviaire » -> « gares
// ferroviaires », « épisode de série télévisée » -> « épisodes de série télévisée ».
function plural(label) {
  const out = [];
  let stop = false;
  label.split(' ').forEach((p, i) => {
    if (!stop && (STOP.has(p.toLowerCase()) || /^[dl]['’]/i.test(p))) stop = true;
    const word = /^\p{L}[\p{L}-]*$/u.test(p) && (i === 0 || p[0] === p[0].toLowerCase());
    out.push(!stop && word ? pluralToken(p) : p);
  });
  return out.join(' ');
}
// Tête seule (sans complément) : « village de Pologne » -> « village ».
const head = (label) => {
  const parts = label.split(' ');
  const i = parts.findIndex((p, k) => k > 0 && (STOP.has(p.toLowerCase()) || /^[dl]['’]/i.test(p)));
  return i < 0 ? label : parts.slice(0, i).join(' ');
};
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
// Voyelle initiale (élision) ; « Y » devant une voyelle se prononce comme une consonne (« de Yasuhiro », « d'Yves »).
const VOWEL = /^(?:[aeiouàâäéèêëîïôöûüœæ]|y(?![aeiouyāēīōūàâäéèêëîïôöûü]))/i;
// « de » devant un nom : « d'Alfred Hitchcock », « du Corbusier », « des Rita Mitsouko ».
function de(x) {
  if (/^Le /.test(x)) return 'du ' + x.slice(3);
  if (/^Les /.test(x)) return 'des ' + x.slice(4);
  return (VOWEL.test(x) ? "d'" : 'de ') + x;
}
// Noms communs qui commencent le nom d'un lieu (« arrondissement de Brest », « Cercle de Kadiolo ») : article selon
// le genre (« de l'arrondissement », « du cercle », « de la province »).
const PLACE_F = new Set(['province', 'commune', 'région', 'municipalité', 'ville', 'île', 'paroisse', 'préfecture', 'sous-préfecture', 'circonscription', 'communauté', 'gmina', 'voïvodie', 'zone', 'république', 'subdivision', 'collectivité', 'métropole', 'agglomération', 'division', 'unité', 'localité', 'cité', 'wilaya', 'daïra', 'principauté', 'seigneurie', 'vallée', 'aire', 'baronnie', 'châtellenie']);
const PLACE_M = new Set(['canton', 'arrondissement', 'district', 'comté', 'département', 'territoire', 'quartier', 'village', 'hameau', 'raïon', 'okrug', 'powiat', 'oblast', 'borough', 'township', 'cercle', 'bailliage', 'land', 'gouvernorat', 'émirat', 'royaume', 'duché', 'comtat', 'secteur', 'municipe', 'kraï', 'bourg', 'faubourg', 'sandjak', 'vilayet', 'dème', 'atoll', 'archipel', 'centre', 'état', 'sous-district', 'kreis', 'bezirk', 'okres']);
// Départements masculins qu'on dit « en … » (« en Loir-et-Cher ») : la règle « en » + consonne = féminin s'y trompe.
const EN_M = new Set(['Loir-et-Cher', 'Lot-et-Garonne', 'Maine-et-Loire', 'Tarn-et-Garonne']);
// « de » devant un lieu, d'après la catégorie de ses natifs (« Naissance dans la Vienne / dans l'Aveyron / dans le
// département du Nord / en Gironde / à Paris »), sinon d'après le nom commun qui le commence.
function deLieu(label, born) {
  const x = label.replace(/ \(.*\)$/, '');
  const m = born && born.replace(/^Catégorie:/, '').match(/^Naissance (?:dans (?:le|la) (?:département|province|région) )?(dans la |dans le |dans l['’]|dans les |du |de la |de l['’]|des |en |au |aux |à )(.+)$/);
  if (m && m[2] === x) {
    switch (m[1].trim()) {
      case 'dans la': case 'de la': return 'de la ' + x;
      case 'dans le': case 'au': case 'du': return 'du ' + x;
      case 'dans les': case 'aux': case 'des': return 'des ' + x;
      case 'en': return EN_M.has(x) ? 'du ' + x : VOWEL.test(x) ? "de l'" + x : 'de la ' + x;
      case 'à': return de(x);
      default: return "de l'" + x;
    }
  }
  const sp = x.indexOf(' ');
  const w = sp > 0 ? x.slice(0, sp).toLowerCase() : null;
  if (w && (PLACE_F.has(w) || PLACE_M.has(w))) {
    const t = w === 'état' ? x : w + x.slice(sp);
    return VOWEL.test(t) ? "de l'" + t : PLACE_F.has(w) ? 'de la ' + t : 'du ' + t;
  }
  return de(x);
}
// Pluriel des natures les plus fréquentes dans un nom d'album de lieu (sans l'adjectif de pays, redondant).
const PLACE_PLURAL = {
  Q484170: 'communes', Q3558970: 'villages', Q532: 'villages', Q126723715: 'villages', Q486972: 'localités',
  Q5153359: 'municipalités', Q12813115: 'unités urbaines', Q1093829: 'villes', Q262166: 'communes',
  Q3257686: 'localités', Q1115575: 'paroisses civiles', Q55488: 'gares', Q16970: 'églises',
  Q18524218: 'cantons', Q184188: 'anciens cantons', Q116457956: 'communes non urbaines',
};
// Rangs taxinomiques féminins (« de la famille »), les autres prennent « du » (ou « de l' » devant voyelle).
const RANK_F = new Set(['famille', 'sous-famille', 'super-famille', 'tribu', 'sous-tribu', 'classe', 'sous-classe', 'super-classe', 'infra-classe', 'section', 'sous-section', 'série', 'espèce', 'sous-espèce', 'division', 'variété', 'forme', 'cohorte', 'légion']);
const deRank = (r) => (VOWEL.test(r) ? "de l'" + r : RANK_F.has(r) ? 'de la ' + r : 'du ' + r);

// Groupe lisible d'un taxon, tiré de sa description : « espèce d'insectes » -> « insectes ».
function taxonGroup(desc) {
  const m = (desc || '').match(/^(espèce|genre|famille|sous-espèce|ordre) d(e |'|es |u )(.+)$/i);
  if (!m) return 'taxon';
  const g = m[3].split(/,| (?:de|du|des|d'|endémique|originaire|présente?|vivant|décrite?)\b/)[0].trim();
  return g ? plural(g) : 'taxon';
}

async function main() {
  const owned = load(path.join(ROOT, 'data', 'owned.json'), null);
  const wd = load(path.join(ROOT, 'cache', 'wd.json'), null);
  if (!owned || !wd) throw new Error("lancer d'abord scripts/extract_har.js puis scripts/wikidata.js");
  const cache = REFRESH ? {} : load(CACHE, {});
  cache.items ||= {}; // Qid -> { P57: [...], …, P136, P105, dep: [départements], sup: [natures superclasses d'une autre] }
  cache.info ||= {}; // Qid -> { l: libellé fr, tn: nom scientifique, r: rang P105, born: catégorie des naissances }
  cache.film ||= {}; // nature -> sous-classe de film ?
  cache.groups ||= {}; // clé d'album -> { list: [[Qid, titre, description]] | null, big, err }
  const persist = () => save(CACHE, cache);

  const cards = owned.cards.map((c) => ({ c, id: wd.titles[c.t] })).filter((x) => x.id && wd.items[x.id]);
  const ids = [...new Set(cards.map((x) => x.id))];
  const p31 = (id) => wd.items[id].p31 || [];

  // 1. Relations de chaque carte (une ligne par valeur), par lots de 200.
  const needRel = ids.filter((id) => !cache.items[id] || !cache.items[id].rel);
  let done = 0;
  for (const batch of chunks(needRel, 200)) {
    const rows = await sparql(`SELECT ?item ?p ?v WHERE { VALUES ?item { ${vals(batch)} }
      VALUES ?p { ${PER_ITEM_RELS.map((p) => 'wdt:' + p).join(' ')} }
      ?item ?p ?v . FILTER(isIRI(?v)) }`);
    for (const id of batch) cache.items[id] = { ...(cache.items[id] || {}), rel: Object.fromEntries(PER_ITEM_RELS.map((p) => [p, []])) };
    for (const r of rows) {
      const rel = cache.items[qid(r.item.value)].rel;
      const p = qid(r.p.value);
      const v = qid(r.v.value);
      if (/^Q\d+$/.test(v) && !rel[p].includes(v)) rel[p].push(v);
    }
    persist();
    progress(`relations ${(done += batch.length)}/${needRel.length}`);
  }
  log(`relations : ${ids.length} éléments (${needRel.length} interrogés)`);

  // 2. Département des cartes situées en France (P131* jusqu'à un département), par lots de 150.
  const needDep = ids.filter((id) => !cache.items[id].dep);
  done = 0;
  for (const batch of chunks(needDep, 150)) {
    const rows = await sparql(`SELECT DISTINCT ?item ?dep WHERE { VALUES ?item { ${vals(batch)} }
      VALUES ?t { ${vals(DEPTS)} } ?item wdt:P131+ ?dep . ?dep wdt:P31 ?t . }`);
    for (const id of batch) cache.items[id].dep = [];
    for (const r of rows) { const d = cache.items[qid(r.item.value)].dep; const v = qid(r.dep.value); if (!d.includes(v)) d.push(v); }
    persist();
    progress(`départements ${(done += batch.length)}/${needDep.length}`);
  }
  log(`départements : ${ids.filter((id) => cache.items[id].dep.length).length} cartes situées dans un département français`);

  // 3. Natures d'une carte qui sont des superclasses (P279+) d'une autre de ses natures.
  const needSup = ids.filter((id) => !cache.items[id].sup);
  for (const id of needSup) if (p31(id).length < 2) cache.items[id].sup = [];
  const multi = needSup.filter((id) => p31(id).length >= 2);
  done = 0;
  for (const batch of chunks(multi, 150)) {
    const rows = await sparql(`SELECT DISTINCT ?item ?b WHERE { VALUES ?item { ${vals(batch)} }
      ?item wdt:P31 ?a , ?b . FILTER(?a != ?b) ?a wdt:P279+ ?b . }`);
    for (const id of batch) cache.items[id].sup = [];
    for (const r of rows) { const s = cache.items[qid(r.item.value)].sup; const b = qid(r.b.value); if (!s.includes(b)) s.push(b); }
    persist();
    progress(`natures ${(done += batch.length)}/${multi.length}`);
  }

  // Natures fines de chaque carte, et celle qui sert de base aux albums (la plus fréquente dans la collection).
  const fine = (id) => {
    const sup = new Set(cache.items[id].sup);
    return p31(id).filter((c) => !sup.has(c));
  };
  const natFreq = {};
  for (const { id } of cards) for (const c of fine(id)) natFreq[c] = (natFreq[c] || 0) + 1;
  const albumNature = (id) => {
    const cands = fine(id).filter((c) => !NO_ALBUM.has(c));
    cands.sort((a, b) => (!!wd.labels[b] - !!wd.labels[a]) || (natFreq[b] || 0) - (natFreq[a] || 0));
    return cands[0] || null;
  };

  // 4. Libellés, noms scientifiques, rangs et catégories de naissance des valeurs rencontrées.
  const wantInfo = new Set();
  for (const id of ids) {
    const it = cache.items[id];
    for (const p of PER_ITEM_RELS) for (const v of it.rel[p].slice(0, p === 'P131' ? 3 : 5)) wantInfo.add(v);
    for (const v of it.dep) wantInfo.add(v);
    for (const c of fine(id)) if (!wd.labels[c]) wantInfo.add(c);
  }
  for (let round = 0; round < 2; round++) {
    const need = [...wantInfo].filter((v) => !cache.info[v]);
    done = 0;
    for (const batch of chunks(need, 250)) {
      const rows = await sparql(`SELECT ?c ?l ?tn ?r ?born WHERE { VALUES ?c { ${vals(batch)} }
        OPTIONAL { ?c rdfs:label ?l FILTER(LANG(?l) = "fr") }
        OPTIONAL { ?c wdt:P225 ?tn }
        OPTIONAL { ?c wdt:P105 ?r }
        OPTIONAL { ?c wdt:P1464 ?cat . ?ca schema:about ?cat ; schema:isPartOf <https://fr.wikipedia.org/> ; schema:name ?born . } }`);
      for (const id of batch) cache.info[id] = { l: null };
      for (const r of rows) {
        const inf = cache.info[qid(r.c.value)];
        if (r.l && !inf.l) inf.l = r.l.value;
        if (r.tn && !inf.tn) inf.tn = r.tn.value;
        if (r.r && !inf.r) inf.r = qid(r.r.value);
        if (r.born && !inf.born) inf.born = r.born.value;
      }
      persist();
      progress(`libellés ${(done += batch.length)}/${need.length}`);
    }
    // Deuxième tour : libellés des rangs taxinomiques des taxons parents.
    for (const v of [...wantInfo]) if (cache.info[v] && cache.info[v].r) wantInfo.add(cache.info[v].r);
  }
  // Taxon : nom scientifique, nom commun entre parenthèses (« Quercus (chêne) »).
  const taxName = (v) => {
    const inf = cache.info[v] || {};
    const sci = inf.tn || inf.l;
    return inf.l && inf.tn && inf.l.toLowerCase() !== inf.tn.toLowerCase() ? `${sci} (${inf.l})` : sci;
  };
  const label = (v) => (cache.info[v] && (cache.info[v].l || cache.info[v].tn)) || wd.labels[v] || null;
  const natLabel = (c) => wd.labels[c] || (cache.info[c] && cache.info[c].l) || null;

  // 5. Natures de films (pour les réalisateurs : « film » et ses sous-classes vont ensemble).
  const filmNats = [...new Set(cards.filter(({ id }) => cache.items[id].rel.P57.length).map(({ id }) => albumNature(id)).filter(Boolean))].filter((c) => !(c in cache.film));
  for (const batch of chunks(filmNats, 200)) {
    const rows = await sparql(`SELECT ?c WHERE { VALUES ?c { ${vals(batch)} } ?c wdt:P279* wd:${FILM} . }`);
    for (const c of batch) cache.film[c] = false;
    for (const r of rows) cache.film[qid(r.c.value)] = true;
    persist();
  }

  // 6. Groupes (relation, valeur, nature) des cartes possédées.
  const groups = new Map();
  for (const { id } of cards) {
    const it = cache.items[id];
    const nat = albumNature(id);
    for (const p of RELS) {
      for (const v of it.rel[p].slice(0, 3)) {
        if (!label(v)) continue;
        let classes, key, name;
        if (p === 'P171') {
          classes = [];
          key = `P171-${v}`;
          const pr = cache.info[v] && cache.info[v].r;
          const myRank = it.rel.P105[0];
          if (pr === GENUS) name = `Espèces du genre ${taxName(v)}`;
          else if (pr && label(pr)) name = `${myRank && myRank !== SPECIES && label(myRank) ? cap(plural(label(myRank))) : 'Taxons'} ${deRank(label(pr))} ${taxName(v)}`;
          else name = `Taxons ${de(taxName(v))}`;
        } else {
          if (!nat) continue;
          const nl = natLabel(nat);
          classes = [nat];
          key = `${p}-${v}-${nat}`;
          if (p === 'P57') {
            const isFilm = nat === FILM || cache.film[nat];
            if (isFilm && nat !== FILM) classes.push(FILM);
            name = isFilm ? `Films ${de(label(v))}` : nl ? `${cap(plural(nl))} ${de(label(v))}` : `Réalisations ${de(label(v))}`;
          } else if (p === 'P50') name = `Œuvres ${de(label(v))}${WRITTEN.has(nat) || !nl ? '' : ` (${plural(nl)})`}`;
          else if (p === 'P175') {
            // Interprète : disques, mais aussi rôles (personnages joués) ou œuvres auxquelles il a prêté sa voix.
            if (nl && /personnage|fiction/i.test(nl)) name = `Personnages joués par ${label(v)}`;
            else if (!nl || /album|single|chanson|musica|\bEP\b|bande originale|disque|maxi/i.test(nl)) name = `Discographie ${de(label(v))}${nl ? ` (${plural(nl)})` : ''}`;
            else name = `${cap(plural(nl))} avec ${label(v)}`;
          }
          else if (p === 'P179' || p === 'P361') name = `${cap(label(v))}${nl ? ` (${plural(nl)})` : ''}`;
          else if (p === 'P131') {
            const inf = cache.info[v] || {};
            const what = PLACE_PLURAL[nat] || (nl && !/^liste\b/i.test(nl) ? plural(head(nl)) : 'lieux');
            name = `${cap(what)} ${deLieu(label(v), inf.born)}`;
          }
        }
        if (!groups.has(key)) groups.set(key, { id: key, p, v, classes, name, cards: new Set() });
        groups.get(key).cards.add(id);
      }
    }
  }
  log(`${groups.size} groupes à sonder (${cards.length} cartes)`);
  if (PLAN) {
    for (const g of groups.values()) log(`${g.id}\t${g.cards.size}\t${g.name}`);
    return;
  }

  // 7. Sonde de chaque groupe : la liste des articles, LIMIT + 1 au plus (jamais de COUNT). Plusieurs groupes par
  // requête (UNION de sous-requêtes) ; si un lot échoue, on reprend ses groupes un par un.
  const sub = (g, i) => {
    const cls = g.classes.length ? `?item wdt:P31 ?cls . VALUES ?cls { ${vals(g.classes)} }` : '';
    return `{ { SELECT DISTINCT ?item ?title WHERE { ?item wdt:${g.p} wd:${g.v} . ${cls} ${FR} } LIMIT ${LIMIT + 1} } BIND("${i}" AS ?g) }`;
  };
  async function probe(batch) {
    const rows = await sparql(`SELECT ?g ?item ?title ?desc WHERE { ${batch.map(sub).join(' UNION ')} ${DESC} }`);
    const by = batch.map(() => new Map());
    for (const r of rows) {
      const m = by[Number(r.g.value)];
      const q = qid(r.item.value);
      if (!m.has(q)) m.set(q, [q, r.title.value, r.desc ? r.desc.value : null]);
    }
    batch.forEach((g, i) => {
      const list = [...by[i].values()];
      cache.groups[g.id] = list.length > LIMIT ? { big: true, list: null } : { list };
    });
  }
  const todo = [...groups.values()].filter((g) => !cache.groups[g.id] || (RETRY && cache.groups[g.id].err));
  done = 0;
  const t0 = Date.now();
  for (const batch of chunks(todo, 6)) {
    try {
      await probe(batch);
    } catch (e) {
      for (const g of batch) {
        try { await probe([g]); } catch (e2) { cache.groups[g.id] = { list: null, err: String(e2.message).slice(0, 200) }; }
      }
    }
    persist();
    done += batch.length;
    const eta = done ? Math.round(((Date.now() - t0) / done) * (todo.length - done) / 1000) : 0;
    progress(`albums sondés ${done}/${todo.length} (reste ≈ ${Math.floor(eta / 60)} min ${eta % 60} s)`);
  }
  if (todo.length) log(`albums sondés : ${todo.length} groupes en ${Math.round((Date.now() - t0) / 1000)} s`);

  // 8. Albums : 3 à 1 000 articles, une seule fois par liste de membres, les plus entamés d'abord.
  const ownedTitle = new Map(cards.map(({ c, id }) => [id, c.t]));
  const albums = [];
  const seen = new Set();
  const stats = { big: 0, small: 0, err: 0, dup: 0, former: 0 };
  // Wikidata garde la nature des unités disparues (une ancienne commune reste « commune française ») : un album de
  // lieu n'en garde que les actuelles (description qui ne commence pas par « ancien(ne) »), sauf si une de tes
  // cartes en est une. Communes de l'Aveyron : 582 -> 290.
  const former = (m) => /^anci(?:en|enne)s? /i.test(m[2] || '');
  const ordered = [...groups.values()].sort((a, b) => RELS.indexOf(a.p) - RELS.indexOf(b.p));
  for (const g of ordered) {
    const res = cache.groups[g.id];
    if (!res || res.err) { stats.err++; continue; }
    if (res.big) { stats.big++; continue; }
    let list = res.list;
    if (g.p === 'P131' && !list.some((m) => ownedTitle.has(m[0]) && former(m))) {
      const kept = list.filter((m) => !former(m));
      if (kept.length < list.length) stats.former++;
      list = kept;
    }
    if (list.length < MIN) { stats.small++; continue; }
    const sig = list.map((m) => m[0]).sort().join(' ');
    if (seen.has(sig)) { stats.dup++; continue; }
    seen.add(sig);
    const members = list
      .map(([q, t, d]) => [ownedTitle.get(q) || t, d])
      .sort((a, b) => a[0].localeCompare(b[0], 'fr'));
    const own = list.filter((m) => ownedTitle.has(m[0])).length;
    albums.push({ id: g.id, name: g.name, basis: g.p, owned: own, members });
  }
  albums.sort((a, b) => b.owned - a.owned || a.members.length - b.members.length || a.name.localeCompare(b.name, 'fr'));

  // 9. Étiquettes fines des cartes.
  const tags = {};
  for (const { c, id } of cards) {
    const it = cache.items[id];
    const n = [];
    for (const k of fine(id)) {
      let l;
      if (k === HUMAN) continue;
      if (k === TAXON) l = taxonGroup(c.c);
      else if (HOMONYMY.has(k)) l = "page d'homonymie";
      else l = natLabel(k);
      if (l && !n.includes(l)) n.push(l);
    }
    const g = [...new Set(it.rel.P136.map(label).filter(Boolean))].slice(0, 3);
    const deps = it.dep.map(label).filter(Boolean);
    const l = [...new Set(deps.length ? deps : it.rel.P131.map((v) => cache.info[v] && cache.info[v].l).filter(Boolean))].slice(0, 2);
    tags[c.t] = { n, g, l };
  }

  save(OUT, { builtAt: new Date().toISOString(), ownedAt: owned.extractedAt, tags, albums: albums.map(({ owned: _, ...a }) => a) });
  const size = fs.statSync(OUT).size;
  const byRel = {};
  for (const a of albums) byRel[a.basis] = (byRel[a.basis] || 0) + 1;
  log(`albums par relation : ${RELS.map((p) => `${p} ${byRel[p] || 0}`).join(', ')}`);
  log(`écartés : ${stats.big} de plus de ${LIMIT} articles, ${stats.small} de moins de ${MIN}, ${stats.dup} doublons, ${stats.err} en échec ; ${stats.former} albums de lieu sans leurs unités disparues`);
  log(`data/refined.json : ${Object.keys(tags).length} cartes étiquetées, ${albums.length} albums, ${(size / 1024).toFixed(0)} Ko`);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
