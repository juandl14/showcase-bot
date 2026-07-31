// RECON DEL TRAMO FINAL — mapea productos → forma de pago → pop-up de pago.
//
// NO PAGA. NO carga datos de tarjeta. NO usa el código 2x1 (va con tarifa
// General para no gastar el beneficio). Abre el pop-up de pago solo para volcar
// su estructura y lee el contador; después cancela.
//
// Frena y cierra sin completar ninguna transacción.
//
// Usá una función CUALQUIERA que tenga lugar — no hace falta que sea la que
// realmente te interesa. El objetivo es solo mapear la pantalla de
// productos/pago, que es igual para cualquier función.
//
//   node --env-file=.env tools/recon-checkout.mjs --film <filmId> [--hora HH:MM]
//
// Corré esto desde la raíz del repo (no desde tools/), así los archivos
// quedan en ./dump/ como el resto de las herramientas.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  getCredentials, login, openFilm, openFilmDate, listPerformances, enterPerformance,
} from '../lib/site.mjs';
import { readSeatMap, markAvailability, findPairs } from '../lib/seats.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const filmId = Number(arg('film'));
if (!filmId) {
  throw new Error(
    'Falta --film <filmId>. Buscalo en la URL de cualquier pelicula en cartel: ' +
      'entradas.todoshowcase.com/showcase/pelicula.aspx?filmid=N\n' +
      'Tip: node tools/mapear-sala.mjs te muestra funciones IMAX con lugar y su filmId.'
  );
}
const PRUEBA = { filmId, hora: arg('hora', null) }; // hora null = la primera que tenga lugar

await mkdir('dump', { recursive: true });
const log = (...a) => console.log(new Date().toLocaleTimeString('es-AR'), ...a);

const creds = await getCredentials();
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1200 } })).newPage();
if (!(await login(page, creds))) throw new Error('login fallido');
log('login OK');

// Cualquier contador visible del tipo m:ss en la página.
const leerTimers = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((e) => e.children.length === 0 && /\b\d{1,2}:\d{2}\b/.test(e.textContent || ''))
      .map((e) => `${e.tagName}#${e.id || ''} "${e.textContent.trim().slice(0, 40)}"`)
      .slice(0, 12)
  );

// --- Llegar a butacas con tarifa General ------------------------------------
const dates = await openFilm(page, PRUEBA.filmId);
let listo = false;
for (const d of dates) {
  if (!(await openFilmDate(page, d, PRUEBA.filmId))) continue;
  const perf = (await listPerformances(page)).find((p) => /IMAX Theatre/i.test(p.cinema) && p.time === PRUEBA.hora)
    ?? (await listPerformances(page)).find((p) => /IMAX Theatre/i.test(p.cinema));
  if (!perf) continue;
  if ((await enterPerformance(page, perf)) === 'ok') { listo = true; break; }
}
if (!listo) throw new Error('no encontré función IMAX con lugar');

const general = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('#ctl00_Contenido_gridPrices tr')].find((t) =>
    /general/i.test(t.querySelector('td')?.innerText || '')
  );
  return tr?.querySelector('select')?.id;
});
await page.selectOption(`#${general}`, '2');
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(900);
await page.click('#ctl00_Contenido_btnContinue');
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1500);

// --- Butacas: cualquier par contiguo ----------------------------------------
if (!page.url().includes('butacas.aspx')) throw new Error(`esperaba butacas, estoy en ${page.url()}`);
const filas = markAvailability(await readSeatMap(page));
const par = findPairs(filas, filas.filter((f) => f.etiqueta).map((f) => ({ fila: f.etiqueta })))[0];
if (!par) throw new Error('sin par contiguo libre');
log(`butacas de prueba: ${par.etiquetas.join(' + ')}`);
for (const b of par.butacas) {
  await page.click(`#${b.id}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);
}
log(`timers en butacas: ${(await leerTimers()).join(' | ') || '(ninguno)'}`);
await page.click('#ctl00_Contenido_btnContinue').catch(() => {});
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1500);

// --- PRODUCTOS: continuar sin agregar nada ----------------------------------
log(`PRODUCTOS: ${page.url().split('/').pop()}`);
await writeFile('dump/co-1-productos.html', await page.content());
const btnProductos = await page.evaluate(() => {
  const b = [...document.querySelectorAll('input[type=submit], input[type=button], button, a')]
    .find((x) => /continuar/i.test(x.value || x.textContent || ''));
  return b ? { id: b.id, name: b.name, tag: b.tagName } : null;
});
log(`  botón continuar productos: ${JSON.stringify(btnProductos)}`);
await page.click('#ctl00_Contenido_btnContinue').catch(async () => {
  await page.click('input[value*="CONTINUAR" i], button:has-text("CONTINUAR")').catch(() => {});
});
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1800);

// --- FORMA DE PAGO ----------------------------------------------------------
log(`FORMA DE PAGO: ${page.url().split('/').pop()}`);
await writeFile('dump/co-2-formapago.html', await page.content());
await page.screenshot({ path: 'dump/co-2-formapago.png', fullPage: true });

// Todos los medios de pago con su selector, para elegir VISA CREDITO sin adivinar.
const medios = await page.evaluate(() =>
  [...document.querySelectorAll('input[type=radio]')].map((r) => {
    const lbl =
      document.querySelector(`label[for="${r.id}"]`)?.innerText ||
      r.closest('label')?.innerText ||
      r.parentElement?.innerText ||
      r.nextElementSibling?.innerText ||
      '';
    return { id: r.id, name: r.name, value: r.value, texto: lbl.replace(/\s+/g, ' ').trim().slice(0, 40) };
  })
);
log('  medios de pago:');
for (const m of medios) log(`    ${m.texto.padEnd(22)} id=${m.id} value=${m.value}`);
const visa = medios.find((m) => /visa\s*cr[eé]dito/i.test(m.texto) || /visa.*cred/i.test(m.value));
log(`  -> VISA CREDITO detectada: ${visa ? JSON.stringify(visa) : 'NO (revisar dump/co-2-formapago.html)'}`);
log(`  timers en forma de pago: ${(await leerTimers()).join(' | ') || '(ninguno)'}`);

// Botón continuar de la forma de pago.
const btnPago = await page.evaluate(() => {
  const b = [...document.querySelectorAll('input[type=submit], input[type=button], button')]
    .find((x) => /continuar/i.test(x.value || x.textContent || ''));
  return b ? { id: b.id, name: b.name } : null;
});
log(`  botón continuar forma de pago: ${JSON.stringify(btnPago)}`);

// --- Abrir el pop-up de pago (arranca el contador de 5 min) y VOLCAR ---------
if (visa) {
  await page.check(`#${visa.id}`).catch(() => page.click(`#${visa.id}`).catch(() => {}));
  log('  VISA CREDITO seleccionada');
}
if (btnPago?.id) {
  await page.click(`#${btnPago.id}`).catch(() => {});
  await page.waitForTimeout(2500);
  await writeFile('dump/co-3-popup-pago.html', await page.content());
  await page.screenshot({ path: 'dump/co-3-popup-pago.png', fullPage: true });

  const modal = await page.evaluate(() => {
    const campos = [...document.querySelectorAll('input:not([type=hidden]), select')]
      .filter((e) => e.offsetParent)
      .map((e) => `${e.tagName.toLowerCase()}[${e.type || ''}] id=${e.id} name=${e.name} ph="${e.placeholder || ''}"`);
    const timer = [...document.querySelectorAll('*')]
      .filter((e) => e.children.length === 0 && /\b\d{1,2}:\d{2}\b/.test(e.textContent || ''))
      .map((e) => e.textContent.trim())[0];
    const botones = [...document.querySelectorAll('button, input[type=submit], input[type=button], a')]
      .filter((e) => e.offsetParent && /pagar|cancelar/i.test(e.value || e.textContent || ''))
      .map((e) => `${e.tagName}#${e.id || ''} "${(e.value || e.textContent).trim().slice(0, 20)}"`);
    return { timer, campos, botones };
  });
  log(`\n  POP-UP DE PAGO:`);
  log(`    contador: ${modal.timer || '(no detectado)'}`);
  log(`    campos de tarjeta: ${modal.campos.length}`);
  for (const c of modal.campos) log(`      ${c}`);
  log(`    botones: ${modal.botones.join(' | ')}`);

  // No pagamos. Cancelamos para soltar limpio.
  await page.click('button:has-text("Cancelar"), input[value*="Cancelar" i]').catch(() => {});
  log('\n  cancelado. NO se pagó, NO se cargó tarjeta.');
}

log('\nVolcado en dump/co-*. Nada comprado.');
await browser.close();
