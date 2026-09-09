/**
 * Pruebas del pipeline sin necesidad de Discord:
 *  1. Decodificación de códigos (largo y corto)
 *  2. Resolución de cartas contra la base de marvelsnapzone
 *  3. Búsqueda de cartas por nombre (normalizada)
 *  4. Generación de la imagen de preview del mazo
 *
 * Uso: node test/run-tests.mjs
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDeckcode, decodeIdentifiers, toShortName } from '../src/deckcode.js';
import { loadCards, searchCards, resolveDeckIdentifiers } from '../src/cardData.js';
import { buildDeckPreview } from '../src/deckPreview.js';
import { deckStats, deckEmbed, cardEmbed, cardEmbedAt, variantButtons } from '../src/embeds.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'output');

let failures = 0;
function check(label, cond, extra = '') {
  if (cond) {
    console.log(`  OK  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

// 1) Semilla de caché desde el JSON ya descargado (evita red en el primer arranque de pruebas)
const SEED = process.env.SEED_CACHE;
if (SEED) {
  const raw = JSON.parse(await readFile(SEED, 'utf8'));
  await mkdir(path.join(ROOT, 'data'), { recursive: true });
  await writeFile(
    path.join(ROOT, 'data', 'cards.json'),
    JSON.stringify({ fetchedAt: Date.now(), cards: raw.success.cards }),
    'utf8',
  );
  console.log(`Caché sembrada desde ${SEED}`);
}

console.log('\n== Carga de cartas ==');
const state = await loadCards();
console.log(`  ${state.list.length} cartas cargadas`);
check('hay mas de 500 cartas', state.list.length > 500, `(tiene ${state.list.length})`);

console.log('\n== Decodificacion de codigos (formato largo) ==');
// Código generado a partir de 12 cartas reales del juego (formato largo)
const sampleIds = ['Deadpool', 'Forge', 'NicoMinoru', 'X23', 'Killmonger', 'Death',
  'Venom', 'Carnage', 'ArnimZola', 'Taskmaster', 'ShangChi', 'Hulk'];
const longCode = Buffer.from(
  JSON.stringify({ Name: 'Test', Cards: sampleIds.map((CardDefId) => ({ CardDefId })) }),
  'utf8',
).toString('base64');
const extracted = extractDeckcode(longCode);
check('extractDeckcode reconoce formato largo', extracted?.type === 'long');
const ids = decodeIdentifiers(extracted);
check('decodeIdentifiers extrae 12 ids', ids.identifiers.length === 12);
check('los ids coinciden', JSON.stringify(ids.identifiers) === JSON.stringify(sampleIds));

console.log('\n== Decodificacion de codigos (formato corto) ==');
const shortNames = sampleIds.map(toShortName);
const shortCode = Buffer.from(shortNames.join(','), 'utf8').toString('base64');
const extractedShort = extractDeckcode(shortCode);
check('extractDeckcode reconoce formato corto', extractedShort?.type === 'short');
const shortIds = decodeIdentifiers(extractedShort);
check('decodeIdentifiers corto extrae 12 shortnames', shortIds.identifiers.length === 12);
check('toShortName(SpiderMan) == SpdrMn9', toShortName('SpiderMan') === 'SpdrMn9');

console.log('\n== Resolucion de cartas ==');
const resolved = resolveDeckIdentifiers(ids);
check('resuelve las 12 cartas', resolved.cards.length === 12, `(resolvio ${resolved.cards.length}, missing=${resolved.missing.length})`);
check('sin cartas perdidas', resolved.missing.length === 0);
if (resolved.cards[0]) {
  check('la carta tiene arte', Boolean(resolved.cards[0].art), resolved.cards[0].art);
  check('la carta tiene habilidad limpia', !/<[^>]+>/.test(resolved.cards[0].ability ?? ''), resolved.cards[0].ability);
}
const resolvedShort = resolveDeckIdentifiers(shortIds);
check('formato corto resuelve las 12 cartas', resolvedShort.cards.length === 12, `(resolvio ${resolvedShort.cards.length})`);

console.log('\n== Busqueda por nombre ==');
const msMarvel = searchCards('ms marvel');
check('busqueda "ms marvel" encuentra Ms. Marvel', msMarvel.some((c) => c.name.includes('Ms. Marvel')), msMarvel.map((c) => c.name).join(', '));
const deadpool = searchCards('deadpool');
check('busqueda "deadpool" encuentra Deadpool', deadpool.some((c) => c.name === 'Deadpool'));
const noMatch = searchCards('zzz-no-existe');
check('busqueda inexistente devuelve vacio', noMatch.length === 0);
const hulks = searchCards('hulk');
check('busqueda "hulk" devuelve varias cartas', hulks.length >= 2, `(${hulks.map((c) => c.name).join(', ')})`);
check('entre ellas Hulk y Red Hulk', hulks.some((c) => c.name === 'Hulk') && hulks.some((c) => c.name.includes('Red Hulk')), hulks.map((c) => c.name).join(', '));

console.log('\n== Estadisticas del mazo ==');
const stats = deckStats(resolved.cards);
check('coste medio entre 1 y 6', Number(stats.avgCost) >= 1 && Number(stats.avgCost) <= 6, `avg=${stats.avgCost}`);
check('curva no vacia', stats.curve.length > 0, stats.curve);

console.log('\n== Embed (sin Discord, solo datos) ==');
const embed = deckEmbed(resolved.cards, { code: longCode, missing: [] });
check('embed tiene titulo', embed.data.title === 'Preview del mazo');
check('embed describe las 12 cartas', (embed.data.description ?? '').includes('Deadpool'));

console.log('\n== Embed de carta ==');
const sampleCard = searchCards('deadpool')[0];
const cardE = cardEmbed(sampleCard);
check('carta tiene imagen grande', Boolean(cardE.data.image?.url), JSON.stringify(cardE.data.image));
check(
  'carta resalta keywords en habilidad',
  (cardE.data.fields ?? []).some((f) => f.name === 'Habilidad' && f.value.includes('**When Destroyed**')),
  JSON.stringify(cardE.data.fields?.find((f) => f.name === 'Habilidad')),
);
check('carta muestra numero de variantes', (cardE.data.fields ?? []).some((f) => f.name === 'Variantes' && Number(f.value) > 0));
const unreleased = state.list.find((c) => c.status === 'unreleased');
if (unreleased) {
  const uE = cardEmbed(unreleased);
  check('carta no publicada muestra Estado', (uE.data.fields ?? []).some((f) => f.name === 'Estado' && f.value === 'No publicada'));
}

console.log('\n== Navegacion de variantes ==');
const v0 = cardEmbedAt(sampleCard, 0);
check('vista base usa el arte de la carta', v0.embed.data.image?.url === sampleCard.art);
check('vista base tiene botones', v0.buttons !== null && v0.buttons.components.length === 2);
check('boton prev deshabilitado en base', v0.buttons.components[0].data.disabled === true);
const v1 = cardEmbedAt(sampleCard, 1);
check('vista variante 1 usa arte de la variante', v1.embed.data.image?.url === sampleCard.variants[0].art);
check('footer de variante indica numero', (v1.embed.data.footer?.text ?? '').includes('Variante 1/'), v1.embed.data.footer?.text);
const vLast = cardEmbedAt(sampleCard, 99);
check('indice se limita al ultimo', vLast.index === sampleCard.variants.length);
check('boton next deshabilitado al final', vLast.buttons.components[1].data.disabled === true);
const noVar = state.list.find((c) => !Array.isArray(c.variants) || c.variants.length === 0);
if (noVar) {
  check('carta sin variantes no tiene botones', variantButtons(noVar, 0) === null);
}

console.log('\n== Imagen de preview ==');
await mkdir(OUT, { recursive: true });
try {
  const { buffer, width, height, failed } = await buildDeckPreview(resolved.cards);
  check('imagen generada', buffer.length > 0, `${buffer.length} bytes`);
  check('dimensiones esperadas (6x2, celdas de 280px)', width === 6 * 280 + 5 * 14 + 48 && height === 2 * 280 + 1 * 14 + 48, `${width}x${height}`);
  check('ninguna imagen fallo', failed === 0, `failed=${failed}`);
  await writeFile(path.join(OUT, 'mazo-test.webp'), buffer);
  console.log('  Imagen guardada en test/output/mazo-test.webp');
} catch (err) {
  failures++;
  console.log('  FAIL imagen de preview:', err.message);
}

console.log(`\n${failures === 0 ? 'TODAS LAS PRUEBAS PASARON' : `${failures} PRUEBA(S) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
