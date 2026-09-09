# Marvel Snap Bot

Bot de Discord para **ver cartas** de Marvel Snap y **previsualizar mazos** a partir de códigos compartidos. Al pegar un código de mazo, el bot lo decodifica y genera una imagen con las 12 cartas + un embed con estadísticas (curva de costes, coste medio, poder total, series).

Datos e imágenes: **marvelsnapzone.com** (API interna `getinfo/?searchtype=cards`).

## Requisitos

- Node.js >= 18 (probado con v22)
- Una cuenta de Discord con permisos para crear aplicaciones

## 1. Crear el bot en Discord (2 minutos)

1. Entra en el [Portal de Desarrolladores de Discord](https://discord.com/developers/applications) y pulsa **New Application**. Ponle nombre (p. ej. "Snap Cards").
2. En el menú de la izquierda ve a **Bot**:
   - Pulsa **Reset Token** y copia el token (es el `DISCORD_TOKEN`).
   - Opcional: desactiva "Public Bot" si no quieres que otros lo inviten.
3. En **OAuth2 → URL Generator**:
   - Marca el scope **applications.commands** y **bot**.
   - En permisos del bot marca: **Send Messages**, **Embed Links**, **Attach Files**, **Use Slash Commands**.
   - Copia la URL generada, ábrela en el navegador y añade el bot a tu servidor.

## 2. Configurar y arrancar

```bash
npm install
copy .env.example .env     # en Windows
# edita .env y pega tu token:
#   DISCORD_TOKEN=tu_token_aqui
#   GUILD_ID=id_de_tu_servidor   (opcional: registra los comandos al instante)
npm start
```

- Si pones `GUILD_ID`, los comandos se registran al instante en ese servidor (recomendado para probar).
- Sin `GUILD_ID`, se registran globalmente y pueden tardar hasta 1 hora en aparecer.

## 3. Comandos

| Comando | Descripción |
| --- | --- |
| `/carta <nombre>` | Busca una carta: arte, coste, poder, habilidad y serie. Acepta búsquedas parciales ("ms marvel"). |
| `/mazo <codigo>` | Decodifica un código de mazo (formato largo y corto) y genera una preview con las 12 cartas + estadísticas. |
| `/actualizar-cartas` | Refresca la base de cartas desde marvelsnapzone.com (solo administradores). |
| `/ayuda` | Muestra la ayuda. |

## Cómo funciona

1. **Base de cartas**: se descarga de `https://marvelsnapzone.com/getinfo/?searchtype=cards&searchcardstype=true` y se cachea en `data/cards.json` (TTL 24 h). Los nombres, habilidades y URLs se limpian de etiquetas Unity/HTML.
2. **Códigos de mazo**:
   - Formato largo (el del juego): base64 de un JSON `{"Name":...,"Cards":[{"CardDefId":"..."}]}`.
   - Formato corto: base64 de shortNames separados por comas (algoritmo: quitar vocales del cardDefId + longitud en hex).
3. **Preview**: el bot descarga las imágenes de las 12 cartas (caché en `data/art/`), las compone en una rejilla 6×2 usando `sharp` (las artes de la web son 1024×1024, se usan celdas cuadradas para no recortarlas), y la adjunta al mensaje junto con el embed de estadísticas.

## Estructura

```
marvel-snap-bot/
├─ index.js              # Bot principal (conexión + registro de comandos)
├─ commands/
│  ├─ carta.js           # /carta
│  ├─ mazo.js            # /mazo
│  ├─ actualizar.js      # /actualizar-cartas
│  └─ ayuda.js           # /ayuda
├─ src/
│  ├─ deckcode.js        # Decodificación de códigos (largo y corto)
│  ├─ cardData.js        # Carga/caché de cartas desde marvelsnapzone.com
│  ├─ deckPreview.js     # Composición de la imagen del mazo (sharp)
│  └─ embeds.js          # Embeds y estadísticas
├─ data/                 # Caché: cards.json + art/ (se crea solo)
└─ test/
   └─ run-tests.mjs      # Pruebas del pipeline sin Discord
```

## Pruebas

```bash
npm test
```

Valida decodificación (largo y corto), resolución de cartas, búsqueda por nombre, estadísticas y generación de imagen. La imagen de prueba se guarda en `test/output/mazo-test.webp`.

## Despliegue

- **Local / VPS**: `npm start` con un gestor de procesos (`pm2`, `systemd`, o `node --watch`).
- **Nube**: Render, Railway o Replit sirven para mantenerlo 24/7 (variables de entorno en vez de `.env`).

## Notas y límites

- Marvel Snap Zone no tiene API pública documentada; el bot usa su endpoint interno. Si cambia la estructura, actualiza `fetchFromApi()` en `src/cardData.js`.
- Sé razonable con las peticiones: la caché local (24 h) evita golpear la web constantemente, y las imágenes de cartas se cachean en disco.
- Las cartas y sus imágenes son propiedad de Marvel / Second Dinner; el bot es para uso comunitario no comercial.
