// Illustrations des cartes possédées. Une page claude.ai ne charge aucune image extérieure : on télécharge la
// vignette Wikimedia de chaque carte (adresse donnée par le jeu), on la réduit en WebP (scripts/thumbs.py,
// Pillow) et on les regroupe en paquets JSON publiés à côté de la page (dist/img/b<k>.json : {titre: data URI}).
// Usage : node scripts/images.js   (reprend où il en était ; cache/img_src = originaux, cache/img = WebP)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const UA = 'WikiMastersCollections/0.1 (outil personnel de suivi de collection, faible volume)';
const SRC = path.join(ROOT, 'cache', 'img_src');
const OUT = path.join(ROOT, 'cache', 'img');
const DIST = path.join(ROOT, 'dist', 'img');
const BUNDLE_MAX = 4 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Une image d'origine (pas une vignette) : on demande la vignette de 330 px, PNG pour un SVG.
function thumbUrl(u) {
  if (/\/thumb\//.test(u)) return u;
  const m = u.match(/^(https:\/\/[a-z]+\.wikimedia\.org\/wikipedia\/[^/]+)\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+)$/);
  if (!m) return u;
  const file = m[3];
  return `${m[1]}/thumb/${m[2]}/${file}/330px-${file}${/\.svg$/i.test(file) ? '.png' : ''}`;
}

async function download(url, dest) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try { res = await fetch(url, { headers: { 'User-Agent': UA } }); } catch (e) { await sleep(5000); continue; }
    if (res.status === 429 || res.status >= 500) { await sleep(((Number(res.headers.get('retry-after')) || 10) + 1) * 1000); continue; }
    if (!res.ok) return res.status;
    const type = res.headers.get('content-type') || '';
    if (!/^image\//.test(type)) return 'type ' + type;
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return 200;
  }
  return 'abandon';
}

async function main() {
  const owned = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'owned.json'), 'utf8'));
  fs.mkdirSync(SRC, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const items = owned.cards.filter((c) => c.img).map((c) => {
    const key = crypto.createHash('sha1').update(c.img).digest('hex').slice(0, 16);
    return { t: c.t, url: c.img, key, src: path.join(SRC, key), out: path.join(OUT, key + '.webp') };
  });
  console.log(`${items.length} cartes illustrées`);

  // 1. Téléchargement (une requête toutes les 0,4 s, attente demandée en cas de refus).
  let n = 0, failed = 0;
  for (const it of items) {
    if (fs.existsSync(it.src) || fs.existsSync(it.out)) continue;
    let st = await download(thumbUrl(it.url), it.src);
    if (st !== 200 && thumbUrl(it.url) !== it.url) st = await download(it.url, it.src);
    if (st !== 200) { failed++; console.log(`échec ${st} : ${it.t}`); }
    if (++n % 50 === 0) console.log(`téléchargées ${n}`);
    await sleep(400);
  }

  // 2. Réduction en WebP (Python -E -P : ni variables PYTHON*, ni dossier du script ou courant dans le chemin des modules ; Pillow vient du site utilisateur).
  const jobs = items.filter((it) => fs.existsSync(it.src) && !fs.existsSync(it.out)).map((it) => [it.src, it.out]);
  if (jobs.length) {
    const jobFile = path.join(ROOT, 'cache', 'img_jobs.json');
    fs.writeFileSync(jobFile, JSON.stringify(jobs));
    console.log(execFileSync('python', ['-E', '-P', path.join(__dirname, 'thumbs.py'), jobFile], { encoding: 'utf8' }).trim());
  }

  // 3. Paquets JSON pour la page.
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  const bundles = [{}];
  let size = 0, total = 0, count = 0;
  for (const it of items) {
    if (!fs.existsSync(it.out)) continue;
    const uri = 'data:image/webp;base64,' + fs.readFileSync(it.out).toString('base64');
    if (size + uri.length > BUNDLE_MAX && Object.keys(bundles[bundles.length - 1]).length) { bundles.push({}); size = 0; }
    bundles[bundles.length - 1][it.t] = uri;
    size += uri.length; total += uri.length; count++;
  }
  bundles.forEach((b, k) => fs.writeFileSync(path.join(DIST, `b${k}.json`), JSON.stringify(b)));
  fs.writeFileSync(path.join(DIST, 'index.json'), JSON.stringify({ bundles: bundles.length, images: count }));
  console.log(`${count} illustrations en ${bundles.length} paquets, ${(total / 1048576).toFixed(1)} Mo ; ${failed} échecs`);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
