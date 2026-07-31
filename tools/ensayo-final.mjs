// ENSAYO DEL TRAMO FINAL — envía el código y clickea butacas de verdad, pero
// FRENA ANTES DEL PAGO. No carga tarjeta, no confirma nada.
//
// !! CONSUME TU CÓDIGO 2x1 DEL DÍA !! (aunque no pagués nada). Usalo sobre una
// función DECOY que no te importe, nunca sobre la que realmente querés
// comprar — así no arriesgás asientos que sí te interesan. El código se
// repone al día siguiente (ver README: "Código 2x1").
//
// Objetivo: verificar que el flujo completo (código -> butacas -> checkout)
// funciona de punta a punta antes de que dependas de él en el momento real.
//
// El código sale de SHOWCASE_2X1_CODE (.env) — nunca se imprime entero.
//
//   node --env-file=.env tools/ensayo-final.mjs --film <filmId> --fecha YYYY-MM-DD --hora HH:MM
//
// Corré esto desde la raíz del repo (no desde tools/), así los archivos
// quedan en ./dump/ como el resto de las herramientas.
// Tip: node tools/mapear-sala.mjs te da una función IMAX con lugar para usar acá.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  getCredentials, login, openFilm, openFilmDate, listPerformances, enterPerformance,
} from '../lib/site.mjs';
import { readSeatMap, markAvailability, findPairs, summarize } from '../lib/seats.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const PRUEBA = { filmId: Number(arg('film')), fecha: arg('fecha'), hora: arg('hora') };
if (!PRUEBA.filmId || !PRUEBA.fecha || !PRUEBA.hora) {
  throw new Error('Faltan argumentos. Uso: tools/ensayo-final.mjs --film <id> --fecha YYYY-MM-DD --hora HH:MM');
}
const PROMO = /^\+\s*Showcase\s*2X1/i;
const log = (...a) => console.log(new Date().toLocaleTimeString('es-AR'), ...a);

await mkdir('dump', { recursive: true });

// --- Código: sale del .env. No se imprime entero. ---------------------------
const codigo = process.env.SHOWCASE_2X1_CODE;
if (!/^\d{12}$/.test(codigo ?? '')) {
  throw new Error('SHOWCASE_2X1_CODE no está seteada o no son 12 dígitos. Ver .env.example.');
}
log(`código a usar: ${codigo.slice(0, 4)}…${codigo.slice(-2)}`);

const creds = await getCredentials();
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1100 } })).newPage();

if (!(await login(page, creds))) throw new Error('login fallido');
log('login OK');

// --- Función de prueba ------------------------------------------------------
await openFilm(page, PRUEBA.filmId);
if (!(await openFilmDate(page, PRUEBA.fecha, PRUEBA.filmId))) throw new Error('fecha no existe');
const perf = (await listPerformances(page)).find((p) => /IMAX Theatre/i.test(p.cinema) && p.time === PRUEBA.hora);
if (!perf) throw new Error('no encontré la función de prueba');
if ((await enterPerformance(page, perf)) !== 'ok') throw new Error('la función de prueba está agotada; buscá otra IMAX con lugar');
log(`en función de prueba: ${PRUEBA.fecha} ${PRUEBA.hora}`);

// --- Tarifa 2x1 por nombre --------------------------------------------------
const tarifas = await page.evaluate(() =>
  [...document.querySelectorAll('#ctl00_Contenido_gridPromos tr')]
    .map((tr) => {
      const s = tr.querySelector('select');
      return s ? { nombre: tr.querySelector('td')?.innerText.trim() ?? '', selectId: s.id } : null;
    })
    .filter(Boolean)
);
const promo = tarifas.find((t) => PROMO.test(t.nombre));
if (!promo) throw new Error(`no está la tarifa 2x1. Hay: ${tarifas.map((t) => t.nombre).join(' | ')}`);
log(`tarifa: "${promo.nombre}" -> cantidad 1`);
await page.selectOption(`#${promo.selectId}`, '1');
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(900);
await page.click('#ctl00_Contenido_btnContinue');
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1500);

// --- PASO 1: enviar el código ----------------------------------------------
if (!page.url().includes('ingresar_cod.aspx')) throw new Error(`esperaba ingresar_cod.aspx, estoy en ${page.url()}`);
log('pantalla de código OK, enviando…');
await page.fill('#ctl00_Contenido_gridVouchers_ctl02_Codigo', codigo);
await page.screenshot({ path: 'dump/ensayo-1-codigo-cargado.png', fullPage: true });
await page.click('#ctl00_Contenido_btnContinue');
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(2000);

const urlPostCodigo = page.url();
await page.screenshot({ path: 'dump/ensayo-2-post-codigo.png', fullPage: true });
if (urlPostCodigo.includes('ingresar_cod.aspx')) {
  const msg = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 500));
  log(`✗ el sitio NO avanzó. Mensaje: ${msg}`);
  await browser.close();
  process.exit(1);
}
log(`✓ código aceptado, avanzó a: ${urlPostCodigo.split('/').pop()}`);

// --- PASO 2: seleccionar 2 butacas contiguas --------------------------------
if (!page.url().includes('butacas.aspx')) throw new Error(`esperaba butacas.aspx, estoy en ${page.url()}`);
const filas = markAvailability(await readSeatMap(page));
const s = summarize(filas);
// Para el ensayo, cualquier par contiguo sirve: probamos la mecánica de click.
// Zona permisiva: todas las filas presentes, sin acotar butacas.
const zonaLibre = filas.filter((f) => f.etiqueta).map((f) => ({ fila: f.etiqueta }));
const pares = findPairs(filas, zonaLibre);
log(`sala: ${s.libres}/${s.total} libres, ${pares.length} pares contiguos`);
if (!pares.length) throw new Error('la función de prueba no tiene ningún par contiguo libre');
const elegido = pares[0];
log(`clickeando ${elegido.etiquetas.join(' + ')} (fila ${elegido.fila})`);

for (const b of elegido.butacas) {
  await page.click(`#${b.id}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(900);
}
await page.screenshot({ path: 'dump/ensayo-3-butacas-elegidas.png', fullPage: true });

// Verificar que el sitio marcó las butacas como seleccionadas.
const seleccionadas = await page.evaluate(() =>
  [...document.querySelectorAll('input[type=image][title]')]
    .filter((el) => /SelSeat|SelectedSeat|red|verde/i.test(el.getAttribute('src') || '') || el.dataset.sel)
    .map((el) => el.title)
);
log(`el sitio marca como seleccionadas: ${seleccionadas.length ? seleccionadas.join(', ') : '(revisar screenshot)'}`);

await page.click('#ctl00_Contenido_btnContinue').catch(() => {});
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(2000);

// --- FRENO: pantalla de productos / resumen. NO se paga. --------------------
const urlFinal = page.url();
await page.screenshot({ path: 'dump/ensayo-4-freno.png', fullPage: true });
const resumen = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 900));
log(`\nFRENO en: ${urlFinal.split('/').pop()}`);
log('NO se cargó tarjeta, NO se confirmó compra.');
log('--- lo que muestra la pantalla ---\n' + resumen);

await browser.close();
