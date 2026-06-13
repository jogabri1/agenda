// Crea el cliente de Supabase para los scripts del servidor.
// Aquí usamos la clave "service_role" (secreta): salta la RLS y permite
// leer todos los eventos y actualizar las marcas de avisos enviados.

const { createClient } = require("@supabase/supabase-js");

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Faltan SUPABASE_URL y la clave (SUPABASE_SERVICE_KEY) en las variables de entorno.");
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

module.exports = { getClient };
