// RECON de todoshowcase — NO COMPRA, NO RETIENE BUTACAS, NO USA EL CODIGO 2x1.
//
// Recorre el wizard hasta el mapa de asientos y vuelca cada etapa a ./dump/.
// Deliberadamente NO clickea ninguna butaca: llegar al mapa no retiene nada,
// seleccionar si. Y deliberadamente NO envia ningun codigo de beneficio.
//
//   node --env-file=.env tools/recon.mjs [--cine "Haedo"] [--date YYYY-MM-DD]
//
// Corré esto desde la raíz del repo (no desde tools/), así los archivos
// quedan en ./dump/ como el resto de las herramientas.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  getCredentials, login, openFilm, openFilmDate, listPerformances, enterPerformance,
} from '../lib/site.mjs';

await mkdir('dump', { recursive: true });

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const wantDate = arg('date', null);
const wantCine = arg('cine', 'Haedo'); // por defecto un complejo tranquilo: hay lugar

const creds = await getCredentials();
console.log(`> Usuario: ${creds.user}  (contraseña del Keychain, no se imprime)`);

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();

/** Vuelca el estado actual con un nombre de etapa. */
async function dump(stage) {
  await writeFile(`dump/${stage}.html`, await page.content());
  await page.screenshot({ path: `dump/${stage}.png`, fullPage: true });
  const fields = await page.evaluate(() =>
    [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].map(
      (e) => `${e.tagName.toLowerCase()}[${e.type || ''}] name=${e.name} id=${e.id} maxlength=${e.maxLength}`
    )
  );
  console.log(`    [dump] ${stage} — ${fields.length} campos visibles`);
  return fields;
}

/** Los <select> del wizard disparan __doPostBack: hay que esperar el ciclo. */
async function setSelect(id, value) {
  await page.selectOption(`#${id}`, value);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
}

if (!(await login(page, creds))) {
  await page.screenshot({ path: 'dump/login-fallo.png' });
  throw new Error('Login fallido. Mira dump/login-fallo.png');
}
console.log('> Login OK');

const dates = await openFilm(page);
console.log(`> Fechas en cartel: ${dates.length} (${dates[0]} .. ${dates.at(-1)})`);

// Las funciones agotadas no avisan: redirigen a pelicula.aspx con &agotada=1.
let entered = null;
outer: for (const d of wantDate ? [wantDate] : dates) {
  if (!(await openFilmDate(page, d))) continue;
  const perfs = (await listPerformances(page)).filter((p) =>
    p.cinema.toUpperCase().includes(wantCine.toUpperCase())
  );
  if (!perfs.length) continue;
  console.log(`\n> ${d}: ${perfs.length} función(es) para "${wantCine}"`);
  for (const perf of perfs) {
    const status = await enterPerformance(page, perf);
    console.log(`    ${perf.time} ${perf.format} (${perf.perfId}) -> ${status}`);
    if (status === 'ok') { entered = { date: d, perf }; break outer; }
    await openFilmDate(page, d);
  }
}
if (!entered) throw new Error(`Todo agotado para "${wantCine}". Probá --cine "Quilmes".`);

console.log(`\n> Etapa PRECIO: ${entered.date} ${entered.perf.time} — ${entered.perf.cinema}`);
await dump('01-precio');

// Catalogo de tarifas: nombre + id del select. Aca aparecera "2X1 IMAX".
const tarifas = await page.evaluate(() =>
  ['gridPrices', 'gridPromos', 'gridSupers'].flatMap((grid) =>
    [...document.querySelectorAll(`#ctl00_Contenido_${grid} tr`)]
      .map((tr) => {
        const sel = tr.querySelector('select');
        if (!sel) return null;
        const tds = [...tr.querySelectorAll('td')].map((td) => td.innerText.trim());
        return { grid, nombre: tds[0], valor: tds[1], selectId: sel.id, max: sel.options.length - 1 };
      })
      .filter(Boolean)
  )
);
console.log('\n=== TARIFAS DISPONIBLES ===');
console.table(tarifas);

// --- Etapa 2x1: seleccionar 1 promo revela (o no) el campo del codigo --------
// Solo revelamos el campo. NO se envia ningun codigo.
const promo = tarifas.find((t) => t.grid === 'gridPromos');
if (promo) {
  console.log(`\n> Etapa 2x1: pongo 1 en "${promo.nombre}" para ver si aparece el campo del código`);
  const antes = await page.evaluate(() => document.querySelectorAll('input:not([type=hidden])').length);
  await setSelect(promo.selectId, '1');
  const campos = await dump('02-promo');
  const despues = campos.length;
  console.log(`    campos visibles: ${antes} -> ${despues}`);
  for (const f of campos) if (!/search|submit|button/i.test(f)) console.log(`      ${f}`);
  await setSelect(promo.selectId, '0'); // dejar como estaba
}

// --- Etapa asientos ---------------------------------------------------------
const general = tarifas.find((t) => t.grid === 'gridPrices');
console.log(`\n> Etapa ASIENTOS: 2 x "${general.nombre}" y continuar`);
await setSelect(general.selectId, '2');
await page.click('#ctl00_Contenido_btnContinue');
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(2500);
console.log(`    URL: ${page.url()}`);
await dump('03-asientos');

// Estructura del mapa: que tipo de elemento es una butaca y como se marca ocupada.
const mapa = await page.evaluate(() => {
  const tally = {};
  for (const el of document.querySelectorAll('*')) {
    const cls = (el.className?.baseVal ?? el.className ?? '').toString().trim();
    const id = el.id || '';
    if (!/seat|butac|asiento|localidad|silla|occupied|ocupad|libre|disponible/i.test(cls + ' ' + id)) continue;
    const k = `${el.tagName}.${cls}`;
    (tally[k] ??= { n: 0, muestra: el.outerHTML.slice(0, 220) }).n++;
  }
  return {
    url: location.href,
    canvas: document.querySelectorAll('canvas').length,
    tables: document.querySelectorAll('table').length,
    tipos: Object.entries(tally).sort((a, b) => b[1].n - a[1].n).slice(0, 15),
    // El temporizador de retencion suele estar en un contador visible.
    posibleTimer: [...document.querySelectorAll('*')]
      .filter((e) => e.children.length === 0 && /\d{1,2}:\d{2}/.test(e.textContent || ''))
      .map((e) => `${e.tagName}#${e.id} "${e.textContent.trim().slice(0, 40)}"`)
      .slice(0, 10),
  };
});
await writeFile('dump/mapa-estructura.json', JSON.stringify({ tarifas, mapa }, null, 2));

console.log('\n=== ESTRUCTURA DEL MAPA ===');
console.log(`canvas=${mapa.canvas} tables=${mapa.tables}`);
for (const [k, v] of mapa.tipos) console.log(`  ${String(v.n).padStart(4)}  ${k}`);
if (mapa.posibleTimer.length) {
  console.log('\nPosible temporizador de retención:');
  for (const t of mapa.posibleTimer) console.log(`  ${t}`);
}
console.log('\nVolcado en dump/. No se seleccionó ninguna butaca ni se usó el 2x1.');
await browser.close();
