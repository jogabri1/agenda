// ───────────────────────────────────────────────────────────────
//  RECORDATORIOS previos: avisa 1 h, 20 min antes y A LA HORA de cada evento.
//  Multi-usuario: cada aviso se envía al Telegram de SU dueño.
//  Lo dispara cron-job.org cada ~5 minutos (así el aviso "a la hora" es exacto).
//
//  Lógica por FRANJAS (evita avisos erróneos y duplicados):
//    · franja 1h:   53 < faltan ≤ 67 min  → marca sent_1h    (~1 h antes)
//    · franja 20m:  13 < faltan ≤ 27 min  → marca sent_20m   (~20 min antes)
//    · franja now:  -3 < faltan ≤  7 min  → marca sent_now   (a la hora exacta)
//  Cada franja se envía UNA sola vez gracias a las marcas sent_*.
//  El mensaje muestra el tiempo restante REAL, así nunca miente.
// ───────────────────────────────────────────────────────────────

const { getClient } = require("./lib/supabase");
const { sendTelegram, esc } = require("./lib/telegram");
const { ahora, momentoEvento, faltaTexto } = require("./lib/time");
const { ocurreEn } = require("./lib/recurrencia");

// Avisos: 1 h antes, 20 min antes y A LA HORA del evento.
// Ventanas ceñidas a 60 / 20 / 0 min, con ancho ≥ 5 min para que el
// cron de 5 min siempre las capture (aunque haya algo de retraso).
const FRANJAS = [
  { flag: "sent_1h",  maxMin: 67, minMin: 53 },               // ~1 h antes
  { flag: "sent_20m", maxMin: 27, minMin: 13 },               // ~20 min antes
  { flag: "sent_now", maxMin: 7,  minMin: -3, ahora: true },  // a la hora exacta
];

function prefijoDia(evDt, ahoraDt) {
  if (evDt.toISODate() === ahoraDt.toISODate()) return "Hoy";
  if (evDt.toISODate() === ahoraDt.plus({ days: 1 }).toISODate()) return "Mañana";
  return evDt.setLocale("es").toFormat("cccc d");
}

async function main() {
  const db = getClient();
  const now = ahora();
  const hoy = now.toISODate();
  const manana = now.plus({ days: 1 }).toISODate();

  // Mapa de usuarios → su chat_id de Telegram
  const { data: perfiles, error: errP } = await db.from("profiles").select("id, nombre, chat_id");
  if (errP) throw errP;
  const chatPorUsuario = {};
  for (const p of perfiles || []) chatPorUsuario[p.id] = p.chat_id;

  // Eventos ÚNICOS (sin repetición) de hoy/mañana a los que aún les falte algún aviso.
  const { data: unicos, error } = await db
    .from("events")
    .select("*")
    .is("repetir_dias", null)
    .in("fecha", [hoy, manana])
    .or("sent_1h.eq.false,sent_20m.eq.false,sent_now.eq.false");
  if (error) throw error;

  // Eventos RECURRENTES activos (su día de inicio puede ser muy anterior; el control
  // de "ya avisado" va en la tabla reminders_log, no en las casillas sent_*).
  const { data: recurrentes, error: errR } = await db
    .from("events")
    .select("*")
    .not("repetir_dias", "is", null)
    .or(`repetir_hasta.is.null,repetir_hasta.gte.${hoy}`);
  if (errR) throw errR;

  // Lista unificada de candidatos { ev, fechaISO, recurrente }: un único aporta su
  // propia fecha; un recurrente aporta las ocurrencias que caen hoy o mañana.
  const candidatos = [];
  for (const ev of unicos || []) candidatos.push({ ev, fechaISO: ev.fecha, recurrente: false });
  for (const ev of recurrentes || []) {
    for (const f of [hoy, manana]) {
      if (ocurreEn(ev, f)) candidatos.push({ ev, fechaISO: f, recurrente: true });
    }
  }

  let enviados = 0;
  for (const { ev, fechaISO, recurrente } of candidatos) {
    const chatId = chatPorUsuario[ev.user_id];
    if (!chatId) continue; // ese usuario aún no vinculó su Telegram

    const evDt = momentoEvento({ ...ev, fecha: fechaISO });
    const minutos = evDt.diff(now, "minutes").minutes;
    if (minutos < 0) continue; // ya pasó

    const franja = FRANJAS.find((f) => minutos > f.minMin && minutos <= f.maxMin);
    if (!franja) continue; // fuera de toda franja

    // ¿Ya se envió esta franja? Únicos: casilla sent_* en la fila. Recurrentes:
    // una fila en reminders_log por (evento, fecha, franja).
    if (recurrente) {
      const { data: ya, error: errLog } = await db
        .from("reminders_log")
        .select("event_id")
        .eq("event_id", ev.id)
        .eq("fecha", fechaISO)
        .eq("franja", franja.flag)
        .maybeSingle();
      if (errLog) throw errLog;
      if (ya) continue;
    } else if (ev[franja.flag]) {
      continue;
    }

    // Mensaje muy corto: solo el aviso + el título en negrita.
    const msg = franja.ahora
      ? `🔔 ¡Es la hora de: <b>${esc(ev.titulo)}</b>`
      : `⏰ Faltan ~${faltaTexto(minutos)} para: <b>${esc(ev.titulo)}</b>`;

    await sendTelegram(chatId, msg);

    // Marcar como enviado (mismo orden que antes: enviar → marcar).
    if (recurrente) {
      const { error: insErr } = await db
        .from("reminders_log")
        .insert({ event_id: ev.id, fecha: fechaISO, franja: franja.flag });
      // 23505 = ya existía (otra ejecución solapada lo marcó): no es un fallo real.
      if (insErr && insErr.code !== "23505") throw insErr;
    } else {
      const { error: upErr } = await db
        .from("events")
        .update({ [franja.flag]: true })
        .eq("id", ev.id);
      if (upErr) throw upErr;
    }

    enviados++;
    console.log(`Aviso (${franja.flag}${recurrente ? " 🔁" : ""}) a chat ${chatId}: "${ev.titulo}" — faltan ${faltaTexto(minutos)}`);
  }

  console.log(`Listo. Recordatorios enviados: ${enviados}.`);
}

main().catch((e) => {
  console.error("ERROR en send-reminders:", e.message);
  process.exit(1);
});
