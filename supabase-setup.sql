-- ─────────────────────────────────────────────────────────────
--  SQL de configuración de la base de datos (Supabase) — MULTI-USUARIO
--  Cómo usarlo: Supabase → SQL Editor → New query → pega esto → Run
--
--  Cada persona tiene su cuenta (login) y solo ve/edita SU agenda.
--  Las reglas RLS lo garantizan a nivel de base de datos.
-- ─────────────────────────────────────────────────────────────

-- ───────── Perfiles (una fila por usuario) ─────────
-- Guarda el nombre y el chat_id de Telegram de cada persona.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text,
  chat_id     text,                              -- Telegram de esa persona
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "perfil_select_propio" on public.profiles;
create policy "perfil_select_propio" on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists "perfil_update_propio" on public.profiles;
create policy "perfil_update_propio" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "perfil_insert_propio" on public.profiles;
create policy "perfil_insert_propio" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

-- Cuando alguien crea su cuenta, se le crea su perfil automáticamente.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nombre)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────── Eventos (cada evento pertenece a un usuario) ─────────
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titulo      text not null,
  fecha       date not null,
  hora        time not null,
  notas       text,
  categoria   text default 'reunión',
  sent_3h     boolean not null default false,   -- aviso "3 h antes" enviado
  sent_1h     boolean not null default false,   -- aviso "1 h antes" enviado
  sent_now    boolean not null default false,   -- aviso "a la hora" enviado
  created_at  timestamptz not null default now()
);

create index if not exists events_user_fecha_idx on public.events (user_id, fecha);

alter table public.events enable row level security;

-- Cada persona solo puede ver/crear/editar/borrar SUS eventos.
drop policy if exists "eventos_propios" on public.events;
create policy "eventos_propios" on public.events
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- NOTA: los scripts de avisos (GitHub Actions) usan la clave "service_role",
-- que salta la RLS, así que pueden leer los eventos de TODOS los usuarios y
-- enviar a cada uno a su propio chat_id (guardado en su perfil).
