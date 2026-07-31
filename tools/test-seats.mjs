// Test de regresión del parser de butacas. NO depende de ningún volcado real:
// genera HTML sintético que reproduce fielmente los dos esquemas de sala
// observados en el sitio, así corre limpio en cualquier clone sin necesitar
// datos de una sesión real.
//
//   node tools/test-seats.mjs
//
// Corré esto desde la raíz del repo (no desde tools/).

import { chromium } from 'playwright';
import { readSeatMap, markAvailability, findPairs, summarize } from '../lib/seats.mjs';

let fallos = 0;
const check = (cond, msg) => { console.log(`  ${cond ? 'ok  ' : 'FALLA'} ${msg}`); if (!cond) fallos++; };

/** Un <input type=image> de butaca, con el markup real del sitio. */
function seat(id, title, estado = 'libre') {
  const src = { libre: 'AvSeat.jpg', no_disp: 'NotAvSeat.jpg', vendida: 'SoldSeat.jpg', accesible: 'HandSeat.jpg' }[estado];
  const disabled = estado === 'no_disp' || estado === 'vendida' ? ' disabled="disabled"' : '';
  return `<td><input type="image" id="ctl00_Contenido_${id}" title="${title}" src="img/${src}"${disabled}></td>`;
}

// --- Esquema "Haedo" (2D): etiqueta "F<fila>-A<n>", numeración desde el
// centro hacia afuera — pares de un lado, impares del otro. A5 y A6 NO son
// vecinas: están en mitades opuestas de la fila. Dos butacas NotAvSeat para
// probar que "NotAvSeat" (que CONTIENE la subcadena "AvSeat") no cuela como libre.
const ordenCentro = [14, 12, 10, 8, 6, 4, 2, 1, 3, 5, 7, 9, 11, 13];
const filaHaedo = ordenCentro
  .map((n, i) => seat(100 + i, `F1-A${n}`, n === 8 || n === 9 ? 'no_disp' : 'libre'))
  .join('');
const htmlHaedo = `<table><tr>${filaHaedo}</tr></table>`;

// --- Esquema "IMAX": etiqueta "<Letra>-<n>", numeración secuencial
// decreciente de izquierda a derecha. Fila A entera no disponible (pasa en la
// vida real: primera fila muy cerca de la pantalla). Fila B con una vendida y
// una accesible, para cubrir los cuatro estados.
const filaA = Array.from({ length: 10 }, (_, i) => seat(200 + i, `A-${10 - i}`, 'no_disp')).join('');
const filaB = Array.from({ length: 12 }, (_, i) => {
  const n = 12 - i;
  const estado = n === 6 ? 'vendida' : n === 5 ? 'accesible' : 'libre';
  return seat(300 + i, `B-${n}`, estado);
}).join('');
const filaC = Array.from({ length: 12 }, (_, i) => seat(400 + i, `C-${12 - i}`, 'libre')).join('');
const htmlImax = `<table><tr>${filaA}</tr><tr>${filaB}</tr><tr>${filaC}</tr></table>`;

const browser = await chromium.launch();
const page = await browser.newPage();

// --- Esquema Haedo -----------------------------------------------------------
await page.setContent(htmlHaedo);
const haedo = markAvailability(await readSeatMap(page));
const h = summarize(haedo);
console.log(`\n[esquema Haedo] ${h.filas} fila, ${h.total} butacas, ${h.libres} libres`);
const f1 = haedo[0].butacas.map((b) => b.nro);
check(h.total === 14, `14 butacas sintéticas (leídas ${h.total})`);
check(h.libres === 12, `12 libres, 2 no_disp excluidas (leídas ${h.libres})`);
check(Math.abs(f1.indexOf(5) - f1.indexOf(6)) !== 1, 'A5 y A6 NO son vecinas (mitades opuestas)');
check(haedo[0].etiqueta === 'F1', `etiqueta de fila "F1" (leída "${haedo[0].etiqueta}")`);

// --- Esquema IMAX --------------------------------------------------------------
await page.setContent(htmlImax);
const imax = markAvailability(await readSeatMap(page));
const i = summarize(imax);
console.log(`\n[esquema IMAX] ${i.filas} filas, ${i.total} butacas, ${i.libres} libres`);
check(i.total === 34, `34 butacas sintéticas (leídas ${i.total})`);
check(imax[0].etiqueta === 'A', `primera fila "A" (leída "${imax[0].etiqueta}")`);
check(imax[0].butacas.every((b) => !b.libre), 'fila A entera no disponible');
check(imax[1].butacas.find((b) => b.nro === 6).libre === false, 'B-6 vendida no cuenta como libre');
check(imax[1].butacas.find((b) => b.nro === 5).accesible === true, 'B-5 detectada como accesible');
check(!imax[1].butacas.find((b) => b.nro === 5).libre, 'accesible se excluye de libre por defecto');

// --- Búsqueda de pares -------------------------------------------------------
const zona = [
  { fila: 'B', min: 1, max: 12 },
  { fila: 'C', min: 1, max: 12 },
];
const pares = findPairs(imax, zona);
console.log(`\n[zona B/C] ${pares.length} pares contiguos`);
for (const p of pares.slice(0, 6)) console.log(`   fila ${p.fila}:  ${p.etiquetas.join(' + ')}`);
check(pares.every((p) => ['B', 'C'].includes(p.fila)), 'ningún par fuera de las filas pedidas');
check(pares.every((p) => p.butacas.every((b) => b.libre)), 'todas las butacas de los pares están libres');
check(pares[0].fila === 'B', `el primer par es de la fila más preferida B (es ${pares[0].fila})`);
// La contigüidad tiene que ser posicional (orden del DOM), no numérica.
check(
  pares.every((p) => {
    const fila = imax.find((f) => f.etiqueta === p.fila);
    const [a, b] = p.butacas.map((x) => fila.butacas.indexOf(x));
    return Math.abs(a - b) === 1;
  }),
  'los pares son adyacentes en el DOM (contigüidad física real)'
);
// La butaca vendida (B-6) y la accesible (B-5) no deberían aparecer en ningún
// par DE LA FILA B (fila C tiene sus propias butacas 5/6, todas libres — no
// hay que confundirlas con las de B).
check(
  pares.filter((p) => p.fila === 'B').every((p) => p.butacas.every((b) => b.nro !== 6 && b.nro !== 5)),
  'B-6 (vendida) y B-5 (accesible) quedan afuera de los pares de fila B'
);

console.log(fallos ? `\n${fallos} chequeo(s) fallando` : '\nTodo OK');
await browser.close();
process.exit(fallos ? 1 : 0);
