// Petits outils : aléatoire, hachage, base64, nettoyage de texte.

const encoder = new TextEncoder();

export function nowIso() {
  return new Date().toISOString();
}

export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function base64ToBytes(text) {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function base64url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Identifiant ou clé aléatoire, en base64url (n octets).
export function randomToken(n) {
  return base64url(crypto.getRandomValues(new Uint8Array(n)));
}

export async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

export async function sha256Hex(text) {
  return [...(await sha256(text))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Comparaison à temps constant : on compare les empreintes, de même longueur quelle que soit l'entrée.
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Texte nettoyé : espaces (y compris insécables et retours) réduits à un seul, bords retirés ; forme NFC seulement
// si le texte contient un signe combinant (accent séparé de sa lettre) ou des jamos coréens, seuls cas où NFC change
// quelque chose en pratique : normalize coûte cher sur de longues listes, ASCII et lettres accentuées précomposées
// (« é ») passent sans. Le remplacement des espaces n'est fait que s'il y a quelque chose à changer (deux espaces,
// espace au bord, ou autre blanc qu'une espace simple). Longueurs en .length.
const NEEDS_NFC = /[\p{M}ᄀ-ᇿ]/u;
const NEEDS_SPACES = /\s\s|^\s|\s$|[^\S ]/;

export function cleanText(value) {
  let text = String(value);
  if (NEEDS_NFC.test(text)) text = text.normalize('NFC');
  return NEEDS_SPACES.test(text) ? text.replace(/\s+/g, ' ').trim() : text;
}

export function byteLength(text) {
  return encoder.encode(text).length;
}

export function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
