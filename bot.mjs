// Bot de compra. FRENA ANTES DEL PAGO — siempre.
//
// Recorre: función -> tarifa 2x1 -> código -> butacas contiguas -> STOP.
// No carga datos de tarjeta, no confirma compras, no resuelve CAPTCHAs.
//
//   node --env-file=.env bot.mjs            corre el flujo (espera el drop si hace falta)
//   node --env-file=.env bot.mjs --ahora    saltea el polling y prueba las funciones ya
//   node --env-file=.env bot.mjs --ensayo   todo el flujo pero SIN código y SIN clickear butacas

import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import cfg from './config.mjs';
import {
  getCredentials, login, openFilm, openFilmDate, listPerformances, enterPerformance, alert,
} from './lib/site.mjs';
import { readSeatMap, markAvailability, findPairs, summarize } from './lib/seats.mjs';

const argv = process.argv.slice(2);
const YA = argv.includes('--ahora');
const ENSAYO = argv.includes('--ensayo');

const log = (...a) => console.log(new Date().toLocaleTimeString('es-AR'), ...a);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ms hasta el próximo múltiplo de intervaloSeg pasada la hora en punto, + margen.
// Alinea el polling a minutos redondos (:00, :10, :20…) y cae unos segundos
// después, por si el drop se publica justo en la hora redonda.
function msHastaTickRedondo(intervaloSeg, margenSeg = 15) {
  const now = new Date();
  const seg = now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
  const prox = (Math.floor(seg / intervaloSeg) + 1) * intervaloSeg;
  return Math.round((prox - seg + margenSeg) * 1000);
}

// Push al celular vía ntfy.sh (sin cuenta). Nunca rompe el bot si falla: los
// avisos de la Mac siguen igual. El tema sale de NTFY_TOPIC (ver config.mjs).
async function pushPhone(title, message) {
  if (!cfg.ntfyTopic) return;
  const asciiTitle = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '').trim() || 'Showcase';
  try {
    await fetch(`https://ntfy.sh/${cfg.ntfyTopic}`, {
      method: 'POST',
      headers: { Title: asciiTitle, Priority: 'high', Tags: 'clapper' },
      body: message,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* la notificación es best-effort; el bot nunca se cae por esto */
  }
}

// Avisa por los dos canales a la vez: notificación local de la Mac + push al celu.
const avisar = async (title, msg) => { await alert(title, msg); await pushPhone(title, msg); };

// dump/ está gitignoreado (guarda screenshots y datos de tu sesión), así que un
// clone nuevo no lo trae. Sin esto, el primer `writeFile('dump/...')` revienta
// con ENOENT antes de que el bot haga nada útil.
await mkdir('dump', { recursive: true });

// Traba contra doble compra: al asegurar butacas se escribe esta marca; si al
// arrancar ya existe, el bot sale sin hacer nada. Para volver a usar el bot
// (otra función, otra semana), borrá este archivo.
const FLAG = 'dump/comprado.flag';

// Traba contra CORRIDAS CONCURRENTES del mismo bot (p. ej. lo lanzaste a mano
// justo cuando launchd también disparaba). A diferencia de FLAG, esta se toma
// al arrancar y se libera siempre al terminar — sea éxito, error o "no había
// nada". Si el proceso dueño del lock ya no existe (crash sin limpiar), se
// considera stale y se toma igual.
const LOCK = 'dump/running.lock';
async function tomarLock() {
  try {
    await writeFile(LOCK, String(process.pid), { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pidPrevio = Number((await readFile(LOCK, 'utf8').catch(() => '')).trim());
    if (pidPrevio) {
      try {
        process.kill(pidPrevio, 0); // no mata a nadie, solo pregunta si sigue vivo
        return false; // vivo de verdad: hay otra corrida en curso
      } catch {
        /* pid muerto: el lock es de una corrida anterior que no limpió */
      }
    }
    await writeFile(LOCK, String(process.pid));
    return true;
  }
}

if (!(await tomarLock())) {
  log(`Ya hay otra corrida de este bot en curso (${LOCK}). Salgo para no pisarla.`);
  process.exit(0);
}

// --- Validación de config ---------------------------------------------------
if (!ENSAYO && existsSync(FLAG)) {
  log(`Ya hay una compra registrada (${FLAG}). Salgo para no comprar de nuevo.`);
  log('Si querés correr otra compra, borrá ese archivo.');
  await unlink(LOCK).catch(() => {});
  process.exit(0);
}
if (!ENSAYO && !/^\d{12}$/.test(cfg.codigo ?? '')) {
  throw new Error(
    `El código 2x1 no es válido (config.codigo = "${cfg.codigo}").\n` +
      `Seteá SHOWCASE_2X1_CODE en tu .env con los 12 dígitos. Ver README.`
  );
}
if (!cfg.funciones?.length) throw new Error('config.funciones está vacío.');
if (!Array.isArray(cfg.zona) || !cfg.zona.length) throw new Error('config.zona está vacío.');
if (!(cfg.medioDePago instanceof RegExp)) {
  throw new Error('config.medioDePago tiene que ser un RegExp, ej. /VISA\\s*CR[EÉ]DITO/i.');
}
{
  // Dos errores de tipeo típicos al armar la zona a mano: filas repetidas
  // (silenciosamente se queda solo con la última) y min > max (esa fila no
  // matchea ninguna butaca nunca, también en silencio). Fallar fuerte acá es
  // mucho mejor que descubrirlo el día del drop viendo que una fila "no anda".
  const vistas = new Set();
  for (const z of cfg.zona) {
    const et = String(z.fila ?? '').toUpperCase();
    if (vistas.has(et)) throw new Error(`config.zona tiene la fila "${z.fila}" repetida.`);
    vistas.add(et);
    if (z.min != null && z.max != null && z.min > z.max) {
      throw new Error(`config.zona: fila "${z.fila}" tiene min (${z.min}) > max (${z.max}).`);
    }
  }
}

// --- Día de semana en hora local de Argentina, sin depender del TZ del host ---
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const sinTilde = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function diaDeFecha(iso) {
  // iso = 'YYYY-MM-DD'. Se ancla a mediodía UTC para que el día no se corra.
  return DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
}

/**
 * Traduce config.funciones (día+hora) a fechas concretas dentro de la ventana
 * recién liberada (posterior a ventanaConocidaHasta), respetando el orden de
 * preferencia. Las que no matcheen ninguna fecha nueva se descartan.
 */
function resolverFunciones(fechasEnCartel) {
  const nuevas = fechasEnCartel.filter((d) => d > cfg.polling.ventanaConocidaHasta);
  const out = [];
  for (const f of cfg.funciones) {
    const objetivo = sinTilde(f.dia);
    const fecha = nuevas.find((d) => diaDeFecha(d) === objetivo); // la más temprana de ese día
    if (fecha) out.push({ ...f, fecha });
  }
  return out;
}

let browser;
try {
  const creds = await getCredentials();
  browser = await chromium.launch({ headless: false }); // visible: vos tomás el control
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();

  // Butacas efectivamente seleccionadas, para el mensaje de handoff.
  let seleccion = null;

  if (!(await login(page, creds))) throw new Error('Login fallido.');
  log('login OK');

  // Push de arranque (solo al celu) para confirmar que el canal llega.
  if (!ENSAYO) await pushPhone('Showcase', 'Bot en marcha, esperando el drop.');

  // --- Espera del drop --------------------------------------------------------
  // Detecta el drop por lo que importa de verdad: que las funciones de tu lista
  // aparezcan en cartel. No depende de hardcodear la fecha de fin de ventana.
  if (!YA && !ENSAYO) {
    const limite = Date.now() + cfg.polling.maxHoras * 3600_000;
    const mins = Math.max(1, Math.round(cfg.polling.intervaloSeg / 60));
    log(`esperando el drop; chequeo cada ${mins} min, alineado a minutos redondos (hasta ${cfg.polling.maxHoras}h)`);
    while (Date.now() < limite) {
      // Chequea ya (así no hay hueco ciego al arrancar), y después se alinea.
      const dates = await openFilm(page, cfg.filmId).catch(() => []);
      const disponibles = resolverFunciones(dates);
      if (disponibles.length) {
        log(`¡DROP! ${disponibles.length} función(es) de tu lista ya están en cartel`);
        await avisar('Showcase — ¡drop!', `${disponibles.length} funciones tuyas disponibles. Voy por las butacas.`);
        break;
      }
      // Dormimos hasta el próximo minuto redondo (:00, :10, :20…) + margen, para
      // caer JUSTO DESPUÉS de una hora redonda, que es cuando es más probable que
      // el cine publique. Si el drop es a cualquier hora, no perdemos nada.
      const esperaMs = msHastaTickRedondo(cfg.polling.intervaloSeg, 15);
      const prox = new Date(Date.now() + esperaMs).toLocaleTimeString('es-AR');
      log(`  sin novedad (fin de ventana: ${dates.at(-1) || '?'}); próximo chequeo ${prox}`);
      await dormir(esperaMs);
    }

    // Tras horas de polling la sesión pudo expirar. Reautenticamos antes de la
    // carrera para no descubrir en el peor momento que quedamos deslogueados.
    log('re-login antes de arrancar la compra…');
    if (!(await login(page, creds))) throw new Error('Re-login tras el drop falló.');
    log('re-login OK');
  }

  // --- Intento sobre una función ----------------------------------------------
  /** Devuelve 'listo' | 'agotada' | 'sin-zona' | 'error'. */
  async function intentar({ fecha, hora }, { usarPromo }) {
    if (!(await openFilmDate(page, fecha, cfg.filmId))) return 'error';

    const perf = (await listPerformances(page)).find(
      (p) => cfg.cine.test(p.cinema) && p.time === hora
    );
    if (!perf) return 'error';

    const estado = await enterPerformance(page, perf);
    if (estado === 'agotada') return 'agotada';
    if (estado !== 'ok') { log(`  estado inesperado al entrar (${estado}); trato como error`); return 'error'; }

    // --- Tarifa: la promo se busca por NOMBRE, nunca por índice de control.
    const tarifas = await page.evaluate(() =>
      ['gridPrices', 'gridPromos'].flatMap((g) =>
        [...document.querySelectorAll(`#ctl00_Contenido_${g} tr`)]
          .map((tr) => {
            const s = tr.querySelector('select');
            if (!s) return null;
            return { grid: g, nombre: tr.querySelector('td')?.innerText.trim() ?? '', selectId: s.id };
          })
          .filter(Boolean)
      )
    );

    let fila;
    if (usarPromo) {
      fila = tarifas.find((t) => t.grid === 'gridPromos' && cfg.promo.test(t.nombre));
      if (!fila) {
        log(`  no encontré la tarifa ${cfg.promo}. Hay: ${tarifas.map((t) => t.nombre).join(' | ')}`);
        return 'error';
      }
      log(`  tarifa: "${fila.nombre}" -> cantidad 1 (el 2x1 da 2 entradas con 1 unidad)`);
    } else {
      fila = tarifas.find((t) => t.grid === 'gridPrices' && /general/i.test(t.nombre)) ?? tarifas[0];
      log(`  tarifa de sondeo: "${fila.nombre}" -> 2`);
    }

    // El 2x1 se pide en cantidad 1 y entrega 2 entradas. Pedir 2 daría 4.
    await page.selectOption(`#${fila.selectId}`, usarPromo ? '1' : '2');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(900);
    await page.click('#ctl00_Contenido_btnContinue');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);

    // --- Código del beneficio (solo en el camino con promo)
    if (page.url().includes('ingresar_cod.aspx')) {
      if (ENSAYO) { log('  [ensayo] llegué al código y freno acá'); return 'listo'; }
      await page.fill('#ctl00_Contenido_gridVouchers_ctl02_Codigo', cfg.codigo);
      await page.click('#ctl00_Contenido_btnContinue');
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(1800);
      if (page.url().includes('ingresar_cod.aspx')) {
        const msg = await page.evaluate(() => document.body.innerText.slice(0, 400));
        log(`  el sitio no aceptó el código:\n${msg}`);
        return 'error';
      }
      log('  código aceptado');
    }

    // --- Butacas
    if (!page.url().includes('butacas.aspx')) return 'error';
    const filas = markAvailability(await readSeatMap(page));
    const s = summarize(filas);
    const pares = findPairs(filas, cfg.zona);
    log(`  sala: ${s.libres}/${s.total} libres — ${pares.length} par(es) contiguo(s) en tu zona`);

    // Regla dura: nunca butacas fuera de la zona. Sin par, se descarta la función.
    if (!pares.length) return 'sin-zona';

    // Sondeo (tarifa General, sin código): solo confirmamos que HAY par en la
    // zona y volvemos, SIN clickear ni retener nada. Así el código no se gasta
    // en una función que no tiene lugar. El asiento real se elige después, en
    // el paso con promo, sobre un mapa recién leído.
    //
    // Ojo — límite conocido: entre este sondeo y la selección real (abajo) pasan
    // varios segundos de por medio (nueva navegación, nueva tarifa, código). En
    // ese hueco, alguien más podría llevarse el mismo par. El sondeo protege el
    // código (no lo gasta en una función vacía), pero no es una reserva atómica.
    if (!usarPromo) {
      log(`  sondeo: hay par en zona (${pares[0].etiquetas.join(' + ')}); no retengo nada`);
      return 'listo';
    }

    const elegido = pares[0];
    log(`  elijo ${elegido.etiquetas.join(' + ')} (fila ${elegido.fila})`);
    if (ENSAYO) { log('  [ensayo] no clickeo butacas'); return 'listo'; }

    // Cada click es un postback: hay que esperar y volver a buscar el elemento.
    for (const b of elegido.butacas) {
      await page.click(`#${b.id}`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(900);
    }
    await page.click('#ctl00_Contenido_btnContinue').catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);

    // --- Productos: continuar SIN agregar nada ---------------------------------
    if (page.url().includes('productos.aspx')) {
      await page.click('#ctl00_Contenido_btnContinue').catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(1500);
    }

    // --- Forma de pago: pre-seleccionar el medio y FRENAR ----------------------
    // NO se abre el pop-up (eso arranca el reloj de 5 min y lo hacés vos). NO se
    // carga tarjeta. NO se paga. Solo dejamos el medio elegido marcado y listo.
    seleccion = { seats: elegido.etiquetas, fila: elegido.fila };
    if (page.url().includes('confirmar.aspx')) {
      const { source, flags } = cfg.medioDePago;
      const radioId = await page.evaluate(({ source, flags }) => {
        const re = new RegExp(source, flags);
        for (const r of document.querySelectorAll('input[type=radio]')) {
          const lbl =
            document.querySelector(`label[for="${r.id}"]`)?.innerText ||
            r.closest('label')?.innerText ||
            r.parentElement?.innerText ||
            '';
          if (re.test(lbl)) return r.id;
        }
        return null;
      }, { source, flags });
      if (radioId) {
        await page.check(`#${radioId}`).catch(() => page.click(`#${radioId}`).catch(() => {}));
        log(`  medio de pago pre-seleccionado (#${radioId})`);
      } else {
        log(`  ⚠ no encontré el medio de pago ${cfg.medioDePago}. Seleccionalo vos.`);
      }
      return 'listo';
    }

    // Si el flujo no llegó a confirmar.aspx, algo cambió: reportar dónde quedó.
    log(`  ⚠ esperaba confirmar.aspx, quedé en ${page.url()}`);
    return 'listo';
  }

  // --- Resolver día+hora a fechas concretas del drop --------------------------
  const enCartel = await openFilm(page, cfg.filmId);
  const agenda = resolverFunciones(enCartel);
  if (!agenda.length) {
    throw new Error(
      `Ninguna de tus funciones matchea fechas nuevas (posteriores a ` +
        `${cfg.polling.ventanaConocidaHasta}). Fechas en cartel: ${enCartel.at(-1)}`
    );
  }
  log('funciones a intentar, en orden:');
  agenda.forEach((f, i) => log(`  ${i + 1}. ${f.dia} ${f.fecha} ${f.hora}`));

  // --- Recorrido en orden de preferencia --------------------------------------
  let ok = null;
  for (const f of agenda) {
    log(`probando ${f.dia} ${f.fecha} ${f.hora}`);

    if (cfg.verificarAntesDeUsarCodigo) {
      const sondeo = await intentar(f, { usarPromo: false });
      if (sondeo !== 'listo') { log(`  sondeo: ${sondeo}, siguiente`); continue; }
      log('  sondeo OK, rehago con el 2x1');
    }

    const r = await intentar(f, { usarPromo: true });
    log(`  resultado: ${r}`);
    if (r === 'listo') { ok = f; break; }
  }

  // --- Handoff ----------------------------------------------------------------
  if (ENSAYO) {
    log(ok ? '\n[ensayo] el flujo llegó hasta el final sin comprar nada.' : '\n[ensayo] no llegó al final.');
  } else if (ok) {
    const asientos = seleccion ? seleccion.seats.join(' + ') : '(ver pantalla)';
    const msg = `${ok.dia} ${ok.fecha} ${ok.hora} — butacas ${asientos} retenidas.`;
    // Marca de doble-compra: se escribe ANTES del sleep de handoff, así persiste
    // aunque el proceso muera mientras esperás para pagar.
    await writeFile(FLAG, `${new Date().toISOString()} — ${msg}\n`).catch(() => {});
    log('\n' + '='.repeat(64));
    log('¡LISTO! ' + msg);
    log('AHORA, EN EL NAVEGADOR:');
    log('  1. Tocá CONTINUAR (ahí arranca el reloj de la pasarela de pago).');
    log('  2. Cargá los datos de la tarjeta y confirmá el pago.');
    log('El bot NO carga la tarjeta ni paga: eso lo hacés vos.');
    log('='.repeat(64));
    // Aviso repetido: el pop-up de pago recién arranca cuando tocás CONTINUAR,
    // pero quiero que llegues a la compu cuanto antes igual.
    for (let i = 0; i < 3; i++) { await avisar('¡Entradas listas! Pagá vos', msg); await dormir(2000); }
    await dormir(30 * 60_000); // navegador abierto media hora para que completes
  } else {
    log('Ninguna función tuvo un par contiguo en tu zona.');
    await avisar('Showcase', 'No conseguí butacas en tu zona en ninguna función.');
  }
} catch (err) {
  const detalle = err?.stack || err?.message || String(err);
  log('ERROR FATAL:', detalle);
  // Best-effort: si el error pasó ANTES de tener credenciales o browser, esto
  // igual intenta avisar — pushPhone no depende de ninguno de los dos.
  await pushPhone('Showcase — el bot falló', String(err?.message || err).slice(0, 200)).catch(() => {});
  await alert('Showcase — el bot falló', String(err?.message || err).slice(0, 200)).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await unlink(LOCK).catch(() => {});
}
