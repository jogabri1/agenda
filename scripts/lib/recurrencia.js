// Lógica de eventos RECURRENTES por DÍAS DE LA SEMANA.
// Una sola fila representa toda la serie: `ev.fecha` es el día de INICIO (no se
// repite antes), `ev.repetir_dias` son los días en que se repite (texto con
// números ISO separados por coma: 1=lunes … 7=domingo; NULL = no se repite) y
// `ev.repetir_hasta` la última fecha posible (NULL = sin fin). Las fechas se
// manejan como texto "YYYY-MM-DD". Esta misma lógica se replica en web/app.js.

const { DateTime } = require("luxon");

// Días de la semana en que se repite, como conjunto de números (1=lun … 7=dom).
function diasSet(ev) {
  return new Set((ev.repetir_dias || "").split(",").map((s) => parseInt(s, 10)).filter(Boolean));
}

// ¿El evento ocurre en la fecha dada ("YYYY-MM-DD")?
function ocurreEn(ev, fechaISO) {
  if (!ev.fecha || fechaISO < ev.fecha) return false;                // antes del inicio
  if (ev.repetir_hasta && fechaISO > ev.repetir_hasta) return false; // pasado el fin
  if (!ev.repetir_dias) return fechaISO === ev.fecha;               // evento único
  const diaSemana = DateTime.fromISO(fechaISO, { zone: "utc" }).weekday; // 1=lun … 7=dom
  return diasSet(ev).has(diaSemana);
}

// Fechas ("YYYY-MM-DD") en que el evento ocurre dentro de [desdeISO, hastaISO].
function ocurrencias(ev, desdeISO, hastaISO) {
  const out = [];
  let d = DateTime.fromISO(desdeISO, { zone: "utc" });
  const fin = DateTime.fromISO(hastaISO, { zone: "utc" });
  while (d <= fin) {
    const iso = d.toISODate();
    if (ocurreEn(ev, iso)) out.push(iso);
    d = d.plus({ days: 1 });
  }
  return out;
}

module.exports = { ocurreEn, ocurrencias };
