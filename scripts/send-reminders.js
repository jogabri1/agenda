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

  // Eventos de hoy/mañana (de todos los usuarios) a los que aún les falte algún aviso
  const { data, error } = await db
    .from("events")
    .select("*")
    .in("fecha", [hoy, manana])
    .or("sent_1h.eq.false,sent_20m.eq.false,sent_now.eq.false");
  if (error) throw error;

  let enviados = 0;
  for (const ev of data || []) {
    const chatId = chatPorUsuario[ev.user_id];
    if (!chatId) continue; // ese usuario aún no vinculó su Telegram

    const evDt = momentoEvento(ev);
    const minutos = evDt.diff(now, "minutes").minutes;
    if (minutos < 0) continue; // ya pasó

    const franja = FRANJAS.find((f) => minutos > f.minMin && minutos <= f.maxMin);
    if (!franja || ev[franja.flag]) continue; // sin franja, o ya enviada

    // Mensaje muy corto: solo el aviso + el título en negrita.
    const msg = franja.ahora
      ? `🔔 ¡Es la hora de: <b>${esc(ev.titulo)}</b>`
      : `⏰ Faltan ~${faltaTexto(minutos)} para: <b>${esc(ev.titulo)}</b>`;

    await sendTelegram(chatId, msg);
    const { error: upErr } = await db
      .from("events")
      .update({ [franja.flag]: true })
      .eq("id", ev.id);
    if (upErr) throw upErr;

    enviados++;
    console.log(`Aviso (${franja.flag}) a chat ${chatId}: "${ev.titulo}" — faltan ${faltaTexto(minutos)}`);
  }

  console.log(`Listo. Recordatorios enviados: ${enviados}.`);
}

main().catch((e) => {
  console.error("ERROR en send-reminders:", e.message);
  process.exit(1);
});
