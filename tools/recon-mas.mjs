// RECON de masshowcase.com (plataforma Bonda) — SOLO LECTURA.
//
// >>> NO RECLAMA EL BENEFICIO. <<<
// El objetivo es entender como se ve el 2x1 de IMAX antes de reclamarlo, para no
// quemar el codigo en una prueba. Cualquier boton de "reclamar" se ignora.
//
//   node --env-file=.env tools/recon-mas.mjs
//
// Corré esto desde la raíz del repo (no desde tools/), así los archivos
// quedan en ./dump/ como el resto de las herramientas.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { MAS_BASE, getMasCredentials, loginMas } from '../lib/mas.mjs';

await mkdir('dump', { recursive: true });

const creds = await getMasCredentials();
console.log(`> Usuario: ${creds.user}  (contraseña del Keychain, no se imprime)`);

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();

// La PWA habla con una API. Capturarla vale mas que cualquier selector: si el
// bot puede pedir el codigo por API, se evita pelear con el DOM de Stencil.
const api = [];
page.on('response', async (res) => {
  const u = res.url();
  if (/\.(js|css|png|jpg|svg|woff2?|ico)(\?|$)/i.test(u)) return;
  if (!/api|graphql|benefit|beneficio|cupon|coupon|voucher|claim/i.test(u)) return;
  api.push({
    method: res.request().method(),
    url: u,
    status: res.status(),
    body: await res.text().catch(() => '').then((t) => t.slice(0, 1500)),
  });
});

await loginMas(page, creds);
await page.screenshot({ path: 'dump/mas-login.png' });
console.log(`> Post-login: ${page.url()}`);

await page.goto(`${MAS_BASE}/beneficios`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

// Buscamos el beneficio de 2x1 IMAX sin tocarlo.
const found = await page.evaluate(() => {
  const hits = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot); // Stencil usa shadow DOM
      const t = (el.textContent || '').trim();
      if (t.length < 200 && /2\s*x\s*1/i.test(t) && el.children.length <= 3) {
        hits.push({ tag: el.tagName, text: t.slice(0, 120), html: el.outerHTML.slice(0, 400) });
      }
    }
  };
  walk(document);
  return { url: location.href, hits: hits.slice(0, 15), bodyText: document.body.innerText.slice(0, 3000) };
});

await writeFile('dump/mas-beneficios.json', JSON.stringify({ found, api }, null, 2));
await writeFile('dump/mas-beneficios.html', await page.content());
await page.screenshot({ path: 'dump/mas-beneficios.png', fullPage: true });

// Bases y condiciones: ahi deberia estar la vigencia y si es de un solo uso.
await page.goto(`${MAS_BASE}/bases-y-condiciones`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await writeFile('dump/mas-bases.txt', await page.evaluate(() => document.body.innerText));
await page.screenshot({ path: 'dump/mas-bases.png', fullPage: true });

console.log('\n=== RESUMEN ===');
console.log(`coincidencias "2x1": ${found.hits.length}`);
for (const h of found.hits.slice(0, 5)) console.log(`  - <${h.tag}> ${h.text}`);
console.log(`llamadas de API capturadas: ${api.length}`);
for (const a of api.slice(0, 10)) console.log(`  ${a.status} ${a.method} ${a.url}`);
console.log('\nVolcado en dump/. NO se reclamo ningun beneficio.');
console.log('Dejo el browser abierto 90s.');
await page.waitForTimeout(90_000);
await browser.close();
