// Accès réseau sobre aux API Wikimedia : une requête à la fois, une pause entre deux,
// et une attente croissante si le serveur répond 429 (trop de requêtes) ou 5xx.
const UA = 'WikiMastersCollections/0.1 (outil personnel de suivi de collection, faible volume)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let last = 0;
async function getJson(url, { gap = 1100, accept = 'application/json' } = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = last + gap - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept } });
    } catch (e) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const retry = Number(res.headers.get('retry-after')) || 0;
      await sleep(Math.max(retry * 1000, 5000 * 2 ** attempt));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url.slice(0, 120)} : ${text.slice(0, 200)}`);
    return JSON.parse(text);
  }
  throw new Error(`abandon après plusieurs refus : ${url.slice(0, 120)}`);
}

async function sparql(query) {
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query);
  const j = await getJson(url, { gap: 1500, accept: 'application/sparql-results+json' });
  return j.results.bindings;
}

async function wikiApi(params) {
  const url = 'https://fr.wikipedia.org/w/api.php?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  return getJson(url);
}

const qid = (uri) => uri.slice(uri.lastIndexOf('/') + 1);
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

module.exports = { getJson, sparql, wikiApi, qid, chunks, sleep };
