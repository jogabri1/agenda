// Envía un mensaje a un chat de Telegram concreto (formato HTML).
// Usa la API de bots (gratuita): https://core.telegram.org/bots/api

// Escapa el texto que escribe el usuario para que sea seguro en HTML
// (Telegram permite <b>, <i>, etc.; hay que escapar < > &).
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendTelegram(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Falta TELEGRAM_BOT_TOKEN en las variables de entorno.");
  if (!chatId) throw new Error("Falta el chat_id de destino.");

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Error de Telegram (chat ${chatId}): ` + JSON.stringify(data));
  }
  return data;
}

module.exports = { sendTelegram, esc };
