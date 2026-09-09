import { Buffer } from 'node:buffer';

/**
 * Algoritmo de shortName usado por la comunidad para el formato corto
 * de códigos de mazo: se quitan las vocales minúsculas del cardDefId y
 * se añade la longitud del id en hexadecimal (mayúsculas).
 * Ej.: SpiderMan -> SpdrMn9
 */
export function toShortName(cardDefId) {
  return cardDefId.replace(/[aeiouy]/g, '') + cardDefId.length.toString(16).toUpperCase();
}

/**
 * Extrae y decodifica un código de mazo a partir de texto libre.
 * El usuario puede pegar el código rodeado de líneas de comentario (#)
 * o con espacios; se filtran las líneas no válidas.
 *
 * @param {string} input
 * @returns {{type: 'long'|'short', deckcode: string} | null}
 */
export function extractDeckcode(input) {
  const rawcode64 = String(input)
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      return t.length > 0 && !t.startsWith('#') && !t.includes(' ');
    })
    .join('')
    .trim();

  if (!rawcode64) return null;

  let rawcode;
  try {
    rawcode = Buffer.from(rawcode64, 'base64').toString('utf-8');
  } catch {
    return null;
  }

  if (rawcode.includes('{')) return { type: 'long', deckcode: rawcode };
  if (rawcode.length > 0) return { type: 'short', deckcode: rawcode };
  return null;
}

/**
 * Obtiene los identificadores crudos de un código ya decodificado.
 * - Formato largo: cardDefIds (p.ej. "Deadpool", "NicoMinoru").
 * - Formato corto: shortNames (p.ej. "Ddpl", "NcMnr").
 *
 * @param {{type: 'long'|'short', deckcode: string}} deckcode
 * @returns {{type: 'long'|'short', identifiers: string[]}}
 */
export function decodeIdentifiers(deckcode) {
  if (deckcode.type === 'long') {
    let parsed;
    try {
      parsed = JSON.parse(deckcode.deckcode);
    } catch {
      throw new Error('El código no contiene un JSON válido en base64.');
    }
    if (!Array.isArray(parsed?.Cards)) {
      throw new Error('El código no tiene el campo "Cards".');
    }
    const identifiers = parsed.Cards.map((c) => c?.CardDefId).filter(
      (v) => typeof v === 'string' && v.length > 0,
    );
    if (identifiers.length === 0) throw new Error('El código no contiene cartas.');
    return { type: 'long', identifiers };
  }

  const identifiers = deckcode.deckcode
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (identifiers.length === 0) throw new Error('El código no contiene cartas.');
  return { type: 'short', identifiers };
}
