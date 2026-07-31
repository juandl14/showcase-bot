// SOLO LECTURA: re-lee el historial de masshowcase para ver si tu código 2x1
// sigue vigente o quedó consumido. No reclama ni usa nada.
//
// Depende de dump/mas-historial.txt, que genera `node tools/recon-mas.mjs`.
// Corré ese primero si este archivo no existe.
//
//   node --env-file=.env tools/check-codigo.mjs
//
// Corré esto desde la raíz del repo (no desde tools/).

import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { getMasCredentials, loginMas, MAS_BASE } from '../lib/mas.mjs';

const hist = await readFile('dump/mas-historial.txt', 'utf8').catch((e) => {
  if (e.code === 'ENOENT') {
    throw new Error('No existe dump/mas-historial.txt. Corré primero: node tools/recon-mas.mjs');
  }
  throw e;
});
const codigo = process.env.SHOWCASE_2X1_CODE || (hist.match(/\b\d{12}\b/g) || []).at(-1);
if (!codigo) throw new Error('No hay ningún código de 12 dígitos en SHOWCASE_2X1_CODE ni en el historial volcado.');

const c = await getMasCredentials();
const b = await chromium.launch({ headless: true });
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();

await loginMas(p, c);
await p.goto(`${MAS_BASE}/historial`, { waitUntil: 'networkidle' });
await p.waitForTimeout(9000);
const txt = (await p.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, '\n');

console.log(`código del ensayo: ${codigo.slice(0, 4)}…${codigo.slice(-2)}`);
console.log(`¿sigue apareciendo en el historial?: ${txt.includes(codigo) ? 'SÍ' : 'NO'}`);
const marcas = txt.match(/utilizad|usad|canjead|consumid|vencid|activ|disponible|pendiente/gi) || [];
console.log(`marcas de estado encontradas: ${[...new Set(marcas.map((m) => m.toLowerCase()))].join(', ') || '(ninguna)'}`);
console.log('\n--- historial (recortado) ---');
console.log(txt.slice(0, 1600));
await b.close();
