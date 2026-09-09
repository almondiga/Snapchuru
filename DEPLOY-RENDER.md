# Desplegar Snapchuru en Render (gratis, sin tarjeta) + UptimeRobot

El bot corre en un servicio web **free** de Render que se "duerme" a los 15 minutos
sin tráfico. **UptimeRobot** le hace ping cada 5 minutos para que nunca se duerma.
Coste: 0 €. Requisito: una cuenta de GitHub (gratis).

---

## Paso 1 — Subir el proyecto a GitHub

1. Entra en https://github.com/new y crea un repositorio **privado** (ej: `marvel-snap-bot`).
   No marques ninguna casilla (sin README, sin .gitignore).
2. Abre una terminal en la carpeta del proyecto y ejecuta:

```bash
git init
git add .
git commit -m "bot snapchuru listo para render"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/marvel-snap-bot.git
git push -u origin main
```

> El `.gitignore` ya excluye `.env` y `node_modules/`, así que **el token no se sube**.
> Verifícalo si quieres: `git status` debe salir limpio y en GitHub el repo no debe
> contener `.env`.

## Paso 2 — Crear el servicio en Render

1. Crea cuenta en https://render.com (puedes entrar con tu cuenta de GitHub, sin tarjeta).
2. Click en **New +** → **Blueprint**.
3. Conecta tu cuenta de GitHub si te lo pide y elige el repositorio `marvel-snap-bot`.
4. Render detectará `render.yaml` y creará el servicio `snapchuru` con el plan free.
5. Pulsa **Apply**. El primer deploy tardará 2-5 minutos.

## Paso 3 — Rellenar las variables de entorno (obligatorio)

En el panel del servicio **snapchuru** → **Environment**, verás dos variables creadas
con valor vacío (`sync: false`). Rellénalas y pulsa **Save Changes** (se redesplegará):

| Variable | Valor |
|---|---|
| `DISCORD_TOKEN` | El token real de tu bot (lo tienes en tu `.env` local) |
| `GUILD_ID` | `720191008419348513,1546252704354148482` (los dos servidores, separados por coma) |

## Paso 4 — Comprobar que está vivo

1. En el panel, pestaña **Logs**: debes ver algo como:
   ```
   Bot conectado como Snapchuru#8251
   Comandos registrados en el servidor 720191008419348513
   Comandos registrados en el servidor 1546252704354148482
   Base de cartas lista: 726 cartas
   ```
2. Abre la URL `https://snapchuru.onrender.com/` en el navegador: debe mostrar
   `Snapchuru online`. (Si el nombre `snapchuru` ya estuviera ocupado, usa el que
   Render te asigne y anótalo: lo necesitas para UptimeRobot.)
3. Prueba `/carta` y `/mazo` en Discord: si responden, ya está funcionando 24/7.

## Paso 5 — UptimeRobot (evita que se duerma)

1. Crea cuenta en https://uptimerobot.com (gratis, sin tarjeta).
2. **+ Add New Monitor** con estos datos:
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `snapchuru`
   - URL (or IP): `https://snapchuru.onrender.com/` (o la URL que te haya dado Render)
   - Monitoring Interval: **every 5 minutes**
   - Alert Contacts: elige tu email (opcional)
3. Guarda. A partir de aquí el bot se mantiene despierto 24/7.

---

## Actualizar el bot en el futuro

Cada vez que cambies el código:

```bash
git add .
git commit -m "descripción del cambio"
git push
```

Render despliega automáticamente (`autoDeploy: true`). En 2-3 minutos el bot en la
nube ya tiene la versión nueva.

## Notas y limitaciones del plan free

- **750 horas/mes**: un servicio encendido 24/7 consume ~744 h/mes, justo dentro del límite.
- Render **recicla la instancia ~1 vez al mes** (reinicio de unos segundos); el bot se
  reconecta solo gracias a discord.js. Si notas que tarda, UptimeRobot lo despierta.
- El bot **local de tu PC puede apagarse** cuando quieras: deja de ser necesario.
- Si algún día Render apaga el servicio tras un fallo, puedes hacerle "Manual Deploy"
  desde el panel y UptimeRobot seguirá manteniéndolo despierto.
- El token vive solo en el panel de Render (Environment), nunca en el repositorio.
