// Minimal JS re-indenter for minified code (built-ins only).
// Tokenizes (strings, template literals with nested ${}, regex, comments), then re-emits with
// newlines after ; { } at statement level, after statement-level commas, and expands long object/array literals.
// Usage: node fmt.js <in.js> <out.js>
'use strict';
const fs = require('fs');
const [inFile, outFile] = process.argv.slice(2);
const src = fs.readFileSync(inFile, 'utf8');
const N = src.length;
const KW_BEFORE_RE = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const PUNCTS = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**'];
const isIdStart = c => /[A-Za-z_$\u0080-￿\\]/.test(c);
const isIdPart = c => /[A-Za-z0-9_$\u0080-￿\\]/.test(c);
const isDigit = c => c >= '0' && c <= '9';

function skipString(p) {
  const q = src[p]; p++;
  while (p < N) { const c = src[p]; if (c === '\\') { p += 2; continue; } if (c === q) return p + 1; p++; }
  throw new Error('unterminated string');
}
function skipRegex(p) {
  p++; let cls = false;
  while (p < N) {
    const c = src[p];
    if (c === '\\') { p += 2; continue; }
    if (cls) { if (c === ']') cls = false; }
    else if (c === '[') cls = true;
    else if (c === '/') { p++; while (p < N && /[a-z]/i.test(src[p])) p++; return p; }
    p++;
  }
  throw new Error('unterminated regex');
}
function skipTemplate(p) {
  p++;
  while (p < N) {
    const c = src[p];
    if (c === '\\') { p += 2; continue; }
    if (c === '`') return p + 1;
    if (c === '$' && src[p + 1] === '{') { p = skipCodeBraces(p + 2); continue; }
    p++;
  }
  throw new Error('unterminated template');
}
// scan code inside ${ ... } until the matching }
function skipCodeBraces(p) {
  let depth = 1; let prevSig = '(';
  while (p < N) {
    const c = src[p];
    if (c === '"' || c === "'") { p = skipString(p); prevSig = 'a'; continue; }
    if (c === '`') { p = skipTemplate(p); prevSig = 'a'; continue; }
    if (c === '/' && src[p + 1] === '*') { p = src.indexOf('*/', p + 2) + 2; continue; }
    if (c === '/' && src[p + 1] === '/') { p = src.indexOf('\n', p); continue; }
    if (c === '/') { if (/[A-Za-z0-9_$)\]}]/.test(prevSig)) { p++; prevSig = '/'; continue; } p = skipRegex(p); prevSig = 'a'; continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) return p + 1; }
    if (!/\s/.test(c)) prevSig = c;
    p++;
  }
  throw new Error('unterminated ${');
}

const toks = []; let p = 0; let sp = false;
function lastSig() { for (let k = toks.length - 1; k >= 0; k--) if (toks[k].t !== 'com') return toks[k]; return null; }
while (p < N) {
  const c = src[p];
  if (/\s/.test(c)) { sp = true; p++; continue; }
  const s = p; let t;
  if (c === '/' && src[p + 1] === '*') { p = src.indexOf('*/', p + 2) + 2; t = 'com'; }
  else if (c === '/' && src[p + 1] === '/') { p = src.indexOf('\n', p); if (p < 0) p = N; t = 'com'; }
  else if (c === '"' || c === "'") { p = skipString(p); t = 'str'; }
  else if (c === '`') { p = skipTemplate(p); t = 'tpl'; }
  else if (isDigit(c) || (c === '.' && isDigit(src[p + 1]))) {
    if (c === '0' && /[xXoObB]/.test(src[p + 1])) { p += 2; while (p < N && /[0-9a-fA-F_n]/.test(src[p])) p++; }
    else {
      while (p < N && /[0-9_]/.test(src[p])) p++;
      if (src[p] === '.') { p++; while (p < N && /[0-9_]/.test(src[p])) p++; }
      if (/[eE]/.test(src[p])) { p++; if (/[+-]/.test(src[p])) p++; while (p < N && isDigit(src[p])) p++; }
      if (src[p] === 'n') p++;
    }
    t = 'num';
  }
  else if (isIdStart(c)) { while (p < N && isIdPart(src[p])) p++; t = 'id'; }
  else if (c === '/') {
    const ls = lastSig(); let re = true;
    if (ls) {
      if (ls.t === 'id') re = KW_BEFORE_RE.has(ls.v);
      else if (ls.t === 'num' || ls.t === 'str' || ls.t === 'tpl' || ls.t === 're') re = false;
      else if (ls.t === 'punc' && (ls.v === ')' || ls.v === ']' || ls.v === '}')) re = false;
    }
    if (re) { p = skipRegex(p); t = 're'; } else { p += (src[p + 1] === '=' ? 2 : 1); t = 'punc'; }
  }
  else {
    let m = null;
    for (const q of PUNCTS) { if (src.startsWith(q, p)) { if (q === '?.' && isDigit(src[p + 2])) continue; m = q; break; } }
    p += m ? m.length : 1; t = 'punc';
  }
  toks.push({ t, v: src.slice(s, p), sp }); sp = false;
}

// bracket matching
const match = new Array(toks.length).fill(-1);
{
  const st = [];
  for (let k = 0; k < toks.length; k++) {
    const v = toks[k].t === 'punc' ? toks[k].v : null;
    if (v === '(' || v === '[' || v === '{') st.push(k);
    else if (v === ')' || v === ']' || v === '}') { const o = st.pop(); match[o] = k; match[k] = o; }
  }
  if (st.length) throw new Error('unbalanced ' + st.length);
}
const textLen = (a, b) => { let L = 0; for (let k = a; k <= b; k++) L += toks[k].v.length; return L; };
function prevSigIdx(k) { for (let j = k - 1; j >= 0; j--) if (toks[j].t !== 'com') return j; return -1; }
function classifyBrace(k) {
  const j = prevSigIdx(k); if (j < 0) return 'block'; const pt = toks[j];
  if (pt.t === 'punc') { if ([')', '=>', ';', '{', '}'].includes(pt.v)) return 'block'; return 'obj'; }
  if (pt.t === 'id') {
    if (['else', 'try', 'finally', 'do'].includes(pt.v)) return 'block';
    for (let q = j; q >= 0 && q >= j - 4; q--) { if (toks[q].t === 'id' && toks[q].v === 'class') return 'block'; }
    if (['return', 'case', 'typeof', 'in', 'of', 'yield', 'await', 'void', 'let', 'const', 'var'].includes(pt.v)) return 'obj';
    return 'block';
  }
  return 'obj';
}
function commaCount(a, b) {
  let c = 0;
  for (let k = a + 1; k < b; k++) {
    const v = toks[k];
    if (v.t === 'punc' && (v.v === '(' || v.v === '[' || v.v === '{')) { k = match[k]; continue; }
    if (v.t === 'punc' && v.v === ',') c++;
  }
  return c;
}

const lines = []; let cur = ''; let indent = 0; const frames = [];
const IND = '  ';
function nl() { if (cur.trim().length) lines.push(cur.replace(/\s+$/, '')); cur = IND.repeat(Math.max(indent, 0)); }
function emit(k) {
  const tk = toks[k];
  if (cur.trim().length && tk.sp) { cur += ' '; }
  else if (cur.trim().length) { const last = cur[cur.length - 1]; if (isIdPart(last) && isIdPart(tk.v[0])) cur += ' '; }
  cur += tk.v;
}
for (let k = 0; k < toks.length; k++) {
  const tk = toks[k]; const v = tk.t === 'punc' ? tk.v : null; const top = frames[frames.length - 1];
  if (v === '{') {
    const kind = classifyBrace(k); const m = match[k]; const empty = m === k + 1;
    let exp = false; if (!empty) { if (kind === 'block') exp = true; else exp = textLen(k, m) > 110 && commaCount(k, m) > 0; }
    emit(k); frames.push({ kind, exp, open: k }); if (exp) { indent++; nl(); }
    continue;
  }
  if (v === '}') {
    const f = frames.pop(); if (f.exp) { indent--; nl(); } emit(k);
    if (f.kind === 'block' && f.exp) { const nx = toks[k + 1]; if (nx && nx.t === 'id' && !['else', 'catch', 'finally'].includes(nx.v)) nl(); }
    continue;
  }
  if (v === '[') {
    const j = prevSigIdx(k); const pt = j >= 0 ? toks[j] : null;
    const member = pt && ((pt.t === 'id' && !KW_BEFORE_RE.has(pt.v)) || pt.t === 'str' || pt.t === 'num' || pt.t === 'tpl' || (pt.t === 'punc' && [')', ']', '}', '?.'].includes(pt.v)));
    const m = match[k]; const exp = !member && textLen(k, m) > 160 && commaCount(k, m) > 0;
    emit(k); frames.push({ kind: member ? 'member' : 'arr', exp, open: k }); if (exp) { indent++; nl(); }
    continue;
  }
  if (v === ']') { const f = frames.pop(); if (f.exp) { indent--; nl(); } emit(k); continue; }
  if (v === '(') { emit(k); frames.push({ kind: 'paren', exp: false, open: k }); continue; }
  if (v === ')') { frames.pop(); emit(k); continue; }
  if (v === ';') { emit(k); if (!top || top.kind === 'block') nl(); continue; }
  if (v === ',') { emit(k); if (!top || top.kind === 'block' || ((top.kind === 'obj' || top.kind === 'arr') && top.exp)) nl(); continue; }
  emit(k);
}
nl();
fs.writeFileSync(outFile, lines.join('\n') + '\n');
console.log('tokens', toks.length, 'lines', lines.length);
