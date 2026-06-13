// Utilidades de fecha/hora con zona horaria (usando luxon).
// GitHub Actions corre en UTC, así que SIEMPRE convertimos a la zona
// horaria configurada (TIMEZONE) para que los cálculos cuadren.

const { DateTime } = require("luxon");

const ZONE = process.env.TIMEZONE || "America/Lima";

// "ahora" en la zona horaria configurada
function ahora() {
  return DateTime.now().setZone(ZONE);
}

// Convierte un evento (fecha "YYYY-MM-DD" + hora "HH:MM[:SS]") en un
// instante con zona horaria. Así podemos comparar con "ahora".
function momentoEvento(ev) {
  const hora = (ev.hora || "00:00:00").slice(0, 8);
  return DateTime.fromISO(`${ev.fecha}T${hora}`, { zone: ZONE });
}

// Formatea una duración en minutos como "3 h 20 min", "45 min", etc.
function faltaTexto(minutos) {
  const m = Math.max(0, Math.round(minutos));
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h > 0 && min > 0) return `${h} h ${min} min`;
  if (h > 0) return `${h} h`;
  return `${min} min`;
}

// Fecha en español: "jueves 12 de junio"
function fechaEspanol(dt) {
  return dt.setLocale("es").toFormat("cccc d 'de' LLLL");
}

module.exports = { DateTime, ZONE, ahora, momentoEvento, faltaTexto, fechaEspanol };
