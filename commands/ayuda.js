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
        '**/mazos** — Muestra los mazos más populares de la última semana (winrate, partidas y preview con código para importar).',
        '**/actualizar-cartas** — Refresca la base de cartas desde marvelsnapzone.com (solo administradores).',
        '**/ayuda** — Muestra esta ayuda.',
      ].join('\n\n'),
    )
    .setFooter({ text: 'Cartas: marvelsnapzone.com · Mazos populares: untapped.gg' });
  return interaction.reply({ embeds: [embed] });
}
