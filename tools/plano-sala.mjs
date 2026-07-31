// Dibuja el plano de una sala a partir de un HTML volcado (butacas.aspx),
// como el que genera tools/mapear-sala.mjs o tools/recon.mjs. Sirve para
// decidir tu `config.zona`: mirás qué filas y qué rango de butacas de cada
// una son las que querés.
//
//   node tools/plano-sala.mjs dump/mapa-sala.html
//
// Corré esto desde la raíz del repo (no desde tools/).

import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { readSeatMap, markAvailability, summarize } from '../lib/seats.mjs';

const archivo = process.argv[2];
if (!archivo) {
  throw new Error('Uso: node tools/plano-sala.mjs <ruta-al-html-volcado>\nEj: node tools/plano-sala.mjs dump/mapa-sala.html');
}

const b = await chromium.launch();
const p = await b.newPage();
await p.goto('file://' + resolve(archivo));
const filas = markAvailability(await readSeatMap(p));
const s = summarize(filas);
await b.close();

if (!filas.length) throw new Error(`No encontré ninguna fila de butacas en ${archivo}. ¿Es un HTML de butacas.aspx?`);

const ancho = Math.max(...filas.map((f) => f.butacas.length));
console.log(`${s.filas} filas, ${s.total} butacas\n`);
console.log(' '.repeat(8) + '┌' + '─'.repeat(ancho * 2 - 1) + '┐');
console.log(' '.repeat(8) + '│' + 'P A N T A L L A'.padStart(Math.floor((ancho * 2 - 1 + 15) / 2)).padEnd(ancho * 2 - 1) + '│');
console.log(' '.repeat(8) + '└' + '─'.repeat(ancho * 2 - 1) + '┘\n');

for (const f of filas) {
  const pad = ' '.repeat(Math.floor(ancho - f.butacas.length));
  const linea = f.butacas.map((x) => (x.libre ? '·' : '×')).join(' ');
  const nums = f.butacas.map((x) => x.nro);
  console.log(`  ${String(f.etiqueta).padEnd(2)} ${String(f.butacas.length).padStart(3)}  ${pad}${linea}   ${nums[0]}…${nums[nums.length - 1]}`);
}
console.log('\n  · libre    × ocupada/no disponible');
console.log('  (la ocupación es la de la función que volcaste, no necesariamente la tuya)\n');
console.log('Numeración por fila (izquierda → derecha en pantalla), para armar config.zona:');
for (const f of filas.slice(0, 3)) console.log(`  ${f.etiqueta}: ${f.butacas.map((x) => x.nro).join(' ')}`);
