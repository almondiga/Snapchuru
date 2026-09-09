import 'dotenv/config';
import { createServer } from 'node:http';
import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
} from 'discord.js';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCards, getCardByCardDefId, searchCards } from './src/cardData.js';
import { cardEmbedAt } from './src/embeds.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.DISCORD_TOKEN;
// Varios servidores separados por coma: "111,222" registra los comandos al instante en todos
const GUILD_IDS = (process.env.GUILD_ID || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!TOKEN) {
  console.error(
    'Falta DISCORD_TOKEN. Copia .env.example a .env e introduce el token de tu bot.',
  );
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

// Servidor HTTP de salud: necesario en hosts como Render para que el servicio
// se considere "desplegado y vivo" (y para que UptimeRobot pueda hacerle ping).
const HEALTH_PORT = Number(process.env.PORT || 3000);
createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Snapchuru online');
}).listen(HEALTH_PORT, '0.0.0.0', () => {
  console.log(`Servidor de salud escuchando en el puerto ${HEALTH_PORT}`);
});

// Cargar comandos desde ./commands
const commands = [];
const commandFiles = (await readdir(path.join(__dirname, 'commands'))).filter((f) =>
  f.endsWith('.js'),
);
for (const file of commandFiles) {
  const mod = await import(`./commands/${file}`);
  client.commands.set(mod.data.name, mod);
  commands.push(mod.data.toJSON());
}
console.log(`Cargados ${commands.length} comandos: ${commands.map((c) => `/${c.name}`).join(', ')}`);

// Registrar comandos al conectar (por servidor si hay GUILD_ID, si no global)
const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once(Events.ClientReady, async (c) => {
  console.log(`Bot conectado como ${c.user.tag}`);
  try {
    if (GUILD_IDS.length > 0) {
      for (const gid of GUILD_IDS) {
        await rest.put(Routes.applicationGuildCommands(c.user.id, gid), { body: commands });
        console.log(`Comandos registrados en el servidor ${gid}`);
      }
    } else {
      await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
      console.log('Comandos registrados globalmente (puede tardar hasta 1 h en propagarse)');
    }
  } catch (err) {
    console.error('Error registrando comandos:', err);
  }
  loadCards()
    .then((s) => console.log(`Base de cartas lista: ${s.list.length} cartas`))
    .catch((e) => console.error('No se pudo precargar la base de cartas:', e.message));
});

client.on(Events.InteractionCreate, async (interaction) => {
  const channel = interaction.channel?.name ?? interaction.channelId;
  const guild = interaction.guild?.name ?? 'DM';
  console.log(
    `[${new Date().toISOString()}] ${interaction.isButton() ? 'BOTON' : '/' + interaction.commandName} canal="${channel}" (${interaction.channelId}) servidor="${guild}" (${interaction.guildId}) usuario=${interaction.user.username}`,
  );

  if (interaction.isButton()) {
    await handleButton(interaction);
    return;
  }
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction);
    return;
  }
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error ejecutando /${interaction.commandName}:`, err);
    const msg = 'Ocurrió un error inesperado al ejecutar el comando.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
});

/** Autocompletado de /carta: sugiere cartas mientras se escribe el nombre. */
async function handleAutocomplete(interaction) {
  if (interaction.commandName !== 'carta') return;
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'nombre') return;
  const value = String(focused.value).trim();
  if (!value) {
    await interaction.respond([]).catch(() => {});
    return;
  }
  try {
    await loadCards();
    const matches = searchCards(value, { limit: 25 });
    await interaction
      .respond(
        matches.map((c) => ({
          name: `${c.name} (${c.cost}/${c.power})`.slice(0, 100),
          value: c.carddefid,
        })),
      )
      .catch(() => {});
  } catch (err) {
    console.error('Error en autocompletado:', err);
    await interaction.respond([]).catch(() => {});
  }
}

/** Botones: navegación de variantes (variantes:...) y selección de carta (selcarta|...). */
async function handleButton(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('selcarta|')) {
    const carddefid = customId.split('|')[1];
    try {
      await loadCards();
      const card = getCardByCardDefId(carddefid);
      if (!card) {
        await interaction
          .update({ content: 'Ya no tengo esa carta en la base.', embeds: [], components: [] })
          .catch(() => {});
        return;
      }
      const view = cardEmbedAt(card, 0);
      await interaction.update({
        embeds: [view.embed],
        components: view.buttons ? [view.buttons] : [],
      });
    } catch (err) {
      console.error('Error en botón de selección:', err);
      await interaction
        .update({ content: 'Ocurrió un error al mostrar la carta.', embeds: [], components: [] })
        .catch(() => {});
    }
    return;
  }

  if (!customId.startsWith('variantes:')) return;
  const [dir, carddefid, indexStr] = customId.split('|');
  const current = Number(indexStr);
  if (!carddefid || Number.isNaN(current)) {
    await interaction
      .update({ content: 'Este botón ya no es válido.', embeds: [], components: [] })
      .catch(() => {});
    return;
  }
  try {
    await loadCards();
    const card = getCardByCardDefId(carddefid);
    if (!card) {
      await interaction
        .update({ content: 'Ya no tengo esa carta en la base.', embeds: [], components: [] })
        .catch(() => {});
      return;
    }
    const delta = dir.endsWith('next') ? 1 : -1;
    const view = cardEmbedAt(card, current + delta);
    await interaction.update({
      embeds: [view.embed],
      components: view.buttons ? [view.buttons] : [],
    });
  } catch (err) {
    console.error('Error en botón de variantes:', err);
    await interaction
      .update({ content: 'Ocurrió un error al cambiar de variante.', embeds: [], components: [] })
      .catch(() => {});
  }
}

client.login(TOKEN);
