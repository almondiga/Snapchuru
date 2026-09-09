import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { loadCards, getCardByCardDefId, searchCards } from '../src/cardData.js';
import { cardEmbedAt } from '../src/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('carta')
  .setDescription('Busca una carta de Marvel Snap')
  .addStringOption((o) =>
    o
      .setName('nombre')
      .setDescription('Nombre de la carta')
      .setRequired(true)
      .setAutocomplete(true),
  );

export async function execute(interaction) {
  const query = interaction.options.getString('nombre', true);
  await interaction.deferReply();
  try {
    await loadCards();
    // Si el valor viene del autocompletado es un carddefid exacto: lo usamos directo
    const byId = getCardByCardDefId(query);
    const matches = byId ? [byId] : searchCards(query);
    if (matches.length === 0) {
      return interaction.editReply(`No encontré ninguna carta con "**${query}**".`);
    }

    const [first, ...rest] = matches;
    const view = cardEmbedAt(first, 0);
    const embed = view.embed;

    const components = [];
    if (rest.length > 0) {
      const shown = rest.slice(0, 5);
      const alternatives = shown.map((c) => `• ${c.name} (${c.cost}/${c.power})`).join('\n');
      const extra = rest.length > shown.length ? `\n… y ${rest.length - shown.length} más (escribe el nombre exacto)` : '';
      embed.setDescription(
        `${embed.data.description ? `${embed.data.description}\n\n` : ''}¿Buscabas alguna de estas?\n${alternatives}${extra}`,
      );
      components.push(
        new ActionRowBuilder().addComponents(
          shown.map((c) =>
            new ButtonBuilder()
              .setCustomId(`selcarta|${c.carddefid}`)
              .setLabel(c.name.length > 16 ? `${c.name.slice(0, 15)}…` : c.name)
              .setStyle(ButtonStyle.Secondary),
          ),
        ),
      );
    }
    if (view.buttons) components.push(view.buttons);
    return interaction.editReply({ embeds: [embed], components });
  } catch (err) {
    console.error('Error en /carta:', err);
    return interaction.editReply(`Hubo un error al buscar la carta: ${err.message}`);
  }
}
