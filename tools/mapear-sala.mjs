// Busca, entre TODAS las películas en cartel, la primera función con lugar en
// el complejo/sala que le pidas, y vuelca el mapa de esa sala + el catálogo de
// tarifas. No compra ni retiene nada.
//
// Útil para armar tu `config.zona` sin depender de que la película que te
// interesa ya tenga funciones abiertas: cualquier función de esa sala sirve,
// porque el layout de butacas es el mismo para todas.
//
//   node --env-file=.env tools/mapear-sala.mjs [--cine "IMAX Theatre"]
//
// Corré esto desde la raíz del repo (no desde tools/), así los archivos
// quedan en ./dump/. Después: node tools/plano-sala.mjs dump/mapa-sala.html

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { getCredentials, login, openFilm, openFilmDate, listPerformances, enterPerformance, BASE } from '../lib/site.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const cineTexto = arg('cine', 'IMAX Theatre');
const cine = new RegExp(cineTexto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

await mkdir('dump', { recursive: true });

const c = await getCredentials();
const b = await chromium.launch({ headless: true });
const p = await (await b.newContext({ viewport: { width: 1440, height: 1200 } })).newPage();
if (!(await login(p, c))) throw new Error('login fallido');
console.log('> Login OK');

await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
const films = await p.evaluate(() => {
  const m = new Map();
  for (const a of document.querySelectorAll('a[href*="filmid="]')) {
    const id = a.href.match(/filmid=(\d+)/)?.[1];
    const t = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (id && t && t !== '+' && !/COMPRAR/i.test(t)) m.set(id, t);
  }
  return [...m].map(([id, titulo]) => ({ id: Number(id), titulo }));
});
console.log(`> Películas en cartel: ${films.length}. Buscando sala que matchee "${cineTexto}"...`);

let hit = null;
outer: for (const f of films) {
  const dates = await openFilm(p, f.id).catch(() => []);
  for (const d of dates.slice(0, 8)) {
    if (!(await openFilmDate(p, d, f.id))) continue;
    const salas = (await listPerformances(p)).filter((x) => cine.test(x.cinema));
    if (!salas.length) break; // esta peli no va en esa sala
    console.log(`  ${f.titulo} · ${d}: ${salas.length} función(es)`);
    for (const perf of salas) {
      const st = await enterPerformance(p, perf);
      console.log(`     ${perf.time} -> ${st}`);
      if (st === 'ok') { hit = { film: f, date: d, perf }; break outer; }
      await openFilmDate(p, d, f.id);
    }
  }
}
if (!hit) throw new Error(`No encontré ninguna función con lugar en salas que matcheen "${cineTexto}".`);

console.log(`\n> Sala vía: ${hit.film.titulo} · ${hit.date} ${hit.perf.time} (filmId=${hit.film.id})`);
await writeFile('dump/mapa-sala-precio.html', await p.content());

const tarifas = await p.evaluate(() =>
  ['gridPrices', 'gridPromos', 'gridSupers'].flatMap((g) =>
    [...document.querySelectorAll(`#ctl00_Contenido_${g} tr`)].map((tr) => {
      const s = tr.querySelector('select');
      if (!s) return null;
      const td = [...tr.querySelectorAll('td')].map((x) => x.innerText.trim());
      return { grid: g, nombre: td[0], valor: td[1], selectId: s.id };
    }).filter(Boolean)
  )
);
console.log('\n=== TARIFAS ===');
console.table(tarifas);

// Avanzamos con 2 entradas generales solo para ver el mapa (sin promo, sin código).
const gen = tarifas.find((t) => t.grid === 'gridPrices');
await p.selectOption(`#${gen.selectId}`, '2');
await p.waitForLoadState('networkidle').catch(() => {});
await p.waitForTimeout(1200);
await p.click('#ctl00_Contenido_btnContinue');
await p.waitForLoadState('networkidle').catch(() => {});
await p.waitForTimeout(2500);
console.log('URL:', p.url());
await writeFile('dump/mapa-sala.html', await p.content());
await p.screenshot({ path: 'dump/mapa-sala.png', fullPage: true });
await writeFile('dump/mapa-sala-meta.json', JSON.stringify({ hit, tarifas }, null, 2));
console.log('\nVolcado: dump/mapa-sala.html');
console.log('Siguiente paso: node tools/plano-sala.mjs dump/mapa-sala.html');
await b.close();
