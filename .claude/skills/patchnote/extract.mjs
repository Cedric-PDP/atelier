// Résumé lisible d'une session Claude Code, pour rédiger une patchnote : demandes de l'utilisateur, réponses de
// Claude (texte seulement), fichiers modifiés, commandes git de commit et de push, heures de début et de fin.
// Usage : node extract.mjs [<id de session> | <chemin .jsonl>] [--full]
//   sans argument : la session la plus récemment écrite des dossiers « spam-atelier » de ~/.claude/projects
//   (celle en cours, puisqu'elle écrit dans son transcript à chaque message) ;
//   --full : réponses de Claude en entier (sinon 1 500 caractères au plus chacune).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const full = args.includes('--full');
const target = args.find((a) => !a.startsWith('--'));
const root = path.join(os.homedir(), '.claude', 'projects');
const dirs = fs.readdirSync(root).filter((d) => d.includes('spam-atelier')).map((d) => path.join(root, d));

function findTranscript() {
  if (target && target.endsWith('.jsonl')) return target;
  if (target && !target.includes('${')) { // ${CLAUDE_SESSION_ID} non remplacé : on cherche la plus récente
    for (const d of dirs) { const f = path.join(d, target + '.jsonl'); if (fs.existsSync(f)) return f; }
    console.error(`Session ${target} introuvable dans ${dirs.join(', ')} : je prends la plus récente.`);
  }
  const all = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(d, f)));
  all.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return all[0];
}

const file = findTranscript();
if (!file) { console.error('Aucun transcript trouvé.'); process.exit(1); }
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
const clip = (s, n) => (full || s.length <= n ? s : s.slice(0, n) + ' […]');
const out = [];
const edited = new Set();
const gitCmds = [];
let first = null;
let last = null;

for (const line of lines) {
  let r;
  try { r = JSON.parse(line); } catch { continue; }
  if (r.isSidechain) continue; // sous-agents : leur travail revient dans les réponses de Claude
  if (r.timestamp) { first = first || r.timestamp; last = r.timestamp; }
  const c = r.message && r.message.content;
  if (r.type === 'user' && !r.isMeta) {
    const texts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text) : [];
    for (let t of texts) {
      // Commande avec arguments (/skill …) : seuls les arguments sont la demande.
      const argsM = t.match(/<command-args>([\s\S]*?)<\/command-args>/);
      const nameM = t.match(/<command-name>([\s\S]*?)<\/command-name>/);
      if (nameM) { if (!argsM || !argsM[1].trim()) continue; t = `${nameM[1].trim()} ${argsM[1].trim()}`; }
      if (/^\s*<(local-command|system-reminder|task-notification)/.test(t)) continue;
      if (/^\[SYSTEM NOTIFICATION/.test(t)) continue;
      out.push(`\n### UTILISATEUR (${r.timestamp})\n${t.trim()}`);
    }
  } else if (r.type === 'assistant' && Array.isArray(c)) {
    for (const b of c) {
      if (b.type === 'text' && b.text.trim()) out.push(`\n--- Claude ---\n${clip(b.text.trim(), 1500)}`);
      if (b.type === 'tool_use') {
        const i = b.input || {};
        if ((b.name === 'Edit' || b.name === 'Write' || b.name === 'NotebookEdit') && i.file_path) edited.add(i.file_path);
        if (b.name === 'Bash' && /\bgit\b[^|;&]*\b(commit|push|revert|reset|checkout --)\b/.test(i.command || '')) gitCmds.push(`${r.timestamp}  ${(i.command || '').split('\n')[0].slice(0, 300)}`);
      }
    }
  }
}

console.log(`# Session ${path.basename(file, '.jsonl')}`);
console.log(`Transcript : ${file}`);
console.log(`Du ${first} au ${last} (UTC)`);
console.log(`\n## Fichiers modifiés par Edit/Write (${edited.size})\n${[...edited].join('\n') || '(aucun)'}`);
console.log(`\n## Commandes git (commit, push, annulations)\n${gitCmds.join('\n') || '(aucune)'}`);
console.log('\n## Échanges');
console.log(out.join('\n'));
