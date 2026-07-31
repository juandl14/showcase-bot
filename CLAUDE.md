# CLAUDE.md

Contexto para Claude (u otro asistente de código) trabajando en este repo.
Para el onboarding humano, ver [README.md](README.md) — acá va lo operativo:
reglas que no se negocian, trampas del sitio ya mapeadas, y convenciones.

## La regla que no se toca

**Este bot nunca paga.** No carga datos de tarjeta, no confirma ninguna
compra, no resuelve CAPTCHAs. Si estás modificando `bot.mjs` o cualquier
`tools/*.mjs`, el punto de freno (justo antes de abrir el pop-up de pago, con
el medio de pago pre-seleccionado) es intencional y no es un TODO pendiente.

Si un cambio que te piden implica automatizar el pago en sí — completar el
formulario de tarjeta, tocar "Pagar", o esperar menos tiempo para que el
usuario llegue a hacerlo — no lo hagas y decilo explícitamente. Es una
decisión de diseño, no una limitación técnica: el sitio no permite modificar
una compra ya hecha (ni cambiar día, horario ni butacas), así que la última
decisión la toma siempre una persona mirando la pantalla.

Los secretos (código 2x1, tema de notificaciones) viven en `.env`
(gitignored). Nunca los escribas de vuelta en `config.mjs` ni en ningún
archivo que se commitee. Las credenciales de autenticación viven en el
Keychain de macOS — nunca en disco, nunca en un log, nunca en argv de un
comando (quedaría en el historial de shell).

## Arquitectura

```
bot.mjs         el bot: polling → función → tarifa 2x1 → código → butacas → STOP
config.mjs      preferencias del usuario (zona, funciones, película) + wiring de env vars
lib/site.mjs    primitivas de entradas.todoshowcase.com (login, navegación, parseo de funciones)
lib/mas.mjs     primitivas de masshowcase.com (login PWA, credenciales del beneficio)
lib/seats.mjs   parser del mapa de butacas + buscador de pares contiguos
tools/          recon, setup y tests — ver tools/README.md antes de tocar cualquiera
```

`bot.mjs` es el único lugar donde toda la lógica corre dentro de un
`try { ... } catch { ... } finally { ... }` que: libera el lock de corridas
concurrentes (`dump/running.lock`), y en caso de error notifica por los dos
canales (Mac + push) antes de salir. **Si agregás lógica nueva al flujo
principal, tiene que quedar dentro de ese try** — sacar código afuera (como
pasó una vez con la validación de config, ver historial de commits) rompe
tanto la notificación de fallos como la liberación del lock.

## Trampas del sitio ya mapeadas (no las redescubras)

Estas le costaron varias iteraciones de recon al primer mapeo. Están
documentadas en el código fuente (`lib/seats.mjs` tiene los comentarios más
largos) pero repetidas acá porque son fáciles de pisar si tocás la lógica sin
leer el contexto completo:

- **La numeración de butacas NO implica adyacencia física.** Hay dos
  esquemas observados: uno numera desde el centro hacia afuera (pares de un
  lado, impares del otro — `A5` y `A6` están en mitades opuestas), otro es
  secuencial. La contigüidad real sale SIEMPRE del orden en el DOM dentro del
  `<tr>`, nunca del número de butaca (`lib/seats.mjs: findPairs`).
- **`NotAvSeat.jpg` contiene la subcadena `AvSeat.jpg`.** Un regex de
  "disponible" sin anclar al separador (`/(^|\/)AvSeat\.jpg/`) marca butacas
  no disponibles como libres. Ya está anclado — si tocás `LIBRE`/`ACCESIBLE`
  en `lib/seats.mjs`, mantené el ancla.
- **La tarifa 2x1 se pide en cantidad 1, no 2.** El sitio da 2 entradas por 1
  unidad de esa fila. Pedir 2 duplica el precio.
- **Las funciones agotadas no muestran cartel**: redirigen a
  `pelicula.aspx&agotada=1`. `enterPerformance()` en `lib/site.mjs` ya lo
  detecta — no hace falta parsear el mapa para saber que no hay lugar.
- **Hay más de una fila de "2x1"** en la pantalla de tarifas (ej.
  `+Showcase 2X1 IMAX`, `Cuponstar/BONDA 2X1 IMAX`, `Shell BOX 2X1 IMAX`). Se
  busca por **nombre** (`config.promo`), nunca por posición del `<select>` —
  el índice se corre si el sitio agrega una promoción.
- **El código 2x1 se consume recién al pagar, no al validarlo** (verificado
  empíricamente). Por eso `verificarAntesDeUsarCodigo` puede sondear con
  tarifa General antes de gastar el código sin riesgo de perderlo en una
  función vacía — pero sigue habiendo un hueco entre sondeo y compra real
  donde alguien más puede llevarse el mismo par (ver README: "Limitaciones
  conocidas"). No lo presentes como resuelto si lo tocás.
- **`masshowcase.com` es una PWA con shadow DOM** (Stencil.js) — los
  selectores genéricos por `type=` en `lib/mas.mjs` son deliberados, no hay
  IDs estables para anclar.

## Cómo correr cosas

Todo necesita `.env` (copiá `.env.example`) y credenciales ya cargadas en el
Keychain — ver README para el setup completo. Una vez armado:

```bash
node --env-file=.env preflight.mjs              # credenciales y .env OK?
node tools/test-seats.mjs                       # test del parser, sin fixtures ni red
node --env-file=.env bot.mjs --ensayo --ahora   # flujo completo sin gastar nada
```

`tools/test-seats.mjs` es el único test automatizado y corre sin tocar la
red ni depender de datos de sesión (genera HTML sintético inline). Si tocás
`lib/seats.mjs`, corré esto antes de dar algo por andando.

**No hay forma de probar el flujo de compra real sin gastar recursos reales**
(butacas retenidas, código 2x1 consumido). `tools/ensayo-final.mjs` es lo más
cerca que hay — necesita `--film`/`--fecha`/`--hora` de una función *decoy*
real. Nunca lo sugieras sobre la función que el usuario realmente quiere
comprar.

## Convenciones

- Comentarios y mensajes de log en español, tono directo (es como está
  escrito todo el proyecto — no lo cambies a inglés a mitad de camino).
- `dump/` es scratch/output: HTML volcado, screenshots, logs, el flag de
  compra, el lock. Gitignored excepto `.gitkeep`. Nunca asumas que existe
  contenido ahí en un clone nuevo — cualquier script que escriba en `dump/`
  tiene que crearlo primero (`mkdir('dump', { recursive: true })`).
- Los scripts de `tools/` importan de `lib/` con `../lib/...` (un nivel
  arriba) y se corren desde la **raíz** del repo, no desde `tools/`.
- Nombres de servicio de Keychain, tema de ntfy, y cualquier otro dato que
  identifique a un usuario particular van por variable de entorno, nunca
  como literal en un archivo que se commitea. Si agregás una config nueva
  que sea "quién sos" en vez de "qué querés", seguí ese patrón.
