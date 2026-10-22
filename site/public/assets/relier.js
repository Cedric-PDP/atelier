// Favori « Relier » du classeur : servi par /api/favori.js (qui y écrit l'adresse du classeur à la place du repère de SITE), exécuté dans
// la page du jeu (wiki-masters.com), dans une fenêtre privée où le membre est connecté.
// Il lit le jeton posé par le favori (window.__classeurLien = {t}) et le cookie de session de la page, les envoie au
// classeur (POST /api/link/session), puis affiche le résultat dans un encart. Il ne lit rien d'autre et n'écrit rien
// dans le jeu. Le classeur vérifie la session auprès du jeu avant de la garder.
(function () {
  "use strict";
  var SITE = "__SITE__";
  var lien = window.__classeurLien;
  try { delete window.__classeurLien; } catch (e) { window.__classeurLien = undefined; }

  var box = null;
  function say(text, ok) {
    if (!box) {
      box = document.createElement("div");
      box.setAttribute("style", "position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:340px;padding:12px 14px;" +
        "border-radius:8px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.4)");
      document.documentElement.appendChild(box);
    }
    box.style.background = ok ? "#14532d" : "#7f1d1d";
    box.style.color = "#fff";
    box.textContent = "";
    var p = document.createElement("span");
    p.textContent = text;
    var b = document.createElement("button");
    b.textContent = "Fermer";
    b.setAttribute("style", "display:block;margin-top:8px;padding:2px 10px;cursor:pointer");
    b.onclick = function () { if (box.parentNode) box.parentNode.removeChild(box); box = null; };
    box.appendChild(p);
    box.appendChild(b);
  }

  var host = location.hostname;
  if (host !== "wiki-masters.com" && host !== "www.wiki-masters.com") {
    say("Ouvre ce favori sur wiki-masters.com, dans une fenêtre privée où tu es connecté.", false);
    return;
  }
  if (!lien || typeof lien.t !== "string") {
    say("Lien de liaison manquant : refais « Relier mon compte » dans le classeur, puis reclique le favori.", false);
    return;
  }
  var cookie = String(document.cookie || "");
  var found = cookie.split(";").some(function (part) {
    return /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(part.split("=")[0].trim());
  });
  if (!found) {
    say("Pas de session du jeu dans cette page : connecte-toi au jeu (dans cette fenêtre privée), puis reclique le favori.", false);
    return;
  }

  say("Liaison en cours…", true);
  fetch(SITE + "/api/link/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: lien.t, cookie: cookie }),
    credentials: "omit",
    mode: "cors"
  }).then(function (res) {
    return res.json().then(function (data) { return { ok: res.ok, data: data || {} }; }, function () { return { ok: res.ok, data: {} }; });
  }).then(function (r) {
    if (r.ok && r.data.ok) {
      say("Compte du jeu relié" + (r.data.pseudo ? " (" + r.data.pseudo + ")" : "") + ". Tu peux fermer cette fenêtre privée sans te déconnecter.", true);
    } else {
      say(r.data.error || "Le classeur a refusé la liaison.", false);
    }
  }, function () {
    say("Le classeur ne répond pas.", false);
  });
})();
