// Favori du classeur, à cliquer sur wiki-masters.com (avec ou sans www) quand tu y es connecté.
// Il lit ta collection avec les mêmes requêtes que la page « Collection » du jeu (lecture seule : rien n'est écrit
// dans le jeu), regroupe les exemplaires par carte, puis envoie les cartes à ton classeur par morceaux de 500.
// Synchro rapide d'abord : seulement les exemplaires obtenus depuis la dernière synchro (collection triée du plus
// récent au plus ancien, arrêt à l'exemplaire daté de la dernière synchro) ; si quelque chose ne colle pas (tri, carte
// la plus récente partie, compteurs du jeu : carte vendue, mise aux enchères…), relecture complète aussitôt, avec la
// raison affichée.
// Mode relié : après le clic, le favori reste actif dans la page jusqu'à ce qu'elle soit rechargée (le jeu est une
// application Next.js : y changer de page ne la recharge pas). Il regarde passer, sans y toucher, les requêtes que la
// page du jeu fait d'elle-même (window.fetch enveloppé : mêmes arguments, même promesse rendue à la page, aucun corps
// lu, aucune requête ajoutée), repère les actions du joueur qui changent sa collection (paquet ouvert, carte défaussée,
// mise aux enchères ou enchère annulée, échange, récompense réclamée : ACTIONS) et relance alors la synchro rapide,
// 5 s après la dernière action, au plus une par minute et 20 par heure ; une relecture complète automatique au plus
// toutes les 15 minutes. Quand il ne se passe rien, rien n'est lu. Encart réductible en badge (« Classeur relié ·
// dernière synchro à 14:32 »), avec « Synchroniser » et « Arrêter » (qui rend window.fetch d'origine).
// L'interface remplace "__SITE__" et "__KEY__" par l'adresse du classeur et la clé d'import du favori (jamais la clé
// principale : elle ne permet que d'envoyer des cartes), et "__START__" par "load" dans le script Tampermonkey (relié
// dès le chargement de chaque page du jeu, sans rien lire avant une action du joueur ; sinon : clic sur le favori), puis
// met ce fichier sur une ligne : chaque instruction finit donc par un point-virgule et les commentaires restent sur des
// lignes à part.
(function () {
  var SITE = "__SITE__";
  var KEY = "__KEY__";
  var START = "__START__";
  var BOX_ID = "classeur-favori";
  var PART = 500;
  // Déjà relié dans cette page : pendant une synchro, le clic déplie seulement l'encart ; sinon l'ancien favori est
  // arrêté (window.fetch rendu, encart retiré) et ce clic repart de zéro, avec sa clé à lui.
  var prev = window.__classeurRelie;
  if (window.__classeurFavori) {
    if (prev && typeof prev.show === "function") {
      prev.show();
    }
    return;
  }
  if (prev && typeof prev.stop === "function") {
    try {
      prev.stop();
    } catch (e) {
      prev = null;
    }
  }
  var old = document.getElementById(BOX_ID);
  if (old) {
    old.remove();
  }
  var WIDE = "position:fixed;z-index:2147483647;right:16px;bottom:16px;width:min(340px,calc(100vw - 32px));padding:14px 16px;border-radius:12px;background:#131615;color:#f2f4f3;font:14px/1.45 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.45);border:1px solid #2e3431";
  var SMALL = "position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:calc(100vw - 32px);padding:4px 10px 8px;border-radius:10px;background:#131615;color:#f2f4f3;font:12.5px/1.4 system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.4);border:1px solid #2e3431;opacity:.94";
  var box = document.createElement("div");
  box.id = BOX_ID;
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");
  box.style.cssText = WIDE;
  var title = document.createElement("div");
  title.textContent = "Le classeur";
  title.style.cssText = "font-weight:700;margin-bottom:4px";
  var text = document.createElement("div");
  var extra = document.createElement("div");
  // Pied : « Fermer » (favori ponctuel), ou la ligne d'état et les boutons du mode relié.
  var foot = document.createElement("div");
  var button = function (caption, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = caption;
    b.style.cssText = "margin:10px 6px 0 0;padding:4px 10px;border-radius:7px;border:1px solid #2e3431;background:#1b1f1d;color:#f2f4f3;font:inherit;font-size:12.5px;cursor:pointer";
    b.addEventListener("click", onClick);
    return b;
  };
  foot.appendChild(button("Fermer", function () {
    box.remove();
  }));
  box.append(title, text, extra, foot);
  document.body.appendChild(box);
  // Mode relié (null : favori ponctuel). keep() remet l'encart dans la page si le jeu l'en a retiré en se redessinant.
  var live = null;
  var keep = function () {
    if (live && live.on && document.documentElement && !document.documentElement.contains(box)) {
      document.body.appendChild(box);
    }
  };
  var say = function (message, withLink) {
    keep();
    text.textContent = message;
    extra.textContent = "";
    if (withLink) {
      var a = document.createElement("a");
      a.href = SITE + "/";
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "Ouvrir le classeur";
      a.style.cssText = "display:inline-block;margin-top:8px;color:#6ee7b7;font-weight:600";
      extra.appendChild(a);
    }
  };
  var num = function (n) {
    return Number(n || 0).toLocaleString("fr-FR");
  };
  var wait = function (ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  };
  var host = location.hostname;
  if (host !== "www.wiki-masters.com" && host !== "wiki-masters.com") {
    if (START === "load") {
      box.remove();
      return;
    }
    say("Ouvre wiki-masters.com et connecte-toi, puis clique à nouveau ce favori.");
    return;
  }
  // Requêtes du favori lui-même (jeu et classeur) : par window.fetch tel qu'il est avant le mode relié, donc jamais vues
  // par l'observateur, qui ne regarde que celles de la page.
  var net = window.fetch;
  // Erreur qui arrête tout (session, limite de lectures du jeu) : pas de relecture complète derrière.
  var stop = function (message) {
    var e = new Error(message);
    e.stop = true;
    return e;
  };
  // Lecture d'une adresse de l'API du jeu, avec la session du navigateur (même origine).
  var read = async function (path) {
    var r = await net.call(window, path, { credentials: "include", headers: { Accept: "application/json" } });
    if (r.status === 403 || r.status === 429) {
      var refused = await r.json().catch(function () {
        return null;
      });
      // Limite de lectures automatiques du jeu (403 avec ce code, vue sur son marché) : la session n'y est pour rien.
      if (r.status === 429 || (refused && refused.code === "automation_limit")) {
        throw stop("Le jeu limite les lectures automatiques : réessaie plus tard.");
      }
    }
    if (r.status === 401 || r.status === 403) {
      throw stop("Connecte-toi à WikiMasters, puis clique à nouveau ce favori.");
    }
    if (!r.ok) {
      throw new Error("WikiMasters a répondu " + r.status + " : réessaie dans un moment.");
    }
    return r.json().catch(function () {
      throw new Error("Réponse inattendue de WikiMasters (ce n'est pas du JSON) : réessaie dans un moment.");
    });
  };
  var web = function (v) {
    return typeof v === "string" && v.length <= 2000 && /^https?:\/\//i.test(v) ? v : null;
  };
  // Raretés de la plus basse à la plus haute : une carte possédée en plusieurs raretés garde la plus haute (comme le
  // classeur).
  var RANKS = ["C", "PC", "R", "SR", "UR", "L"];
  // Exemplaires -> cartes (CarteImport) : un objet par card_id, sans user_id ni étiquettes du jeu. Un exemplaire vu
  // deux fois (même entry.id) ne compte qu'une fois ; les entrées inexploitables sont comptées à part (ignored), et
  // parmi elles les cartes distinctes que le jeu compte dans totalUnique (unknown). rows / copies : exemplaires lus et
  // leur nombre total, invalides compris (contrôlés par le classeur avec les compteurs du jeu).
  var group = function (entries) {
    var byId = {};
    var seen = {};
    var bad = {};
    var list = [];
    var rows = 0;
    var copies = 0;
    entries.forEach(function (e, i) {
      if (e && e.id !== undefined && e.id !== null) {
        if (seen[e.id]) {
          return;
        }
        seen[e.id] = true;
      }
      var n = e && Math.trunc(Number(e.count)) > 0 ? Math.trunc(Number(e.count)) : 1;
      rows += 1;
      copies += n;
      var c = e && e.card;
      var id = e && (e.card_id || (c && c.id));
      var title = c && c.wikipedia_title;
      var longCat = c && typeof c.category === "string" && c.category.length > 500;
      if (!c || !id || typeof title !== "string" || !title || title.length > 500 || longCat || ["C", "PC", "R", "SR", "UR", "L"].indexOf(c.rarity) < 0) {
        bad[id ? "c" + id : "e" + i] = true;
        return;
      }
      id = String(id);
      var card = byId[id];
      if (!card) {
        card = { id: id, title: c.wikipedia_title, rarity: c.rarity, atk: typeof c.atk === "number" ? c.atk : null, def: typeof c.def === "number" ? c.def : null, quality: typeof c.q_score === "number" ? c.q_score : null, pageviews: typeof c.pageviews === "number" ? c.pageviews : null, category: typeof c.category === "string" && c.category ? c.category : null, image: c.hide_image ? null : web(c.image_url), url: web(c.wikipedia_url), count: 0, shiny: false, starred: false, obtained_at: null };
        byId[id] = card;
        list.push(card);
      } else if (RANKS.indexOf(c.rarity) > RANKS.indexOf(card.rarity)) {
        card.rarity = c.rarity;
      }
      card.count += n;
      card.shiny = card.shiny || !!e.is_shiny;
      card.starred = card.starred || !!e.starred;
      if (typeof e.obtained_at === "string" && (!card.obtained_at || e.obtained_at < card.obtained_at)) {
        card.obtained_at = e.obtained_at;
      }
    });
    var unknown = Object.keys(bad).filter(function (k) {
      return k.charAt(0) === "c" && !byId[k.slice(1)];
    }).length;
    return { list: list, ignored: Object.keys(bad).length, unknown: unknown, rows: rows, copies: copies };
  };
  // Date du plus récent exemplaire lu (texte ISO du jeu, comparé tel quel).
  var newest = function (entries) {
    var last = null;
    entries.forEach(function (e) {
      if (e && typeof e.obtained_at === "string" && (last === null || e.obtained_at > last)) {
        last = e.obtained_at;
      }
    });
    return last;
  };
  var GONE = "La carte la plus récente de ta dernière synchro n'est plus dans ta collection (vendue, échangée…) : relecture complète. ";
  // Exemplaires obtenus après lastAt : collection lue du plus récent au plus ancien, 10 pages au plus. {fresh} ; ou
  // {why} (relecture complète, avec sa raison) : tri par date en erreur ou sans liste, dates dans le désordre (le
  // reste de la page est contrôlé aussi : un tri ignoré ou croissant ne passe pas pour une vente), exemplaire de la
  // dernière synchro introuvable (le premier d'au plus lastAt doit être lui, à la même date), trop de nouveautés.
  var readNew = async function (lastAt) {
    var fresh = [];
    var prev = null;
    for (var page = 0; page < 10; page++) {
      var data = null;
      try {
        data = await read("/api/my-collection?sort=added&page=" + page + "&stats=0");
      } catch (e) {
        if (e.stop) {
          throw e;
        }
        return { why: "Le tri par date du jeu n'a pas répondu : relecture complète. " };
      }
      var list = data && Array.isArray(data.collection) ? data.collection : null;
      if (!list) {
        return { why: "Réponse inattendue du jeu pour le tri par date : relecture complète. " };
      }
      var stopAt = -1;
      for (var i = 0; i < list.length; i++) {
        var at = list[i] && list[i].obtained_at;
        if (typeof at !== "string" || (prev !== null && at > prev)) {
          return { why: "Le jeu n'a pas rangé ta collection par date comme prévu : relecture complète. " };
        }
        prev = at;
        if (stopAt < 0 && at <= lastAt) {
          stopAt = i;
        }
        if (stopAt < 0) {
          fresh.push(list[i]);
        }
      }
      if (stopAt >= 0) {
        return list[stopAt].obtained_at === lastAt ? { fresh: fresh } : { why: GONE };
      }
      if (list.length < 50) {
        return { why: GONE };
      }
      await wait(300);
    }
    return { why: "Plus de 500 exemplaires obtenus depuis ta dernière synchro : relecture complète. " };
  };
  var send = async function (body) {
    var r = await net.call(window, SITE + "/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Classeur-Key": KEY },
      body: JSON.stringify(body)
    });
    var res = await r.json().catch(function () {
      return {};
    });
    if (!r.ok) {
      var e = new Error((res && res.error) || "Le classeur a répondu " + r.status + ".");
      e.status = r.status;
      throw e;
    }
    return res;
  };
  // Raisons d'une relecture complète demandée par le classeur (réponse needs_full à une synchro rapide).
  var WHY = {
    counts: "Les compteurs du jeu ne collent pas avec tes nouveautés (carte vendue, échangée ou mise aux enchères, exemplaire ajouté à une carte déjà là…) : relecture complète. ",
    race: "Une autre synchro est passée en même temps : relecture complète. ",
    state: "Le classeur demande une relecture complète. ",
    invalid: "Une de tes nouvelles cartes ne peut pas être rangée dans le classeur : relecture complète. ",
    too_many: "Plus de 500 nouvelles cartes : relecture complète. ",
    max_cards: "Ton classeur dépasserait 20 000 cartes : relecture complète. "
  };
  // Synchro : rapide si possible, sinon relecture complète. auto = true (mode relié, après une action du joueur) : une
  // relecture complète moins de FULL_GAP après la précédente est reportée ({later: true}, rien n'est lu de plus).
  var run = async function (auto) {
    say("Lecture de ta collection…");
    var stats = await read("/api/my-collection/stats?sort=rarity");
    var state = null;
    // Raison d'une relecture complète, gardée en tête des messages de progression.
    var why = "";
    try {
      state = await send({ mode: "state" });
    } catch (e) {
      // Favori périmé (clé d'import remplacée) ou refusé : inutile de lire toute la collection pour rien. Autre erreur
      // (classeur plus ancien, réseau) : lecture complète quand même.
      if (e.status === 401 || e.status === 403) {
        throw e;
      }
      state = null;
    }
    if (state && state.quick && state.last_at) {
      say("Recherche de tes nouvelles cartes…");
      var got = await readNew(state.last_at);
      why = got.why || "";
      if (got.fresh) {
        var news = group(got.fresh);
        if (news.ignored > 0) {
          why = WHY.invalid;
        } else {
          var quick = await send({ mode: "delta", cards: news.list, stats: stats, rows: news.rows, copies: news.copies, last_at: newest(got.fresh), source: "bookmarklet" });
          if (!quick.needs_full) {
            var added = Array.isArray(quick.new_ids) ? quick.new_ids.length : 0;
            if (!news.rows) {
              say("Rien de nouveau depuis ta dernière synchro : ton classeur est à jour (" + num(quick.count) + " cartes).", true);
            } else {
              say(num(news.rows) + (news.rows > 1 ? " exemplaires obtenus" : " exemplaire obtenu") + " depuis ta dernière synchro, " + num(added) + (added > 1 ? " nouvelles cartes" : " nouvelle carte") + " : ton classeur est à jour (" + num(quick.count) + " cartes).", true);
            }
            return { quick: true };
          }
          why = WHY[quick.reason] || WHY.counts;
        }
      }
    }
    if (auto === true && live && Date.now() - live.fullAt < FULL_GAP) {
      say(why.replace(/ : relecture complète\. $/, ". ") + "Relecture complète prévue à " + hhmm(live.fullAt + FULL_GAP) + " (une relecture automatique toutes les 15 minutes au plus) : « Synchroniser » la lance tout de suite.", true);
      return { later: true };
    }
    if (live) {
      live.fullAt = Date.now();
    }
    say(why + "Lecture de ta collection…");
    var entries = [];
    for (var page = 0; page < 2000; page++) {
      var data = await read("/api/my-collection?sort=rarity&page=" + page + "&stats=0");
      if (!data || !Array.isArray(data.collection)) {
        throw new Error("Réponse inattendue de WikiMasters (pas de liste de cartes) : rien n'a été envoyé, réessaie dans un moment.");
      }
      var list = data.collection;
      entries = entries.concat(list);
      say(why + "Lecture de ta collection… " + num(entries.length) + (stats && stats.total ? " sur " + num(stats.total) : "") + " exemplaires");
      if (list.length < 50) {
        break;
      }
      await wait(300);
    }
    var grouped = group(entries);
    var cards = grouped.list;
    var upload = Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    var parts = Math.max(1, Math.ceil(cards.length / PART));
    var res = null;
    for (var i = 0; i < parts; i++) {
      say("Envoi au classeur… " + num(Math.min((i + 1) * PART, cards.length)) + " sur " + num(cards.length) + " cartes");
      var body = { upload_id: upload, part: i, last: i === parts - 1, cards: cards.slice(i * PART, (i + 1) * PART), source: "bookmarklet" };
      if (i === 0) {
        body.stats = stats;
        body.last_at = newest(entries);
        body.rows = grouped.rows;
        body.copies = grouped.copies;
        body.ignored = grouped.unknown;
      }
      res = await send(body);
    }
    var fresh = Array.isArray(res.new_ids) ? res.new_ids.length : 0;
    var message = num(res.count) + " cartes envoyées au classeur, " + num(fresh) + (fresh > 1 ? " nouvelles." : " nouvelle.");
    var ignored = grouped.ignored + (Number(res.skipped) || 0);
    if (ignored > 0) {
      message += " " + num(ignored) + (ignored > 1 ? " cartes ignorées" : " carte ignorée") + " (sans titre ou rareté inconnue du classeur) : " + (ignored > 1 ? "elles restent dans le jeu, mais le classeur ne peut pas les ranger." : "elle reste dans le jeu, mais le classeur ne peut pas la ranger.");
    }
    if (res.complete === false) {
      message += " Il en manque par rapport au total du jeu (ta collection a sans doute bougé pendant la lecture) : relance le favori dans un moment.";
    }
    say(message, true);
    return { full: true };
  };
  // Page « Collection globale » du jeu : le favori propose aussi de créer une collection du classeur avec la recherche
  // affichée. Mêmes requêtes que la page (GET /api/cards?page=N&q=…, lecture seule), triées par nom, au plus MAX_PAGES
  // pages et MAX_FOUND cartes, puis POST <site>/api/targets/from-game. Format inconnu : message clair, rien d'envoyé.
  var MAX_PAGES = 20;
  var MAX_FOUND = 3000;
  var NOTHING = "Rien n'a été envoyé au classeur.";
  var CANCELLED = "Annulé : rien n'a été envoyé au classeur.";
  var FORMAT = "La Collection globale du jeu a répondu dans un format inattendu";
  var TOO_MANY = "Trop de résultats (plus de " + num(MAX_FOUND) + " cartes ou de " + MAX_PAGES + " pages) : précise ta recherche. " + NOTHING;
  // Recherche affichée : dans l'adresse si la page l'y met, sinon dans son champ « Rechercher par titre ou
  // catégorie... ». sure = false si aucun des deux n'est trouvé (q = la valeur d'un autre champ de recherche, ou "") :
  // la recherche est alors demandée, préremplie.
  var searchOf = function () {
    var params = new URLSearchParams(location.search || "");
    var names = ["q", "search", "query", "recherche"];
    for (var i = 0; i < names.length; i++) {
      var v = (params.get(names[i]) || "").trim();
      if (v) {
        return { q: v, sure: true };
      }
    }
    var guess = "";
    var fields = document.querySelectorAll("input");
    for (var j = 0; j < fields.length; j++) {
      var hint = String(fields[j].getAttribute("placeholder") || "").toLowerCase();
      var value = String(fields[j].value || "").trim();
      if (hint.indexOf("rechercher par titre") === 0) {
        return { q: value, sure: true };
      }
      if (!guess && value && (fields[j].type === "search" || hint.indexOf("recherch") >= 0 || hint.indexOf("search") >= 0)) {
        guess = value;
      }
    }
    return { q: guess, sure: false };
  };
  // Toutes les cartes de la recherche q, triées par nom : {cards:[{card_id, title, rarity, category, image}], skipped}.
  // Champs attendus (relevés dans le code d'extensions du jeu, pas dans une documentation) : {cards:[{id,
  // wikipedia_title, rarity, category, image_url, hide_image…}], searchHasMore}. Un autre format arrête tout ; une carte
  // d'une rareté inconnue du classeur est seulement écartée (skipped).
  var readSearch = async function (q) {
    var cards = [];
    var seen = {};
    var skipped = 0;
    for (var page = 0; page < MAX_PAGES; page++) {
      var data = await read("/api/cards?page=" + page + "&q=" + encodeURIComponent(q) + "&sort=name");
      if (!data || typeof data !== "object" || !Array.isArray(data.cards)) {
        throw new Error(FORMAT + " (pas de liste « cards »). " + NOTHING);
      }
      var added = 0;
      for (var i = 0; i < data.cards.length; i++) {
        var raw = data.cards[i];
        var c = raw && typeof raw === "object" && raw.card && typeof raw.card === "object" ? raw.card : raw;
        var id = c && typeof c === "object" ? c.id || raw.card_id : null;
        var title = c && typeof c === "object" ? c.wikipedia_title : null;
        if ((typeof id !== "string" && typeof id !== "number") || id === "" || typeof title !== "string" || !title.trim() || title.length > 300) {
          throw new Error(FORMAT + " (carte sans « id » ou sans « wikipedia_title »). " + NOTHING);
        }
        id = String(id);
        if (seen[id]) {
          continue;
        }
        seen[id] = true;
        added += 1;
        if (["C", "PC", "R", "SR", "UR", "L"].indexOf(c.rarity) < 0) {
          skipped += 1;
          continue;
        }
        cards.push({ card_id: id, title: title, rarity: c.rarity, category: typeof c.category === "string" && c.category ? c.category.slice(0, 500) : null, image: c.hide_image ? null : web(c.image_url) });
      }
      if (cards.length + skipped > MAX_FOUND) {
        throw new Error(TOO_MANY);
      }
      say("Lecture de la recherche « " + q + " »… " + num(cards.length) + " cartes");
      var more = data.cards.length > 0 && data.pageCapped !== true && (typeof data.searchHasMore === "boolean" ? data.searchHasMore : true);
      if (!more) {
        if (!cards.length && skipped) {
          throw new Error(FORMAT + " (aucune rareté connue : C, PC, R, SR, UR ou L). " + NOTHING);
        }
        return { cards: cards, skipped: skipped };
      }
      if (!added) {
        throw new Error(FORMAT + " (la page suivante redonne les mêmes cartes). " + NOTHING);
      }
      await wait(300);
    }
    throw new Error(TOO_MANY);
  };
  var createFromSearch = async function () {
    var found = searchOf();
    var q = found.q;
    if (!q || !found.sure) {
      var asked = window.prompt("Recherche de la Collection globale à garder comme collection du classeur (titre ou catégorie) :", q);
      if (asked === null || asked === undefined) {
        say(CANCELLED);
        return;
      }
      q = String(asked).trim();
    }
    if (q.length < 2 || q.length > 100) {
      say("Recherche trop " + (q.length < 2 ? "courte (2 caractères au moins)" : "longue (100 caractères au plus)") + ". " + NOTHING);
      return;
    }
    say("Lecture de la recherche « " + q + " »…");
    var got = await readSearch(q);
    var n = got.cards.length;
    if (!n) {
      say("Aucune carte ne correspond à « " + q + " » dans la Collection globale. " + NOTHING);
      return;
    }
    var name = window.prompt(num(n) + (n > 1 ? " cartes trouvées" : " carte trouvée") + " pour « " + q + " ». Nom de la collection dans ton classeur :", (q.charAt(0).toUpperCase() + q.slice(1)).slice(0, 80));
    name = typeof name === "string" ? name.trim().slice(0, 80) : "";
    if (!name) {
      say(CANCELLED);
      return;
    }
    say("Envoi au classeur… " + num(n) + " cartes");
    var r = await net.call(window, SITE + "/api/targets/from-game", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Classeur-Key": KEY },
      body: JSON.stringify({ name: name, query: q, items: got.cards })
    });
    var res = await r.json().catch(function () {
      return {};
    });
    if (!r.ok) {
      throw new Error((res && res.error) || "Le classeur a répondu " + r.status + ".");
    }
    var made = res && res.target ? res.target : {};
    var count = typeof made.count === "number" ? made.count : n;
    var message = "Collection « " + (made.name || name) + " » créée dans ton classeur : " + num(count) + (count > 1 ? " cartes" : " carte") + ", avec leur rareté dans le jeu.";
    if (got.skipped > 0) {
      message += " " + num(got.skipped) + (got.skipped > 1 ? " cartes écartées" : " carte écartée") + " (rareté inconnue du classeur).";
    }
    say(message, true);
  };
  // ---------------------------------------------------------------- mode relié
  // Synchro automatique AFTER après la dernière action (le jeu finit d'écrire), au plus AFTER_MAX après la première d'une
  // rafale ; jamais moins de GAP après la fin de la précédente (automatique ou non), PER_HOUR automatiques par heure au
  // plus ; une relecture complète automatique au plus toutes les FULL_GAP (sinon reportée, « Synchroniser » la lance).
  var AFTER = 5000;
  var AFTER_MAX = 30000;
  var GAP = 60000;
  var PER_HOUR = 20;
  var HOUR = 3600000;
  var FULL_GAP = 15 * 60000;
  var two = function (n) {
    return (n < 10 ? "0" : "") + n;
  };
  var hhmm = function (t) {
    var d = new Date(t);
    return two(d.getHours()) + ":" + two(d.getMinutes());
  };
  // Actions du joueur qui changent sa collection : [méthode ("*" : toute sauf GET), chemin de l'API du jeu, ce que le
  // badge en dit]. Relevées dans docs/api.md de qpautrat/wikimasters-cli et dans le code d'extensions tierces (tableau
  // dans SPEC.md). Toute autre requête (lecture, Supabase, autre site, enchère posée, statut hors 2xx) ne déclenche rien.
  var ACTIONS = [
    ["POST", /^\/api\/packs\/[^/]+/, "paquet ouvert"],
    ["POST", /^\/api\/user-cards\/(bulk-discard|[^/]+\/discard)$/, "carte défaussée"],
    ["POST", /^\/api\/marketplace$/, "carte mise aux enchères"],
    ["DELETE", /^\/api\/marketplace\/[^/]+$/, "enchère annulée"],
    ["*", /^\/api\/trades(\/|$)/, "échange"],
    ["POST", /^\/api\/achievements\/claim$/, "récompense réclamée"]
  ];
  var actionOf = function (method, path) {
    for (var i = 0; i < ACTIONS.length; i++) {
      if ((ACTIONS[i][0] === "*" || ACTIONS[i][0] === method) && ACTIONS[i][1].test(path)) {
        return ACTIONS[i][2];
      }
    }
    return null;
  };
  // Une requête de la page : seuls sa méthode et son adresse sont lus (jamais son corps) ; sa réponse n'est regardée que
  // par son statut, une fois reçue par la page, et jamais lue.
  var watch = function (args, p) {
    var input = args[0];
    var init = args[1];
    var method = String((init && init.method) || (input && typeof input === "object" && input.method) || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") {
      return;
    }
    var u = new URL(typeof input === "string" ? input : input && typeof input.url === "string" ? input.url : String(input), location.href);
    if (u.origin !== location.origin) {
      return;
    }
    var what = actionOf(method, u.pathname);
    if (!what || !p || typeof p.then !== "function") {
      return;
    }
    p.then(function (r) {
      try {
        if (r && r.ok === true) {
          noticed(what);
        }
      } catch (e) {
        return;
      }
    }, function () {
      return;
    });
  };
  // window.fetch enveloppé : la requête part d'abord, telle quelle (mêmes arguments, même this), et la page reçoit la
  // promesse même du fetch d'origine ; l'observation vient après, et ses erreurs sont avalées.
  var install = function () {
    var base = window.fetch;
    if (typeof base !== "function" || typeof URL !== "function" || !location.origin || !location.href) {
      return false;
    }
    var spy = function () {
      var p = base.apply(this, arguments);
      if (live && live.on) {
        try {
          watch(arguments, p);
        } catch (e) {
          // L'observateur ne casse jamais la requête de la page.
        }
      }
      return p;
    };
    live = { on: true, wanted: false, first: 0, last: 0, what: "", hold: "", plan: 0, due: 0, end: 0, okAt: 0, autos: [], fullAt: 0, later: false, paused: false, fails: 0, foldPlan: 0 };
    // Arrêt : window.fetch d'origine rendu ; si un autre script l'a enveloppé à son tour, il est laissé en place et
    // celui-ci ne fait plus que passer la main (live.on = false).
    live.restore = function () {
      if (window.fetch === spy) {
        window.fetch = base;
      }
    };
    window.fetch = spy;
    return true;
  };
  var status = document.createElement("div");
  status.style.cssText = "margin-top:10px;font-size:12.5px;color:#b8c2bd";
  status.title = "Le favori reste actif dans cette page : après tes actions dans le jeu (paquet ouvert, carte défaussée, mise aux enchères, échange), il relit tes nouvelles cartes et les envoie au classeur. Il ne fait que lire. « Arrêter », ou recharger la page, le coupe.";
  var folded = false;
  var foldBtn = null;
  // Encart réduit en badge (true) ou déplié.
  var fold = function (yes) {
    folded = yes;
    live.foldPlan += 1;
    title.style.display = yes ? "none" : "";
    text.style.display = yes ? "none" : "";
    extra.style.display = yes ? "none" : "";
    box.style.cssText = yes ? SMALL : WIDE;
    status.style.marginTop = yes ? "4px" : "10px";
    foldBtn.textContent = yes ? "Détails" : "Réduire";
    keep();
  };
  var badge = function () {
    if (!live || !live.on) {
      return;
    }
    var s = "synchro après ta prochaine action dans le jeu";
    if (window.__classeurFavori) {
      s = "synchro en cours…";
    } else if (live.paused) {
      s = "synchro automatique en pause : clique « Synchroniser »";
    } else if (live.wanted) {
      s = (live.later ? "relecture complète" : "synchro") + (live.due - Date.now() > AFTER_MAX ? " à " + hhmm(live.due) : " dans un instant") + " (" + live.what + (live.hold ? " ; " + live.hold : "") + ")";
    } else if (live.okAt) {
      s = "dernière synchro à " + hhmm(live.okAt);
    }
    status.textContent = "Classeur relié · " + s;
    keep();
  };
  // Prochaine synchro automatique, si une action l'attend (et ni pause ni synchro en cours : sa fin rappelle schedule).
  var schedule = function () {
    if (!live || !live.on || !live.wanted || live.paused || window.__classeurFavori) {
      badge();
      return;
    }
    var now = Date.now();
    live.autos = live.autos.filter(function (t) {
      return now - t < HOUR;
    });
    var at = Math.min(live.last + AFTER, live.first + AFTER_MAX);
    live.hold = "";
    if (live.end && live.end + GAP > at) {
      at = live.end + GAP;
      live.hold = "une par minute au plus";
    }
    if (live.autos.length >= PER_HOUR && live.autos[live.autos.length - PER_HOUR] + HOUR > at) {
      at = live.autos[live.autos.length - PER_HOUR] + HOUR;
      live.hold = PER_HOUR + " synchros automatiques par heure au plus";
    }
    if (live.later && live.fullAt + FULL_GAP > at) {
      at = live.fullAt + FULL_GAP;
      live.hold = "une relecture complète automatique toutes les 15 minutes au plus";
    }
    live.due = at;
    live.plan += 1;
    var id = live.plan;
    setTimeout(function () {
      if (live.on && id === live.plan && live.wanted && !live.paused && !window.__classeurFavori) {
        live.autos.push(Date.now());
        start(run, true);
      }
    }, Math.max(0, at - now));
    badge();
  };
  // Action du joueur vue (réponse 2xx reçue par la page).
  var noticed = function (what) {
    if (!live || !live.on) {
      return;
    }
    var now = Date.now();
    if (!live.wanted) {
      live.first = now;
    }
    live.wanted = true;
    live.last = now;
    live.what = what;
    schedule();
  };
  // Lance une synchro (run) ou la création d'une collection ; auto = true : synchro déclenchée par une action du joueur.
  // Une synchro couvre les actions d'avant son début ; une erreur qui arrête tout (session, limite de lectures du jeu,
  // favori périmé), ou trois de suite, met les synchros automatiques en pause jusqu'à un « Synchroniser » réussi.
  var start = function (task, auto) {
    var sync = task === run;
    window.__classeurFavori = true;
    if (live && sync) {
      live.wanted = false;
      live.later = false;
      live.plan += 1;
    }
    badge();
    task(auto).then(function (res) {
      if (!live) {
        return;
      }
      if (sync) {
        live.fails = 0;
        if (res && res.later) {
          live.later = true;
          live.wanted = true;
          live.first = Date.now();
          live.last = live.first;
          return;
        }
        live.okAt = Date.now();
        live.paused = false;
      }
      if (!auto) {
        var plan = live.foldPlan;
        setTimeout(function () {
          if (live.on && plan === live.foldPlan && !window.__classeurFavori) {
            fold(true);
          }
        }, 15000);
      }
    }).catch(function (e) {
      say(e && e.message ? e.message : "Le favori n'a pas pu lire ta collection.");
      if (live) {
        if (sync) {
          live.fails += 1;
          if (auto && ((e && (e.stop || e.status === 401 || e.status === 403)) || live.fails >= 3)) {
            live.paused = true;
          }
        }
        fold(false);
      }
    }).finally(function () {
      window.__classeurFavori = false;
      if (live) {
        if (sync) {
          live.end = Date.now();
        }
        schedule();
      }
    });
  };
  var stopLive = function () {
    if (live) {
      live.on = false;
      live.plan += 1;
      live.restore();
    }
    if (window.__classeurRelie === handle) {
      window.__classeurRelie = null;
    }
    box.remove();
  };
  var handle = {
    show: function () {
      if (live && live.on) {
        fold(false);
      }
    },
    stop: stopLive
  };
  // Mode relié installé (sinon, navigateur sans URL ou sans fetch : favori ponctuel, comme avant) : ligne d'état et
  // boutons à la place de « Fermer ».
  var relier = function () {
    if (!install()) {
      return false;
    }
    window.__classeurRelie = handle;
    foldBtn = button("Réduire", function () {
      fold(!folded);
    });
    foot.textContent = "";
    foot.append(status, button("Synchroniser", function () {
      if (!window.__classeurFavori) {
        start(run, false);
      }
    }), foldBtn, button("Arrêter", stopLive));
    badge();
    return true;
  };
  var linked = relier();
  if (START === "load") {
    // Script Tampermonkey : relié dès le chargement, rien n'est lu avant une action du joueur (ni le choix de la
    // Collection globale).
    if (!linked) {
      box.remove();
      return;
    }
    text.textContent = "Relié à ton classeur : après tes actions dans le jeu (paquet ouvert, carte défaussée, mise aux enchères, échange), il relit tes nouvelles cartes et les lui envoie. Rien n'est lu avant.";
    fold(true);
  } else if (/^\/global-collection\/?$/.test(String(location.pathname || ""))) {
    var shown = searchOf();
    var label = shown.q.length > 40 ? shown.q.slice(0, 39) + "…" : shown.q;
    say("Collection globale : que veux-tu faire ?");
    var choice = function (caption, task) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = caption;
      b.style.cssText = "display:block;width:100%;margin-top:8px;padding:7px 10px;border-radius:8px;border:1px solid #2e3431;background:#1b1f1d;color:#f2f4f3;font:inherit;text-align:left;cursor:pointer";
      b.addEventListener("click", function () {
        if (!window.__classeurFavori) {
          start(task, false);
        }
      });
      extra.appendChild(b);
    };
    choice("Mettre à jour mon classeur", run);
    choice(shown.q && shown.sure ? "Créer une collection avec cette recherche (« " + label + " »)" : "Créer une collection avec une recherche…", createFromSearch);
  } else {
    start(run, false);
  }
})();
