// ───────────────────────────────────────────────────────────────
//  Lógica de la PWA de Agenda (multi-usuario con login)
//  - Login/registro con email + contraseña (Supabase Auth)
//  - Cada usuario ve SOLO su agenda (lo garantiza la RLS)
//  - Cada usuario vincula su Telegram para recibir avisos
// ───────────────────────────────────────────────────────────────

const cfg = window.AGENDA_CONFIG || {};
const configOK =
  cfg.SUPABASE_URL &&
  cfg.SUPABASE_ANON_KEY &&
  !cfg.SUPABASE_URL.includes("TU-PROYECTO") &&
  !cfg.SUPABASE_ANON_KEY.includes("PEGA_AQUI");

let db = null;
let usuario = null;
let perfil = null;
let modoRegistro = false;

const $ = (id) => document.getElementById(id);

// ───────── Utilidades de fecha ─────────
const fmtDiaLargo = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" });

function fechaLocal(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function isoDe(fecha) {
  const p = (x) => String(x).padStart(2, "0");
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}`;
}
function isoHoy() {
  return isoDe(new Date());
}
function horaCorta(hora) {
  return (hora || "").slice(0, 5);
}
function etiquetaFecha(yyyymmdd) {
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  let txt = fmtDiaLargo.format(fechaLocal(yyyymmdd));
  txt = txt.charAt(0).toUpperCase() + txt.slice(1);
  if (yyyymmdd === isoHoy()) return { txt: "Hoy · " + txt, hoy: true };
  if (yyyymmdd === isoDe(manana)) return { txt: "Mañana · " + txt, hoy: false };
  return { txt, hoy: false };
}
function escapar(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ───────── Banner de estado ─────────
function aviso(mensaje, tipo) {
  const el = $("status");
  el.textContent = mensaje;
  el.className = "banner " + (tipo === "ok" ? "banner-ok" : tipo === "error" ? "banner-error" : "");
  el.hidden = false;
  if (tipo === "ok") setTimeout(() => (el.hidden = true), 2800);
}

// ───────── Arranque ─────────
async function init() {
  if (!configOK) {
    $("config-warning").hidden = false;
    return;
  }
  db = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    global: {
      // Forzamos "no-store" para que el navegador NUNCA sirva respuestas
      // viejas en caché (era lo que hacía que el banner no se actualizara).
      fetch: (input, init = {}) => fetch(input, { ...init, cache: "no-store" }),
    },
  });

  const { data } = await db.auth.getSession();
  renderSesion(data.session);
  // Importante: diferimos con setTimeout para NO llamar a Supabase dentro
  // del callback de onAuthStateChange (evita un bloqueo/deadlock conocido
  // de supabase-js que hacía que el login se quedara colgado sin entrar).
  db.auth.onAuthStateChange((_evento, session) => {
    setTimeout(() => renderSesion(session), 0);
  });

  registrarServiceWorker();
}

function renderSesion(session) {
  usuario = session ? session.user : null;
  if (usuario) {
    $("auth-view").hidden = true;
    $("app-view").hidden = false;
    cargarPerfil();
    cargar();
  } else {
    $("app-view").hidden = true;
    $("auth-view").hidden = false;
    $("cargando").hidden = false;
  }
}

// ═══════════════ LOGIN / REGISTRO ═══════════════
function alternarModo() {
  modoRegistro = !modoRegistro;
  $("campo-nombre-wrap").hidden = !modoRegistro;
  $("auth-sub").textContent = modoRegistro ? "Crea tu cuenta para empezar" : "Inicia sesión para ver tu agenda";
  $("btn-auth").textContent = modoRegistro ? "Crear cuenta" : "Entrar";
  $("auth-toggle-text").textContent = modoRegistro ? "¿Ya tienes cuenta?" : "¿No tienes cuenta?";
  $("btn-toggle-auth").textContent = modoRegistro ? "Iniciar sesión" : "Crear cuenta";
  $("auth-pass").setAttribute("autocomplete", modoRegistro ? "new-password" : "current-password");
}

async function enviarAuth(e) {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  const pass = $("auth-pass").value;
  $("btn-auth").disabled = true;

  try {
    if (modoRegistro) {
      const nombre = $("auth-nombre").value.trim();
      const { data, error } = await db.auth.signUp({
        email,
        password: pass,
        options: { data: { nombre } },
      });
      if (error) throw error;
      if (!data.session) {
        aviso("Cuenta creada. Revisa tu email para confirmarla y luego inicia sesión.", "ok");
        alternarModo(); // vuelve a modo "Entrar"
      } else {
        aviso("¡Cuenta creada! Bienvenido/a 🎉", "ok");
      }
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    }
  } catch (err) {
    aviso(traducirError(err.message), "error");
  } finally {
    $("btn-auth").disabled = false;
  }
}

function traducirError(msg) {
  if (/Invalid login credentials/i.test(msg)) return "Email o contraseña incorrectos.";
  if (/already registered/i.test(msg)) return "Ese email ya tiene cuenta. Inicia sesión.";
  if (/Password should be/i.test(msg)) return "La contraseña debe tener al menos 6 caracteres.";
  if (/Email not confirmed/i.test(msg)) return "Confirma tu email antes de entrar (revisa tu correo).";
  return msg;
}

async function salir() {
  await db.auth.signOut();
}

// ═══════════════ PERFIL / TELEGRAM ═══════════════
async function cargarPerfil() {
  const { data, error } = await db.from("profiles").select("*").eq("id", usuario.id).maybeSingle();
  if (error) {
    aviso("No se pudo cargar tu perfil: " + error.message, "error");
    return;
  }
  perfil = data || { id: usuario.id, nombre: null, chat_id: null };
  $("userbar-nombre").textContent = "👤 " + (perfil.nombre || usuario.email);
  $("telegram-banner").hidden = !!perfil.chat_id; // oculto si ya tiene Telegram
}

function abrirTelegram() {
  $("tg-nombre").value = perfil?.nombre || "";
  $("tg-chatid").value = perfil?.chat_id || "";
  $("sheet-telegram").hidden = false;
  $("overlay").hidden = false;
}

async function guardarTelegram(e) {
  e.preventDefault();
  const nombre = $("tg-nombre").value.trim() || null;
  const chat_id = $("tg-chatid").value.trim() || null;
  $("btn-tg-guardar").disabled = true;

  const { error } = await db
    .from("profiles")
    .upsert({ id: usuario.id, nombre, chat_id }, { onConflict: "id" });
  $("btn-tg-guardar").disabled = false;

  if (error) return aviso("No se pudo guardar: " + error.message, "error");
  perfil = { ...perfil, nombre, chat_id };
  // Actualizamos la interfaz directamente con lo recién guardado, sin
  // depender de una relectura (que podría venir cacheada por el navegador).
  $("userbar-nombre").textContent = "👤 " + (perfil.nombre || usuario.email);
  $("telegram-banner").hidden = !!perfil.chat_id;
  cerrarHojas();
  aviso("Telegram vinculado ✓", "ok");
}

// ═══════════════ EVENTOS ═══════════════
async function cargar() {
  // Traemos los eventos de hoy en adelante Y los pendientes (sin fecha).
  const { data, error } = await db
    .from("events")
    .select("*")
    .or(`fecha.gte.${isoHoy()},pendiente.is.true`)
    .order("fecha", { ascending: true })
    .order("hora", { ascending: true });

  if (error) {
    aviso("No se pudo cargar la agenda: " + error.message, "error");
    return;
  }
  pintar(data || []);
}

function pintar(eventos) {
  const lista = $("lista");
  lista.innerHTML = "";
  if (eventos.length === 0) {
    lista.innerHTML = '<p class="vacio">No hay nada en tu agenda todavía.<br>Pulsa “+ Nuevo” para empezar.</p>';
    return;
  }
  const pendientes = eventos.filter((ev) => ev.pendiente);
  const conFecha = eventos.filter((ev) => !ev.pendiente);

  // Pendientes (sin fecha) arriba del todo.
  if (pendientes.length > 0) {
    const h = document.createElement("div");
    h.className = "grupo-fecha pendientes";
    h.textContent = "📌 Pendientes (sin fecha)";
    lista.appendChild(h);
    for (const ev of pendientes) lista.appendChild(tarjeta(ev));
  }

  // Eventos con fecha, agrupados por día.
  let fechaActual = null;
  for (const ev of conFecha) {
    if (ev.fecha !== fechaActual) {
      fechaActual = ev.fecha;
      const { txt, hoy } = etiquetaFecha(ev.fecha);
      const h = document.createElement("div");
      h.className = "grupo-fecha" + (hoy ? " hoy" : "");
      h.textContent = txt;
      lista.appendChild(h);
    }
    lista.appendChild(tarjeta(ev));
  }
}

function tarjeta(ev) {
  const card = document.createElement("div");
  card.className = "evento";
  const notasHtml = ev.notas ? `<div class="notas">${escapar(ev.notas)}</div>` : "";
  const badge = ev.categoria ? `<span class="badge">${escapar(ev.categoria)}</span>` : "";
  const horaTxt = ev.pendiente ? "📌" : horaCorta(ev.hora);
  card.innerHTML = `
    <div class="hora${ev.pendiente ? " pend" : ""}">${horaTxt}</div>
    <div class="cuerpo">
      <div class="titulo">${escapar(ev.titulo)}</div>
      ${notasHtml}
      <div>${badge}</div>
    </div>
    <div class="acciones-evento">
      <button class="icono-btn" data-accion="editar" title="Editar">✏️</button>
      <button class="icono-btn" data-accion="borrar" title="Borrar">🗑️</button>
    </div>`;
  card.querySelector('[data-accion="editar"]').onclick = () => abrirFormulario(ev);
  card.querySelector('[data-accion="borrar"]').onclick = () => borrar(ev);
  return card;
}

function abrirFormulario(ev) {
  const form = $("form-evento");
  form.reset();
  $("evento-id").value = ev ? ev.id : "";
  $("form-titulo").textContent = ev ? "Editar evento" : "Nuevo evento";
  if (ev) {
    $("campo-titulo").value = ev.titulo || "";
    $("campo-fecha").value = ev.fecha || "";
    $("campo-hora").value = horaCorta(ev.hora);
    $("campo-categoria").value = ev.categoria || "reunión";
    $("campo-notas").value = ev.notas || "";
    $("campo-pendiente").checked = !!ev.pendiente;
  } else {
    $("campo-fecha").value = isoHoy();
    $("campo-pendiente").checked = false;
  }
  aplicarModoPendiente(); // apaga/enciende los campos según el interruptor
  $("sheet").hidden = false;
  $("overlay").hidden = false;
}

// Cuando el evento es "pendiente": solo queda el nombre. Apagamos día, hora,
// tipo y notas (y les quitamos el `required` para que el formulario sí envíe).
function aplicarModoPendiente() {
  const p = $("campo-pendiente").checked;
  for (const cid of ["campo-fecha", "campo-hora", "campo-categoria", "campo-notas"]) {
    $(cid).disabled = p;
  }
  $("campo-fecha").required = !p;
  $("campo-hora").required = !p;
}

function cerrarHojas() {
  $("sheet").hidden = true;
  $("sheet-telegram").hidden = true;
  $("overlay").hidden = true;
}

async function guardarEvento(e) {
  e.preventDefault();
  const id = $("evento-id").value;
  const esPendiente = $("campo-pendiente").checked;

  // Un "pendiente" solo lleva título (sin fecha, hora, tipo ni notas).
  const datos = esPendiente
    ? { titulo: $("campo-titulo").value.trim(), pendiente: true, fecha: null, hora: null, categoria: null, notas: null }
    : {
        titulo: $("campo-titulo").value.trim(),
        pendiente: false,
        fecha: $("campo-fecha").value,
        hora: $("campo-hora").value,
        categoria: $("campo-categoria").value,
        notas: $("campo-notas").value.trim() || null,
      };

  $("btn-guardar").disabled = true;

  // Evitar dos eventos el mismo día a la misma hora. Solo aplica a eventos con
  // horario; los pendientes no tienen hora, así que no se validan.
  // La RLS limita la consulta a MIS eventos; comparamos con horaCorta para
  // que "10:00" del formulario iguale a "10:00:00" guardado en la base.
  if (!esPendiente) {
    const { data: delDia, error: errChk } = await db
      .from("events")
      .select("id, hora")
      .eq("fecha", datos.fecha);
    if (errChk) {
      $("btn-guardar").disabled = false;
      return aviso("No se pudo validar el horario: " + errChk.message, "error");
    }
    const choca = (delDia || []).some((ev) => horaCorta(ev.hora) === datos.hora && ev.id !== id);
    if (choca) {
      $("btn-guardar").disabled = false;
      alert(`Ya tienes un evento a las ${datos.hora} ese día. Cambia la hora o borra el otro.`);
      return; // no se graba; el formulario queda abierto para corregir
    }
  }

  let error;
  if (id) {
    // Al editar: reiniciamos los avisos para que se reevalúen con la nueva hora.
    datos.sent_1h = false;
    datos.sent_20m = false;
    datos.sent_now = false;
    ({ error } = await db.from("events").update(datos).eq("id", id));
  } else {
    // user_id lo pone la base de datos por defecto (auth.uid()).
    ({ error } = await db.from("events").insert(datos));
  }
  $("btn-guardar").disabled = false;

  if (error) return aviso("No se pudo guardar: " + error.message, "error");
  cerrarHojas();
  aviso("Guardado ✓", "ok");
  cargar();
}

async function borrar(ev) {
  if (!confirm(`¿Borrar "${ev.titulo}"?`)) return;
  const { error } = await db.from("events").delete().eq("id", ev.id);
  if (error) return aviso("No se pudo borrar: " + error.message, "error");
  aviso("Eliminado ✓", "ok");
  cargar();
}

// ───────── Limpieza de service worker ─────────
// Ya no usamos service worker (causaba cachés que congelaban versiones viejas).
// Desregistramos cualquiera que hubiera quedado y borramos sus cachés, para
// que la app cargue siempre la última versión desde la red.
function registrarServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {});
  }
  if (window.caches) {
    caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
  }
}

// ───────── Conectar la interfaz ─────────
$("form-auth").onsubmit = enviarAuth;
$("btn-toggle-auth").onclick = alternarModo;
$("btn-salir").onclick = salir;
$("btn-telegram").onclick = abrirTelegram;
$("btn-vincular").onclick = abrirTelegram;
$("btn-nuevo").onclick = () => abrirFormulario(null);
$("btn-cancelar").onclick = cerrarHojas;
$("btn-tg-cancelar").onclick = cerrarHojas;
$("overlay").onclick = cerrarHojas;
$("form-evento").onsubmit = guardarEvento;
$("campo-pendiente").onchange = aplicarModoPendiente;
$("form-telegram").onsubmit = guardarTelegram;

init();
