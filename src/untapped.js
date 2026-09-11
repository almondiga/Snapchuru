import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCards } from './cardData.js';
import { toShortName } from './deckcode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'data', 'untapped');
const TTL_MS = 12 * 60 * 60 * 1000; // 12 h

// Endpoints públicos que usa la web snap.untapped.gg (accesibles sin API key).
const DECKS_URL =
  'https://api.snap.untapped.gg/api/v1/analytics/query/decks_stats_by_pool_v4/free' +
  '?TimestampRangeFilter=EXACTLY_LAST_7_DAYS_NO_CURRENT_LOCATION';
const CARDS_URL = 'https://snapjson.untapped.gg/v2/56.4.6/en/cards.json';
const ARCH_URL = 'https://api.snap.untapped.gg/api/v1/analytics/query/archetypes_manifest_v3';
const ART_URL = (defId) =>
  `https://snapjson.untapped.gg/art/render/framebreak/common/256/${encodeURIComponent(defId)}.webp`;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Descarga JSON con reintentos (hasta 3) y timeout amplio para redes lentas. */
async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`untapped.gg HTTP ${res.status} en ${url}`);
    return await res.json();
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 800 * attempt));
      return fetchJson(url, attempt + 1);
    }
    throw err;
  }
}

/** Carga (o descarga si la caché está caducada) un JSON de untapped.gg. */
async function loadCached(key, url) {
  const file = path.join(CACHE_DIR, `${key}.json`);
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    if (raw?.fetchedAt && Date.now() - raw.fetchedAt < TTL_MS && raw.data !== undefined) {
      return raw.data;
    }
  } catch {
    /* sin caché o corrupta: descargar */
  }
  const data = await fetchJson(url);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify({ fetchedAt: Date.now(), data }), 'utf8');
  return data;
}

/**
 * Datos completos de untapped.gg: mazos (últimos 7 días), catálogo de cartas
 * y arquetipos. La caché dura 12 h y se refresca sola al volver a llamar.
 */
export async function getUntappedData() {
  const [decksRaw, cards, archetypesRaw] = await Promise.all([
    loadCached('decks', DECKS_URL),
    loadCached('cards', CARDS_URL),
    loadCached('archetypes', ARCH_URL),
  ]);
  const decks = Array.isArray(decksRaw) ? decksRaw : decksRaw?.data ?? [];
  const archetypes = archetypesRaw?.data ?? archetypesRaw ?? {};
  return { decks, cards: Array.isArray(cards) ? cards : [], archetypes };
}

/**
 * Agrega las estadísticas de un mazo (todas las ligas y rangos):
 * [partidas, victorias, cubos_medios] por tier -> totales ponderados.
 */
export function aggregateDeck(deck) {
  let games = 0;
  let wins = 0;
  let cubes = 0;
  let archId = null;
  for (const poolKey of Object.keys(deck)) {
    if (poolKey === 'd') continue;
    const pool = deck[poolKey];
    if (pool?.arch_id) archId = pool.arch_id;
    else if (!archId && pool?.alt_arch_id) archId = pool.alt_arch_id;
    for (const tier of Object.keys(pool)) {
      if (tier === 'arch_id' || tier === 'alt_arch_id') continue;
      const [g, w, c] = pool[tier];
      if (Number.isFinite(g) && Number.isFinite(w) && Number.isFinite(c) && g > 0) {
        games += g;
        wins += w;
        cubes += c * g;
      }
    }
  }
  return { archId, games, wins, cubes };
}

/**
 * Resuelve una carta de untapped (por defId) contra la base local de marvelsnapzone.
 * Si msz no está disponible o la carta no existe allí (cartas nuevas),
 * usa los datos de untapped y su arte como respaldo.
 */
function resolveSlot(defId, byDefId, msz) {
  const uc = byDefId.get(defId) ?? null;
  let card = msz?.byId.get(defId) ?? null;
  if (!card) card = msz?.byNorm.get(normKey(defId))?.[0] ?? null;
  if (!card && uc) {
    card = msz?.byNorm.get(normKey(uc.name))?.[0] ?? null;
    if (!card) card = msz?.byName.get(String(uc.name).toLowerCase())?.[0] ?? null;
  }

  if (card) {
    return {
      defId,
      name: card.name,
      cost: card.cost,
      power: card.power,
      art: card.art,
      series: card.series,
      msz: true,
    };
  }
  if (uc) {
    return {
      defId,
      name: String(uc.name).replace(/<[^>]*>/g, '').trim(),
      cost: uc.cost,
      power: uc.power,
      art: ART_URL(defId),
      series: uc.series ? `Serie ${uc.series}` : 'Desconocida',
      msz: false,
    };
  }
  return { defId, name: defId, cost: null, power: null, art: null, series: 'Desconocida', msz: false };
}

/**
 * Mazos populares: el mazo con más partidas de cada arquetipo, ordenados
 * por partidas. Cada mazo trae sus 12 cartas resueltas y sus estadísticas.
 */
export async function buildPopularDecks({ limit = 10, minGames = 200 } = {}) {
  const { decks, cards, archetypes } = await getUntappedData();
  // marvelsnapzone es solo un extra de resolución (arte/estilo): si no responde
  // (p. ej. Cloudflare en datacenters), /mazos sigue funcionando con datos de untapped.
  let msz = null;
  try {
    msz = await loadCards();
  } catch (err) {
    console.warn('loadCards no disponible para /mazos; usando solo untapped.gg:', err.message);
  }
  const byDefId = new Map(cards.map((c) => [c.defId, c]));

  const byArch = new Map();
  for (const deck of decks) {
    const { archId, games, wins, cubes } = aggregateDeck(deck);
    if (!archId || games < minGames) continue;
    const prev = byArch.get(archId);
    if (!prev || games > prev.games) {
      byArch.set(archId, { archId, games, wins, cubes, indices: deck.d });
    }
  }

  const ranked = [...byArch.values()].sort((a, b) => b.games - a.games).slice(0, limit);
  return ranked.map((d) => {
    const archName = archetypes[d.archId]?.arch_name ?? `Arquetipo ${d.archId}`;
    const slots = d.indices
      .map((i) => (cards[i] ? cards[i].defId : null))
      .filter(Boolean)
      .map((defId) => resolveSlot(defId, byDefId, msz));
    return {
      archId: d.archId,
      archName,
      games: d.games,
      winrate: d.games ? (d.wins / d.games) * 100 : 0,
      avgCubes: d.games ? d.cubes / d.games : 0,
      slots,
      missing: slots.filter((s) => !s.msz).map((s) => s.name),
    };
  });
}

/** Código de mazo en formato corto (base64 de shortNames) para importar en el juego. */
export function deckCodeFromDefIds(defIds) {
  const shortNames = defIds.filter(Boolean).map(toShortName);
  if (shortNames.length === 0) return null;
  return Buffer.from(shortNames.join(',')).toString('base64');
}
