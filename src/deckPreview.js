import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART_DIR = path.join(__dirname, '..', 'data', 'art');

// Las artes de marvelsnapzone.com son 1024x1024 (cuadradas), así que las celdas
// deben ser cuadradas para no recortar el marco de la carta.
const CELL = 280; // lado de cada carta en la imagen
const GAP = 14;
const PAD = 24;
const MAX_COLS = 6; // 12 cartas -> 6x2

const BG = { r: 22, g: 24, b: 38 }; // fondo oscuro estilo Marvel Snap

/** Descarga (o lee de caché local) la imagen de una carta. */
async function getArtBuffer(url) {
  const key = crypto.createHash('md5').update(url).digest('hex');
  const file = path.join(ART_DIR, `${key}.webp`);
  try {
    return await readFile(file);
  } catch {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(ART_DIR, { recursive: true });
    await writeFile(file, buf);
    return buf;
  }
}

/** Recorta a la celda sin deformar: como el origen es cuadrado, no hay recorte. */
async function fitToCell(buffer) {
  return sharp(buffer)
    .resize(CELL, CELL, { fit: 'cover', position: 'centre' })
    .toBuffer();
}

/**
 * Genera una imagen con la preview del mazo: rejilla de artes de carta.
 * @param {object[]} cards  cartas con { name, cost, power, art }
 * @returns {Promise<{buffer: Buffer, width: number, height: number, failed: number}>}
 */
export async function buildDeckPreview(cards) {
  const results = await Promise.allSettled(
    cards.map(async (card) => ({ raw: await getArtBuffer(card.art), card })),
  );

  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const failed = results.length - ok.length;
  if (ok.length === 0) throw new Error('No se pudo descargar ninguna imagen de carta.');

  const n = ok.length;
  // Rejilla adaptativa con máximo 6 columnas: 12 cartas -> 6x2
  const cols = Math.min(MAX_COLS, Math.max(1, Math.ceil(n / 2)));
  const rows = Math.ceil(n / cols);

  const width = PAD * 2 + cols * CELL + (cols - 1) * GAP;
  const height = PAD * 2 + rows * CELL + (rows - 1) * GAP;

  const layers = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const left = PAD + col * (CELL + GAP);
    const top = PAD + row * (CELL + GAP);
    const processed = await fitToCell(ok[i].raw);
    layers.push({ input: processed, left, top });
  }

  const base = sharp({ create: { width, height, channels: 4, background: BG } });
  const buffer = await base.composite(layers).webp({ quality: 88 }).toBuffer();

  return { buffer, width, height, failed };
}
