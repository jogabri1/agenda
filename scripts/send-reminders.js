// ───────────────────────────────────────────────────────────────
//  RECORDATORIOS previos: avisa 5 h, 3 h y 1 h antes de cada evento.
//  Multi-usuario: cada aviso se envía al Telegram de SU dueño.
//  Se ejecuta en GitHub Actions cada ~15 minutos.
//
//  Lógica por FRANJAS (evita avisos erróneos y duplicados):
//    · franja 5h:  180 < faltan ≤ 300 min  → marca sent_5h
//    · franja 3h:   60 < faltan ≤ 180 min  → marca sent_3h
//    · franja 1h:    0 < faltan ≤  60 min  → marca sent_1h
//  Cada franja se envía UNA sola vez gracias a las marcas sent_*.
//  El mensaje muestra el tiempo restante REAL, así nunca miente.
// ───────────────────────────────────────────────────────────────

const { getClient } = require("./lib/supabase");
const { sendTelegram } = require("./lib/telegram");
const { ahora, momentoEvento, faltaTexto } = require("./lib/time");

const FRANJAS = [
  { flag: "sent_5h", maxMin: 300, minMin: 180 },
  { flag: "sent_3h", maxMin: 180, minMin: 60 },
  { flag: "sent_1h", maxMin: 60, minMin: 0 },
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
    .or("sent_5h.eq.false,sent_3h.eq.false,sent_1h.eq.false");
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

    const cuando = `${prefijoDia(evDt, now)} a las ${evDt.toFormat("HH:mm")}`;
    // Mensaje corto: solo el intervalo + el título + la hora (sin categoría ni notas).
    const msg = `⏰ Faltan ~${faltaTexto(minutos)} para:\n*${ev.titulo}*\n🗓️ ${cuando}`;

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
