# showcase-bot

Bot que automatiza la carrera por conseguir 2 butacas contiguas apenas
[Cines Showcase Argentina](https://entradas.todoshowcase.com) libera una
nueva tanda de funciones, aplicando el beneficio 2x1 IMAX de
[masshowcase.com](https://masshowcase.com) (plataforma Bonda). Nació para
resolver un caso puntual — conseguir entradas de un estreno IMAX que se
agotaba en minutos — y quedó documentado para que cualquiera en la misma
situación lo pueda adaptar.

**Es específico de esta cadena de cines.** No es un scraper genérico de
entradas: los selectores, el flujo de compra y las trampas documentadas acá
son los de `entradas.todoshowcase.com` (ASP.NET WebForms) y
`masshowcase.com` (PWA Bonda). Sirve tal cual para esa cadena; para otra
tendrías que re-mapear el sitio con las herramientas de `tools/`.

> Si vas a tocar o extender este proyecto con Claude Code (u otro asistente),
> leé primero [CLAUDE.md](CLAUDE.md) — tiene las trampas del sitio ya
> mapeadas y la regla de diseño que no se negocia, para no redescubrirlas
> desde cero.

## La regla que no se negocia

**El bot frena siempre antes del pago.** No carga datos de tarjeta, no
confirma ninguna compra, no resuelve CAPTCHAs. Deja las butacas retenidas y
el medio de pago pre-seleccionado, te avisa, y una persona completa la
tarjeta y confirma. Esto no es una limitación pendiente de resolver — es la
razón de ser del diseño: el sitio no permite modificar una compra ya hecha
(ni cambiar día, horario ni butacas), así que la última decisión la toma
siempre alguien mirando la pantalla.

Tus credenciales de *autenticación* (usuario/contraseña de ambos sitios)
viven en el Keychain de macOS, nunca en un archivo. Ningún dato de pago pasa
por este proyecto en ningún momento.

## Qué hace, en orden

```
polling (alineado a minutos redondos, hasta detectar el drop)
  → por cada función en TU orden de preferencia:
      sondeo de disponibilidad (sin gastar el código)
      → tarifa 2x1 → código → butacas contiguas en TU zona
  → productos (sin agregar nada)
  → forma de pago: medio de pago pre-seleccionado
  → STOP. Notificación (Mac + push opcional al celu). Pagás vos.
```

Ver [tools/README.md](tools/README.md) para las herramientas de investigación
y setup que se usaron para mapear todo esto, y que te van a servir para
armar tu propia configuración.

## Requisitos

- macOS (usa el Keychain y `osascript` para notificaciones — no portado a
  otros sistemas)
- [Node.js](https://nodejs.org) 20.6 o superior (usa `--env-file`, nativo,
  sin dependencias extra)
- Cuenta en `entradas.todoshowcase.com` (la que compra)
- Cuenta en `masshowcase.com` (la del beneficio 2x1 — puede ser la misma
  persona con una cuenta distinta, o directamente otra cuenta; no asumas que
  comparten contraseña)

## Setup

### 1. Instalar

```bash
git clone https://github.com/juandl14/showcase-bot.git
cd showcase-bot
npm install
npm run setup    # descarga el Chromium que usa Playwright
```

### 2. Guardar tus credenciales en el Keychain

**Nunca las escribas en un archivo del proyecto.** Cada comando pide la
contraseña de forma interactiva (input oculto) — no la pongas en la línea de
comando, quedaría en tu historial de shell.

```bash
security add-generic-password -a "tu-email-o-usuario" -s showcase-entradas -w
security add-generic-password -a "tu-email-o-usuario" -s mas-showcase-beneficio -w
```

Verificar que se leen bien, sin imprimir nada sensible:

```bash
cp .env.example .env
node --env-file=.env preflight.mjs
```

### 3. Código 2x1

Reclamá el beneficio 2x1 de IMAX en `masshowcase.com/beneficios` (a mano, una
vez). Los códigos observados valen hasta fin de año y se puede reclamar uno
por día — no hace falta reclamarlo el mismo día que compras.

Para llevarlo a tu `.env` sin tipear los 12 dígitos a mano (evita errores que
rebotan el código justo en el momento crítico):

```bash
node tools/traer-codigo.mjs
```

O poné `SHOWCASE_2X1_CODE=` a mano en tu `.env`.

### 4. Configurar `config.mjs`

Es el único archivo de código que necesitás tocar. Editá:

- **`filmId`** — de la URL de la película: `pelicula.aspx?filmid=N`
- **`cine`** — regex sobre el nombre del complejo/sala
- **`zona`** — filas aceptables y rango de butacas de cada una, en orden de
  preferencia. Para armar la tuya:
  ```bash
  node tools/mapear-sala.mjs        # encuentra una función con lugar y vuelca el mapa
  node tools/plano-sala.mjs dump/mapa-sala.html   # lo dibuja con los números reales
  ```
- **`funciones`** — tus día+horario preferidos, en orden. Las que no estén
  en la lista nunca se consideran.
- **`polling.ventanaConocidaHasta`** — la última fecha ya publicada hoy; el
  bot dispara cuando aparece algo posterior a esto.

El archivo tiene comentarios extensos en cada campo — es más rápido editar
ahí mismo que resumir todo acá.

### 5. Notificaciones (opcional)

Además del sonido/notificación local de macOS, podés recibir push al
celular vía [ntfy.sh](https://ntfy.sh) — sin cuenta, sin API key.

1. Instalá la app **ntfy** (iOS/Android) o simplemente abrí
   `https://ntfy.sh/<tu-tema>` en el navegador del celu.
2. Elegí un tema **no adivinable** (es semi-público: quien lo sepa puede leer
   tus avisos, incluido cuándo conseguiste butacas):
   ```bash
   node -e "console.log('showcase-' + Math.random().toString(36).slice(2,10))"
   ```
3. Suscribite a ese tema en la app.
4. Poné `NTFY_TOPIC=` en tu `.env`.

Sin `NTFY_TOPIC`, el bot sigue avisando por notificación local de Mac
únicamente.

## Uso

```bash
node --env-file=.env preflight.mjs          # credenciales y .env OK?
node tools/test-seats.mjs                   # el parser de butacas sigue sano?
node --env-file=.env bot.mjs --ensayo --ahora   # flujo completo, SIN código y SIN clickear
node --env-file=.env bot.mjs                # el día real: espera el drop y va
```

`--ahora` saltea el polling y prueba las funciones ya (útil si sabés que ya
está todo publicado). `--ensayo` corre el flujo entero sin gastar el código
ni retener butacas — es el modo seguro para probar que todo está bien armado.

Cuando el bot consigue butacas, **deja el navegador abierto** en la pantalla
de forma de pago, con el medio de pago marcado, y espera 30 minutos. Ahí:

1. Tocás **Continuar** (recién ahí arranca el reloj del pop-up de pago).
2. Cargás la tarjeta y confirmás.

### Arranque automático (opcional)

Si no querés estar pendiente de lanzarlo a mano, `launchd/` trae una
plantilla para que macOS lo dispare solo a una hora fija:

```bash
cp launchd/com.example.showcasebot.plist ~/Library/LaunchAgents/com.tu-usuario.showcasebot.plist
```

Editá en el plist copiado:
- `__PROJECT_DIR__` (dos lugares) → la ruta absoluta a tu clone
- `Month`/`Day`/`Hour`/`Minute` → cuándo esperás el drop

Y en `launchd/run-bot.sh`, la línea `NODE_BIN="node"` → la ruta absoluta de
tu `node` (`which node`). **Esto es obligatorio si usás nvm**: launchd no
carga tu shell config, así que un `node` a secas no se va a encontrar, o va a
resolver a uno equivocado.

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tu-usuario.showcasebot.plist
```

Para probarlo sin esperar a la hora programada:

```bash
launchctl kickstart gui/$(id -u)/com.tu-usuario.showcasebot
tail -f dump/bot.log
```

Y para desactivarlo:

```bash
launchctl bootout gui/$(id -u)/com.tu-usuario.showcasebot
```

## Salvaguardas

- **Nunca compra**: frena antes de cargar cualquier dato de pago, en todos
  los caminos (éxito, error, o "no encontré nada").
- **Nunca gasta el código sin necesidad**: por defecto (`verificarAntesDeUsarCodigo:
  true`) sondea disponibilidad con tarifa General antes de enviar el código,
  así una función sin lugar no te lo consume.
- **Nunca toma butacas fuera de tu zona**: es una regla dura del buscador de
  pares, no una preferencia blanda.
- **No compra dos veces**: al conseguir butacas escribe `dump/comprado.flag`;
  cualquier corrida posterior (a mano o por launchd) lo detecta y sale sin
  hacer nada. Para reusar el bot en otra función, borrá ese archivo.
- **No corre dos veces en paralelo**: toma un lock (`dump/running.lock`) al
  arrancar. Si lo lanzás a mano justo cuando el launchd también dispara, la
  segunda corrida se retira sola.
- **Avisa si algo se rompe**: cualquier error fatal (login caído, sesión
  vencida, lo que sea) dispara notificación antes de salir — no falla en
  silencio mientras estás lejos de la pantalla.

## Limitaciones conocidas

- **Hueco entre sondeo y compra real**: el sondeo confirma que hay lugar,
  pero entre eso y la selección real pasan varios segundos (nueva
  navegación, nueva tarifa, código). En ese hueco alguien más podría
  llevarse el mismo par. No es una reserva atómica — es una carrera con
  ventaja, no una garantía.
- **El bot te da ventaja de segundos, no milagros**: si la sala se agota en
  3 segundos por cupo mínimo, ninguna automatización lo cambia.
- **Automatizar un sitio de terceros puede violar sus Términos de Servicio.**
  Este bot actúa siempre con tu propia sesión autenticada, no resuelve
  CAPTCHAs, no evade ninguna protección anti-bot, y nunca ejecuta la
  transacción final — pero la responsabilidad de revisar los términos del
  sitio es tuya.
- **Supuesto de calendario**: `polling.ventanaConocidaHasta` asume que sabés
  cuál es la última fecha ya publicada. Si te equivocás esa fecha (muy
  vieja), el bot puede disparar de entrada contra una ventana que ya
  conocías.

## Estructura del repo

```
bot.mjs              el bot
config.mjs            tu configuración (zona, funciones, película)
.env                  tus secretos (no se commitea)
preflight.mjs         chequeo de credenciales y .env
smoke.mjs             smoke test rápido (fechas/funciones), sin credenciales
lib/
  site.mjs             primitivas de entradas.todoshowcase.com
  mas.mjs              primitivas de masshowcase.com (login, credenciales)
  seats.mjs            parser del mapa de butacas + buscador de pares
tools/                 setup, recon y verificación — ver tools/README.md
launchd/               plantilla para arranque automático
```

## Licencia

MIT. Ver [LICENSE](LICENSE).
