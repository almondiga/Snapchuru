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

console.log('\n== Codigos con caracter extra al inicio ==');
// Algunos exports del juego (o copiados) añaden un carácter antes del código real
const prefixedShort = 'n' + shortCode;
const decPrefixed = extractDeckcode(prefixedShort);
check('extractDeckcode tolera prefijo extra (corto)', decPrefixed?.type === 'short');
check('el prefijo extra no rompe los ids', decPrefixed && decodeIdentifiers(decPrefixed).identifiers.length === 12);
const prefixedLong = 'X' + longCode;
const decPrefixedLong = extractDeckcode(prefixedLong);
check('extractDeckcode tolera prefijo extra (largo)', decPrefixedLong?.type === 'long');
check('el prefijo extra no rompe los ids largos', decPrefixedLong && decodeIdentifiers(decPrefixedLong).identifiers.length === 12);
const garbage = extractDeckcode('https://marvelsnapzone.com/decks/foo-bar');
check('una URL no se interpreta como codigo', garbage === null);
const binaryBase64 = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).toString('base64');
check('base64 binario sin estructura no se acepta', extractDeckcode(binaryBase64) === null);
// El código real del usuario (con la 'n' extra al inicio) debe decodificar tras quitarla
const userCode = 'nSWtyNSxKYmw3LElybkNkNyxLaGhyNyxFblNiaE5yQSxDcHRuTXJ2bEQsQ2xsT2JzZG5DLFpiNCxBbnRQbHJNZ250MTAsUHNsY2s4LEJsbms1LENyc3NibnNB';
const decUser = extractDeckcode(userCode);
check('codigo del usuario (con prefijo extra) se decodifica', decUser?.type === 'short');
check('codigo del usuario da 12 ids', decUser && decodeIdentifiers(decUser).identifiers.length === 12, decUser && String(decodeIdentifiers(decUser).identifiers.length));
// Reconstrucción del código limpio: re-codificar el texto decodificado debe dar el código original sin el prefijo
if (decPrefixed) {
  const rebuilt = Buffer.from(decPrefixed.deckcode, 'utf8').toString('base64');
  check('el codigo limpio reconstruido coincide con el original', rebuilt === shortCode, `(${rebuilt.slice(0, 20)}... vs ${shortCode.slice(0, 20)}...)`);
}

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
const codeField = (embed.data.fields ?? []).find((f) => f.name === 'Código para importar');
check('embed muestra el codigo en campo seleccionable', Boolean(codeField), JSON.stringify(embed.data.fields?.map((f) => f.name)));
check('embed muestra el codigo COMPLETO (sin recortar)', Boolean(codeField?.value.includes(longCode)), `(${codeField?.value?.length} chars vs ${longCode.length})`);
check('el pie del embed no lleva el codigo recortado', !((embed.data.footer?.text ?? '').includes('Código:')), embed.data.footer?.text);

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

console.log('\n== Mazos populares (untapped.gg, fixture) ==');
// Sembrar la caché de untapped con los fixtures para no depender de red
const { buildPopularDecks, deckCodeFromDefIds } = await import('../src/untapped.js');
const { popularDeckEmbed, pageForNav } = await import('../commands/mazos.js');
{
  const fixDir = path.join(__dirname, 'fixtures', 'untapped');
  const untapDir = path.join(ROOT, 'data', 'untapped');
  await mkdir(untapDir, { recursive: true });
  const decksFix = JSON.parse(await readFile(path.join(fixDir, 'decks.json'), 'utf8'));
  const cardsFix = JSON.parse(await readFile(path.join(fixDir, 'cards.json'), 'utf8'));
  const archFix = JSON.parse(await readFile(path.join(fixDir, 'archetypes.json'), 'utf8'));
  const stamp = () => Date.now();
  await writeFile(path.join(untapDir, 'decks.json'), JSON.stringify({ fetchedAt: stamp(), data: decksFix }), 'utf8');
  await writeFile(path.join(untapDir, 'cards.json'), JSON.stringify({ fetchedAt: stamp(), data: cardsFix }), 'utf8');
  await writeFile(path.join(untapDir, 'archetypes.json'), JSON.stringify({ fetchedAt: stamp(), data: archFix.data || archFix }), 'utf8');

  const popular = await buildPopularDecks({ limit: 5, minGames: 1 });
  check('se construyen mazos populares', popular.length > 0, `(${popular.length})`);
  const first = popular[0];
  if (first) {
    check('cada mazo tiene 12 cartas', first.slots.length === 12, `(${first.slots.length})`);
    check('cada carta tiene nombre', first.slots.every((s) => s.name?.length > 0));
    check('cada carta tiene arte', first.slots.every((s) => Boolean(s.art)), first.slots.map((s) => s.name).join(', '));
    check('winrate entre 0 y 100', first.winrate > 0 && first.winrate <= 100, `(${first.winrate})`);
    check('arquetipo tiene nombre', first.archName.length > 0, first.archName);
    const code = deckCodeFromDefIds(first.slots.map((s) => s.defId));
    check('se genera codigo importable', Boolean(code), code);
    if (code) {
      const dec = decodeIdentifiers(extractDeckcode(code));
      check('el codigo generado decodifica a 12 shortnames', dec.identifiers.length === 12, `(${dec.identifiers.length})`);
    }
    const emb = popularDeckEmbed(first);
    check('embed de mazo popular tiene titulo', emb.data.title === first.archName);
    check('embed de mazo popular describe una carta', (emb.data.description ?? '').includes(first.slots[0].name));
    check('embed tiene campo winrate', (emb.data.fields ?? []).some((f) => f.name === 'Winrate'));
  }
}

console.log('\n== Paginador de mazos populares ==');
{
  const page1 = await pageForNav('mazosnav:prev:1');
  check('pagina 1 tiene embed', Boolean(page1.embeds?.[0]?.data?.title), page1.embeds?.[0]?.data?.title);
  check('pagina 1 indica la pagina', (page1.embeds[0].data.title ?? '').includes('página 1/'), page1.embeds[0].data.title);
  const row1 = page1.components[0].toJSON();
  const row2 = page1.components[1].toJSON();
  check('las dos filas son ActionRow (type 1)', row1.type === 1 && row2.type === 1, `(${row1.type}, ${row2.type})`);
  const sel1 = row1.components[0];
  check('la fila 1 contiene el selector (type 3)', sel1.type === 3, `(${sel1.type})`);
  check('pagina 1 tiene selector con 5 opciones', sel1.options.length === 5, `(${sel1.options.length})`);
  check('las opciones del selector traen archId|games', sel1.options.every((o) => /^\d+\|\d+$/.test(o.value)), JSON.stringify(sel1.options.map((o) => o.value)));
  check('pagina 1 tiene fila de flechas', row2.components.length === 2, `(${row2.components.length})`);
  check('prev deshabilitado en pagina 1', row2.components[0].disabled === true);
  check('next habilitado en pagina 1', row2.components[1].disabled === false);
  const page2 = await pageForNav('mazosnav:next:1');
  check('next desde 1 llega a pagina 2', (page2.embeds[0].data.title ?? '').includes('página 2/'), page2.embeds[0].data.title);
  const row2b = page2.components[1].toJSON();
  check('prev habilitado en pagina 2', row2b.components[0].disabled === false);
  check('pagina 2 lista mazos distintos', page2.embeds[0].data.description !== page1.embeds[0].data.description);
  const last = await pageForNav(`mazosnav:next:99`);
  const lastBtns = last.components[1].toJSON().components;
  check('next deshabilitado en la ultima pagina', lastBtns[1].disabled === true, JSON.stringify(lastBtns.map((b) => b.disabled)));
  check('embed del listado no muestra cubos', !(page1.embeds[0].data.description ?? '').includes('cubos'));
}

console.log(`\n${failures === 0 ? 'TODAS LAS PRUEBAS PASARON' : `${failures} PRUEBA(S) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
