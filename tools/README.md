# tools/

Herramientas de investigación, setup y verificación. **No hacen falta para
correr el bot** (eso es solo `bot.mjs` + `config.mjs` + `.env`) — son para
armar tu configuración la primera vez, o para re-mapear el sitio si algo
cambió.

Corré todas desde la **raíz del repo**, no desde `tools/` (así los archivos
que generan quedan en `./dump/` junto con todo lo demás):

```bash
node tools/recon.mjs
```

Ninguna de estas herramientas paga, confirma una compra, ni carga datos de
tarjeta — la única excepción que gasta algo real es `ensayo-final.mjs`, que
consume tu código 2x1 del día (ver su propia advertencia abajo).

## Setup — para armar tu config la primera vez

| Herramienta | Qué hace |
|---|---|
| **`mapear-sala.mjs`** | Busca, en TODA la cartelera, la primera función con lugar en la sala que le pidas (`--cine "IMAX Theatre"` por defecto), y vuelca su mapa de butacas + tarifas. No necesitás que la película que te interesa ya tenga funciones abiertas. |
| **`plano-sala.mjs`** | Dibuja en ASCII el plano de una sala a partir de un HTML volcado (por `mapear-sala.mjs` o `recon.mjs`), con los números reales de cada butaca. Usalo para decidir tu `config.zona`. |
| **`traer-codigo.mjs`** | Lee tu código 2x1 del historial de masshowcase y lo escribe en `.env` (`SHOWCASE_2X1_CODE`). Evita errores de tipeo en los 12 dígitos. Solo lectura del lado de masshowcase; no reclama nada. |
| **`check-codigo.mjs`** | Vuelve a mirar el historial de masshowcase para confirmar si un código sigue vigente o quedó consumido. Depende de `dump/mas-historial.txt` (lo genera `recon-mas.mjs`). |

## Recon — para entender o re-verificar el sitio

Útiles si el sitio cambió algo (un selector, un paso del flujo) y el bot
empieza a fallar en un punto nuevo. Cada uno vuelca HTML/screenshots a
`dump/` con el estado de esa pantalla.

| Herramienta | Qué mapea |
|---|---|
| **`recon.mjs`** | El flujo de todoshowcase hasta el mapa de butacas: selección de función → precio → (si hay promo) código → butacas. `--cine` / `--date` opcionales. |
| **`recon-mas.mjs`** | La página de beneficios de masshowcase (Bonda/PWA), capturando además las llamadas a su API GraphQL — útil si algún día conviene reclamar el código por API en vez de por DOM. |
| **`recon-checkout.mjs`** | El tramo final: productos → forma de pago → pop-up de pago. Necesita `--film <filmId>` de una función cualquiera con lugar. Abre el pop-up para leer su contador y estructura, y **cancela** sin pagar. |

## Ensayo — para probar el flujo de punta a punta

**`ensayo-final.mjs`** — corre el flujo completo (código real + click de
butacas reales) sobre una función que le indiques, y frena justo antes del
pago. Es la única forma de confirmar que el código, el click de butacas y el
checkout andan juntos, no por separado.

```bash
node --env-file=.env tools/ensayo-final.mjs --film <filmId> --fecha YYYY-MM-DD --hora HH:MM
```

**Advertencia real**: esto **consume tu código 2x1 del día**, aunque no
llegues a pagar nada — el sitio lo da por usado en cuanto lo valida. Usalo
sobre una función *decoy* que no te importe (nunca sobre la que realmente
querés comprar), y sabiendo que el código se repone recién al día siguiente.
Encontrá una función decoy con `mapear-sala.mjs`.

## Tests — no tocan el sitio

**`test-seats.mjs`** — regresión del parser de butacas (`lib/seats.mjs`)
contra HTML sintético que reproduce los dos esquemas de numeración
conocidos. No depende de ningún volcado real; corre limpio en cualquier
clone.

```bash
node tools/test-seats.mjs
```
