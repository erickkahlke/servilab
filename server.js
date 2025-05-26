// Importar las dependencias necesarias
const express = require("express");
const axios = require("axios");
const app = express();
const persist = require("node-persist");
require('dotenv').config();

// Middleware para parsear JSON
app.use(express.json({ limit: "10mb" }));

// Middleware para permitir solicitudes desde cualquier origen (CORS)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Methods", "PUT, POST, PATCH, DELETE, GET");
    return res.status(200).json({});
  }
  next();
});

// ── Inicializar node-persist (se guarda en .data/polls, que Glitch NO borra) ──
(async () => {
  await persist.init({ dir: ".data/polls" }); // podés cambiar el nombre si querés
  console.log("Almacenamiento persistente inicializado");
})();

// Función para normalizar el número de teléfono
const normalizarTelefono = (telefono) => {
  // 1. Eliminar caracteres no numéricos
  let soloNumeros = telefono.replace(/[^0-9]/g, "");

  // 2. Si empieza en 5490, remover los 4 primeros dígitos
  if (soloNumeros.startsWith("5490")) {
    soloNumeros = soloNumeros.substring(4);
  }
  // 3. Si empieza con 549, remover los 3 primeros dígitos
  else if (soloNumeros.startsWith("549")) {
    soloNumeros = soloNumeros.substring(3);
  }
  // 4. Si empieza con 54, remover los 2 primeros dígitos
  else if (soloNumeros.startsWith("54")) {
    soloNumeros = soloNumeros.substring(2);
  }

  let areaCode = "";
  let phoneNumber = "";

  // 5. Si tiene 12 dígitos, buscar la primera aparición del 15 y remover esos dígitos
  if (soloNumeros.length >= 12) {
    const indexOf15 = soloNumeros.indexOf("15");
    if (indexOf15 !== -1) {
      soloNumeros = soloNumeros.replace("15", ""); // Remover el '15'
    }
  }

  // 6. Si empieza con 11, definir areaCode con 11 y phoneNumber con los últimos 8 dígitos
  if (soloNumeros.startsWith("11")) {
    areaCode = "11";
    phoneNumber = soloNumeros.substring(2); // Obtener los últimos 8 dígitos
  } else {
    // Asumir que el resto del número es el código de área y el número local
    if (soloNumeros.length >= 2) {
      areaCode = soloNumeros.substring(0, 4); // Asumir que el código de área puede ser de hasta 4 dígitos
      phoneNumber = soloNumeros.substring(4); // El resto es el número local
    }
  }

  // Asegurarse de que el número local tenga 8 dígitos
  if (phoneNumber.length < 8) {
    // phoneNumber = phoneNumber.padEnd(8, '0'); // Completar con ceros si es muy corto
  } else if (phoneNumber.length > 8) {
    phoneNumber = phoneNumber.substring(0, 8); // Truncar si es muy largo
  }

  // Construir el número normalizado
  return `+549${areaCode}${phoneNumber}`;
};

// Función para enviar mensajes a la API de WhatsApp
const enviarMensajeWhatsApp = async (chatId, message) => {
  const body = {
    message,
    chatId,
    previewLink: false,
  };

  try {
    const response = await axios.post(
      `https://waapi.app/api/v1/instances/${process.env.WAAPI_INSTANCE_ID}/client/action/send-message`,
      body,
      {
        headers: {
          Authorization: `Bearer ${process.env.WAAPI_TOKEN}`,
          Host: "waapi.app",
          "Content-Type": "application/json",
        },
      }
    );
    return response.data;
  } catch (error) {
    throw new Error(
      "Error al enviar el mensaje: " +
        (error.response ? error.response.data : error.message)
    );
  }
};

const SHEETS_URL = process.env.SHEETS_URL;

// Funcion para analizar encuestas
async function analizarEncuesta(vote) {
  /*  vote obj que viste en consola:
      {
        voter: "549113…@c.us",
        selectedOptions:[{ name:"Excelente ⭐️", localId:0 }],
        parentMessage:{ id:{ id:"3EB0…50", … } }
      }
  */
  const voter = vote.voter; // JID del cliente
  const opcion = vote.selectedOptions?.[0]?.name || "—";
  const messageId = vote.parentMessage?.id?.id; // el ID real del poll
  const llaveDone = `done:${messageId}:${voter}`; // p/ idempotencia

  // ── Evitar duplicados ───────────────────────────────────────────
  if (await persist.getItem(llaveDone)) return;

  // ── Buscar la encuesta pendiente ────────────────────────────────
  const poll = await persist.getItem(`poll:${messageId}`);
  if (!poll) {
    console.warn("Voto huérfano: la encuesta no estaba pendiente", messageId);
    await persist.setItem(llaveDone, true);
    return;
  }

  // ── Grabar la fila en Google Sheets ─────────────────────────────
  try {
    await axios.post(
      SHEETS_URL,
      {
        nombre: poll.nombre,
        apellido: poll.apellido,
        lavado: poll.lavado,
        fecha: poll.fecha,
        hora: poll.hora,
        calificacion: opcion,
      },
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("⚠️  Error subiendo a Sheets, se reintentará:", err.message);
    return; // no borro el pending: volverá a intentar
  }

  // ── Limpieza e idempotencia ─────────────────────────────────────
  await persist.removeItem(`poll:${messageId}`);
  await persist.setItem(llaveDone, true);

  // ── Agradecimiento al cliente ───────────────────────────────────
  enviarMensajeWhatsApp(
    voter,
    "¡Gracias por tu opinión! Nos ayuda a mejorar 🙌"
  );

  console.log(`Voto procesado (${opcion}) para ID ${messageId}`);
}

// Endpoint para notificación de turno confirmado
app.post("/notificacion/turno-confirmado", async (req, res) => {
  const {
    telefono,
    customer_first_name,
    appointment_start_date,
    appointment_start_time,
  } = req.body;

  if (
    !telefono ||
    !customer_first_name ||
    !appointment_start_date ||
    !appointment_start_time
  ) {
    return res
      .status(400)
      .json({ success: false, message: "Faltan datos requeridos" });
  }

  try {
    const telefonoNormalizado = normalizarTelefono(telefono);
    const chatId = `${telefonoNormalizado.replace("+", "")}@c.us`;

    const message = `¡Hola ${customer_first_name}!\nTu turno está confirmado ✅\nTe esperamos el 🗓️${appointment_start_date} a las ${appointment_start_time} en ServiLab 🚗\n\n🤖 Mensaje automático. No requiere respuesta.`;

    await enviarMensajeWhatsApp(chatId, message);
    console.log("Mensaje de turno confirmado enviado a " + telefonoNormalizado);
    res
      .status(200)
      .json({ success: true, message: "Mensaje enviado exitosamente" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/notificacion/seguro-lluvia", async (req, res) => {
  const { telefono, customer_first_name, cupon, fechaValidoHasta } = req.body;

  // Validación de campos requeridos (se corrigió para utilizar cupon y fechaValidoHasta)
  if (!telefono || !customer_first_name || !cupon || !fechaValidoHasta) {
    return res
      .status(400)
      .json({ success: false, message: "Faltan datos requeridos" });
  }

  try {
    const telefonoNormalizado = normalizarTelefono(telefono);
    const chatId = `${telefonoNormalizado.replace("+", "")}@c.us`;

    const message =
      `Tu seguro de lluvia está ACTIVADO ☂️ ✅\n\n` +
      `La protección incluida en tu SuperLavado te permite volver a lavar tu vehículo sin cargo dentro los próximos 3 días 🙌\n` +
      `Reserva turno en nuestra web e ingresa este código en el paso del pago: *${cupon}*\n` +
      `http://turnos.servilab.ar\n\n` +
      `🗓️(Recordá que no es transferible y tiene validez hasta el ${fechaValidoHasta})`;

    await enviarMensajeWhatsApp(chatId, message);
    console.log("Mensaje de seguro de lluvia enviado a " + telefonoNormalizado);
    res
      .status(200)
      .json({ success: true, message: "Mensaje enviado exitosamente" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/notificacion/pin-llaves", async (req, res) => {
  const { telefono, customer_first_name, codigo } = req.body;

  // Validación de campos requeridos
  if (!telefono || !customer_first_name || !codigo) {
    return res
      .status(400)
      .json({ success: false, message: "Faltan datos requeridos" });
  }

  try {
    const telefonoNormalizado = normalizarTelefono(telefono);
    const chatId = `${telefonoNormalizado.replace("+", "")}@c.us`;

    const message =
      `🔑 Retirá las llaves de tu vehículo\n\n` +
      `Están disponibles las 24hs y de forma 100% segura en nuestro autodispenser. Obtenelas ingresando tu pin: *${codigo}*\n\n` +
      `Si necesitas ayuda ingresá a este link: servilab.ar/llaves)`;

    await enviarMensajeWhatsApp(chatId, message);
    console.log("Mensaje de codigo de llaves enviado a " + telefonoNormalizado);
    res
      .status(200)
      .json({ success: true, message: "Mensaje enviado exitosamente" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Endpoint para notificación de recordatorio
app.post("/notificacion/recordatorio", async (req, res) => {
  const {
    telefono,
    customer_first_name,
    appointment_start_date,
    appointment_start_time,
  } = req.body;

  if (!telefono || !customer_first_name) {
    return res
      .status(400)
      .json({ success: false, message: "Faltan datos requeridos" });
  }

  try {
    const telefonoNormalizado = normalizarTelefono(telefono);
    const chatId = `${telefonoNormalizado.replace("+", "")}@c.us`;

    const message = `¡Hola ${customer_first_name}! \n⏰ Tu turno comienza las ${appointment_start_time}. Te esperamos en ServiLab 🚗 \n\n🤖 Mensaje automático. No requiere respuesta.`;

    await enviarMensajeWhatsApp(chatId, message);
    console.log("Mensaje de recordatorio enviado a " + telefonoNormalizado);
    res
      .status(200)
      .json({
        success: true,
        message: "Mensaje de recordatorio enviado exitosamente",
      });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Endpoint para notificación de aviso de lavado completado
app.post("/notificacion/lavado-completado", async (req, res) => {
  const { telefono, customer_first_name } = req.body;

  if (!telefono || !customer_first_name) {
    return res
      .status(400)
      .json({ success: false, message: "Faltan datos requeridos" });
  }

  try {
    const telefonoNormalizado = normalizarTelefono(telefono);
    const chatId = `${telefonoNormalizado.replace("+", "")}@c.us`;

    const message = `${customer_first_name}, tu vehículo está listo 🚗✨\nTe recordamos que estamos abiertos de 10 a 13.30hs y de 16 a 20.30hs\n\n🤖 Mensaje automático. No requiere respuesta.`;

    await enviarMensajeWhatsApp(chatId, message);
    console.log(
      "Mensaje de lavado finalizado enviado a " + telefonoNormalizado
    );
    res
      .status(200)
      .json({
        success: true,
        message:
          "Mensaje de lavado completado enviado exitosamente al" + chatId,
      });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Endpoint para enviar la encuesta post-lavado
app.post("/enviar-encuesta", async (req, res) => {
  const {
    telefono,
    nombre,
    apellido,
    lavado,
    appointment_start_date,
    appointment_start_time,
  } = req.body;

  // ── Validación mínima ───────────────────────────────────────────
  if (
    !telefono ||
    !nombre ||
    !lavado ||
    !appointment_start_date ||
    !appointment_start_time
  ) {
    return res
      .status(400)
      .json({ success: false, message: "Faltan datos requeridos" });
  }

  try {
    // 1) chatId normalizado
    const telNorm = normalizarTelefono(telefono);
    const chatId = `${telNorm.replace("+", "")}@c.us`;

    // 2) Definir la encuesta
    const pollBody = {
      chatId,
      caption: "¿Cómo calificarías tu lavado en ServiLab? 🧽",
      options: ["Excelente ⭐️", "Buena 👍", "Regular 😕", "Mala 👎"],
      multipleAnswers: false,
    };

    console.log("→ Enviando create-poll a WaAPI", pollBody); // LOG 1

    // 3) Llamada a WaAPI
    const resp = await axios.post(
      `https://waapi.app/api/v1/instances/${process.env.WAAPI_INSTANCE_ID}/client/action/create-poll`,
      pollBody,
      {
        headers: {
          Authorization: `Bearer ${process.env.WAAPI_TOKEN}`,
          Host: "waapi.app",
          "Content-Type": "application/json",
        },
      }
    );

    if (resp.data?.status !== "success") {
      throw new Error("WaAPI devolvió un estado distinto de success");
    }

    // 4) Extraer messageId (tres variantes)
    let messageId =
      resp.data?.data?.data?.id?.id || // ← estructura actual
      resp.data?.data?.id?.id || // backup: estructura anterior
      (resp.data?.data?.data?.id?._serialized // backup: usando _serialized
        ? resp.data.data.data.id._serialized.split("_")[2]
        : null);

    if (!messageId) throw new Error("No se encontró messageId; revisá el log");

    // 5) Guardar pendiente
    await persist.setItem(`poll:${messageId}`, {
      nombre,
      apellido,
      lavado,
      fecha: appointment_start_date,
      hora: appointment_start_time,
      createdAt: Date.now(),
    });

    console.log(
      // LOG 3
      `Encuesta enviada a ${nombre} ${apellido || ""} (${telNorm}) | ` +
        `turno ${appointment_start_date} ${appointment_start_time} | ID: ${messageId}`
    );

    res.status(200).json({ success: true, messageId });
  } catch (err) {
    console.error("Error al enviar encuesta:", err); // LOG 4
    res.status(500).json({ success: false, message: err.message });
  }
});

// Webhook global de WaAPI
app.post(
  '/webhook/waapi',
  express.json({ limit: '10mb' }),      // evita PayloadTooLargeError
  async (req, res) => {
    const { event, data } = req.body;

    try {
      if (event === 'vote_update' && data?.vote) {
        await analizarEncuesta(data.vote);
      }
      // otros eventos por ahora se ignoran
      res.json({ ok: true });
    } catch (err) {
      console.error('Error en webhook WaAPI:', err);
      res.status(200).json({ ok: false });   // igual devolvemos 200
    }
  }
);

// SOLO PARA DEBUG: lista todas las encuestas pendientes
app.get("/debug/pendientes", async (req, res) => {
  const keys = await persist.keys(); // ej. ['poll:ABC123', 'poll:DEF456']
  const pendientes = [];

  for (const k of keys) {
    if (k.startsWith("poll:")) {
      pendientes.push({ key: k, data: await persist.getItem(k) });
    }
  }

  res.json(pendientes);
});

// Puerto en el que corre el servidor
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor corriendo en el puerto ${port}`);
});
