// Lógica de eventos RECURRENTES ("se repite cada N días").
// Una sola fila representa toda la serie: `ev.fecha` es la primera ocurrencia
// (ancla), `ev.repetir_cada` cada cuántos días se repite (NULL = no se repite)
// y `ev.repetir_hasta` la última fecha posible (NULL = sin fin).
// Las fechas se manejan como texto "YYYY-MM-DD" (su orden alfabético coincide
// con el cronológico). Esta misma lógica se replica en web/app.js (vanilla).

const { DateTime } = require("luxon");

// ¿El evento ocurre en la fecha dada ("YYYY-MM-DD")?
function ocurreEn(ev, fechaISO) {
  if (!ev.fecha || fechaISO < ev.fecha) return false;             // antes de la ancla
  if (ev.repetir_hasta && fechaISO > ev.repetir_hasta) return false; // pasado el fin
  if (!ev.repetir_cada) return fechaISO === ev.fecha;            // evento único
  // Recurrente: cuenta los días enteros desde la ancla (UTC evita líos de horario de verano).
  const desde = DateTime.fromISO(ev.fecha, { zone: "utc" });
  const hasta = DateTime.fromISO(fechaISO, { zone: "utc" });
  const dias = Math.round(hasta.diff(desde, "days").days);
  return dias % ev.repetir_cada === 0;
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
