import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toShortName } from './deckcode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'cards.json');

export const CARDS_API_URL =
  'https://marvelsnapzone.com/getinfo/?searchtype=cards&searchcardstype=true';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

let state = null; // { loadedAt, list, byId, byShort, byName, byNorm }

/* ---------- limpieza de texto (etiquetas Unity/HTML de marvelsnapzone) ---------- */

function stripTags(text = '') {
  return String(text)
    .replace(/<color=#[0-9a-fA-F]+>/gi, '')
    .replace(/<\/?color>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

const normKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

function normalizeCard(raw) {
  return {
    cid: raw.cid,
    carddefid: raw.carddefid,
    name: stripTags(raw.name),
    ability: stripTags(raw.ability),
    flavor: stripTags(raw.flavor),
    cost: raw.cost,
    power: raw.power,
    art: stripTags(raw.art),
    url: stripTags(raw.url),
    status: raw.status,
    series: stripTags(raw.source) || 'Desconocida',
    variants: Array.isArray(raw.variants) ? raw.variants : [],
  };
}

function buildState(list) {
  const byId = new Map();
  const byShort = new Map();
  const byName = new Map();
  const byNorm = new Map();
  for (const card of list) {
    byId.set(card.carddefid, card);
    byShort.set(toShortName(card.carddefid), card);
    const key = card.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(card);
    const nk = normKey(card.name);
    if (!byNorm.has(nk)) byNorm.set(nk, []);
    byNorm.get(nk).push(card);
  }
  return { loadedAt: Date.now(), list, byId, byShort, byName, byNorm };
}

async function fetchFromApi() {
  const res = await fetch(CARDS_API_URL, {
    headers: { 'User-Agent': 'marvel-snap-discord-bot/1.0 (+https://marvelsnapzone.com)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Error al consultar marvelsnapzone: HTTP ${res.status}`);
  const json = await res.json();
  const cards = json?.success?.cards;
  if (!Array.isArray(cards)) {
    throw new Error('Respuesta inesperada de marvelsnapzone (sin campo success.cards).');
  }
  return cards.map(normalizeCard);
}

/**
 * Carga la base de cartas (desde caché local o desde marvelsnapzone.com).
 * @param {{force?: boolean, ttlMs?: number}} options
 */
export async function loadCards({ force = false, ttlMs = DEFAULT_TTL_MS } = {}) {
  if (state && !force && Date.now() - state.loadedAt < ttlMs) return state;

  if (!force) {
    try {
      const cached = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
      if (cached?.fetchedAt && Date.now() - cached.fetchedAt < ttlMs && Array.isArray(cached.cards)) {
        state = buildState(cached.cards);
        return state;
      }
    } catch {
      /* sin caché o caché corrupta: se descarga */
    }
  }

  const list = await fetchFromApi();
  state = buildState(list);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify({ fetchedAt: Date.now(), cards: state.list }), 'utf8');
  return state;
}

export function getCardByCardDefId(cardDefId) {
  return state?.byId.get(cardDefId) ?? null;
}

export function getCardByShortName(shortName) {
  return state?.byShort.get(shortName) ?? null;
}

/**
 * Busca cartas por nombre (insensible a mayúsculas y puntuación).
 * Devuelve TODAS las coincidencias: exactas primero, luego por prefijo
 * y después parciales, alfabéticas dentro de cada grupo.
 * Ej.: "hulk" -> Hulk, Hulkbuster, Red Hulk, She-Hulk...
 */
export function searchCards(query, { limit = 10 } = {}) {
  if (!state) return [];
  const q = normKey(query);
  if (!q) return [];

  const scored = [];
  const seen = new Set();
  const exact = state.byNorm.get(q) ?? [];
  for (const c of exact) {
    scored.push({ c, score: 0 });
    seen.add(c.carddefid);
  }
  for (const card of state.list) {
    if (seen.has(card.carddefid)) continue;
    const nk = normKey(card.name);
    if (nk === q) {
      scored.push({ c: card, score: 0 });
    } else if (nk.startsWith(q)) {
      scored.push({ c: card, score: 1 });
    } else if (nk.includes(q)) {
      scored.push({ c: card, score: 2 });
    }
  }
  scored.sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name));
  return scored.slice(0, limit).map((s) => s.c);
}

/**
 * Resuelve los identificadores de un mazo contra la base de cartas.
 * @param {{type: 'long'|'short', identifiers: string[]}} decoded
 * @returns {{cards: object[], missing: string[]}}
 */
export function resolveDeckIdentifiers({ type, identifiers }) {
  const cards = [];
  const missing = [];
  for (const id of identifiers) {
    const card = type === 'long' ? getCardByCardDefId(id) : getCardByShortName(id);
    if (card) cards.push(card);
    else missing.push(id);
  }
  return { cards, missing };
}
