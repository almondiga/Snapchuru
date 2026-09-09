import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ayuda')
  .setDescription('Muestra los comandos disponibles del bot');

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('Marvel Snap Bot - Comandos')
    .setColor(0x5865f2)
    .setDescription(
      [
        '**/carta <nombre>** — Busca una carta y muestra su arte, coste, poder y habilidad.',
        '**/mazo <codigo>** — Decodifica un código de mazo y genera una preview con todas las cartas.',
        '**/actualizar-cartas** — Refresca la base de cartas desde marvelsnapzone.com (solo administradores).',
        '**/ayuda** — Muestra esta ayuda.',
      ].join('\n\n'),
    )
    .setFooter({ text: 'Datos e imágenes: marvelsnapzone.com' });
  return interaction.reply({ embeds: [embed] });
}
