// Small Markdown renderer for REPONSE.md (branch pc-perso) on the « Nouvelles » page of the personal-PC site.
// Covers what REPONSE.md uses: headings, paragraphs, lists (nested by indentation), bold, italic, inline code, links,
// bare URLs, simple tables, block quotes, rules. Everything else is shown as text: all input is escaped, and a link
// is kept only if it is http(s), mailto, an anchor or a relative path.
// Relative links are written from the root of the pc-perso branch: `interface/<x>` becomes the site page `<x>`, any
// other path the file on GitHub (https://github.com/Cedric-PDP/spam-atelier/blob/pc-perso/<path>).
const { esc } = require('./nav.js');

const GITHUB_BLOB = 'https://github.com/Cedric-PDP/spam-atelier/blob/pc-perso/';

function linkTarget(u) {
  u = String(u).trim();
  if (/^(https?:|mailto:)/i.test(u)) return { href: u, external: true };
  if (u.startsWith('#')) return { href: u };
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//')) return null;
  const i = u.indexOf('#'), hash = i < 0 ? '' : u.slice(i), p = (i < 0 ? u : u.slice(0, i)).replace(/^(\.\/|\/)+/, '');
  if (p.startsWith('interface/')) return { href: p.slice('interface/'.length) + hash };
  return { href: GITHUB_BLOB + p.split('/').map(encodeURIComponent).join('/') + hash, external: true };
}
const linkHtml = (u, inner) => {
  const t = linkTarget(u);
  if (!t) return inner;
  return `<a href="${esc(t.href)}"${t.external ? ' target="_blank" rel="noopener"' : ''}>${inner}</a>`;
};

// Inline: `code`, [text](url), bare URL, **bold**, *italic* or _italic_. The leftmost match wins.
const INLINE = /`([^`]+)`|\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"»])|\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?![\s*])(.+?)(?<!\s)\*(?![\w*])|(?<![\w_])_(?![\s_])(.+?)(?<!\s)_(?![\w_])/g;
function inline(s) {
  let out = '', last = 0, m;
  const re = new RegExp(INLINE.source, 'g');
  while ((m = re.exec(s))) {
    out += esc(s.slice(last, m.index));
    if (m[1] != null) out += `<code>${esc(m[1])}</code>`;
    else if (m[2] != null) out += linkHtml(m[3], inline(m[2]));
    else if (m[4] != null) out += linkHtml(m[4], esc(m[4]));
    else if (m[5] != null || m[6] != null) out += `<strong>${inline(m[5] != null ? m[5] : m[6])}</strong>`;
    else out += `<em>${inline(m[7] != null ? m[7] : m[8])}</em>`;
    last = re.lastIndex;
  }
  return out + esc(s.slice(last));
}

const plain = s => String(s).replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_]+/g, '');
const slug = s => plain(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';

// Blocks: {type:'h', level, text, id} | {type:'p', text} | {type:'list', ordered, items:[{text, sub:[lists]}]} |
// {type:'table', head:[], rows:[[]]} | {type:'quote', text} | {type:'hr'}
function parse(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const blocks = [], ids = new Map();
  const uniq = s => { const b = slug(s), n = (ids.get(b) || 0) + 1; ids.set(b, n); return n > 1 ? `${b}-${n}` : b; };
  const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const isTableSep = l => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l);
  const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  let i = 0;
  const startsBlock = l => /^#{1,6}\s/.test(l) || ITEM.test(l) || /^\s*>/.test(l) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l) ||
    (/^\s*\|/.test(l));
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l))) { blocks.push({ type: 'h', level: m[1].length, text: m[2], id: uniq(m[2]) }); i++; continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { blocks.push({ type: 'hr' }); i++; continue; }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(l), rows = []; i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push({ type: 'table', head, rows }); continue;
    }
    if (/^\s*>/.test(l)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', text: q.join(' ') }); continue;
    }
    if (ITEM.test(l)) {
      // A list and its nested lists: a deeper indentation opens a sub-list in the current item.
      const root = { indent: ITEM.exec(l)[1].length, ordered: /\d/.test(ITEM.exec(l)[2]), items: [] }, stack = [root];
      while (i < lines.length) {
        const x = lines[i];
        if (!x.trim()) {
          // A blank line ends the list unless the next line is still an item or an indented continuation.
          const nx = lines[i + 1];
          const nm = nx == null ? null : ITEM.exec(nx);
          if (nx != null && (nm ? nm[1].length > root.indent || /\d/.test(nm[2]) === root.ordered : /^\s{2,}\S/.test(nx))) { i++; continue; }
          break;
        }
        const im = ITEM.exec(x);
        if (im) {
          const ind = im[1].length;
          while (stack.length > 1 && ind < stack[stack.length - 1].indent) stack.pop();
          let cur = stack[stack.length - 1];
          if (ind > cur.indent && cur.items.length) {
            const sub = { indent: ind, ordered: /\d/.test(im[2]), items: [] };
            cur.items[cur.items.length - 1].sub.push(sub); stack.push(sub); cur = sub;
          } else if (ind < root.indent || (cur === root && /\d/.test(im[2]) !== root.ordered)) break;
          cur.items.push({ text: im[3], sub: [] }); i++; continue;
        }
        if (startsBlock(x) && !/^\s{2,}/.test(x)) break;
        // Continuation of the current item's text.
        const cur = stack[stack.length - 1]; cur.items[cur.items.length - 1].text += ' ' + x.trim(); i++;
      }
      blocks.push({ type: 'list', ordered: root.ordered, items: root.items }); continue;
    }
    const p = [l.trim()]; i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) p.push(lines[i++].trim());
    blocks.push({ type: 'p', text: p.join(' ') });
  }
  return blocks;
}

function listHtml(l) {
  const tag = l.ordered ? 'ol' : 'ul';
  return `<${tag}>${l.items.map(it => `<li>${inline(it.text)}${it.sub.map(listHtml).join('')}</li>`).join('')}</${tag}>`;
}
function render(blocks) {
  return blocks.map(b => {
    if (b.type === 'h') { const n = Math.min(6, b.level); return `<h${n} id="${esc(b.id)}">${inline(b.text)}</h${n}>`; }
    if (b.type === 'p') return `<p>${inline(b.text)}</p>`;
    if (b.type === 'list') return listHtml(b);
    if (b.type === 'quote') return `<blockquote><p>${inline(b.text)}</p></blockquote>`;
    if (b.type === 'hr') return '<hr>';
    if (b.type === 'table') return `<div class="scroll-x"><table><thead><tr>${b.head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${b.head.map((_, k) => `<td>${inline(r[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    return '';
  }).join('\n');
}

module.exports = { parse, render, inline, linkTarget, plain, slug };
