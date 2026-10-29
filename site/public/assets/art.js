/* Le classeur : illustrations des cartes, deux options des Réglages (préférences du compte, décochées par défaut).
 *
 * 1. « Image de Wikipédia en anglais quand elle est meilleure » (prefs.art_en) : Wikipédia en français n'accepte aucune
 *    image sous droits (personnage dessiné, affiche, pochette, logo) et met à la place une photo libre (Homer Simpson en
 *    cosplay) ou rien. L'article anglais lié (langlinks) les a. On prend son image quand son image principale n'est pas
 *    libre (pageprops.page_image : ses rédacteurs l'ont préférée aux images libres, c'est l'œuvre elle-même), ou quand la
 *    carte n'a aucune image. Sans image principale (image trop allongée, écartée par Wikipédia), l'image non libre de
 *    l'article dont le nom reprend son titre. Réponses gardées 14 jours dans localStorage (« classeur-art »).
 * 2. « Changer l'illustration » (fiche d'une carte) : candidates(titre, get) rend les images principales de l'article dans
 *    plusieurs versions linguistiques de Wikipédia (LANGS), pour en choisir une ; le choix est gardé par le serveur
 *    (GET /api/art, POST /api/art/set) et passe avant tout le reste.
 * 3. « Couverture dessinée pour les cartes sans image » (prefs.art_cover) : coverOf(description, titre) donne la nature
 *    de l'article (icône et mot : Personne, Lieu, Espèce…), lue dans la description courte (Wikidata), et le drapeau
 *    du pays qu'elle nomme (fichier de Commons). Aucune requête.
 *
 * Script classique (ni module, ni eval) : il définit window.ClasseurArt.
 *
 * Intégration (interface) :
 * - index.html : <script defer src="/assets/art.js"></script> avant celui d'app.js ; CSP : *.wikipedia.org dans
 *   connect-src (les langues de LANGS), commons.wikimedia.org dans img-src (Special:FilePath redirige vers upload.wikimedia.org).
 * - app.js : art = ClasseurArt.createArt({get, onChange}) ; get(url) rend le JSON (files d'attente de app.js), onChange
 *   avance un compteur réactif. art.image(titre, image) rend aussitôt l'image à montrer (celle donnée tant que l'anglais
 *   n'est pas connu) et demande l'anglais au besoin, par lots de 50, une requête à la fois.
 */
(function (root) {
  'use strict';

  const FR_API = 'https://fr.wikipedia.org/w/api.php';
  const EN_API = 'https://en.wikipedia.org/w/api.php';
  const STORAGE_KEY = 'classeur-art';
  const TTL = 14 * 24 * 3600 * 1000;
  const MAX_ENTRIES = 6000; // ~80 octets par titre : la place de localStorage est partagée avec le reste du classeur
  const BATCH = 50;
  const UP = 'https://upload.wikimedia.org/wikipedia/';

  const qs = (base, p) => base + '?' + new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...p });
  // Adresse rangée sans son début commun ni ses paramètres de suivi (utm_*).
  const pack = (u) => { if (!u) return 0; const s = String(u).split('?')[0]; return s.startsWith(UP) ? s.slice(UP.length) : s; };
  const unpack = (s) => (!s ? null : /^https:\/\//.test(s) ? s : UP + s);
  const aliasOf = (q) => {
    const a = {};
    for (const n of (q && q.normalized) || []) a[n.from] = n.to;
    for (const r of (q && q.redirects) || []) a[r.from] = r.to;
    return a;
  };
  const follow = (alias, t) => { let cur = t; for (let i = 0; i < 5 && alias[cur]; i++) cur = alias[cur]; return cur; };
  const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/_/g, ' ').toLowerCase().trim();
  // Fichier dont le nom est le titre de l'article (sans sa parenthèse d'homonymie), ou commence par lui suivi d'un
  // séparateur (« Bart Simpson 200px ») ; le nom exact d'abord, puis le plus court.
  function fileFor(title, files) {
    const t = fold(String(title).replace(/\s*\([^)]*\)$/, ''));
    let best = null;
    for (const f of files) {
      const exact = f.name === t;
      if (!exact && !(f.name.startsWith(t) && /^[\s\-–(,.\d]/.test(f.name.slice(t.length)))) continue;
      const score = (exact ? 0 : 1000) + f.name.length;
      if (!best || score < best.score) best = { score, url: f.url };
    }
    return best ? best.url : null;
  }

  function loadStore(storage) {
    const map = new Map();
    try {
      const raw = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
      const now = Date.now();
      if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (Array.isArray(v) && now - v[0] < TTL) map.set(k, v);
    } catch (e) { /* cache illisible : on repart de rien */ }
    return map;
  }

  // get(url) -> Promise<json> ; onChange() après chaque lot ; storage : localStorage (ou un faux, pour les tests).
  function createArt(opts) {
    const get = opts.get;
    const onChange = opts.onChange || (() => {});
    let storage = opts.storage;
    if (!storage) { try { storage = root.localStorage; } catch (e) { storage = null; } }
    const map = storage ? loadStore(storage) : new Map(); // titre français -> [date, image non libre | 0, image quelconque | 0]
    const pending = new Set();
    const failed = new Set(); // échecs de cette visite : pas redemandés avant le prochain chargement de la page
    let busy = false;
    let timer = null;
    let saveTimer = null;

    const save = () => {
      saveTimer = null;
      if (!storage) return;
      let list = [...map.entries()];
      if (list.length > MAX_ENTRIES) {
        list.sort((a, b) => b[1][0] - a[1][0]);
        list = list.slice(0, MAX_ENTRIES);
        map.clear();
        for (const [k, v] of list) map.set(k, v);
      }
      for (let n = list.length; n > 0; n = Math.floor(n / 2)) {
        try { storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(list.slice(0, n)))); return; } catch (e) { /* plus de place : la moitié */ }
        list.sort((a, b) => b[1][0] - a[1][0]);
      }
    };
    const remember = (t, nf, any) => { map.set(t, [Date.now(), pack(nf), pack(any)]); if (!saveTimer) saveTimer = setTimeout(save, 1500); };

    async function lookup(titles) {
      // 1. Article anglais lié à chaque titre français.
      const fr = await get(qs(FR_API, { action: 'query', redirects: '1', prop: 'langlinks', lllang: 'en', lllimit: '500', titles: titles.join('|') }));
      const fq = (fr && fr.query) || {};
      const falias = aliasOf(fq);
      const enOf = new Map();
      for (const p of fq.pages || []) { const l = (p.langlinks || [])[0]; if (l && l.title) enOf.set(p.title, l.title); }
      const want = new Map(); // titre anglais -> titres français
      for (const t of titles) {
        const e = enOf.get(follow(falias, t));
        if (!e) { remember(t, 0, 0); continue; }
        if (!want.has(e)) want.set(e, []);
        want.get(e).push(t);
      }
      if (!want.size) return;
      // 2. Son image principale, libre ou non, et si elle ne l'est pas (page_image).
      const en = await get(qs(EN_API, { action: 'query', redirects: '1', prop: 'pageimages|pageprops', ppprop: 'page_image', piprop: 'thumbnail',
        pithumbsize: '330', pilicense: 'any', pilimit: '50', titles: [...want.keys()].join('|') }));
      const eq = (en && en.query) || {};
      const ealias = aliasOf(eq);
      const pages = new Map((eq.pages || []).map((p) => [p.title, p]));
      const found = new Map(); // titre anglais -> [image non libre | null, image quelconque | null]
      const bare = []; // articles anglais sans image principale
      for (const e of want.keys()) {
        const p = pages.get(follow(ealias, e));
        const any = p && p.thumbnail && p.thumbnail.source ? p.thumbnail.source : null;
        found.set(e, [any && p.pageprops && p.pageprops.page_image ? any : null, any]);
        if (p && !p.missing && !any) bare.push(p.title);
      }
      // 3. Sans image principale (Wikipédia écarte une image trop allongée : Marge Simpson, 130 × 400) : l'image de
      //    l'article hébergée par Wikipédia en anglais, donc non libre, dont le nom reprend son titre (« Marge Simpson.png »).
      if (bare.length) {
        const im = await get(qs(EN_API, { action: 'query', generator: 'images', gimlimit: 'max', prop: 'imageinfo', iiprop: 'url',
          iiurlwidth: '330', titles: bare.join('|') }));
        const files = [];
        for (const f of ((im && im.query) || {}).pages || []) {
          const info = (f.imageinfo || [])[0];
          const m = /^[^:]+:(.+)\.(png|jpe?g|gif|webp|svg)$/i.exec(f.title || '');
          if (m && f.imagerepository === 'local' && info && (info.thumburl || info.url)) files.push({ name: fold(m[1]), url: info.thumburl || info.url });
        }
        for (const [e] of want) {
          const p = pages.get(follow(ealias, e));
          if (!p || !bare.includes(p.title)) continue;
          const url = fileFor(p.title, files);
          if (url) found.set(e, [url, url]);
        }
      }
      for (const [e, list] of want) for (const t of list) remember(t, found.get(e)[0], found.get(e)[1]);
    }

    async function pump() {
      if (busy) return;
      busy = true;
      try {
        while (pending.size) {
          const batch = [...pending].slice(0, BATCH);
          batch.forEach((t) => pending.delete(t));
          try { await lookup(batch); } catch (e) { batch.forEach((t) => { if (!map.has(t)) failed.add(t); }); }
          onChange();
        }
      } finally { busy = false; }
    }
    const ask = (t) => {
      if (pending.has(t) || failed.has(t)) return;
      pending.add(t);
      if (!timer) timer = setTimeout(() => { timer = null; pump(); }, 60);
    };

    // Image à montrer pour une carte (titre de l'article en français, image qu'elle a déjà, ou null).
    function image(title, base) {
      const t = String(title || '');
      if (!t) return base || null;
      const v = map.get(t);
      if (!v) { ask(t); return base || null; }
      return unpack(v[1]) || base || unpack(v[2]) || null;
    }
    const known = (title) => map.has(String(title || ''));
    function clear() { map.clear(); pending.clear(); failed.clear(); try { if (storage) storage.removeItem(STORAGE_KEY); } catch (e) { /* rien */ } }
    return { image, known, clear, get size() { return map.size; } };
  }

  // ---------------------------------------------------------------- « Changer l'illustration » : images de chaque langue
  // Langues regardées, dans l'ordre montré (le français d'abord) ; une langue où l'article n'existe pas est sautée.
  const LANGS = [['fr', 'Français'], ['en', 'Anglais'], ['de', 'Allemand'], ['es', 'Espagnol'], ['it', 'Italien'], ['pt', 'Portugais'],
    ['nl', 'Néerlandais'], ['pl', 'Polonais'], ['sv', 'Suédois'], ['ca', 'Catalan'], ['ru', 'Russe'], ['uk', 'Ukrainien'],
    ['ar', 'Arabe'], ['ja', 'Japonais'], ['zh', 'Chinois'], ['ko', 'Coréen']];
  const wpApi = (lang) => 'https://' + lang + '.wikipedia.org/w/api.php';
  const imgParams = { action: 'query', redirects: '1', prop: 'pageimages', piprop: 'thumbnail|name', pithumbsize: '330', pilicense: 'any' };
  const firstPage = (j) => { const p = ((j && j.query) || {}).pages; return p && p[0] && !p[0].missing && !p[0].invalid ? p[0] : null; };
  // Image principale d'une page (libre ou non) : {url (sans paramètres), file} ou null.
  const imageOfPage = (p) => {
    const src = p && p.thumbnail && p.thumbnail.source;
    return src ? { url: String(src).split('?')[0], file: String(p.pageimage || '').replace(/_/g, ' ') } : null;
  };

  // Images principales de l'article (titre français) dans les versions linguistiques de LANGS : une requête sur
  // fr.wikipedia.org (son image et ses liens de langue), puis une par langue qui a l'article, en parallèle. Une même image
  // n'est rendue qu'une fois, avec toutes ses langues : même nom de fichier (une image non libre est hébergée à part par
  // chaque Wikipédia qui l'utilise : Homer_Simpson_2006.png en anglais, portugais, catalan…), à défaut même adresse.
  // get(url) -> Promise<json>. Rend {missing, list:[{url, file, langs:[{code, name}]}]} ; une langue qui ne répond pas est sautée.
  async function candidates(title, get) {
    const fr = firstPage(await get(qs(FR_API, { ...imgParams, prop: 'pageimages|langlinks', lllimit: 'max', titles: String(title) })));
    if (!fr) return { missing: true, list: [] };
    const links = new Map((fr.langlinks || []).map((l) => [l.lang, l.title]));
    const found = await Promise.all(LANGS.map(async ([code, name]) => {
      if (code === 'fr') return { code, name, img: imageOfPage(fr) };
      if (!links.has(code)) return null;
      try { return { code, name, img: imageOfPage(firstPage(await get(qs(wpApi(code), { ...imgParams, titles: links.get(code) })))) }; } catch (e) { return null; }
    }));
    const byFile = new Map();
    for (const f of found) {
      if (!f || !f.img) continue;
      const k = f.img.file || f.img.url;
      const cur = byFile.get(k);
      if (cur) cur.langs.push({ code: f.code, name: f.name }); else byFile.set(k, { ...f.img, langs: [{ code: f.code, name: f.name }] });
    }
    return { missing: false, list: [...byFile.values()] };
  }

  // ---------------------------------------------------------------- couverture : nature de l'article
  // Mots cherchés en début de mot (lettres accentuées comprises) ; règles dans l'ordre, la première qui répond gagne.
  const W = (s) => new RegExp('(?:^|[^\\p{L}])(?:' + s + ')', 'u');
  const KINDS = [
    ['homonymie', 'Homonymie', 'k-sign', W('homonymie')],
    ['liste', 'Liste', 'list', W('page de liste|liste d')],
    ['astre', 'Astre', 'k-planet', W('astéroïde|planète|étoile|galaxie|comète|nébuleuse|constellation|cratère|satellite naturel|amas')],
    ['date', 'Date', 'k-cal', W('année|siècle|décennie|millénaire|chronologie|événements liés|jour de l\'année|calendrier')],
    ['plante', 'Plante', 'k-leaf', W('plante|végéta|arbre|arbuste|fleur|champignon|algue|fougère|mousse|orchidée|lichen|cultivar|graminée|poacée|astéracée|fabacée|rosacée')],
    ['espece', 'Espèce', 'k-paw', W('espèce|sous-espèce|taxon|race d|insecte|oiseau|mammifère|poisson|reptile|amphibien|arachnide|araignée|scorpion|papillon|lépidoptère|coléoptère|mollusque|crustacé|dinosaure|serpent|grenouille|lézard|tortue|requin|baleine|chien|chat ')],
    // Épreuves sportives avant les personnes (« compétition sportive » n'est pas une sportive).
    ['sport', 'Sport', 'k-trophy', W('compétition|championnat|coupe d|coupe du|tournoi|saison \\d|saison d|édition d|étape d|jeux olympiques|grand prix|course cycliste|rallye')],
    ['personne', 'Personne', 'k-person', W('imprimeu|prélat|chef d\x27orchestre|condottiere|amiral|vizir|courtisane|souverain|industriel|fonctionnaire|père de|mère de|fils de|fille de|épouse de|prénom|calife|sultan|émir|pharaon|tsar|cinéaste|documentariste|commissaire-priseur|artiste|designer|égyptologue|footballeu|joueu|athlète|cycliste|nageu|boxeu|tennism|pilote|personnalité|homme politique|femme politique|politicien|acteur|actrice|chanteu|musicien|compositeu|compositrice|écrivain|romanci|poète|poétesse|peintre|sculpt|architecte|photographe|réalisateu|réalisatrice|scénariste|producteu|productrice|journaliste|historien|philosophe|scientifique|mathématicien|physicien|chimiste|biologiste|médecin|militaire|général |officier|prêtre|évêque|archevêque|cardinal|roi |reine|prince|empereu|impératrice|pape|noble|seigneur|comte|comtesse|duc |duchesse|entraîneu|dirigeant|entrepreneu|homme d\'affaires|femme d\'affaires|avocat|juriste|diplomate|économiste|ingénieu|inventeu|explorateu|aviateu|astronaute|mannequin|humoriste|animateu|animatrice|youtubeu|rappeu|danseu|chorégraphe|archéologue|sociologue|linguiste|théologien|résistant|militant|syndicaliste|maire|député|sénateu|ministre|moine|religieu|astronome|botaniste|zoologiste|entomologiste|géologue|géographe|graveu|illustrat|dessinat|auteur|autrice|escrimeu|lutteu|judoka|skieu|patineu|gymnaste|rameu|haltérophile|basketteu|handballeu|volleyeu|rugbyman|hockeyeu|golfeu|jockey|biathlète|triathlète|marathonien|sprinteu|perchiste|coureu|plongeu|surfeu|alpiniste|navigateu|cuisinier|styliste|mécène|espion|criminel|tueu|personnage|né en|née en|né le|née le')],
    ['jeu', 'Jeu', 'k-game', W('jeu vidéo|jeu de société|jeu de rôle|jeu de cartes|jeux vidéo')],
    ['film', 'Film ou série', 'k-film', W('film|téléfilm|série télévisée|série d\'animation|feuilleton|épisode|émission|court métrage|documentaire|dessin animé|anime|sitcom|telenovela|websérie')],
    ['musique', 'Musique', 'k-music', W('album|chanson|single|groupe de musique|groupe de rock|groupe de pop|groupe de metal|groupe de jazz|groupe de punk|œuvre musicale|musical|opéra|symphonie|concerto|bande originale|morceau|comédie musicale|genre musical|label|ep ')],
    ['livre', 'Livre', 'k-book', W('roman|livre|bande dessinée|manga|nouvelle |recueil|poème|essai |œuvre littéraire|revue|magazine|journal|périodique|quotidien|pièce de théâtre|conte|encyclopédie|dictionnaire')],
    ['oeuvre', 'Œuvre d\'art', 'k-palette', W('peinture|tableau|sculpture|œuvre d\'art|fresque|tapisserie|tenture|gravure|vitrail|mosaïque')],
    ['sport', 'Sport', 'k-trophy', W('club de football|club de rugby|club de basket|club de hockey|club de handball|club sportif|de football|de rugby|de basket-ball|de handball|de volley-ball|de hockey|équipe de|équipe nationale|épreuve')],
    ['batiment', 'Bâtiment', 'k-building', W('église|cathédrale|basilique|chapelle|abbaye|monastère|mosquée|temple|synagogue|château|palais|manoir|forteresse|fort |tour |pont |gare|station|aéroport|stade|musée|bâtiment|édifice|monument|immeuble|gratte-ciel|phare|hôpital|école|lycée|collège|université|théâtre|salle de|cinéma|hôtel|moulin|barrage|cimetière|site archéologique|tumulus|dolmen|menhir|allée couverte|clocher|bibliothèque|grand magasin|circuit|rue |avenue|boulevard|place |parc |jardin')],
    ['eau', 'Cours d\'eau', 'k-waves', W('rivière|fleuve|cours d\'eau|lac |baie|golfe|détroit|canal|cascade|chute d\'eau|étang|mer |océan|lagune|affluent|réservoir')],
    ['relief', 'Relief', 'k-mountain', W('montagne|sommet|mont |volcan|col |colline|massif|chaîne de montagnes|glacier|vallée|plateau|île|archipel|péninsule|presqu\'île|cap |grotte|désert|forêt|gorges')],
    ['lieu', 'Lieu', 'k-pin', W('établissement humain|intercommunalité|village|commune|ville|localité|municipalité|quartier|hameau|arrondissement|canton|département|région|province|district|comté|état |pays|capitale|agglomération|banlieue|oblast|raïon|voïvodie|gmina|powiat|préfecture|lieu-dit|territoire|subdivision|circonscription|paroisse|municipio|census-designated|town|bourg|cité ')],
    ['org', 'Organisation', 'k-org', W('constructeu|organisme|studio|représentation diplomatique|conservatoire|entreprise|société|organisation|association|parti politique|parti |fédération|comité|syndicat|fondation|institut|agence|ministère|administration|marque|club |ong |compagnie|banque|groupe |conseil|assemblée|gouvernement|armée|régiment|division|unité militaire|ordre religieux|congrégation|mouvement')],
    ['vehicule', 'Véhicule', 'k-ship', W('voilier|navire|bateau|paquebot|automobile|voiture|avion|hélicoptère|locomotive|train |sous-marin|cuirassé|frégate|croiseur|porte-avions|moto|vaisseau|fusée')],
    ['histoire', 'Histoire', 'swords', W('bataille|guerre|siège |traité|révolution|conflit|insurrection|révolte|massacre|attentat|catastrophe|accident|naufrage|élection|référendum|procès|affaire|enlèvement|crise|incident|émeute|coup d\'état|dynastie|empire|royaume|civilisation|époque|période|événement|épidémie|séisme|ouragan|tempête|cyclone|histoire')],
    ['cuisine', 'Cuisine', 'k-fork', W('plat |recette|fromage|vin |boisson|cocktail|bière|pâtisserie|dessert|spécialité culinaire|cépage|sauce|gâteau|soupe')],
    ['science', 'Science', 'k-atom', W('molécule|composé |chimique|élément chimique|minéral|protéine|enzyme|gène|maladie|syndrome|médicament|hormone|virus|bactérie|cellule|théorème|concept|unité de|algorithme|langage de programmation|logiciel|technique|méthode|théorie|phénomène|équation|langue|dialecte|alphabet')],
  ];
  const DEFAULT_KIND = ['article', 'Article', 'k-page'];

  function kindOf(desc, title) {
    const t = String(title || '');
    const d = String(desc || '').toLowerCase().replace(/\s+/g, ' ');
    if (/\(homonymie\)$/.test(t)) return KINDS[0];
    if (/^liste (de|des|d')/i.test(t)) return KINDS[1];
    if (/^\(\d+\) /.test(t)) return KINDS[2];
    if (/^\d{1,4}( av\. J\.-C\.)?$/.test(t) || /^\d{3,4} en /.test(t) || /^\d{1,2}(er)? (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)$/.test(t)) return KINDS[3];
    if (d) for (const k of KINDS) if (k[3].test(d + ' ')) return k;
    return DEFAULT_KIND;
  }

  // ---------------------------------------------------------------- couverture : drapeau du pays nommé
  // [noms du pays (avec majuscule, tels qu'écrits), adjectif masculin (et formes irrégulières), nom du fichier sur Commons].
  const COUNTRIES = [
    [['France'], ['français'], 'France'], [['Belgique'], ['belge'], 'Belgium'], [['Suisse'], ['suisse'], 'Switzerland'],
    [['Canada'], ['canadien'], 'Canada'], [['Québec'], ['québécois'], 'Quebec'], [['Luxembourg'], ['luxembourgeois'], 'Luxembourg'],
    [['Monaco'], ['monégasque'], 'Monaco'], [['Andorre'], ['andorran'], 'Andorra'],
    [['Allemagne'], ['allemand'], 'Germany'], [['Autriche'], ['autrichien'], 'Austria'], [['Italie'], ['italien'], 'Italy'],
    [['Espagne'], ['espagnol'], 'Spain'], [['Portugal'], ['portugais'], 'Portugal'], [['Royaume-Uni'], ['britannique'], 'the United Kingdom'],
    [['Angleterre'], ['anglais'], 'England'], [['Écosse'], ['écossais'], 'Scotland'], [['pays de Galles', 'Pays de Galles'], ['gallois'], 'Wales'],
    [['Irlande'], ['irlandais'], 'Ireland'], [['Pays-Bas'], ['néerlandais'], 'the Netherlands'], [['Danemark'], ['danois'], 'Denmark'],
    [['Suède'], ['suédois'], 'Sweden'], [['Norvège'], ['norvégien'], 'Norway'], [['Finlande'], ['finlandais'], 'Finland'],
    [['Islande'], ['islandais'], 'Iceland'], [['Pologne'], ['polonais'], 'Poland'], [['Tchéquie', 'République tchèque'], ['tchèque'], 'the Czech Republic'],
    [['Slovaquie'], ['slovaque'], 'Slovakia'], [['Hongrie'], ['hongrois'], 'Hungary'], [['Roumanie'], ['roumain'], 'Romania'],
    [['Bulgarie'], ['bulgare'], 'Bulgaria'], [['Grèce'], ['grec', 'grecque', 'grecques'], 'Greece'], [['Turquie'], ['turc', 'turque', 'turques'], 'Turkey'],
    [['Russie'], ['russe'], 'Russia'], [['Ukraine'], ['ukrainien'], 'Ukraine'], [['Biélorussie'], ['biélorusse'], 'Belarus'],
    [['Serbie'], ['serbe'], 'Serbia'], [['Croatie'], ['croate'], 'Croatia'], [['Slovénie'], ['slovène'], 'Slovenia'],
    [['Bosnie-Herzégovine'], ['bosnien', 'bosniaque'], 'Bosnia and Herzegovina'], [['Albanie'], ['albanais'], 'Albania'],
    [['Lituanie'], ['lituanien'], 'Lithuania'], [['Lettonie'], ['letton'], 'Latvia'], [['Estonie'], ['estonien'], 'Estonia'],
    [['Géorgie'], ['géorgien'], 'Georgia'], [['Arménie'], ['arménien'], 'Armenia'], [['Azerbaïdjan'], ['azerbaïdjanais'], 'Azerbaijan'],
    [['Iran'], ['iranien'], 'Iran'], [['Irak'], ['irakien'], 'Iraq'], [['Israël'], ['israélien'], 'Israel'], [['Liban'], ['libanais'], 'Lebanon'],
    [['Syrie'], ['syrien'], 'Syria'], [['Égypte'], ['égyptien'], 'Egypt'], [['Maroc'], ['marocain'], 'Morocco'], [['Algérie'], ['algérien'], 'Algeria'],
    [['Tunisie'], ['tunisien'], 'Tunisia'], [['Libye'], ['libyen'], 'Libya'], [['Sénégal'], ['sénégalais'], 'Senegal'], [['Mali'], ['malien'], 'Mali'],
    [['Côte d\'Ivoire'], ['ivoirien'], 'Côte d\'Ivoire'], [['Cameroun'], ['camerounais'], 'Cameroon'], [['Nigeria', 'Nigéria'], ['nigérian'], 'Nigeria'],
    [['Ghana'], ['ghanéen'], 'Ghana'], [['Kenya'], ['kényan'], 'Kenya'], [['Éthiopie'], ['éthiopien'], 'Ethiopia'],
    [['Afrique du Sud'], ['sud-africain'], 'South Africa'], [['Madagascar'], ['malgache'], 'Madagascar'], [['Comores'], ['comorien'], 'the Comoros'],
    [['États-Unis'], ['américain'], 'the United States'], [['Mexique'], ['mexicain'], 'Mexico'], [['Brésil'], ['brésilien'], 'Brazil'],
    [['Argentine'], ['argentin'], 'Argentina'], [['Chili'], ['chilien'], 'Chile'], [['Colombie'], ['colombien'], 'Colombia'], [['Pérou'], ['péruvien'], 'Peru'],
    [['Venezuela', 'Vénézuéla'], ['vénézuélien'], 'Venezuela'], [['Cuba'], ['cubain'], 'Cuba'], [['Haïti'], ['haïtien'], 'Haiti'], [['Uruguay'], ['uruguayen'], 'Uruguay'],
    [['Chine'], ['chinois'], 'the People\'s Republic of China'], [['Japon'], ['japonais'], 'Japan'], [['Corée du Sud'], ['sud-coréen'], 'South Korea'],
    [['Inde'], ['indien'], 'India'], [['Pakistan'], ['pakistanais'], 'Pakistan'], [['Indonésie'], ['indonésien'], 'Indonesia'],
    [['Viêt Nam', 'Vietnam', 'Viet Nam'], ['vietnamien'], 'Vietnam'], [['Thaïlande'], ['thaïlandais'], 'Thailand'], [['Philippines'], ['philippin'], 'the Philippines'],
    [['Australie'], ['australien'], 'Australia'], [['Nouvelle-Zélande'], ['néo-zélandais'], 'New Zealand'], [['Arabie saoudite'], ['saoudien'], 'Saudi Arabia'],
    [['Kazakhstan'], ['kazakh'], 'Kazakhstan'], [['Ouzbékistan'], ['ouzbek'], 'Uzbekistan'], [['Palestine'], ['palestinien'], 'Palestine'],
  ];
  // Formes d'un adjectif : masculin, féminin et pluriels (« algérien » -> algérienne, algériens, algériennes).
  function forms(m) {
    if (m.endsWith('e')) return [m, m + 's'];
    const f = /(en|on)$/.test(m) ? [m + 'ne', m + 'nes'] : [m + 'e', m + 'es'];
    return m.endsWith('s') ? [m, ...f] : [m, m + 's', ...f];
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const END = '(?![\\p{L}-])';
  const COUNTRY_RE = COUNTRIES.map(([names, adj, file]) => {
    const a = adj.flatMap((x) => (/(que|ques)$/.test(x) ? [x] : forms(x)));
    return { file, re: new RegExp('(?:^|[^\\p{L}-])(?:' + names.map(esc).join('|') + ')' + END + '|(?:^|[^\\p{L}-])(?:' + a.map(esc).join('|') + ')' + END, 'u') };
  });
  // Pays nommé le plus tôt dans la description (« footballeur algérien né en France » : Algérie).
  function countryOf(desc) {
    const d = String(desc || '');
    if (!d) return null;
    let best = null;
    for (const c of COUNTRY_RE) {
      const m = c.re.exec(d);
      if (m && (!best || m.index < best.i)) best = { i: m.index, file: c.file };
    }
    return best ? best.file : null;
  }
  const flagUrl = (file) => (file ? 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(('Flag of ' + file + '.svg').replace(/ /g, '_')) + '?width=96' : null);

  // Couverture d'une carte sans image : {kind, label, icon, flag (adresse | null)}.
  function coverOf(desc, title) {
    const k = kindOf(desc, title);
    const country = k[0] === 'homonymie' || k[0] === 'liste' || k[0] === 'astre' ? null : countryOf(desc);
    return { kind: k[0], label: k[1], icon: k[2], flag: flagUrl(country) };
  }

  root.ClasseurArt = Object.freeze({ createArt, candidates, LANGS, coverOf, kindOf, countryOf, flagUrl, STORAGE_KEY, TTL,
    ICONS: Object.freeze([...new Set(KINDS.map((k) => k[2]).concat(DEFAULT_KIND[2]))]) });
})(typeof window !== 'undefined' ? window : globalThis);
