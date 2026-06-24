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
let pendientesAbiertos = false; // la sección de pendientes arranca plegada (no estorba)
let repitenAbiertos = false;    // la sección de eventos que se repiten, también plegada
let historialAbierto = false;   // la sección de Historial (eventos pasados), también plegada

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
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  let txt = fmtDiaLargo.format(fechaLocal(yyyymmdd));
  txt = txt.charAt(0).toUpperCase() + txt.slice(1);
  if (yyyymmdd === isoHoy()) return { txt: "Hoy · " + txt, hoy: true };
  if (yyyymmdd === isoDe(manana)) return { txt: "Mañana · " + txt, hoy: false };
  if (yyyymmdd === isoDe(ayer)) return { txt: "Ayer · " + txt, hoy: false };
  return { txt, hoy: false };
}
function escapar(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// Cuántos días hacia atrás se conservan en el "Historial" (eventos ya pasados).
const HISTORIAL_DIAS = 30;
// Fecha ISO de hace N días (para el límite del historial).
function isoHaceDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDe(d);
}

// ───────── Recurrencia (por días de la semana) ─────────
const INI_DIA = { 1: "L", 2: "M", 3: "X", 4: "J", 5: "V", 6: "S", 7: "D" };

// Texto corto de la regla para mostrar: "todos los días", "L a V" o "L·X·V".
function textoRepeticion(repetirDias) {
  const dias = (repetirDias || "").split(",").map(Number).filter(Boolean).sort((a, b) => a - b);
  if (dias.length === 7) return "todos los días";
  if (dias.length === 5 && dias.every((d, i) => d === i + 1)) return "L a V";
  return dias.map((d) => INI_DIA[d]).join("·");
}

// Lee/escribe los botones de día del formulario ("1,3,5").
function getDias() {
  return [...document.querySelectorAll("#dias-semana .dia.on")].map((b) => b.dataset.dia).join(",");
}
function setDias(repetirDias) {
  const sel = new Set((repetirDias || "").split(",").filter(Boolean));
  for (const b of document.querySelectorAll("#dias-semana .dia")) {
    b.classList.toggle("on", sel.has(b.dataset.dia));
  }
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
  // Traemos los eventos del último mes en adelante (para el Historial), los pendientes
  // (sin fecha) y TODOS los recurrentes (su día de inicio puede ser anterior, pero
  // siguen activos). Lo pasado y lo futuro se separan luego en pintar().
  const { data, error } = await db
    .from("events")
    .select("*")
    .or(`fecha.gte.${isoHaceDias(HISTORIAL_DIAS)},pendiente.is.true,repetir_dias.not.is.null`)
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

  const hoy = isoHoy();
  const pendientes = eventos.filter((ev) => ev.pendiente);
  const recurrentes = eventos.filter((ev) => !ev.pendiente && ev.repetir_dias);
  const unicos = eventos.filter((ev) => !ev.pendiente && !ev.repetir_dias);

  // Eventos únicos de hoy en adelante → agenda por días (orden ascendente).
  const futuros = unicos
    .filter((ev) => ev.fecha >= hoy)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || horaCorta(a.hora).localeCompare(horaCorta(b.hora)));
  // Eventos únicos ya pasados → Historial (orden descendente, lo más reciente primero).
  const historial = unicos
    .filter((ev) => ev.fecha < hoy)
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || horaCorta(b.hora).localeCompare(horaCorta(a.hora)));

  if (pendientes.length === 0 && recurrentes.length === 0 && futuros.length === 0 && historial.length === 0) {
    lista.innerHTML = '<p class="vacio">No hay nada en tu agenda todavía.<br>Pulsa “+ Nuevo” para empezar.</p>';
    return;
  }

  // Secciones plegables de arriba: pendientes sin fecha y eventos que se repiten.
  if (pendientes.length > 0) {
    seccionPlegable("📌 Pendientes", pendientes, () => pendientesAbiertos, (v) => (pendientesAbiertos = v), tarjeta);
  }
  if (recurrentes.length > 0) {
    seccionPlegable("🔁 Se repiten", recurrentes, () => repitenAbiertos, (v) => (repitenAbiertos = v), tarjetaRecurrente);
  }

  // Agenda por días (eventos únicos de hoy en adelante).
  agruparPorDia(lista, futuros);

  // Historial (eventos ya pasados del último mes), plegable, al final del todo.
  if (historial.length > 0) seccionHistorial(historial);
}

// Pinta una lista de eventos con fecha, agrupados por día (encabezado + tarjetas).
function agruparPorDia(contenedor, eventos) {
  let fechaActual = null;
  for (const ev of eventos) {
    if (ev.fecha !== fechaActual) {
      fechaActual = ev.fecha;
      const { txt, hoy } = etiquetaFecha(ev.fecha);
      const h = document.createElement("div");
      h.className = "grupo-fecha" + (hoy ? " hoy" : "");
      h.textContent = txt;
      contenedor.appendChild(h);
    }
    contenedor.appendChild(tarjeta(ev));
  }
}

// Sección "🕘 Historial": eventos ya pasados, plegable (cerrada por defecto) y
// agrupados por día con su tarjeta completa (para releer las notas y reagendar).
function seccionHistorial(items) {
  const lista = $("lista");
  const h = document.createElement("button");
  h.type = "button";
  h.className = "grupo-fecha historial toggle-pendientes";
  h.innerHTML = `<span>🕘 Historial (${items.length})</span><span class="flecha">${historialAbierto ? "▾" : "▸"}</span>`;
  lista.appendChild(h);

  const cont = document.createElement("div");
  cont.hidden = !historialAbierto;
  agruparPorDia(cont, items);
  lista.appendChild(cont);

  h.onclick = () => {
    historialAbierto = !historialAbierto;
    cont.hidden = !historialAbierto;
    h.querySelector(".flecha").textContent = historialAbierto ? "▾" : "▸";
  };
}

// Crea una sección plegable: cabecera con contador + lista compacta que se abre/cierra.
function seccionPlegable(titulo, items, getAbierto, setAbierto, render) {
  const lista = $("lista");
  const h = document.createElement("button");
  h.type = "button";
  h.className = "grupo-fecha pendientes toggle-pendientes";
  h.innerHTML = `<span>${titulo} (${items.length})</span><span class="flecha">${getAbierto() ? "▾" : "▸"}</span>`;
  lista.appendChild(h);

  const cont = document.createElement("div");
  cont.className = "pendientes-cont";
  cont.hidden = !getAbierto();
  for (const ev of items) cont.appendChild(render(ev));
  lista.appendChild(cont);

  h.onclick = () => {
    const nuevo = !getAbierto();
    setAbierto(nuevo);
    cont.hidden = !nuevo;
    h.querySelector(".flecha").textContent = nuevo ? "▾" : "▸";
  };
}

// Tarjeta compacta (una línea) para un pendiente: 📌 título + acciones.
function tarjetaPendiente(ev) {
  const card = document.createElement("div");
  card.className = "pendiente-item";
  card.innerHTML = `
    <span class="pin">📌</span>
    <span class="texto">${escapar(ev.titulo)}</span>
    <span class="acciones-pend">
      <button class="icono-btn" data-accion="editar" title="Editar">✏️</button>
      <button class="icono-btn" data-accion="borrar" title="Borrar">🗑️</button>
    </span>`;
  card.querySelector('[data-accion="editar"]').onclick = () => abrirFormulario(ev);
  card.querySelector('[data-accion="borrar"]').onclick = () => borrar(ev);
  return card;
}

// Tarjeta compacta (una línea) para una serie recurrente: 🔁 título + días·hora.
function tarjetaRecurrente(ev) {
  const card = document.createElement("div");
  card.className = "pendiente-item";
  const meta = `${textoRepeticion(ev.repetir_dias)} · ${horaCorta(ev.hora)}`;
  card.innerHTML = `
    <span class="pin">🔁</span>
    <span class="texto"><b>${escapar(ev.titulo)}</b> <span class="r-meta">${meta}</span></span>
    <span class="acciones-pend">
      <button class="icono-btn" data-accion="editar" title="Editar">✏️</button>
      <button class="icono-btn" data-accion="borrar" title="Borrar">🗑️</button>
    </span>`;
  card.querySelector('[data-accion="editar"]').onclick = () => abrirFormulario(ev);
  card.querySelector('[data-accion="borrar"]').onclick = () => borrar(ev);
  return card;
}

function tarjeta(ev) {
  if (ev.pendiente) return tarjetaPendiente(ev);
  const card = document.createElement("div");
  card.className = "evento";
  const notasHtml = ev.notas ? `<div class="notas">${escapar(ev.notas)}</div>` : "";
  const badge = ev.categoria ? `<span class="badge">${escapar(ev.categoria)}</span>` : "";
  const badgeRep = ev.repetir_dias ? `<span class="badge badge-rep">🔁 ${textoRepeticion(ev.repetir_dias)}</span>` : "";
  const horaTxt = ev.pendiente ? "📌" : horaCorta(ev.hora);
  card.innerHTML = `
    <div class="hora${ev.pendiente ? " pend" : ""}">${horaTxt}</div>
    <div class="cuerpo">
      <div class="titulo">${escapar(ev.titulo)}</div>
      ${notasHtml}
      <div>${badge}${badgeRep}</div>
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
    // En un recurrente mostramos la fecha-ancla (inicio de la serie), no el día visto.
    $("campo-fecha").value = ev._ancla || ev.fecha || "";
    $("campo-hora").value = horaCorta(ev.hora);
    $("campo-categoria").value = ev.categoria || "reunión";
    $("campo-notas").value = ev.notas || "";
    $("campo-pendiente").checked = !!ev.pendiente;
    $("campo-repite").checked = !!ev.repetir_dias;
    setDias(ev.repetir_dias);
    $("campo-repetir-hasta").value = ev.repetir_hasta || "";
  } else {
    $("campo-fecha").value = isoHoy();
    $("campo-pendiente").checked = false;
    $("campo-repite").checked = false;
    setDias("");
  }
  aplicarModoPendiente(); // apaga/enciende los campos según los interruptores
  $("sheet").hidden = false;
  $("overlay").hidden = false;
}

// Cuando el evento es "pendiente": solo queda el nombre. Apagamos día, hora,
// tipo y notas (y les quitamos el `required` para que el formulario sí envíe).
// Un pendiente no tiene fecha, así que tampoco puede repetirse.
function aplicarModoPendiente() {
  const p = $("campo-pendiente").checked;
  for (const cid of ["campo-fecha", "campo-hora", "campo-categoria", "campo-notas"]) {
    $(cid).disabled = p;
  }
  $("campo-fecha").required = !p;
  $("campo-hora").required = !p;
  $("repetir-toggle").hidden = p;
  if (p) $("campo-repite").checked = false;
  aplicarModoRepite();
}

// Muestra los días/"hasta" si el evento se repite y, en ese caso, oculta el campo
// "Día": una serie no tiene una fecha concreta, arranca desde hoy en los días marcados.
function aplicarModoRepite() {
  const r = $("campo-repite").checked;
  const p = $("campo-pendiente").checked;
  $("repetir-campos").hidden = !r;
  $("campo-fecha-wrap").hidden = r;
  $("campo-fecha").required = !p && !r; // no se pide fecha si es pendiente o si se repite
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
  const seRepite = !esPendiente && $("campo-repite").checked;

  // Regla de repetición: NULL si no se repite; si no, los días de la semana
  // marcados ("1,3,5") y una fecha de fin opcional ("hasta").
  const repetirDias = seRepite ? getDias() : null;
  const repetirHasta = seRepite && $("campo-repetir-hasta").value ? $("campo-repetir-hasta").value : null;

  // Si activó "se repite" pero no marcó ningún día, no se puede crear la serie.
  if (seRepite && !repetirDias) {
    alert("Elige al menos un día de la semana para que el evento se repita.");
    return;
  }

  // Un "pendiente" solo lleva título (sin fecha, hora, tipo, notas ni repetición).
  const datos = esPendiente
    ? { titulo: $("campo-titulo").value.trim(), pendiente: true, fecha: null, hora: null, categoria: null, notas: null, repetir_dias: null, repetir_hasta: null }
    : {
        titulo: $("campo-titulo").value.trim(),
        pendiente: false,
        // Un recurrente no tiene fecha concreta: la serie arranca HOY y se repite
        // en los días marcados. Un evento normal sí usa el día elegido.
        fecha: seRepite ? isoHoy() : $("campo-fecha").value,
        hora: $("campo-hora").value,
        categoria: $("campo-categoria").value,
        notas: $("campo-notas").value.trim() || null,
        repetir_dias: repetirDias,
        repetir_hasta: repetirHasta,
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
  // Como un recurrente es una sola fila, borrarlo elimina TODA la serie: lo avisamos.
  const msg = ev.repetir_dias
    ? `¿Borrar "${ev.titulo}"?\nSe eliminarán TODAS sus repeticiones (toda la serie).`
    : `¿Borrar "${ev.titulo}"?`;
  if (!confirm(msg)) return;
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
$("campo-repite").onchange = aplicarModoRepite;
$("form-telegram").onsubmit = guardarTelegram;

// Botones de día de la semana: alternan seleccionado/no seleccionado al pulsar.
for (const b of document.querySelectorAll("#dias-semana .dia")) {
  b.onclick = () => b.classList.toggle("on");
}

init();
