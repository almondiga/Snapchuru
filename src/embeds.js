import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const COST_COLORS = {
  1: 0x7f8c8d,
  2: 0x27ae60,
  3: 0x2980b9,
  4: 0x8e44ad,
  5: 0xe67e22,
  6: 0xe74c3c,
};

export function costColor(cost) {
  return COST_COLORS[cost] ?? 0x2c3e50;
}

/** Resalta los keywords de habilidad en negrita para que se lea mejor. */
const KEYWORD_RE = /\b(On Reveal|Ongoing|Activate|When Destroyed)\b/g;

function highlightKeywords(text) {
  return String(text).replace(KEYWORD_RE, '**$1**');
}

/** Embed de una carta individual (con opción de mostrar una variante concreta). */
export function cardEmbed(card, { variant = null, variantIndex = 0, totalVariants = 1 } = {}) {
  const fields = [
    { name: 'Coste', value: String(card.cost), inline: true },
    { name: 'Poder', value: String(card.power), inline: true },
    { name: 'Serie', value: card.series || 'Desconocida', inline: true },
  ];
  if (card.status === 'unreleased') {
    fields.push({ name: 'Estado', value: 'No publicada', inline: true });
  }
  const numVariants = Array.isArray(card.variants) ? card.variants.length : 0;
  if (numVariants > 0) {
    fields.push({ name: 'Variantes', value: String(numVariants), inline: true });
  }
  if (card.ability) {
    fields.push({ name: 'Habilidad', value: highlightKeywords(card.ability).slice(0, 1024) });
  }

  const embed = new EmbedBuilder()
    .setTitle(card.name)
    .setColor(costColor(card.cost))
    .setURL(card.url)
    .addFields(fields);

  if (variant) {
    embed.setImage(variant.art);
    const bits = [`Variante ${variantIndex}/${numVariants}`];
    if (variant.rarity) bits.push(variant.rarity);
    if (variant.sketcher) bits.push(`Arte: ${variant.sketcher}`);
    if (variant.inker) bits.push(`Tinta: ${variant.inker}`);
    if (variant.colorist) bits.push(`Color: ${variant.colorist}`);
    embed.setFooter({ text: bits.join(' · ') });
  } else {
    embed.setImage(card.art);
    if (numVariants > 0) {
      embed.setFooter({ text: `Arte base · ${numVariants} variantes (usa los botones para verlas)` });
    }
    if (card.flavor) {
      embed.setDescription(`*"${card.flavor}"*`);
    }
  }
  return embed;
}

/** Botones ◀ ▶ para navegar por las variantes (null si la carta no tiene variantes). */
export function variantButtons(card, index) {
  const variants = Array.isArray(card.variants) ? card.variants : [];
  const total = variants.length + 1; // arte base + variantes
  if (total <= 1) return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`variantes:prev|${card.carddefid}|${index}`)
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index <= 0),
    new ButtonBuilder()
      .setCustomId(`variantes:next|${card.carddefid}|${index}`)
      .setLabel('▶')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(index >= total - 1),
  );
}

/**
 * Vista de la carta en un índice dado: 0 = arte base, 1..N = variantes.
 * @returns {{embed: EmbedBuilder, index: number, total: number, buttons: ActionRowBuilder|null}}
 */
export function cardEmbedAt(card, index) {
  const variants = Array.isArray(card.variants) ? card.variants : [];
  const total = variants.length + 1;
  const idx = Math.min(Math.max(index, 0), total - 1);
  const variant = idx > 0 ? variants[idx - 1] : null;
  return {
    embed: cardEmbed(card, { variant, variantIndex: idx, totalVariants: total }),
    index: idx,
    total,
    buttons: variantButtons(card, idx),
  };
}

export function deckStats(cards) {
  const byCost = {};
  let totalCost = 0;
  let totalPower = 0;
  for (const c of cards) {
    byCost[c.cost] = (byCost[c.cost] ?? 0) + 1;
    totalCost += Number(c.cost) || 0;
    totalPower += Number(c.power) || 0;
  }
  const curve = Object.keys(byCost)
    .sort((a, b) => Number(a) - Number(b))
    .map((cost) => `${cost} -> ${byCost[cost]}`)
    .join(' | ') || '—';
  return {
    byCost,
    curve,
    totalPower,
    avgCost: cards.length ? (totalCost / cards.length).toFixed(1) : '0',
  };
}

/** Lista de cartas agrupada por coste, en dos columnas (Coste 1 | Coste 2, Coste 3 | Coste 4...). */
export function deckCardGrid(cards) {
  const grouped = new Map();
  for (const c of cards) {
    const key = c.cost;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(c);
  }
  const groups = [...grouped.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([cost, list]) => {
      const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
      return [`Coste ${cost}`, ...sorted.map((c) => `${c.name} (${c.cost}/${c.power})`)];
    });

  const pairs = [];
  for (let i = 0; i < groups.length; i += 2) pairs.push([groups[i], groups[i + 1] ?? null]);

  const maxLen = (arr) => arr.reduce((m, l) => Math.max(m, l.length), 0);
  const col1Width = maxLen(pairs.map((p) => p[0]).flat());
  const col2Width = maxLen(pairs.map((p) => p[1] ?? []).flat());
  const sep = `${'-'.repeat(col1Width + 1)}|${'-'.repeat(col2Width + 1)}`;
  const grid = [];
  for (let i = 0; i < pairs.length; i++) {
    const [left, right] = pairs[i];
    const n = Math.max(left.length, right ? right.length : 0);
    for (let j = 0; j < n; j++) {
      const l = (left[j] ?? '').padEnd(col1Width);
      const r = right ? (right[j] ?? '').padEnd(col2Width) : '';
      grid.push(`${l} | ${r}`.trimEnd());
    }
    if (i < pairs.length - 1) grid.push(sep);
  }
  return `\`\`\`\n${grid.join('\n')}\n\`\`\``;
}

/** Embed con las estadísticas del mazo. El código va completo y en un campo
 *  seleccionable (los pies de embed no se pueden copiar en Discord y causaban
 *  que la gente compartiese códigos recortados). */
export function deckEmbed(cards, { code, missing = [] } = {}) {
  const stats = deckStats(cards);
  const description = deckCardGrid(cards).slice(0, 4000) || 'Sin cartas';

  const embed = new EmbedBuilder()
    .setTitle('Preview del mazo')
    .setColor(0x5865f2)
    .setDescription(description.slice(0, 4000) || 'Sin cartas')
    .addFields(
      { name: 'Cartas', value: String(cards.length), inline: true },
      { name: 'Coste medio', value: stats.avgCost, inline: true },
      { name: 'Poder total', value: String(stats.totalPower), inline: true },
      { name: 'Curva de costes', value: stats.curve.slice(0, 1024), inline: false },
    );
  if (code) {
    embed.addFields({ name: 'Código para importar', value: `\`${code}\`` });
  }
  const footerParts = [];
  if (missing.length > 0) footerParts.push(`${missing.length} carta(s) no encontradas`);
  if (footerParts.length > 0) embed.setFooter({ text: footerParts.join(' · ') });
  return embed;
}
