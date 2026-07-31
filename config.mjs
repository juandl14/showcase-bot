// Configuración del bot. Editá esto para tu propia función — es lo único que
// hace falta tocar además del .env.
//
// Lo que va acá: preferencias tuyas (qué película, qué butacas, qué horarios).
// Lo que NO va acá: secretos (código 2x1, tema de notificaciones). Eso vive en
// tu `.env`, ver .env.example.

export default {
  // filmid de la pelicula que estás siguiendo. Se encuentra en la URL de su
  // página: entradas.todoshowcase.com/showcase/pelicula.aspx?filmid=N
  filmId: 5875, // EJEMPLO: 5875 = "La Odisea" (Nolan, IMAX) — cambialo por la tuya
  cine: /IMAX Theatre/i, // regex sobre el nombre del complejo/sala que aparece en el sitio

  // Código de 12 dígitos del beneficio 2x1 (ver README: "Código 2x1"). Se lee
  // de la variable de entorno SHOWCASE_2X1_CODE — no lo escribas acá.
  codigo: process.env.SHOWCASE_2X1_CODE || null,

  // Se busca la fila de la promo POR NOMBRE, no por posición: el índice del
  // control cambia según la sala y se correría si el cine agrega promociones.
  // Ajustá el texto a como aparece la tuya en "Selección de Precio".
  promo: /^\+\s*Showcase\s*2X1/i,

  // Push al celular vía ntfy.sh (sin cuenta). Se lee de NTFY_TOPIC en tu .env.
  // Si esa variable no está seteada, el bot simplemente no manda push (sigue
  // avisando por notificación local de macOS). Ver README: "Notificaciones".
  ntfyTopic: process.env.NTFY_TOPIC || null,

  // Medio de pago a pre-seleccionar en la pantalla de forma de pago. Se
  // matchea por el TEXTO del radio button (no por id), así sobrevive a
  // cambios en la lista de medios. El bot lo deja marcado y FRENA antes de
  // abrir el pop-up de pago: vos tocás continuar y cargás la tarjeta (nunca
  // la carga el bot — ver README: "Qué hace y qué NO hace").
  medioDePago: /VISA\s*CR[EÉ]DITO/i, // ajustá al medio que uses vos

  // ---- ZONA ACEPTABLE -------------------------------------------------------
  // Regla dura: el bot NUNCA toma butacas fuera de esto. El array va EN ORDEN
  // DE PREFERENCIA de fila (la primera es la más preferida). Cada fila trae su
  // propio rango de butaca, porque "las N centrales" es un rango DISTINTO por
  // fila — las filas no tienen todas el mismo ancho.
  //
  // Para armar la tuya: corré `node tools/mapear-sala.mjs` y `node
  // tools/plano-sala.mjs`, que dibujan el plano real de la sala con los
  // números de butaca. Mirá el README para el detalle.
  //
  // EJEMPLO de abajo: sala IMAX de 13 filas (A–M, 391 butacas), preferencia
  // de centro hacia afuera, las ~15 butacas más centrales de cada fila.
  zona: [
    { fila: 'H', min: 11, max: 25 },
    { fila: 'I', min: 12, max: 26 },
    { fila: 'G', min: 10, max: 24 },
    { fila: 'J', min: 12, max: 26 },
    { fila: 'F', min: 9, max: 23 },
    { fila: 'K', min: 12, max: 26 },
    { fila: 'E', min: 8, max: 22 },
  ],

  // ---- FUNCIONES, EN ORDEN DE PREFERENCIA -----------------------------------
  // Por día de semana + horario. El bot las resuelve a la fecha concreta que
  // aparezca en el drop (la fecha más próxima de ese día de semana dentro de
  // la ventana recién liberada). Las funciones que NO estén acá no se
  // consideran — si tu día/horario ideal no está en la lista, nunca se prueba.
  funciones: [
    { dia: 'sabado', hora: '22:35' },
    { dia: 'sabado', hora: '19:00' },
    { dia: 'sabado', hora: '15:25' },
    { dia: 'domingo', hora: '19:00' },
    { dia: 'domingo', hora: '15:25' },
    { dia: 'sabado', hora: '11:50' },
    { dia: 'domingo', hora: '11:50' },
    { dia: 'domingo', hora: '22:35' },
    { dia: 'lunes', hora: '22:35' },
    { dia: 'martes', hora: '22:35' },
    { dia: 'miercoles', hora: '22:35' },
    { dia: 'lunes', hora: '19:00' },
    { dia: 'martes', hora: '19:00' },
    { dia: 'miercoles', hora: '19:00' },
  ],

  // ---- POLLING --------------------------------------------------------------
  // No sabés a qué hora libera el cine, así que se vigila hasta detectar que
  // tus funciones aparecieron en cartel.
  polling: {
    // Última fecha en cartel ANTES del drop que esperás. Poné la fecha más
    // lejana que ya está publicada hoy — el bot dispara cuando aparece algo
    // posterior a esto. Revisala antes de cada uso: si queda vieja, el bot
    // puede disparar en falso contra una ventana que ya conocías.
    ventanaConocidaHasta: '2026-08-12',
    // Segundos entre chequeos. Se alinea a minutos redondos del reloj (:00,
    // :10, :20…) porque los cines suelen publicar en horas redondas — debería
    // dividir 3600 exacto (60, 120, 300, 600, 900...) para que la alineación
    // tenga sentido.
    intervaloSeg: 600,
    maxHoras: 14, // el bot se rinde solo después de este tiempo poleteando
  },

  // Antes de gastar el código, el bot entra con tarifa General y solo LEE si
  // hay par contiguo en la zona (no retiene nada). Recién si lo hay, rehace el
  // flujo con la promo y el código. Cuesta unos segundos por función, pero no
  // quema el código en una función sin lugar. Recomendado: true.
  //
  // Ojo: sigue existiendo una ventana chica entre el sondeo y la compra real
  // donde alguien más podría llevarse esas mismas butacas — ver README:
  // "Limitaciones conocidas".
  verificarAntesDeUsarCodigo: true,
};
