// Primitivas de masshowcase.com — plataforma de beneficios Bonda.
// Stack totalmente distinto a todoshowcase: PWA con shadow DOM (Stencil.js).
// Los selectores del formulario de login son genericos a proposito (por
// type=email/password), porque no hay IDs estables para anclar.

import { getCredentials } from './site.mjs';

export const MAS_BASE = 'https://masshowcase.com';

// Nombre del item de Keychain donde vive tu cuenta de masshowcase.com. Suele
// ser una cuenta DISTINTA de la de compra (mismo mail, contraseña distinta) —
// no asumas que es la misma.
export const MAS_KEYCHAIN_SERVICE = process.env.MAS_KEYCHAIN_SERVICE || 'mas-showcase-beneficio';

/** Lee las credenciales de masshowcase del Keychain (servicio MAS_KEYCHAIN_SERVICE). */
export function getMasCredentials() {
  return getCredentials(MAS_KEYCHAIN_SERVICE);
}

/** Loguea en la PWA de masshowcase. No verifica el resultado; llamá a la página siguiente y fijate. */
export async function loginMas(page, creds) {
  await page.goto(`${MAS_BASE}/signin`, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[type=password]', { timeout: 20_000 }).catch(() => {});
  await page
    .fill('input[type=email], input[name*=mail i], input[name*=user i], input[type=text]', creds.user)
    .catch(() => {});
  await page.fill('input[type=password]', creds.pass).catch(() => {});
  await page
    .click('button[type=submit], button:has-text("Ingresar"), button:has-text("INGRESAR")')
    .catch(() => page.press('input[type=password]', 'Enter').catch(() => {}));
  await page.waitForTimeout(6000);
}
