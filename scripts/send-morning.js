// ───────────────────────────────────────────────────────────────
//  RESUMEN DE LA MAÑANA (multi-usuario): a cada persona se le envía
//  SU propio resumen a SU Telegram, con dos bloques:
//    1) HOY:           sus reuniones y tareas de hoy (por hora)
//    2) PRÓXIMOS DÍAS: sus eventos de los siguientes días (solo si hay)
//  Se ejecuta en GitHub Actions una vez al día (por la mañana).
// ───────────────────────────────────────────────────────────────

const { getClient } = require("./lib/supabase");
const { sendTelegram, esc } = require("./lib/telegram");
const { ahora, momentoEvento, fechaEspanol } = require("./lib/time");
const { ocurrencias } = require("./lib/recurrencia");

const NEXT_DAYS = parseInt(process.env.NEXT_DAYS || "3", 10);

function lineaEvento(ev) {
  // Hora y título en NEGRITA (<b>); el resto del texto del usuario se escapa.
  // 🔁 marca los eventos que se repiten.
  const rep = ev.repetir_cada ? " 🔁" : "";
  let linea = `• <b>${(ev.hora || "").slice(0, 5)}</b> — <b>${esc(ev.titulo)}</b>${rep}`;
  if (ev.notas) linea += `\n   📝 ${esc(ev.notas)}`;
  return linea;
}

function construirMensaje(now, eventos, nombre, pendientes = []) {
  const hoy = now.toISODate();
  const deHoy = eventos.filter((e) => e.fecha === hoy);
  const proximos = eventos.filter((e) => e.fecha !== hoy);

  const saludo = nombre ? `¡Buenos días, ${esc(nombre)}!` : "¡Buenos días!";
  let msg = `☀️ <b>${saludo}</b>\n\n`;
  msg += `<b>Agenda de hoy (${fechaEspanol(now)}):</b>\n`;
  msg += deHoy.length === 0 ? "<i>Hoy no tienes nada agendado.</i>\n" : deHoy.map(lineaEvento).join("\n") + "\n";

  if (proximos.length > 0) {
    msg += `\n📅 <b>Próximos días:</b>\n`;
    let fechaActual = null;
    for (const ev of proximos) {
      if (ev.fecha !== fechaActual) {
        fechaActual = ev.fecha;
        const etiqueta = fechaEspanol(momentoEvento(ev));
        msg += `\n<b>${etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1)}:</b>\n`;
      }
      msg += lineaEvento(ev) + "\n";
    }
  }
  // Pendientes (sin fecha): se recuerdan cada mañana hasta agendarlos o borrarlos.
  if (pendientes.length > 0) {
    msg += `\n📌 <b>Pendientes:</b>\n`;
    msg += pendientes.map((p) => `• <b>${esc(p.titulo)}</b>`).join("\n") + "\n";
  }

  return { msg: msg.trim(), nHoy: deHoy.length, nProx: proximos.length };
}

async function main() {
  const db = getClient();
  const now = ahora();
  const hoy = now.toISODate();
  const hasta = now.plus({ days: NEXT_DAYS }).toISODate();

  // Usuarios con Telegram vinculado
  const { data: perfiles, error: errP } = await db
    .from("profiles")
    .select("id, nombre, chat_id")
    .not("chat_id", "is", null);
  if (errP) throw errP;

  let enviados = 0;
  for (const perfil of perfiles || []) {
    // Eventos ÚNICOS (sin repetición) del rango [hoy, hasta].
    const { data: unicos, error } = await db
      .from("events")
      .select("*")
      .eq("user_id", perfil.id)
      .is("repetir_cada", null)
      .gte("fecha", hoy)
      .lte("fecha", hasta)
      .order("fecha", { ascending: true })
      .order("hora", { ascending: true });
    if (error) throw error;

    // Eventos RECURRENTES activos del usuario: expandimos sus ocurrencias dentro
    // del rango (cada ocurrencia es un evento "virtual" con su fecha concreta).
    const { data: recurrentes, error: errR } = await db
      .from("events")
      .select("*")
      .eq("user_id", perfil.id)
      .not("repetir_cada", "is", null)
      .or(`repetir_hasta.is.null,repetir_hasta.gte.${hoy}`);
    if (errR) throw errR;

    const expandidos = [];
    for (const ev of recurrentes || []) {
      for (const f of ocurrencias(ev, hoy, hasta)) expandidos.push({ ...ev, fecha: f });
    }

    // Mezclamos únicos + ocurrencias recurrentes y ordenamos por fecha y hora.
    const eventos = [...(unicos || []), ...expandidos].sort(
      (a, b) => a.fecha.localeCompare(b.fecha) || (a.hora || "").localeCompare(b.hora || "")
    );

    // Pendientes (sin fecha) de esa persona, para recordárselos cada mañana.
    const { data: pendientes, error: errP2 } = await db
      .from("events")
      .select("titulo")
      .eq("user_id", perfil.id)
      .eq("pendiente", true)
      .order("created_at", { ascending: true });
    if (errP2) throw errP2;

    const { msg, nHoy, nProx } = construirMensaje(now, eventos || [], perfil.nombre, pendientes || []);
    await sendTelegram(perfil.chat_id, msg);
    enviados++;
    console.log(`Resumen → ${perfil.nombre || perfil.id} (chat ${perfil.chat_id}). Hoy: ${nHoy} · Próximos: ${nProx} · Pendientes: ${(pendientes || []).length}.`);
  }

  console.log(`Listo. Resúmenes enviados: ${enviados}.`);
}

main().catch((e) => {
  console.error("ERROR en send-morning:", e.message);
  process.exit(1);
});
