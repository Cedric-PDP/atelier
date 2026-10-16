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
// toutes les 15 minutes. Ces limites valent pour toutes les pages et tous les onglets du jeu de ce navigateur (heures
// gardées dans son localStorage, clé "classeur:relie", jamais la clé d'import) et, pour les relectures complètes, d'après
// la dernière vue par le classeur (full_at). Quand il ne se passe rien, rien n'est lu. Classeur injoignable ou en
// erreur : rien n'est lu dans le jeu, et trois échecs de suite (ou un favori périmé, ou le quota du jour du classeur)
// mettent les synchros automatiques en pause. Encart réductible en badge (« Classeur relié · dernière synchro à
// 14:32 »), avec « Synchroniser » et « Arrêter » (qui rend window.fetch d'origine, et coupe la synchro en cours : plus
// rien n'est lu ni envoyé).
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
  // arrêté (window.fetch rendu, encart retiré) et ce clic repart de zéro, avec sa clé à lui. Synchro d'un favori arrêté
  // (ou dont l'encart a été fermé) qui se termine : sa requête en cours finit seule, et ce clic le dit sans rien lancer.
  var prev = window.__classeurRelie;
  var ending = false;
  if (window.__classeurFavori) {
    if (prev && typeof prev.show === "function") {
      prev.show();
      return;
    }
    if (document.getElementById(BOX_ID)) {
      return;
    }
    ending = true;
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
  // Choix de la Collection globale : à part, pour qu'aucun message (synchro automatique comprise) ne les efface.
  var menu = document.createElement("div");
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
  box.append(title, text, extra, menu, foot);
  document.body.appendChild(box);
  // Mode relié (null : favori ponctuel). keep() remet l'encart dans la page si le jeu l'en a retiré en se redessinant.
  var live = null;
  // « Arrêter » : plus aucune lecture du jeu ni aucun envoi au classeur, même au milieu d'une synchro.
  var halted = false;
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
  if (ending) {
    say("Une synchro se termine : clique à nouveau le favori dans un instant (ou recharge la page).");
    return;
  }
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
  // Erreur qui arrête tout (session, limite de lectures du jeu, « Arrêter ») : pas de relecture complète derrière.
  var stop = function (message) {
    var e = new Error(message);
    e.stop = true;
    return e;
  };
  // Avant chaque lecture et chaque envoi (donc entre deux pages) : rien de plus après « Arrêter ».
  var halt = function () {
    if (halted) {
      var e = stop("Favori arrêté.");
      e.halted = true;
      throw e;
    }
  };
  // Lecture d'une adresse de l'API du jeu, avec la session du navigateur (même origine).
  var read = async function (path) {
    halt();
    var r = await net.call(window, path, { credentials: "include", headers: { Accept: "application/json" } }).catch(function () {
      throw new Error("WikiMasters ne répond pas (réseau) : réessaie dans un moment.");
    });
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
  // leur nombre total, invalides compris (contrôlés par le classeur avec les compteurs du jeu). variants : exemplaires
  // par rareté d'exemplaire (snapshot_rarity s'il est là, celle des ventes du marché ; sinon celle de la carte) et
  // brillance (« R* »), pour coter chacun.
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
        card = { id: id, title: c.wikipedia_title, rarity: c.rarity, atk: typeof c.atk === "number" ? c.atk : null, def: typeof c.def === "number" ? c.def : null, quality: typeof c.q_score === "number" ? c.q_score : null, pageviews: typeof c.pageviews === "number" ? c.pageviews : null, category: typeof c.category === "string" && c.category ? c.category : null, image: c.hide_image ? null : web(c.image_url), url: web(c.wikipedia_url), count: 0, shiny: false, starred: false, obtained_at: null, variants: {} };
        byId[id] = card;
        list.push(card);
      } else if (RANKS.indexOf(c.rarity) > RANKS.indexOf(card.rarity)) {
        card.rarity = c.rarity;
      }
      var copy = (RANKS.indexOf(e.snapshot_rarity) >= 0 ? e.snapshot_rarity : c.rarity) + (e.is_shiny ? "*" : "");
      card.variants[copy] = (card.variants[copy] || 0) + n;
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
  // Message d'un refus du classeur : le sien (favori périmé…), sauf script Tampermonkey périmé (401 en mode « load » :
  // c'est le script qu'il faut reprendre, pas le favori) et erreur du serveur (5xx ; 503 : quota du jour ou base non
  // liée, avec son message).
  var refusal = function (status, res) {
    var said = res && typeof res.error === "string" && res.error ? res.error : "";
    if (status === 401 && START === "load") {
      return "Script Tampermonkey périmé : sa clé ne correspond plus à ton classeur (un favori plus récent l'a remplacée). Ouvre ton classeur, onglet « Mettre à jour », copie le script régénéré (« Sans cliquer à chaque fois ») et remplace l'ancien dans Tampermonkey.";
    }
    if (status >= 500) {
      return status === 503 && said ? said : "Le classeur ne répond pas (erreur " + status + ") : réessaie dans un moment.";
    }
    return said || "Le classeur a répondu " + status + ".";
  };
  // Envoi au classeur (route : /api/import ou /api/targets/from-game). Erreur : e.status (refus) ou e.down (réseau).
  var post = async function (route, body) {
    halt();
    var r = await net.call(window, SITE + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Classeur-Key": KEY },
      body: JSON.stringify(body)
    }).catch(function () {
      var down = new Error("Le classeur ne répond pas (réseau) : réessaie dans un moment.");
      down.down = true;
      throw down;
    });
    var res = await r.json().catch(function () {
      return {};
    });
    if (!r.ok) {
      var e = new Error(refusal(r.status, res));
      e.status = r.status;
      throw e;
    }
    return res;
  };
  var send = function (body) {
    return post("/api/import", body);
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
    var state = null;
    // Raison d'une relecture complète, gardée en tête des messages de progression.
    var why = "";
    // L'état de la synchro d'abord : sans réponse du classeur, rien n'est lu dans le jeu.
    try {
      state = await send({ mode: "state" });
    } catch (e) {
      // Favori périmé (clé d'import remplacée) ou refusé, classeur injoignable ou en erreur (réseau, 5xx), « Arrêter », ou
      // synchro automatique : erreur, rien n'est lu. Autre refus après un clic (classeur plus ancien) : lecture complète.
      if (auto === true || e.stop || e.down || e.status === 401 || e.status === 403 || e.status >= 500) {
        throw e;
      }
      state = null;
    }
    var stats = await read("/api/my-collection/stats?sort=rarity");
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
    if (auto === true && live) {
      // Dernière relecture complète : celle des pages de ce navigateur (share), ou celle que le classeur a vérifiée
      // (full_at, heure du serveur ; prise au plus à maintenant si l'horloge de l'ordinateur retarde).
      share(false);
      var server = state && typeof state.full_at === "string" ? Date.parse(state.full_at) : NaN;
      if (server > live.fullAt) {
        live.fullAt = Math.min(server, Date.now());
      }
      if (Date.now() - live.fullAt < FULL_GAP) {
        say(why.replace(/ : relecture complète\. $/, ". ") + "Relecture complète prévue à " + hhmm(live.fullAt + FULL_GAP) + " (une relecture automatique toutes les 15 minutes au plus) : « Synchroniser » la lance tout de suite.", true);
        return { later: true };
      }
    }
    if (live) {
      live.fullAt = Date.now();
      share(true);
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
    var res = await post("/api/targets/from-game", { name: name, query: q, items: got.cards });
    var made = res && res.target ? res.target : {};
    var count = typeof made.count === "number" ? made.count : n;
    var message = "Collection « " + (made.name || name) + " » créée dans ton classeur : " + num(count) + (count > 1 ? " cartes" : " carte") + ", avec leur rareté dans le jeu.";
    if (got.skipped > 0) {
      message += " " + num(got.skipped) + (got.skipped > 1 ? " cartes écartées" : " carte écartée") + " (rareté inconnue du classeur).";
    }
    say(message, true);
  };
  // ---------------------------------------------------------------- cotes et marché (« Mettre à jour les cotes »)
  // À ton clic seulement : lecture directe de la base du jeu (Supabase : tables auctions, cards et auction_bids, celles
  // que la page du jeu lit déjà avec ta session), jamais ses routes /api/marketplace (limitées). Une requête par seconde
  // au plus, SUPA_MAX par clic (le clic suivant reprend aux cotes les plus anciennes) ; arrêt sur 401, 403 ou 429. Le
  // jeton de ta session est lu dans la page à chaque requête et ne la quitte pas (ni le classeur ni l'encart ne le
  // voient) ; le favori ne le renouvelle jamais : un jeton de renouvellement ne sert qu'une fois, le réutiliser fermerait
  // ta session. Le classeur reçoit les cotes calculées ici (médiane des 30 ventes les plus récentes par rareté
  // d'exemplaire et brillance, sur 90 jours ; fiable dès 3 ventes ; celle d'il y a 7 jours ; la dernière vente), et ta
  // lecture du marché (bonnes affaires, tes enchères et tes ventes), jamais ton identifiant dans le jeu.
  var SUPA = "https://cyrxjeppjqsxxjayfrur.supabase.co/rest/v1/";
  // Clé publique de la base du jeu (rôle « anon », livrée dans le code de sa page) : seule, elle n'ouvre rien.
  var ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5cnhqZXBwanFzeHhqYXlmcnVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4ODAzMzksImV4cCI6MjA4OTQ1NjMzOX0.BZluyXygNxuQGDPxFX1zG5i-cqp10CVK-8GGtuak4Rg";
  var SESSION = "sb-cyrxjeppjqsxxjayfrur-auth-token";
  var SUPA_GAP = 1000;
  var SUPA_MAX = 30;
  var DAY = 86400000;
  var EXPIRED = "Ta session du jeu a expiré dans cette page : recharge la page du jeu, puis clique à nouveau « Mettre à jour les cotes » (le favori ne la renouvelle jamais lui-même).";
  var NO_SESSION = "Le favori ne trouve pas ta session du jeu dans cette page : connecte-toi, recharge la page, puis réessaie. Rien n'a été lu.";
  var unb64 = function (s) {
    var b = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) {
      b += "=";
    }
    var bin = atob(b);
    try {
      return decodeURIComponent(bin.replace(/[\s\S]/g, function (c) {
        return "%" + ("0" + c.charCodeAt(0).toString(16)).slice(-2);
      }));
    } catch (e) {
      return bin;
    }
  };
  // Session de la page : cookie SESSION (« base64- » puis du JSON en base64url, parfois découpé en .0, .1…), sinon le
  // localStorage du même nom. {token, uid} ou {why}. Jeton expiré (ou à moins de 30 s) : pas de lecture.
  var session = function () {
    var jar = {};
    var raw;
    var data = null;
    try {
      String(document.cookie || "").split(";").forEach(function (p) {
        var i = p.indexOf("=");
        if (i > 0) {
          jar[p.slice(0, i).trim()] = p.slice(i + 1).trim();
        }
      });
    } catch (e) {
      jar = {};
    }
    raw = jar[SESSION];
    if (raw === undefined && jar[SESSION + ".0"] !== undefined) {
      raw = "";
      for (var j = 0; j < 20 && jar[SESSION + "." + j] !== undefined; j++) {
        raw += jar[SESSION + "." + j];
      }
    }
    try {
      raw = raw || window.localStorage.getItem(SESSION) || "";
      try {
        raw = decodeURIComponent(raw);
      } catch (e) {
        raw = String(raw);
      }
      data = raw ? JSON.parse(raw.indexOf("base64-") === 0 ? unb64(raw.slice(7)) : raw) : null;
    } catch (e) {
      data = null;
    }
    data = data && data.currentSession ? data.currentSession : data;
    var token = data && typeof data.access_token === "string" ? data.access_token : "";
    if (!token) {
      return { why: NO_SESSION };
    }
    var claims = {};
    try {
      claims = JSON.parse(unb64(token.split(".")[1])) || {};
    } catch (e) {
      claims = {};
    }
    var exp = typeof data.expires_at === "number" ? data.expires_at : claims.exp;
    if (typeof exp === "number" && exp * 1000 < Date.now() + 30000) {
      return { why: EXPIRED };
    }
    var uid = data.user && typeof data.user.id === "string" ? data.user.id : claims.sub;
    return { token: token, uid: typeof uid === "string" ? uid : "" };
  };
  // Compte des requêtes du clic en cours (n) et heure de la dernière (last) : rythme et plafond.
  var mk = { n: 0, last: 0 };
  var room = function () {
    return mk.n < SUPA_MAX;
  };
  var supa = async function (path) {
    halt();
    if (mk.last + SUPA_GAP > Date.now()) {
      await wait(mk.last + SUPA_GAP - Date.now());
    }
    halt();
    var s = session();
    if (!s.token) {
      throw stop(s.why);
    }
    mk.n += 1;
    mk.last = Date.now();
    var r = await net.call(window, SUPA + path, { headers: { apikey: ANON, Authorization: "Bearer " + s.token, Accept: "application/json" } }).catch(function () {
      throw stop("La base du jeu ne répond pas (réseau) : cotes arrêtées, réessaie dans un moment.");
    });
    mk.last = Date.now();
    if (r.status === 401 || r.status === 403 || r.status === 429) {
      var said = await r.json().catch(function () {
        return null;
      });
      if (r.status === 429 || (said && said.code === "automation_limit")) {
        throw stop("Le jeu limite les lectures automatiques : cotes arrêtées, réessaie plus tard.");
      }
      if (r.status === 401 && said && /api ?key/i.test(String(said.message || said.msg || ""))) {
        throw stop("La clé publique de la base du jeu a changé : le favori doit être mis à jour pour lire les cotes.");
      }
      throw stop(r.status === 401 ? EXPIRED : "La base du jeu refuse cette lecture (403) : cotes arrêtées.");
    }
    if (!r.ok) {
      throw stop("La base du jeu a répondu " + r.status + " : cotes arrêtées, réessaie dans un moment.");
    }
    var rows = await r.json().catch(function () {
      return null;
    });
    if (!Array.isArray(rows)) {
      throw stop("La base du jeu a répondu dans un format inattendu : cotes arrêtées.");
    }
    return rows;
  };
  // Liste PostgREST « in.(…) » de textes entre guillemets (titres avec virgules ou parenthèses compris).
  var inList = function (xs) {
    return encodeURIComponent("(" + xs.map(function (x) {
      return "\"" + String(x).replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"";
    }).join(",") + ")");
  };
  var iso = function (t) {
    return encodeURIComponent(new Date(t).toISOString());
  };
  var vkey = function (r, shiny) {
    return RANKS.indexOf(r) >= 0 ? r + (shiny ? "*" : "") : null;
  };
  var median = function (xs) {
    var a = xs.slice().sort(function (x, y) {
      return x - y;
    });
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  var px = function (x) {
    return x.p;
  };
  // Ventes d'une carte -> {"R": {p, n, w, l, d}, "R*": …}.
  var cotes = function (rows) {
    var by = {};
    var out = {};
    var week = Date.now() - 7 * DAY;
    rows.forEach(function (x) {
      var k = vkey(x.snapshot_rarity, x.is_shiny);
      var p = Number(x.final_price);
      var t = Date.parse(x.settled_at);
      if (k && isFinite(p) && p >= 0 && p <= 1e9 && isFinite(t)) {
        (by[k] = by[k] || []).push({ p: p, t: t, d: x.settled_at });
      }
    });
    Object.keys(by).forEach(function (k) {
      var s = by[k].sort(function (a, b) {
        return b.t - a.t;
      });
      var old = s.filter(function (x) {
        return x.t < week;
      }).slice(0, 30);
      out[k] = { p: median(s.slice(0, 30).map(px)), n: s.length, w: old.length >= 3 ? median(old.map(px)) : null, l: s[0].p, d: s[0].d };
    });
    return out;
  };
  // Cotes d'un lot de 100 cartes au plus : ventes des 90 derniers jours, pages de 1 000 dans un ordre stable. Plafond
  // atteint au milieu : seules les cartes lues en entier (toutes sauf la dernière vue) sont rendues. [{id, v}].
  var readCotes = async function (ids) {
    var rows = [];
    var done = false;
    for (var off = 0; room(); off += 1000) {
      var page = await supa("auctions?select=card_id,snapshot_rarity,final_price,settled_at,is_shiny&status=eq.settled_sold&settled_at=gte." + iso(Date.now() - 90 * DAY) + "&card_id=in." + inList(ids) + "&order=card_id,settled_at.desc,id&limit=1000&offset=" + off);
      rows = rows.concat(page);
      if (page.length < 1000) {
        done = true;
        break;
      }
    }
    var by = {};
    rows.forEach(function (x) {
      (by[x.card_id] = by[x.card_id] || []).push(x);
    });
    var last = rows.length ? rows[rows.length - 1].card_id : null;
    return ids.filter(function (id) {
      return done || (by[id] && id !== last);
    }).map(function (id) {
      return { id: id, v: by[id] ? cotes(by[id]) : {} };
    });
  };
  var https = function (v) {
    return typeof v === "string" && v.length <= 2000 && /^https:\/\//i.test(v) ? v : null;
  };
  var money = function (v) {
    var n = Number(v);
    return v !== null && v !== undefined && isFinite(n) && n >= 0 && n <= 1e9 ? n : null;
  };
  // Ce que la page du classeur montre d'une enchère : carte, rareté de l'exemplaire, image, fin, cote (fiable ou non).
  // null si une valeur ne passerait pas les contrôles du classeur (qui refuserait toute la lecture du marché).
  var lot = function (a, fresh, title) {
    var r = a.snapshot_rarity;
    var c = a.card || {};
    if (RANKS.indexOf(r) < 0 || !/^[A-Za-z0-9_-]{1,64}$/.test(String(a.id)) || !CARD_ID.test(String(a.card_id)) || typeof a.end_at !== "string" || a.end_at.length > 40 || !isFinite(Date.parse(a.end_at))) {
      return null;
    }
    var k = vkey(r, a.is_shiny);
    var q = fresh[a.card_id] && fresh[a.card_id][k];
    return { a: String(a.id), id: String(a.card_id), t: String(title || c.wikipedia_title || "?").slice(0, 300), r: r, s: !!a.is_shiny, img: c.hide_image ? null : https(c.image_url), end: String(a.end_at), cote: q ? q.p : null, n: q ? q.n : null };
  };
  var CARD = "card:cards(wikipedia_title,image_url,hide_image)";
  // Identifiant de carte accepté par le classeur (sinon tout l'envoi serait refusé).
  var CARD_ID = /^[A-Za-z0-9_-]{1,100}$/;
  // Le clic : plan du classeur (cartes à coter, cartes qui manquent à tes collections), tes enchères et tes ventes,
  // titres -> cartes du jeu, enchères en cours sur les cartes voulues, cotes de ces cartes, puis des tiennes (les plus
  // anciennes d'abord) tant que le plafond le permet. Les cotes lues sont envoyées même si une erreur arrête tout.
  var market = async function () {
    say("Lecture des cotes…");
    var me = session();
    if (!me.token) {
      say(me.why);
      return;
    }
    var plan = await post("/api/market/plan", {});
    if (!(plan.quota > 0)) {
      say("Quota du jour des cotes atteint pour ton classeur (ou pour tout le site) : réessaie demain. Rien n'a été lu.");
      return;
    }
    mk.n = 0;
    var cards = Array.isArray(plan.cards) ? plan.cards : [];
    var ids = plan.ids && typeof plan.ids === "object" ? plan.ids : {};
    var wanted = Array.isArray(plan.wanted) ? plan.wanted : [];
    var fresh = {};
    var sent = [];
    var found = {};
    var live = { ids: {}, deals: [], bids: [], sales: [] };
    var fail = null;
    var take = async function (list) {
      for (var i = 0; i < list.length && room() && sent.length < plan.quota; i += 100) {
        (await readCotes(list.slice(i, i + 100))).forEach(function (x) {
          if (!fresh[x.id] && sent.length < plan.quota && CARD_ID.test(x.id)) {
            fresh[x.id] = x.v;
            sent.push(x);
          }
        });
      }
    };
    try {
      var now = Date.now();
      var mine = [];
      var bids = me.uid ? await supa("auction_bids?select=amount,placed_at,auction:auctions(id,card_id,status,end_at,current_bid,current_bidder_id,final_price,winner_id,snapshot_rarity,is_shiny," + CARD + ")&bidder_id=eq." + encodeURIComponent(me.uid) + "&placed_at=gte." + iso(now - 14 * DAY) + "&order=placed_at.desc&limit=200") : [];
      var sales = me.uid ? await supa("auctions?select=id,card_id,status,end_at,base_amount,current_bid,current_bidder_id,final_price,snapshot_rarity,is_shiny," + CARD + "&seller_id=eq." + encodeURIComponent(me.uid) + "&end_at=gte." + iso(now - 14 * DAY) + "&order=end_at.desc&limit=100") : [];
      say("Lecture des cotes… recherche des cartes qui te manquent");
      var unknown = wanted.filter(function (t) {
        return typeof ids[t] !== "string";
      }).slice(0, 320);
      for (var i = 0; i < unknown.length && room(); i += 80) {
        var part = unknown.slice(i, i + 80);
        (await supa("cards?select=id,wikipedia_title,lang&wikipedia_title=in." + inList(part) + "&order=id&limit=1000")).forEach(function (c) {
          if (c && CARD_ID.test(String(c.id)) && (!found[c.wikipedia_title] || c.lang === "fr")) {
            found[c.wikipedia_title] = String(c.id);
          }
        });
        part.forEach(function (t) {
          live.ids[t] = found[t] || "";
          ids[t] = live.ids[t];
        });
      }
      var titleOf = {};
      var want = wanted.filter(function (t) {
        return ids[t];
      }).map(function (t) {
        titleOf[ids[t]] = t;
        return ids[t];
      });
      var auctions = [];
      for (var k = 0; k < want.length && room() && k < 500; k += 100) {
        auctions = auctions.concat(await supa("auctions?select=id,card_id,seller_id,snapshot_rarity,current_bid,current_bidder_id,base_amount,end_at,is_shiny," + CARD + "&status=eq.active&end_at=gt." + iso(now) + "&card_id=in." + inList(want.slice(k, k + 100)) + "&order=end_at&limit=1000"));
      }
      auctions = auctions.filter(function (a) {
        return a && a.id && a.card_id && a.seller_id !== me.uid;
      });
      bids.forEach(function (b) {
        var a = b && b.auction;
        if (a && a.id && a.card_id) {
          mine.push(a.card_id);
        }
      });
      sales.forEach(function (a) {
        if (a && a.card_id && a.status === "active") {
          mine.push(a.card_id);
        }
      });
      say("Lecture des cotes…");
      var first = auctions.map(function (a) {
        return String(a.card_id);
      }).concat(mine.map(String)).filter(function (id, n, all) {
        return all.indexOf(id) === n;
      }).slice(0, 300);
      await take(first);
      await take(cards.filter(function (id) {
        return !fresh[id];
      }));
      auctions.forEach(function (a) {
        var x = lot(a, fresh, titleOf[a.card_id]);
        if (!x) {
          return;
        }
        var bid = !!a.current_bidder_id;
        var ask = money(bid ? a.current_bid : a.base_amount);
        var base = money(a.base_amount);
        var left = Date.parse(a.end_at) - Date.now();
        if (x.cote !== null && x.n >= 3 && ask !== null && (ask <= 0.8 * x.cote || (!bid && left < 2 * 3600000 && base !== null && base <= x.cote))) {
          x.ask = ask;
          x.bid = bid;
          x.lead = !!me.uid && a.current_bidder_id === me.uid;
          live.deals.push(x);
        }
      });
      live.deals = live.deals.sort(function (a, b) {
        return Date.parse(a.end) - Date.parse(b.end);
      }).slice(0, 50);
      var seen = {};
      bids.forEach(function (b) {
        var a = b && b.auction;
        var amount = money(b && b.amount);
        if (!a || !a.id || !a.card_id || amount === null) {
          return;
        }
        if (seen[a.id]) {
          seen[a.id].mine = Math.max(seen[a.id].mine, amount);
          return;
        }
        var x = lot(a, fresh);
        if (!x) {
          return;
        }
        var run = a.status === "active";
        x.mine = amount;
        x.cur = money(run ? a.current_bid : a.final_price);
        x.lead = run && a.current_bidder_id === me.uid;
        x.st = run ? "run" : a.status === "settled_sold" ? (a.winner_id === me.uid ? "won" : "lost") : "off";
        seen[a.id] = x;
        live.bids.push(x);
      });
      live.bids = live.bids.slice(0, 100);
      sales.forEach(function (a) {
        if (!a || !a.id || !a.card_id || money(a.base_amount) === null) {
          return;
        }
        var x = lot(a, fresh);
        if (!x) {
          return;
        }
        var st = String(a.status || "");
        x.base = money(a.base_amount);
        x.bid = !!a.current_bidder_id;
        x.cur = money(st === "settled_sold" ? a.final_price : x.bid ? a.current_bid : null);
        x.st = st === "active" ? "run" : st === "settled_sold" ? "sold" : st.indexOf("settled") === 0 ? "unsold" : "off";
        live.sales.push(x);
      });
    } catch (e) {
      fail = e;
    }
    if (halted) {
      throw fail || stop("Favori arrêté.");
    }
    for (var p = 0; p * 500 < sent.length || p === 0; p++) {
      await post("/api/market/prices", { prices: sent.slice(p * 500, (p + 1) * 500), last: (p + 1) * 500 >= sent.length });
    }
    if (fail) {
      throw new Error(fail.message + (sent.length ? " " + num(sent.length) + " cotes lues avant l'arrêt ont été envoyées au classeur." : ""));
    }
    await post("/api/market/live", live);
    var planned = {};
    cards.forEach(function (id) {
      planned[id] = true;
    });
    var left = Math.max(0, (Number(plan.stale) || 0) - sent.filter(function (x) {
      return planned[x.id];
    }).length);
    var running = live.bids.filter(function (x) {
      return x.st === "run";
    }).length;
    say("Cotes lues : " + num(sent.length) + (sent.length > 1 ? " cartes" : " carte") + (left ? " (il en reste " + num(left) + " : reclique plus tard, les plus anciennes d'abord)" : ", tes cotes sont à jour") + ". " + num(live.deals.length) + (live.deals.length > 1 ? " bonnes affaires" : " bonne affaire") + ", " + num(running) + " de tes enchères en cours : onglet « Marché » du classeur.", true);
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
  // Limites communes à toutes les pages et tous les onglets du jeu de ce navigateur (un rechargement ou un autre onglet
  // ne les remet pas à zéro) : localStorage de wiki-masters.com, clé MEMO, {autos: heures des synchros automatiques de
  // la dernière heure, end: fin (ou début, pendant qu'elle tourne) de la dernière synchro, full: début de la dernière
  // relecture complète}. Rien d'autre (jamais la clé). Stockage absent ou refusé (navigation privée…) : limites de cette
  // page seulement. Une heure à venir (horloge changée) est ignorée.
  var MEMO = "classeur:relie";
  var share = function (write) {
    if (!live) {
      return;
    }
    var now = Date.now();
    var m = null;
    try {
      m = JSON.parse(window.localStorage.getItem(MEMO) || "null");
    } catch (e) {
      m = null;
    }
    var at = function (t) {
      return typeof t === "number" && isFinite(t) && t <= now ? t : 0;
    };
    if (m && typeof m === "object") {
      (Array.isArray(m.autos) ? m.autos.slice(-PER_HOUR) : []).forEach(function (t) {
        if (at(t) && live.autos.indexOf(t) < 0) {
          live.autos.push(t);
        }
      });
      live.end = Math.max(live.end, at(m.end));
      live.fullAt = Math.max(live.fullAt, at(m.full));
    }
    live.autos = live.autos.filter(function (t) {
      return now - t < HOUR;
    }).sort(function (a, b) {
      return a - b;
    });
    if (write) {
      try {
        window.localStorage.setItem(MEMO, JSON.stringify({ autos: live.autos.slice(-PER_HOUR), end: live.end, full: live.fullAt }));
      } catch (e) {
        // Stockage plein ou refusé : limites de cette page seulement.
      }
    }
  };
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
    live = { on: true, wanted: false, first: 0, last: 0, what: "", hold: "", plan: 0, due: 0, end: 0, okAt: 0, autos: [], fullAt: 0, later: false, paused: false, pauseWhy: "", fails: 0, foldPlan: 0 };
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
  // Ce que dit le badge pendant une lecture (synchro ou cotes).
  var busy = "synchro en cours…";
  // Sous les boutons, déplié : ce que fait « Mettre à jour les cotes » (règles du jeu, SPEC.md).
  var mnote = document.createElement("div");
  mnote.style.cssText = "margin-top:8px;font-size:11.5px;line-height:1.35;color:#98a29d";
  mnote.textContent = "Cotes : lecture directe de la base du jeu avec ta session, à ton clic seulement (1 requête/s, 30 au plus), sans passer par les pages du marché, qui limitent les outils. Plus risqué qu'une synchro : avec modération.";
  // Encart réduit en badge (true) ou déplié.
  var fold = function (yes) {
    folded = yes;
    live.foldPlan += 1;
    title.style.display = yes ? "none" : "";
    text.style.display = yes ? "none" : "";
    extra.style.display = yes ? "none" : "";
    menu.style.display = yes ? "none" : "";
    mnote.style.display = yes ? "none" : "";
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
      s = busy;
    } else if (live.paused) {
      s = live.pauseWhy || "synchro automatique en pause : clique « Synchroniser »";
    } else if (live.wanted) {
      s = (live.later ? "relecture complète" : "synchro") + (live.due - Date.now() > AFTER_MAX ? " à " + hhmm(live.due) : " dans un instant") + " (" + live.what + (live.hold ? " ; " + live.hold : "") + ")";
    } else if (live.okAt) {
      s = "dernière synchro à " + hhmm(live.okAt);
    }
    status.textContent = "Classeur relié · " + s;
    keep();
  };
  // Heure de la prochaine synchro automatique (live.hold : ce qui la retient), limites de toutes les pages comprises.
  var when = function () {
    share(false);
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
    return at;
  };
  // Prochaine synchro automatique, si une action l'attend (et ni pause ni synchro en cours : sa fin rappelle schedule).
  var schedule = function () {
    if (!live || !live.on || !live.wanted || live.paused || window.__classeurFavori) {
      badge();
      return;
    }
    var at = when();
    live.due = at;
    live.plan += 1;
    var id = live.plan;
    setTimeout(function () {
      if (live.on && id === live.plan && live.wanted && !live.paused && !window.__classeurFavori) {
        // Une autre page du jeu a pu synchroniser entre-temps : l'heure est recalculée avant de lire quoi que ce soit.
        if (when() > Date.now()) {
          schedule();
          return;
        }
        live.autos.push(Date.now());
        start(run, true);
      }
    }, Math.max(0, at - Date.now()));
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
  // Une synchro couvre les actions d'avant son début. Une erreur qui arrête tout (session, limite de lectures du jeu,
  // favori périmé, quota du jour du classeur), ou trois de suite (classeur injoignable…), met les synchros automatiques
  // en pause jusqu'à un « Synchroniser » réussi ; seule une synchro réussie remet le compte des échecs à zéro (pas une
  // relecture complète reportée). Après « Arrêter », plus rien : ni message, ni pause, ni synchro suivante.
  var start = function (task, auto) {
    var sync = task === run;
    busy = task === market ? "lecture des cotes…" : "synchro en cours…";
    window.__classeurFavori = true;
    if (live && sync) {
      live.wanted = false;
      live.later = false;
      live.plan += 1;
      // Synchro en cours : les autres pages du jeu attendent aussi la minute.
      live.end = Math.max(live.end, Date.now());
      share(true);
    }
    badge();
    task(auto).then(function (res) {
      if (!live || halted) {
        return;
      }
      if (sync) {
        if (res && res.later) {
          live.later = true;
          live.wanted = true;
          live.first = Date.now();
          live.last = live.first;
          return;
        }
        live.fails = 0;
        live.okAt = Date.now();
        live.paused = false;
        live.pauseWhy = "";
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
      if (halted) {
        return;
      }
      var message = e && e.message ? e.message : "Le favori n'a pas pu lire ta collection.";
      if (live && sync) {
        live.fails += 1;
        var code = e ? e.status : undefined;
        if (auto && ((e && (e.stop || e.status === 401 || e.status === 403)) || code === 503 || live.fails >= 3)) {
          live.paused = true;
          var hint = " Synchros automatiques en pause : « Synchroniser » les relance.";
          if (e && (e.down || code >= 500)) {
            live.pauseWhy = "le classeur ne répond pas, synchros automatiques en pause : clique « Synchroniser »";
          } else if (code === 401 || code === 403) {
            live.pauseWhy = (code === 403 ? "refusé par le classeur" : START === "load" ? "script périmé" : "favori périmé") + ", synchros automatiques en pause";
            hint = " Synchros automatiques en pause.";
          } else {
            live.pauseWhy = "";
          }
          message += hint;
        }
      }
      say(message);
      if (live) {
        fold(false);
      }
    }).finally(function () {
      window.__classeurFavori = false;
      if (live && !halted) {
        if (sync) {
          live.end = Date.now();
          share(true);
        }
        schedule();
      }
    });
  };
  var stopLive = function () {
    halted = true;
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
    }), button("Mettre à jour les cotes", function () {
      if (!window.__classeurFavori) {
        start(market, false);
      }
    }), foldBtn, button("Arrêter", stopLive), mnote);
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
    // La question et les deux choix restent dans menu (une synchro automatique ne les efface pas) jusqu'au choix.
    var ask = document.createElement("div");
    ask.textContent = "Collection globale : que veux-tu faire ?";
    menu.appendChild(ask);
    var choice = function (caption, task) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = caption;
      b.style.cssText = "display:block;width:100%;margin-top:8px;padding:7px 10px;border-radius:8px;border:1px solid #2e3431;background:#1b1f1d;color:#f2f4f3;font:inherit;text-align:left;cursor:pointer";
      b.addEventListener("click", function () {
        if (!window.__classeurFavori) {
          menu.textContent = "";
          start(task, false);
        }
      });
      menu.appendChild(b);
    };
    choice("Mettre à jour mon classeur", run);
    choice(shown.q && shown.sure ? "Créer une collection avec cette recherche (« " + label + " »)" : "Créer une collection avec une recherche…", createFromSearch);
  } else {
    start(run, false);
  }
})();
