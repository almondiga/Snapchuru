import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { buildPopularDecks, deckCodeFromDefIds } from '../src/untapped.js';
import { buildDeckPreview } from '../src/deckPreview.js';
import { deckStats, deckCardGrid } from '../src/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('mazos')
  .setDescription('Muestra los mazos más populares de los últimos 7 días (datos de untapped.gg)');

const PAGE_SIZE = 5; // mazos por página del listado
const LIMIT = 40; // cuántos mazos se listan en total
const CACHE_TTL_MS = 30 * 60 * 1000; // lista en memoria 30 min para que paginar sea instantáneo

const formatNum = (n) => Number(n).toLocaleString('es-ES');

// Lista de mazos populares con caché en memoria (evita re-descargar 2,5 MB en cada interacción)
let rankedCache = { at: 0, list: null };
async function getRankedList() {
  if (rankedCache.list && Date.now() - rankedCache.at < CACHE_TTL_MS) return rankedCache.list;
  const list = await buildPopularDecks({ limit: LIMIT, minGames: 200 });
  rankedCache = { at: Date.now(), list };
  return list;
}

/** Embed del listado para una página concreta (1-based). */
function listPageEmbed(ranked, page) {
  const pageCount = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const entries = ranked.slice(start, start + PAGE_SIZE);
  const lines = entries.map(
    (d, i) =>
      `**${start + i + 1}.** ${d.archName} — ${d.winrate.toFixed(1)} % WR · ${formatNum(d.games)} partidas`,
  );
  return new EmbedBuilder()
    .setTitle(`Mazos populares · página ${page}/${pageCount}`)
    .setDescription(lines.join('\n'))
    .setColor(0x5865f2)
    .setFooter({ text: 'Datos: untapped.gg · últimos 7 días · Usa las flechas para ver más mazos' });
}

/** Selector con los mazos de la página actual. */
function pageSelectMenu(ranked, page) {
  const start = (page - 1) * PAGE_SIZE;
  const entries = ranked.slice(start, start + PAGE_SIZE);
  return new StringSelectMenuBuilder()
    .setCustomId('mazosel')
    .setPlaceholder('Elige un mazo para ver su preview')
    .addOptions(
      entries.map((d, i) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${start + i + 1}. ${d.archName}`.slice(0, 100))
          .setDescription(
            `${d.winrate.toFixed(1)} % WR · ${formatNum(d.games)} partidas`.slice(0, 100),
          )
          .setValue(`${d.archId}|${d.games}`),
      ),
    );
}

/** Flechas de paginación (◀ / ▶), deshabilitadas en los extremos. */
function navButtons(page, ranked) {
  const pageCount = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE));
  const prev = new ButtonBuilder()
    .setCustomId(`mazosnav:prev:${page}`)
    .setLabel('◀')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page <= 1);
  const next = new ButtonBuilder()
    .setCustomId(`mazosnav:next:${page}`)
    .setLabel('▶')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= pageCount);
  return new ActionRowBuilder().addComponents(prev, next);
}

/**
 * Embed con el detalle de un mazo popular (stats + lista de cartas + código).
 */
export function popularDeckEmbed(deck) {
  const cards = deck.slots.filter((s) => s.art);
  const stats = deckStats(cards);
  const code = deckCodeFromDefIds(deck.slots.map((s) => s.defId));

  const embed = new EmbedBuilder()
    .setTitle(deck.archName)
    .setColor(0x5865f2)
    .setDescription(deckCardGrid(cards).slice(0, 4000) || 'Sin cartas')
    .addFields(
      { name: 'Winrate', value: `${deck.winrate.toFixed(1)} %`, inline: true },
      { name: 'Partidas', value: formatNum(deck.games), inline: true },
      { name: 'Coste medio', value: stats.avgCost, inline: true },
      { name: 'Poder total', value: String(stats.totalPower), inline: true },
      { name: 'Curva de costes', value: stats.curve, inline: false },
    );
  if (code) {
    embed.addFields({ name: 'Código para importar', value: `\`${code}\`` });
  }
  const footer = ['Datos: untapped.gg · últimos 7 días'];
  if (deck.missing.length > 0) {
    footer.push(`${deck.missing.length} carta(s) nuevas sin datos en marvelsnapzone`);
  }
  embed.setFooter({ text: footer.join(' · ') });
  return embed;
}

export async function execute(interaction) {
  await interaction.deferReply();
  try {
    const ranked = await getRankedList();
    if (ranked.length === 0) {
      return interaction.editReply(
        'No pude obtener los mazos populares ahora mismo. Inténtalo más tarde.',
      );
    }
    const embed = listPageEmbed(ranked, 1);
    return interaction.editReply({
      embeds: [embed],
      components: [pageSelectMenu(ranked, 1), navButtons(1, ranked)],
    });
  } catch (err) {
    console.error('Error en /mazos:', err);
    return interaction.editReply(`No pude obtener los mazos populares: ${err.message}`);
  }
}

/**
 * Genera el detalle de un mazo a partir del valor del selector (archId|games).
 * Devuelve null si ya no está disponible.
 */
export async function deckDetailForSelection(value) {
  const [archIdStr, gamesStr] = String(value).split('|');
  const ranked = await getRankedList();
  const deck =
    ranked.find((d) => String(d.archId) === archIdStr && String(d.games) === gamesStr) ??
    ranked.find((d) => String(d.archId) === archIdStr);
  if (!deck) return null;

  const cards = deck.slots.filter((s) => s.art);
  const embed = popularDeckEmbed(deck);
  const { buffer, failed } = await buildDeckPreview(cards);
  return { embed, buffer, failed };
}

/**
 * Cambia de página del listado. pageNext: +1 o -1 relativo a la página actual
 * (viene en el customId del botón). Devuelve la respuesta para interaction.update.
 */
export async function pageForNav(customId) {
  const [, dir, pageStr] = String(customId).split(':');
  const current = Number(pageStr);
  const ranked = await getRankedList();
  const pageCount = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE));
  let page = current + (dir === 'next' ? 1 : -1);
  page = Math.min(Math.max(page, 1), pageCount);
  return {
    embeds: [listPageEmbed(ranked, page)],
    components: [pageSelectMenu(ranked, page), navButtons(page, ranked)],
  };
}
