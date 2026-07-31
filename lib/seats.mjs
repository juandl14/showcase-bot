// Lectura del mapa de butacas y busqueda de pares contiguos.
//
// El mapa de butacas.aspx es una <table>. Cada butaca es:
//   <input type="image" id="ctl00_Contenido_<N>" title="F3-A7" src="img/AvSeat.jpg">
//
// TRAMPA IMPORTANTE: la numeracion va del centro hacia afuera, con los pares a
// un lado y los impares al otro:
//
//     A14 A12 A10 A8 A6 A4 A2 | A1 A3 A5 A7 A9 A11 A13
//
// Es decir que A5 y A6 NO son vecinas: estan en mitades opuestas de la sala.
// La contigüidad fisica se deduce del ORDEN EN EL DOM dentro de cada <tr>,
// nunca del numero de butaca. El sitio ademas lo valida: si mandas dos butacas
// no contiguas responde "Debe seleccionar todas las butacas contiguas".

// Estados observados, por imagen:
//   AvSeat.jpg     disponible            (seleccionable)
//   NotAvSeat.jpg  no disponible         (disabled)
//   SoldSeat.jpg   vendida               (disabled)
//   HandSeat.jpg   accesible/movilidad   (seleccionable, pero se excluye por defecto)
//
// OJO: el nombre "NotAvSeat" CONTIENE "AvSeat". Un /AvSeat/ suelto da falsos
// positivos y el bot termina clickeando butacas deshabilitadas. El ancla del
// separador es obligatoria, y ademas cruzamos con el atributo `disabled`.
const LIBRE = /(^|\/)AvSeat\.jpg/i;
const ACCESIBLE = /(^|\/)HandSeat\.jpg/i;

/**
 * Lee el mapa como una matriz de filas fisicas, respetando el orden del DOM.
 * Devuelve [{ fila, butacas: [{ id, title, fila, nro, libre, src }] }]
 */
export async function readSeatMap(page) {
  const filas = await page.evaluate(() => {
    const out = [];
    for (const tr of document.querySelectorAll('tr')) {
      const butacas = [...tr.querySelectorAll('input[type=image][title]')].map((el) => {
        // Hay al menos dos esquemas de etiquetado segun la sala:
        //   Haedo / salas 2D   ->  "F1-A14"   fila F1, butaca 14
        //   IMAX Norcenter     ->  "A-19"     fila A,  butaca 19
        // Se parte por el guion: izquierda = etiqueta de fila, derecha = numero.
        const [izq = '', der = ''] = (el.title || '').split('-');
        const n = der.replace(/\D/g, '');
        return {
          id: el.id,
          title: el.title,
          etiquetaFila: izq.trim() || null,
          nro: n === '' ? null : Number(n),
          src: el.getAttribute('src') || '',
          disabled: el.disabled,
        };
      });
      if (butacas.length > 2) out.push({ etiqueta: butacas[0].etiquetaFila, butacas });
    }
    return out;
  });

  // El indice es 1-based en orden de pantalla hacia el fondo: sirve para acotar
  // zonas sin depender de si las filas se llaman "A" o "F1".
  return filas.map((f, i) => ({ ...f, indice: i + 1 }));
}

/**
 * Marca el estado libre/ocupado. Se hace fuera del browser para poder testear.
 * Las butacas accesibles se excluyen salvo pedido explicito: son de quien las
 * necesita, y ademas suelen tener condiciones distintas en boleteria.
 */
export function markAvailability(filas, { incluirAccesibles = false } = {}) {
  return filas.map((f) => ({
    ...f,
    butacas: f.butacas.map((b) => ({
      ...b,
      accesible: ACCESIBLE.test(b.src),
      libre: !b.disabled && (LIBRE.test(b.src) || (incluirAccesibles && ACCESIBLE.test(b.src))),
    })),
  }));
}

/**
 * Busca pares (o grupos de `n`) de butacas fisicamente contiguas dentro de la
 * zona aceptable.
 *
 * `zona` es un array de filas EN ORDEN DE PREFERENCIA, cada una con su propio
 * rango de numeros de butaca (porque "las N centrales" es un rango distinto por
 * fila, ya que cada fila tiene distinto ancho):
 *
 *   [ { fila: 'H', min: 11, max: 25 },
 *     { fila: 'I', min: 12, max: 26 }, ... ]
 *
 * Regla dura: nada fuera de la zona. Devuelve los pares ordenados de mejor a
 * peor; el primero es el que hay que tomar.
 */
export function findPairs(filas, zona = [], { n = 2 } = {}) {
  // Mapa etiqueta -> { min, max, prioridad } segun el orden de la zona.
  const reglas = new Map(
    zona.map((z, i) => [String(z.fila).toUpperCase(), { min: z.min ?? -Infinity, max: z.max ?? Infinity, prioridad: i }])
  );

  const pares = [];
  for (const f of filas) {
    const et = String(f.etiqueta ?? '').toUpperCase();
    const regla = reglas.get(et);
    if (!regla) continue; // fila fuera de la zona

    // Ventana deslizante sobre el orden del DOM: esa es la contigüidad real.
    for (let i = 0; i + n <= f.butacas.length; i++) {
      const grupo = f.butacas.slice(i, i + n);
      if (!grupo.every((b) => b.libre)) continue;
      if (grupo.some((b) => b.nro == null || b.nro < regla.min || b.nro > regla.max)) continue;

      // Desempate: cuanto mas cerca del centro de la fila, mejor.
      const medio = (f.butacas.length + 1) / 2;
      const posiciones = grupo.map((b) => f.butacas.indexOf(b) + 1);
      const desvio = Math.abs(posiciones.reduce((a, x) => a + x, 0) / n - medio);

      pares.push({
        fila: f.etiqueta,
        indice: f.indice,
        butacas: grupo,
        etiquetas: grupo.map((b) => b.title),
        puntaje: regla.prioridad * 1000 + desvio, // menor es mejor
      });
    }
  }
  return pares.sort((a, b) => a.puntaje - b.puntaje);
}

/** Resumen legible del mapa, para logs y para decidir la zona. */
export function summarize(filas) {
  const total = filas.reduce((a, f) => a + f.butacas.length, 0);
  const libres = filas.reduce((a, f) => a + f.butacas.filter((b) => b.libre).length, 0);
  return {
    filas: filas.length,
    total,
    libres,
    ocupadas: total - libres,
    porFila: filas.map((f) => ({
      fila: f.etiqueta,
      indice: f.indice,
      ancho: f.butacas.length,
      libres: f.butacas.filter((b) => b.libre).length,
    })),
  };
}
