import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { loadCards } from '../src/cardData.js';

export const data = new SlashCommandBuilder()
  .setName('actualizar-cartas')
  .setDescription('Actualiza la base de cartas desde marvelsnapzone.com (solo administradores)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  await interaction.deferReply();
  try {
    const state = await loadCards({ force: true });
    return interaction.editReply(
      `Base de cartas actualizada: **${state.list.length}** cartas desde marvelsnapzone.com.`,
    );
  } catch (err) {
    console.error('Error en /actualizar-cartas:', err);
    return interaction.editReply(`No se pudo actualizar la base de cartas: ${err.message}`);
  }
}
