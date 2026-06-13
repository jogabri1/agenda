# 📅 Agenda — app para iPhone + avisos por Telegram (multi-usuario)

Sistema para que **varias personas** (tu esposa, tú, tu mamá…) lleven su agenda
(reuniones, tareas de los hijos, etc.) desde una **app instalada en el iPhone**, cada una
con **su cuenta privada**, y reciban por **Telegram**:

- ☀️ Un **resumen cada mañana** con sus eventos de hoy y de los próximos días.
- ⏰ Un **aviso 5 h, 3 h y 1 h antes** de cada evento.

Cada persona **solo ve su propia agenda** (lo garantiza la base de datos) y recibe **sus
avisos en su propio Telegram**. Todo es **gratis** y funciona **en la nube** (no necesitas
tener tu PC encendido).

---

## 🧠 Cómo funciona (en una frase)

Cada persona inicia sesión en la **app** (PWA) y guarda sus eventos en una base de datos
gratuita (**Supabase**). Un robot en la nube (**GitHub Actions**) revisa esa base cada 15
minutos y, cuando toca, envía el mensaje al **Telegram** de cada quien.

```
 iPhone (app + login) → Supabase (BD por usuario) → GitHub Actions (robot) → Telegram (a cada persona)
```

---

## ✅ Lo que vas a necesitar (todo gratis)

1. Una cuenta de **Telegram** (un solo bot para toda la familia).
2. Una cuenta en **Supabase** → https://supabase.com
3. Una cuenta en **GitHub** → https://github.com
4. **Git** o **GitHub Desktop** para subir el proyecto (ver Fase D).

> Sigue las fases **en orden**. Dime por dónde vas y te acompaño con los clics exactos.

---

## 🔹 FASE A — Crear el bot de Telegram (uno para toda la familia)

1. En Telegram, busca **@BotFather** y pulsa **Start**.
2. Escribe `/newbot` y sigue las instrucciones (un nombre y un usuario que termine en `bot`,
   por ejemplo `agenda_familia_bot`).
3. Al terminar te dará un **token** parecido a `123456789:AAH...`. **Guárdalo.**

> 🔒 El token es secreto: lo pondrás tú directamente en GitHub (Fase E). No hace falta que me
> lo pegues aquí. El **chat_id ya no se configura aquí**: cada persona vinculará su propio
> Telegram desde la app (Fase F).

---

## 🔹 FASE B — Base de datos (Supabase)

1. Entra en https://supabase.com → **Sign in**.
2. **New project**: nombre (ej. `agenda`), contraseña de BD (guárdala), región cercana.
   Espera ~2 min.
3. Menú lateral → **SQL Editor** → **New query**. Abre [`supabase-setup.sql`](supabase-setup.sql),
   **copia todo**, pégalo y pulsa **Run**. Debe decir *Success*.
4. **Activar el login por email** (viene activado por defecto). Para que crear cuenta sea
   instantáneo y sin fricción, te recomiendo **desactivar la confirmación por correo**:
   - **Authentication** → **Providers** (o *Sign In / Providers*) → **Email** →
     desactiva **"Confirm email"** → **Save**.
   - (Si prefieres dejarlo activado es más seguro, pero cada persona tendrá que pulsar un
     enlace que le llega por email la primera vez.)
5. Menú lateral → **Project Settings** (engranaje) → **API**. Copia y guarda:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** → `SUPABASE_ANON_KEY`  (pública, va en la web)
   - **service_role** (pulsa *Reveal*) → `SUPABASE_SERVICE_KEY`  ⚠️ **secreta**, solo para GitHub.

---

## 🔹 FASE C — Configurar la web

1. Abre [`web/config.js`](web/config.js).
2. Pega tu **URL** y tu **anon** (la pública):
   ```js
   window.AGENDA_CONFIG = {
     SUPABASE_URL: "https://abcdxyz.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGci..."   // la clave ANON (NO la service_role)
   };
   ```
3. Guarda el archivo.

---

## 🔹 FASE D — Subir el proyecto a GitHub y publicar la web

Necesitas Git. **Elige la opción más cómoda:**

**Opción 1 — GitHub Desktop (recomendada):**
1. https://desktop.github.com → inicia sesión.
2. **File → Add local repository** → carpeta `D:\proyectos\agenda`.
3. Te ofrecerá crear el repo: nombre (ej. `agenda`), **Public** (necesario para Pages gratis)
   → **Publish repository**.

**Opción 2 — Git por terminal:**
```powershell
cd D:\proyectos\agenda
git init
git add .
git commit -m "Agenda inicial"
git remote add origin https://github.com/TU_USUARIO/agenda.git
git branch -M main
git push -u origin main
```

**Activar la web (GitHub Pages):**
1. Repo → **Settings** → **Pages**.
2. *Source*: **Deploy from a branch** → *Branch*: **main** / carpeta **/ (root)** → **Save**.
3. Tu app quedará en `https://TU_USUARIO.github.io/agenda/web/`. Espera 1-2 min y ábrela en el
   PC para comprobar que carga (verás la pantalla de **login**).

---

## 🔹 FASE E — Configurar el robot de avisos

Repo → **Settings** → **Secrets and variables** → **Actions**.

**Pestaña *Secrets* → New repository secret** (estos **tres**):
| Nombre | Valor |
|---|---|
| `SUPABASE_URL` | tu Project URL |
| `SUPABASE_SERVICE_KEY` | tu clave **service_role** |
| `TELEGRAM_BOT_TOKEN` | el token de BotFather |

**Pestaña *Variables* → New repository variable** (estas **dos**):
| Nombre | Valor |
|---|---|
| `TIMEZONE` | `America/Lima` (o tu zona UTC-5: `America/Bogota`, `America/Guayaquil`) |
| `NEXT_DAYS` | `3` |

> El resumen está fijado a las **07:00 (UTC-5)** en
> [`.github/workflows/morning.yml`](.github/workflows/morning.yml). Para cambiar la hora,
> ajusta el `cron` (está en UTC: 07:00 local = 12:00 UTC).

---

## 🔹 FASE F — Cada persona: instalar la app, crear cuenta y vincular Telegram

**Esto lo hace CADA persona en su propio iPhone:**

1. **Instalar la app:** abrir la URL **en Safari** → botón **Compartir** → **Añadir a
   pantalla de inicio** → **Añadir**. Aparece el icono 📅 *Agenda*.
2. **Crear su cuenta:** abrir la app → **Crear cuenta** → poner su nombre, su email y una
   contraseña → **Crear cuenta**. (Si dejaste activada la confirmación por email, que revise
   su correo y pulse el enlace antes de entrar.)
3. **Vincular su Telegram** (para recibir avisos):
   - En Telegram, abrir **el bot de la familia** (el de la Fase A) y pulsar **Start**.
   - Abrir **@userinfobot** en Telegram: responde con su número (*Id*).
   - En la app → **🔔 Mi Telegram** → pegar ese número → **Guardar**.

¡Listo! Esa persona ya verá su agenda y recibirá sus avisos.

---

## 🔹 FASE G — Probar que todo funciona

1. **Cuenta + app:** inicia sesión y crea un evento para dentro de ~1 hora. Compruébalo en
   Supabase → Table Editor → `events`.
2. **Aviso:** GitHub → **Actions** → **Recordatorios** → **Run workflow**. Debe llegarte el
   mensaje a Telegram **una sola vez** (si ya vinculaste tu Telegram).
3. **Resumen:** **Actions** → **Resumen de la mañana** → **Run workflow**.
4. **Privacidad:** crea una segunda cuenta de prueba y verifica que **no ve** los eventos de
   la primera.

---

## 📲 Uso diario

- **Entrar:** abre la app (normalmente ya estarás con la sesión iniciada).
- **Añadir:** **+ Nuevo** → evento, día, hora y notas → **Guardar**.
- **Editar / borrar:** iconos ✏️ y 🗑️ de cada evento.
- Los avisos llegan **solos** por Telegram.

---

## 🔧 Mantenimiento (cosas que quizá quieras cambiar)

- **Color de la app:** `--acento` en [`web/style.css`](web/style.css) y `theme_color` en
  [`web/manifest.json`](web/manifest.json).
- **Horas de los avisos (5/3/1 h):** array `FRANJAS` en
  [`scripts/send-reminders.js`](scripts/send-reminders.js).
- **Cada cuánto revisa:** `cron` en [`.github/workflows/reminders.yml`](.github/workflows/reminders.yml).
- **Hora del resumen:** `cron` en [`.github/workflows/morning.yml`](.github/workflows/morning.yml).
- **Días "próximos":** variable `NEXT_DAYS` en GitHub.

Tras cambiar algo en tu PC, vuelve a subirlo (GitHub Desktop: *Commit* → *Push*).

---

## 🆘 Problemas comunes

- **No me llega ningún aviso:** ¿vinculaste tu Telegram en la app (🔔 Mi Telegram)? ¿Pulsaste
  **Start** en el bot? ¿Están bien `TELEGRAM_BOT_TOKEN`, `SUPABASE_URL` y `SUPABASE_SERVICE_KEY`
  en *Secrets*?
- **No me deja entrar / "Email not confirmed":** o confirmas el email (revisa el correo) o
  desactivas la confirmación en Supabase (Fase B, paso 4).
- **La app dice "Falta configurar la conexión":** revisa `web/config.js` (URL y anon).
- **El aviso llega a una hora rara:** revisa la variable `TIMEZONE`.
- **Los avisos dejaron de ejecutarse solos:** GitHub pausa los workflows programados si el
  repo lleva 60 días sin actividad. Entra en **Actions** y pulsa **Enable workflow**.
- **Ver qué pasó:** GitHub → **Actions** → abre la última ejecución → mira el *log*.

---

## 🔒 Seguridad y privacidad

Cada persona entra con su **email y contraseña**, y las reglas de la base de datos (RLS)
garantizan que **solo puede ver y editar su propia agenda**. La clave `anon` de la web es
pública por diseño: la seguridad la dan el login y la RLS, no el ocultarla. La clave
`service_role` y el token del bot son **secretos** y viven solo en los *Secrets* de GitHub.
