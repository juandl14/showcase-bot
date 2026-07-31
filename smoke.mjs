// Smoke test sin credenciales: valida el parseo de fechas y funciones.
import { chromium } from 'playwright';
import { openFilm, openFilmDate, listPerformances } from './lib/site.mjs';

const browser = await chromium.launch();
const page = await browser.newPage();

const dates = await openFilm(page);
console.log(`fechas: ${dates.length} -> ${dates[0]} .. ${dates.at(-1)}`);

for (const d of ['2026-08-10', dates.at(-1)]) {
  const ok = await openFilmDate(page, d);
  const perfs = await listPerformances(page);
  console.log(`\n${d}  (fecha existe: ${ok})`);
  console.table(perfs.map(({ cinema, format, time, perfId, soldOut }) => ({ cinema, format, time, perfId, soldOut })));
}

await browser.close();
