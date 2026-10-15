// Favori du classeur, à cliquer sur wiki-masters.com (avec ou sans www) quand tu y es connecté.
// Il lit ta collection avec les mêmes requêtes que la page « Collection » du jeu (lecture seule : rien n'est écrit
// dans le jeu), regroupe les exemplaires par carte, puis envoie les cartes à ton classeur par morceaux de 500.
// L'interface remplace "__SITE__" et "__KEY__" par l'adresse du classeur et la clé d'import du favori (jamais la clé
// principale : elle ne permet que d'envoyer des cartes), puis met ce fichier sur une ligne : chaque instruction finit
// donc par un point-virgule et les commentaires restent sur des lignes à part.
(function () {
  var SITE = "__SITE__";
  var KEY = "__KEY__";
  var BOX_ID = "classeur-favori";
  var PART = 500;
  if (window.__classeurFavori) {
    return;
  }
  var old = document.getElementById(BOX_ID);
  if (old) {
    old.remove();
  }
  var box = document.createElement("div");
  box.id = BOX_ID;
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");
  box.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;width:min(340px,calc(100vw - 32px));padding:14px 16px;border-radius:12px;background:#231a15;color:#f3e7d6;font:14px/1.45 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.45);border:1px solid #46382e";
  var title = document.createElement("div");
  title.textContent = "Le classeur";
  title.style.cssText = "font-weight:700;margin-bottom:4px";
  var text = document.createElement("div");
  var extra = document.createElement("div");
  var close = document.createElement("button");
  close.type = "button";
  close.textContent = "Fermer";
  close.style.cssText = "margin-top:10px;padding:4px 10px;border-radius:7px;border:1px solid #46382e;background:#2e231c;color:#f3e7d6;font:inherit;font-size:12.5px;cursor:pointer";
  close.onclick = function () {
    box.remove();
  };
  box.append(title, text, extra, close);
  document.body.appendChild(box);
  var say = function (message, withLink) {
    text.textContent = message;
    extra.textContent = "";
    if (withLink) {
      var a = document.createElement("a");
      a.href = SITE + "/";
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "Ouvrir le classeur";
      a.style.cssText = "display:inline-block;margin-top:8px;color:#edba78;font-weight:600";
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
    say("Ouvre wiki-masters.com et connecte-toi, puis clique à nouveau ce favori.");
    return;
  }
  // Lecture d'une adresse de l'API du jeu, avec la session du navigateur (même origine).
  var read = async function (path) {
    var r = await fetch(path, { credentials: "include", headers: { Accept: "application/json" } });
    if (r.status === 401 || r.status === 403) {
      throw new Error("Connecte-toi à WikiMasters, puis clique à nouveau ce favori.");
    }
    if (!r.ok) {
      throw new Error("WikiMasters a répondu " + r.status + " : réessaie dans un moment.");
    }
    return r.json();
  };
  var web = function (v) {
    return typeof v === "string" && v.length <= 2000 && /^https?:\/\//i.test(v) ? v : null;
  };
  // Exemplaires -> cartes (CarteImport) : un objet par card_id, sans user_id ni étiquettes du jeu. Un exemplaire vu
  // deux fois (même entry.id) ne compte qu'une fois ; les entrées inexploitables sont comptées à part.
  var group = function (entries) {
    var byId = {};
    var seen = {};
    var bad = {};
    var list = [];
    entries.forEach(function (e, i) {
      if (e && e.id !== undefined && e.id !== null) {
        if (seen[e.id]) {
          return;
        }
        seen[e.id] = true;
      }
      var c = e && e.card;
      var id = e && (e.card_id || (c && c.id));
      var title = c && c.wikipedia_title;
      var longCat = c && typeof c.category === "string" && c.category.length > 500;
      if (!c || !id || typeof title !== "string" || !title || title.length > 500 || longCat || ["C", "PC", "R", "SR", "UR", "L"].indexOf(c.rarity) < 0) {
        bad[id ? "c" + id : "e" + i] = true;
        return;
      }
      id = String(id);
      var n = Math.trunc(Number(e.count)) || 1;
      var card = byId[id];
      if (!card) {
        card = { id: id, title: c.wikipedia_title, rarity: c.rarity, atk: typeof c.atk === "number" ? c.atk : null, def: typeof c.def === "number" ? c.def : null, quality: typeof c.q_score === "number" ? c.q_score : null, pageviews: typeof c.pageviews === "number" ? c.pageviews : null, category: typeof c.category === "string" && c.category ? c.category : null, image: c.hide_image ? null : web(c.image_url), url: web(c.wikipedia_url), count: 0, shiny: false, starred: false, obtained_at: null };
        byId[id] = card;
        list.push(card);
      }
      card.count += n > 0 ? n : 1;
      card.shiny = card.shiny || !!e.is_shiny;
      card.starred = card.starred || !!e.starred;
      if (typeof e.obtained_at === "string" && (!card.obtained_at || e.obtained_at < card.obtained_at)) {
        card.obtained_at = e.obtained_at;
      }
    });
    return { list: list, ignored: Object.keys(bad).length };
  };
  var send = async function (body) {
    var r = await fetch(SITE + "/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Classeur-Key": KEY },
      body: JSON.stringify(body)
    });
    var res = await r.json().catch(function () {
      return {};
    });
    if (!r.ok) {
      throw new Error((res && res.error) || "Le classeur a répondu " + r.status + ".");
    }
    return res;
  };
  var run = async function () {
    say("Lecture de ta collection…");
    var stats = await read("/api/my-collection/stats?sort=rarity");
    var entries = [];
    for (var page = 0; page < 2000; page++) {
      var data = await read("/api/my-collection?sort=rarity&page=" + page + "&stats=0");
      var list = Array.isArray(data.collection) ? data.collection : [];
      entries = entries.concat(list);
      say("Lecture de ta collection… " + num(entries.length) + (stats && stats.total ? " sur " + num(stats.total) : "") + " exemplaires");
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
      }
      res = await send(body);
    }
    var fresh = Array.isArray(res.new_ids) ? res.new_ids.length : 0;
    var message = num(res.count) + " cartes envoyées au classeur, " + num(fresh) + (fresh > 1 ? " nouvelles." : " nouvelle.");
    var ignored = grouped.ignored + (Number(res.skipped) || 0);
    if (ignored > 0) {
      message += " " + num(ignored) + (ignored > 1 ? " cartes ignorées" : " carte ignorée") + " (sans titre ou rareté inconnue).";
    }
    if (res.complete === false) {
      message += " Il en manque par rapport au total du jeu : relance le favori dans un moment.";
    }
    say(message, true);
  };
  window.__classeurFavori = true;
  run().catch(function (e) {
    say(e && e.message ? e.message : "Le favori n'a pas pu lire ta collection.");
  }).finally(function () {
    window.__classeurFavori = false;
  });
})();
