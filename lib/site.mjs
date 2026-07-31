// Primitivas del sitio entradas.todoshowcase.com
//
// El sitio es ASP.NET WebForms: la navegacion real pasa por postbacks y por dos
// funciones JS globales que expone la pagina de pelicula:
//   LoadCinemaData('YYYY-MM-DD')            -> recarga los complejos/horarios de esa fecha
//   SelectPerformance(perfId, cineId, code) -> abre el modal de confirmacion de funcion
// Por eso conviene disparar esas funciones en vez de pelear con clicks a ciegas.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export const BASE = 'https://entradas.todoshowcase.com/showcase';

// Nombre del item de Keychain donde vive tu cuenta de entradas.todoshowcase.com.
// Overrideable por si ya usás ese nombre para otra cosa, o corrés dos cuentas.
export const KEYCHAIN_SERVICE = process.env.SHOWCASE_KEYCHAIN_SERVICE || 'showcase-entradas';

// Default de conveniencia para tools/ standalone que no reciben --film. El bot
// real usa siempre config.mjs -> filmId, no este valor. Encontrás el filmid de
// cualquier pelicula en la URL de su pagina: pelicula.aspx?filmid=N.
// EJEMPLO: 5875 = "La Odisea" (Nolan, IMAX) al momento de escribir esto.
export const FILM_ID = Number(process.env.SHOWCASE_FILM_ID) || 5875;

/**
 * Lee usuario y contraseña del Keychain de macOS.
 *
 * El valor nunca se escribe a disco, ni se loguea, ni se pasa por argv (donde
 * seria visible en `ps`). Vive solo en memoria del proceso.
 *
 * Nota deliberada: aca solo viven credenciales de *autenticacion*. Ningun dato
 * de pago pasa por este proyecto. El checkout lo completa una persona.
 */
export async function getCredentials(service = KEYCHAIN_SERVICE) {
  let meta;
  try {
    // El info del item va a stderr en la herramienta `security`.
    const r = await exec('security', ['find-generic-password', '-s', service]);
    meta = r.stdout + r.stderr;
  } catch {
    throw new Error(
      `No encontre el item "${service}" en el Keychain.\n` +
        `Crealo con:\n\n  security add-generic-password -a "TU_EMAIL_O_ID" -s ${service} -w\n`
    );
  }

  const acct = meta.match(/"acct"<blob>="([^"]*)"/)?.[1];
  if (!acct) throw new Error('El item del Keychain no tiene cuenta (-a) asociada.');

  const { stdout } = await exec('security', ['find-generic-password', '-s', service, '-w']);
  return { user: acct, pass: stdout.replace(/\n$/, '') };
}

/** Notificacion de macOS + sonido. Para avisarte cuando hay que tomar el control. */
export async function alert(title, message) {
  await exec('osascript', [
    '-e',
    `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)} sound name "Glass"`,
  ]).catch(() => {});
  await exec('afplay', ['/System/Library/Sounds/Glass.aiff']).catch(() => {});
}

/** Loguea la sesion. Devuelve true si quedo autenticada. */
export async function login(page, { user, pass }) {
  await page.goto(`${BASE}/ingresar.aspx`, { waitUntil: 'domcontentloaded' });

  await page.fill('#ctl00_Contenido_txtIdOrMail', user);
  await page.fill('#ctl00_Contenido_txtpass', pass);

  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click('#ctl00_Contenido_txtpass ~ * input[type=submit], input[type=submit][value*="NGRESAR" i], .custom-button:has-text("INGRESAR")').catch(() =>
      page.press('#ctl00_Contenido_txtpass', 'Enter')
    ),
  ]);

  await page.waitForTimeout(1500);
  // Si seguimos en ingresar.aspx con el campo de password visible, fallo.
  const stillOnLogin = await page.locator('#ctl00_Contenido_txtpass').count();
  return !(stillOnLogin && page.url().includes('ingresar.aspx'));
}

/**
 * Abre la pagina de la pelicula y devuelve las fechas en cartel (YYYY-MM-DD).
 * Los botones de fecha se inyectan por JS despues del load: hay que esperarlos.
 */
export async function openFilm(page, filmId = FILM_ID) {
  await page.goto(`${BASE}/pelicula.aspx?filmid=${filmId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button.op_day', { timeout: 20_000 });
  return page.evaluate(() =>
    [...document.querySelectorAll('button.op_day')].map((b) => b.value).filter(Boolean)
  );
}

/** Abre la pagina de la pelicula y selecciona una fecha (YYYY-MM-DD). */
export async function openFilmDate(page, isoDate, filmId = FILM_ID) {
  await openFilm(page, filmId);

  const has = await page.evaluate((d) => {
    const b = [...document.querySelectorAll('button.op_day')].find((x) =>
      (x.getAttribute('onclick') || '').includes(d)
    );
    if (b) b.click();
    return Boolean(b);
  }, isoDate);

  if (!has) return false;
  // LoadCinemaData repuebla el acordeon por AJAX. Puede quedar vacio (sin
  // funciones ese dia), asi que esperamos la red y no un selector concreto.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
  return true;
}

/**
 * Lista las funciones visibles para la fecha ya seleccionada.
 * Devuelve [{ cinema, format, time, perfId, cineId, code }]
 */
export async function listPerformances(page) {
  return page.evaluate(() => {
    const out = [];
    for (const header of document.querySelectorAll('.ui-accordion-header')) {
      const cinema = header.textContent.trim();
      const panel = header.nextElementSibling;
      if (!panel) continue;
      let format = '';
      for (const node of panel.children) {
        if (!node.classList.contains('op_perfs')) {
          format = node.textContent.trim();
          continue;
        }
        for (const btn of node.querySelectorAll('button.op_perf')) {
          const m = (btn.getAttribute('onclick') || '').match(
            /SelectPerformance\(\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']*)'/
          );
          if (!m) continue;
          out.push({
            cinema,
            format,
            time: btn.textContent.trim(),
            perfId: Number(m[1]),
            cineId: Number(m[2]),
            code: m[3],
            soldOut: btn.disabled || btn.className.includes('disab'),
          });
        }
      }
    }
    return out;
  });
}

/**
 * Entra a una funcion y avanza el modal de confirmacion hasta el mapa de butacas.
 *
 * Devuelve 'agotada' | 'ok' | 'desconocido'.
 *
 * Cuando no hay lugar, el sitio no muestra un cartel: redirige de vuelta a
 * pelicula.aspx con `&agotada=1`. Es la forma mas rapida y confiable de
 * descartar una funcion; no hace falta leer el mapa para saberlo.
 */
export async function enterPerformance(page, perf) {
  await page.evaluate(
    ({ perfId, cineId, code }) => window.SelectPerformance(perfId, cineId, code),
    perf
  );
  await page.waitForTimeout(600);
  await page
    .click('a:has-text("CONTINUAR"), button:has-text("CONTINUAR"), input[value*="CONTINUAR" i]')
    .catch(() => {});
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const url = page.url();
  if (/agotada=1/i.test(url)) return 'agotada';
  if (/pelicula\.aspx/i.test(url)) return 'desconocido';
  return 'ok';
}
