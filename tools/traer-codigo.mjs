// Helper de UNA SOLA VEZ: lee el código de 2x1 IMAX del historial de masshowcase
// (solo lectura) y lo escribe en tu .env como SHOWCASE_2X1_CODE. Así no lo
// tipeás a mano (evita typos de un dígito, que rebotan el código justo en el
// momento crítico).
//
// No reclama beneficios, no compra nada. Solo lee y actualiza tu .env local
// (nunca config.mjs, nunca nada que se commitee).
//
//   node tools/traer-codigo.mjs
//
// Corré esto desde la raíz del repo (no desde tools/), así encuentra tu .env.

import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { MAS_BASE, getMasCredentials, loginMas } from '../lib/mas.mjs';

const c = await getMasCredentials();
console.log(`> Cuenta masshowcase: ${c.user} (contraseña del Keychain, no se imprime)`);

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();

await loginMas(page, c);
await page.goto(`${MAS_BASE}/historial`, { waitUntil: 'networkidle' });
await page.waitForTimeout(9000);

// Busca códigos de 12 dígitos y los asocia a su tarjeta (para saber cuáles son
// IMAX). La PWA de Bonda usa shadow DOM, así que hay que descender en los
// shadowRoot y cruzar los límites al subir por ancestros.
const encontrados = await page.evaluate(() => {
  const out = [];
  const visit = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) visit(el.shadowRoot);
      const t = (el.textContent || '').trim();
      if (el.children.length === 0 && /^\d{12}$/.test(t)) {
        let ctx = '';
        let p = el;
        for (let i = 0; i < 10 && p; i++) {
          ctx = p.textContent || ctx;
          p = p.parentElement || p.getRootNode()?.host || null;
        }
        out.push({
          code: t,
          imax: /imax/i.test(ctx),
          fecha: (ctx.match(/\b\d{2}-\d{2}-\d{4}\b/) || [])[0] || '',
        });
      }
    }
  };
  visit(document);
  // dedupe por código
  const seen = new Set();
  return out.filter((x) => (seen.has(x.code) ? false : seen.add(x.code)));
});

await browser.close();

if (!encontrados.length) {
  throw new Error('No encontré ningún código de 12 dígitos en el historial. ¿Reclamaste el 2x1 IMAX?');
}

const imax = encontrados.filter((x) => x.imax);
const candidatos = imax.length ? imax : encontrados;
if (!imax.length) {
  console.log('⚠ No pude asociar ningún código a "IMAX". Muestro todos los encontrados:');
}
console.log('\nCódigos en el historial:');
for (const x of encontrados) {
  console.log(`  ${x.code.slice(0, 4)}…${x.code.slice(-2)}  ${x.imax ? 'IMAX' : '(otro)'}  ${x.fecha}`);
}

if (candidatos.length > 1) {
  console.log(`\n⚠ Hay ${candidatos.length} códigos IMAX. Tomo el último de la lista.`);
  console.log('  Si no es el correcto, editá SHOWCASE_2X1_CODE en tu .env a mano.');
}
const elegido = candidatos.at(-1).code;

// --- Escribir SHOWCASE_2X1_CODE en .env, tocando SOLO esa línea -------------
const path = '.env';
let src = await readFile(path, 'utf8').catch((e) => {
  if (e.code === 'ENOENT') {
    throw new Error(`No existe ${path}. Crealo primero: cp .env.example .env`);
  }
  throw e;
});
const linea = `SHOWCASE_2X1_CODE=${elegido}`;
src = /^SHOWCASE_2X1_CODE=.*$/m.test(src)
  ? src.replace(/^SHOWCASE_2X1_CODE=.*$/m, linea)
  : src.replace(/\n?$/, `\n${linea}\n`);
await writeFile(path, src);

console.log(`\n✓ Escrito en .env: SHOWCASE_2X1_CODE=${elegido.slice(0, 4)}…${elegido.slice(-2)}`);
console.log('  Verificalo con: node --env-file=.env preflight.mjs');
