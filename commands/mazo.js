import { SlashCommandBuilder } from 'discord.js';
import { extractDeckcode, decodeIdentifiers } from '../src/deckcode.js';
import { loadCards, resolveDeckIdentifiers } from '../src/cardData.js';
import { buildDeckPreview } from '../src/deckPreview.js';
import { deckEmbed } from '../src/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('mazo')
  .setDescription('Decodifica un código de mazo y muestra una preview en Discord')
  .addStringOption((o) =>
    o.setName('codigo').setDescription('Código de mazo de Marvel Snap').setRequired(true),
  );

export async function execute(interaction) {
  const input = interaction.options.getString('codigo', true);
  await interaction.deferReply();
  try {
    const deckcode = extractDeckcode(input);
    if (!deckcode) {
      return interaction.editReply(
        'No pude reconocer un código de mazo válido. Pega el código que exporta el juego (formato base64).',
      );
    }

    const identifiers = decodeIdentifiers(deckcode);
    await loadCards();
    const { cards, missing } = resolveDeckIdentifiers(identifiers);
    if (cards.length === 0) {
      const preview = identifiers.identifiers.slice(0, 6).join(', ');
      const plural = identifiers.identifiers.length === 1 ? 'identificador' : 'identificadores';
      return interaction.editReply(
        `No pude resolver ninguna carta del código. Decodifiqué ${identifiers.identifiers.length} ${plural} (${preview}...) que no coinciden con mi base de cartas. ` +
          'Si el código lo exporta el juego, pásamelo tal cual (formato base64). Si lo copiaste de una web, dime de cuál para adaptar el formato.',
      );
    }

    // Código limpio y completo para mostrar: en formato corto se reconstruye
    // desde el texto decodificado (sin el carácter extra que a veces arrastra
    // el copiado), para que al compartirlo importe las 12 cartas.
    let cleanCode = input.replace(/\s+/g, ' ').trim();
    if (deckcode.type === 'short') {
      cleanCode = Buffer.from(deckcode.deckcode, 'utf8').toString('base64');
    }

    const embed = deckEmbed(cards, {
      code: cleanCode,
      missing,
    });

    // Generar la imagen de preview; si falla, respondemos solo con el embed.
    try {
      const { buffer, failed } = await buildDeckPreview(cards);
      if (failed > 0 && embed.data.footer) {
        embed.setFooter({
          text: `${embed.data.footer.text} · ${failed} imagen(es) no disponibles`,
        });
      }
      return interaction.editReply({
        embeds: [embed],
        files: [{ attachment: buffer, name: 'mazo.webp' }],
      });
    } catch (err) {
      console.error('No se pudo generar la imagen del mazo:', err.message);
      return interaction.editReply({ embeds: [embed] });
    }
  } catch (err) {
    console.error('Error en /mazo:', err);
    return interaction.editReply(`No pude procesar el mazo: ${err.message}`);
  }
}
