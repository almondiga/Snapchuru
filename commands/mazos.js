import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { buildPopularDecks, deckCodeFromDefIds } from '../src/untapped.js';
import { buildDeckPreview } from '../src/deckPreview.js';
import { deckStats, deckCardGrid } from '../src/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('mazos')
  .setDescription('Muestra los mazos más populares de los últimos 7 días (datos de untapped.gg)');

const formatNum = (n) => Number(n).toLocaleString('es-ES');

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
      { name: 'Cubos medios', value: `${deck.avgCubes.toFixed(1)}`, inline: true },
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
    const popular = await buildPopularDecks({ limit: 10 });
    if (popular.length === 0) {
      return interaction.editReply(
        'No pude obtener los mazos populares ahora mismo. Inténtalo más tarde.',
      );
    }

    const lines = popular.map(
      (d, i) =>
        `**${i + 1}.** ${d.archName} — ${d.winrate.toFixed(1)} % WR · ${formatNum(d.games)} partidas · ${d.avgCubes.toFixed(1)} cubos`,
    );
    const embed = new EmbedBuilder()
      .setTitle('Mazos populares · últimos 7 días')
      .setDescription(lines.join('\n'))
      .setColor(0x5865f2)
      .setFooter({ text: 'Datos: untapped.gg · Selecciona un mazo para ver su preview' });

    const select = new StringSelectMenuBuilder()
      .setCustomId('mazosel')
      .setPlaceholder('Elige un mazo para ver su preview')
      .addOptions(
        popular.map((d, i) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${i + 1}. ${d.archName}`.slice(0, 100))
            .setDescription(
              `${d.winrate.toFixed(1)} % WR · ${formatNum(d.games)} partidas · ${d.avgCubes.toFixed(1)} cubos`.slice(
                0,
                100,
              ),
            )
            .setValue(`${d.archId}|${d.games}`),
        ),
      );

    return interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(select)],
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
  const popular = await buildPopularDecks({ limit: 10, minGames: 200 });
  let deck =
    popular.find((d) => String(d.archId) === archIdStr && String(d.games) === gamesStr) ??
    popular.find((d) => String(d.archId) === archIdStr);
  if (!deck) return null;

  const cards = deck.slots.filter((s) => s.art);
  const embed = popularDeckEmbed(deck);
  const { buffer, failed } = await buildDeckPreview(cards);
  return { embed, buffer, failed };
}
