// Verifica que las credenciales y el .env estén bien armados, SIN imprimir
// nada sensible. Correlo antes del día del drop: un fallo de Keychain o de
// variables de entorno en pleno drop no se recupera.
//
//   node --env-file=.env preflight.mjs

import { KEYCHAIN_SERVICE, getCredentials } from './lib/site.mjs';
import { MAS_KEYCHAIN_SERVICE, getMasCredentials } from './lib/mas.mjs';

let ok = true;

for (const [service, label, fn] of [
  [KEYCHAIN_SERVICE, 'sitio de compra (todoshowcase)', () => getCredentials()],
  [MAS_KEYCHAIN_SERVICE, 'beneficio 2x1 (masshowcase)', () => getMasCredentials()],
]) {
  try {
    const { user, pass } = await fn();
    if (!pass) throw new Error('la contraseña está vacía');
    // Solo confirmamos que existe. Ni el valor ni su longitud se reportan.
    console.log(`  OK     ${label.padEnd(32)} keychain:${service}  ->  ${user}`);
  } catch (e) {
    ok = false;
    console.log(`  FALLA  ${label.padEnd(32)} keychain:${service}\n         ${e.message.split('\n')[0]}`);
  }
}

console.log();

const codigo = process.env.SHOWCASE_2X1_CODE;
if (/^\d{12}$/.test(codigo ?? '')) {
  console.log(`  OK     SHOWCASE_2X1_CODE           ->  ${codigo.slice(0, 4)}…${codigo.slice(-2)}`);
} else {
  ok = false;
  console.log(`  FALLA  SHOWCASE_2X1_CODE           ->  ${codigo ? 'no son 12 dígitos' : 'no está seteada'}`);
}

if (process.env.NTFY_TOPIC) {
  console.log(`  OK     NTFY_TOPIC                  ->  seteada (push al celu activado)`);
} else {
  console.log(`  --     NTFY_TOPIC                  ->  no seteada (solo aviso local de Mac, sin push)`);
}

console.log(
  ok
    ? '\nTodo lo que se puede chequear sin tocar el sitio está OK.\n' +
        'Ojo: esto no valida que las credenciales sean correctas — eso lo dice tools/recon.mjs.'
    : '\nHay algo mal. Revisá el README ("Configuración") y tu .env / Keychain.'
);
process.exit(ok ? 0 : 1);
