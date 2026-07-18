// Importar las dependencias necesarias
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const app = express();
const persist = require("node-persist");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const prodEnvPath = "/var/www/html/servilab/.env";
const envPath = fs.existsSync(prodEnvPath) ? prodEnvPath : path.resolve(__dirname, ".env");
require('dotenv').config({ path: envPath });

// Importar Swagger
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./src/swagger');

// Importar middlewares de seguridad
const validateApiKeyMiddleware = require('./src/middleware/apiKey');
const { generalLimiter, authLimiter } = require('./src/middleware/rateLimiter');
const { PUBLIC_ENDPOINTS, WEBHOOK_ENDPOINTS } = require('./src/config/keys');

// Importar el generador de API keys
const { generateApiKey, validateApiKey, getKeyType, registerApiKey, listApiKeys, deleteApiKey, isMasterKey } = require('./src/utils/apiKeyGenerator');

// Test de despliegue automático
console.log('Servidor iniciado - Versión con despliegue automático');

// Configuración de logging
const logger = {
  info: (message, ...args) => console.log(`[INFO] ${message}`, ...args),
  error: (message, ...args) => console.error(`[ERROR] ${message}`, ...args),
  warn: (message, ...args) => console.warn(`[WARN] ${message}`, ...args)
};

// Función helper para generar ID único de request
const generarRequestId = () => {
  return `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

// Función helper para obtener información del request
const obtenerInfoRequest = (req) => {
  return {
    ip: req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
    method: req.method,
    path: req.path,
    headers: {
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-real-ip': req.headers['x-real-ip'],
      'referer': req.headers['referer'],
      'origin': req.headers['origin']
    }
  };
};

// Función helper para formatear logs de mensajes enviados
const logMensajeEnviado = (tipo, destinatario, nombre = null, telefonoNormalizado = null) => {
  const timestamp = new Date().toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  let logMessage = `[${timestamp}] ${tipo} enviado`;

  if (nombre) {
    logMessage += ` a ${nombre}`;
  }

  if (telefonoNormalizado) {
    logMessage += ` (${telefonoNormalizado})`;
  } else if (destinatario) {
    logMessage += ` (${destinatario})`;
  }

  console.log(logMessage);
};

// Función helper para formatear logs de errores 400
const logError400 = (req, mensaje, datosRecibidos = null) => {
  const timestamp = new Date().toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const ip = req.ip || req.connection.remoteAddress || 'IP desconocida';
  const userAgent = req.get('User-Agent') || 'User-Agent desconocido';

  let logMessage = `[${timestamp}] ❌ ERROR 400 en ${req.method} ${req.path}`;
  logMessage += ` | IP: ${ip}`;
  logMessage += ` | Error: ${mensaje}`;

  if (datosRecibidos) {
    // Ocultar información sensible como tokens, passwords, etc.
    const datosSeguros = { ...datosRecibidos };
    Object.keys(datosSeguros).forEach(key => {
      if (key.toLowerCase().includes('token') ||
        key.toLowerCase().includes('password') ||
        key.toLowerCase().includes('secret')) {
        datosSeguros[key] = '[OCULTO]';
      }
    });
    logMessage += ` | Datos: ${JSON.stringify(datosSeguros)}`;
  }

  console.error(logMessage);
};

// Middleware para manejo de errores
const errorHandler = (err, req, res, next) => {
  logger.error('Error en la aplicación:', err);
  res.status(500).json({
    success: false,
    message: 'Error interno del servidor',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
};

// Configurar trust proxy para producción (detrás de proxy/load balancer)
app.set('trust proxy', 1);

// Middleware para parsear JSON
app.use(express.json({ limit: "10mb" }));

// Configurar Swagger UI
const swaggerUiOptions = {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }'
};

app.use('/docs', swaggerUi.serve);
app.get('/docs', swaggerUi.setup(swaggerSpecs, swaggerUiOptions));

// Aplicar rate limiting general a todas las rutas excepto docs
app.use(/^(?!\/docs).+/, generalLimiter);

// Middleware para permitir solicitudes desde cualquier origen (CORS)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-api-key"
  );
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Methods", "PUT, POST, PATCH, DELETE, GET");
    return res.status(200).json({});
  }
  next();
});

// Definir rutas públicas antes del middleware de autenticación
app.get("/test", (req, res) => {
  const endpoints = {
    notificaciones: [
      "/notificacion/turno-confirmado",
      "/notificacion/seguro-lluvia",
      "/notificacion/pin-llaves",
      "/notificacion/recordatorio",
      "/notificacion/lavado-completado",
      "/notificacion/grupo-interno"
    ],
    encuestas: [
      "/enviar-encuesta",
      "/debug/pendientes",
      "/encuesta/resultados"
    ],
    webhook: [
      "/webhook/waapi"
    ]
  };

  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    serverUptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    endpoints
  });
});

// Aplicar validación de API key a todas las rutas excepto las públicas
app.use((req, res, next) => {
  const apiKey = req.header('x-api-key');

  // Si es la master key, permitir acceso a todo
  if (apiKey && isMasterKey(apiKey)) {
    return next();
  }

  // Si la ruta está en PUBLIC_ENDPOINTS o WEBHOOK_ENDPOINTS, permitir sin API key
  const isBypassEndpoint = [...PUBLIC_ENDPOINTS, ...(WEBHOOK_ENDPOINTS || [])].some(endpoint => {
    // Convertir el endpoint a regex si contiene *
    if (endpoint.includes('*')) {
      const regexStr = endpoint.replace('*', '.*');
      const regex = new RegExp(`^${regexStr}$`);
      return regex.test(req.path);
    }
    return endpoint === req.path;
  });

  if (isBypassEndpoint) {
    return next();
  }

  // Si no es pública ni master key, aplicar validación normal
  return validateApiKeyMiddleware(req, res, next);
});

// ── Inicializar node-persist (se guarda en .data/polls, que Glitch NO borra) ──
(async () => {
  await persist.init({ dir: ".data/polls" }); // podés cambiar el nombre si querés
  console.log("Almacenamiento persistente inicializado");
  // Inicializar alertas de disconformidad pendientes tras reinicio del servidor
  await inicializarAlertasPendientes();
  // Inicializar encuestas diferidas
  await inicializarEncuestasDiferidas();
})();

// Configuración de WhatsApp API
const whatsappConfig = {
  baseURL: 'https://waapi.app/api/v1',
  instanceId: process.env.WAAPI_INSTANCE_ID,
  token: process.env.WAAPI_TOKEN,
  maxRetries: 3,
  retryDelay: 5000,
  timeout: 30000 // 30 segundos de timeout (aumentado para evitar timeouts prematuros)
};

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

// Función para generar hash de idempotencia
const generarHashIdempotencia = (chatId, message) => {
  return crypto.createHash('md5').update(`${chatId}:${message}`).digest('hex');
};

// Función mejorada para enviar mensajes a WhatsApp con reintentos e idempotencia
const enviarMensajeWhatsApp = async (chatId, message, retryCount = 0, requestId = null) => {
  const timestamp = new Date().toISOString();
  const attemptId = requestId ? `${requestId}-${retryCount}` : `msg-${Date.now()}-${retryCount}`;

  // Generar hash para idempotencia
  const messageHash = generarHashIdempotencia(chatId, message);
  const idempotencyKey = `msg:${messageHash}`;

  logger.info(`[${attemptId}] Intento de envío WhatsApp iniciado | chatId: ${chatId} | retryCount: ${retryCount} | hash: ${messageHash.substring(0, 8)}...`);

  // Verificar si este mensaje ya se envió recientemente (últimos 5 minutos)
  const lastSent = await persist.getItem(idempotencyKey);
  if (lastSent) {
    const timeSinceLastSent = Date.now() - lastSent;
    const fiveMinutes = 5 * 60 * 1000;
    if (timeSinceLastSent < fiveMinutes) {
      logger.warn(`[${attemptId}] ⚠️ DUPLICADO DETECTADO | chatId: ${chatId} | tiempo desde último envío: ${Math.round(timeSinceLastSent / 1000)}s | hash: ${messageHash.substring(0, 8)}...`);
      return { status: 'success', duplicate: true, attemptId };
    } else {
      logger.info(`[${attemptId}] Mensaje anterior encontrado pero expirado (${Math.round(timeSinceLastSent / 1000)}s), procediendo con envío`);
    }
  }

  const body = {
    message,
    chatId,
    previewLink: false,
  };

  const startTime = Date.now();
  try {
    logger.info(`[${attemptId}] Enviando request a WaAPI | URL: ${whatsappConfig.baseURL}/instances/${whatsappConfig.instanceId}/client/action/send-message | timeout: ${whatsappConfig.timeout}ms`);

    const response = await axios.post(
      `${whatsappConfig.baseURL}/instances/${whatsappConfig.instanceId}/client/action/send-message`,
      body,
      {
        headers: {
          Authorization: `Bearer ${whatsappConfig.token}`,
          Host: "waapi.app",
          "Content-Type": "application/json",
        },
        timeout: whatsappConfig.timeout
      }
    );

    const responseTime = Date.now() - startTime;
    logger.info(`[${attemptId}] ✅ Respuesta recibida de WaAPI | tiempo: ${responseTime}ms | status: ${response.data?.status} | statusCode: ${response.status}`);

    if (response.data?.status === 'success') {
      // Marcar como enviado para idempotencia (guardar timestamp)
      await persist.setItem(idempotencyKey, Date.now());
      logger.info(`[${attemptId}] ✅ Mensaje enviado exitosamente | chatId: ${chatId} | guardado en idempotencia: ${idempotencyKey}`);

      // Log detallado de la respuesta si existe data
      if (response.data?.data) {
        logger.info(`[${attemptId}] Detalles respuesta WaAPI: ${JSON.stringify(response.data.data).substring(0, 200)}...`);
      }

      return { ...response.data, attemptId };
    } else {
      logger.error(`[${attemptId}] ❌ Respuesta no exitosa de WaAPI | status: ${response.data?.status} | data: ${JSON.stringify(response.data)}`);
      throw new Error(`Respuesta no exitosa de WhatsApp API: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const isTimeout = error.code === 'ECONNABORTED' || error.message.includes('timeout');
    const errorType = isTimeout ? 'TIMEOUT' : error.response ? `HTTP_${error.response.status}` : 'NETWORK_ERROR';

    logger.error(`[${attemptId}] ❌ Error en envío WhatsApp | tipo: ${errorType} | tiempo: ${responseTime}ms | retryCount: ${retryCount}`);
    logger.error(`[${attemptId}] Detalles error: code=${error.code} | message=${error.message}`);

    if (error.response) {
      logger.error(`[${attemptId}] Respuesta error HTTP: status=${error.response.status} | data=${JSON.stringify(error.response.data)}`);
    }

    if (error.request && !error.response) {
      logger.error(`[${attemptId}] No se recibió respuesta del servidor (posible timeout o red)`);
    }

    // Si es un error de timeout, ser más cauteloso con los reintentos
    if (isTimeout && retryCount === 0) {
      // En el primer intento con timeout, esperar un poco más antes de reintentar
      // porque el mensaje puede haberse enviado pero la respuesta tardó
      logger.warn(`[${attemptId}] ⏱️ Timeout detectado. Esperando 2s antes de verificar si el mensaje se envió...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (retryCount < whatsappConfig.maxRetries) {
      logger.warn(`[${attemptId}] 🔄 Reintentando envío | intento ${retryCount + 1}/${whatsappConfig.maxRetries} | delay: ${whatsappConfig.retryDelay}ms${isTimeout ? ' (timeout previo)' : ''}`);
      await new Promise(resolve => setTimeout(resolve, whatsappConfig.retryDelay));
      return enviarMensajeWhatsApp(chatId, message, retryCount + 1, requestId || attemptId.split('-')[0]);
    }

    logger.error(`[${attemptId}] ❌ ERROR FINAL: Se agotaron los reintentos | chatId: ${chatId} | total intentos: ${retryCount + 1}`);
    throw new Error(
      `Error al enviar el mensaje después de ${retryCount + 1} intentos: ` +
      (error.response ? JSON.stringify(error.response.data) : error.message)
    );
  }
};

const SHEETS_URL = process.env.SHEETS_URL;

// Registro en memoria de temporizadores de alertas de disconformidad activos
const activeAlertTimeouts = {};

// Registro en memoria de temporizadores de encuestas diferidas activos
const activeSurveyTimeouts = {};

// Función helper para obtener el mensaje de agradecimiento personalizado
function obtenerMensajeAgradecimiento(opcion) {
  if (!opcion || typeof opcion !== 'string') {
    return "¡Gracias por tu opinión! Nos ayuda a seguir mejorando 🙌";
  }
  const textoOpcion = opcion.toLowerCase();
  if (textoOpcion.includes("excelente")) {
    return "¡Muchas gracias por tu calificación! 😊 Nos alegra saber que tu experiencia fue excelente. Tu opinión nos motiva a seguir brindando el mejor servicio.";
  }
  if (textoOpcion.includes("buena")) {
    return "¡Gracias por tu calificación! 😊 Nos alegra saber que tu experiencia fue buena. Para seguir mejorando, ¿qué podríamos hacer para que la próxima vez sea excelente?";
  }
  if (textoOpcion.includes("regular") || textoOpcion.includes("mala")) {
    return "Gracias por tu devolución. Sentimos que tu experiencia no haya sido buena 😔 Nos gustaría entender qué pasó para poder mejorarlo. ¿Podés contarnos un poco más?";
  }
  return "¡Gracias por tu opinión! Nos ayuda a seguir mejorando 🙌";
}

// Programar alertas pendientes tras reinicio del servidor
async function inicializarAlertasPendientes() {
  try {
    const keys = await persist.keys();
    const fiveMinutes = 5 * 60 * 1000;
    const now = Date.now();
    let reprogramadasCount = 0;

    for (const key of keys) {
      if (key.startsWith("done:")) {
        const voteData = await persist.getItem(key);
        if (voteData && voteData.timestamp && voteData.calificacion) {
          const timeElapsed = now - voteData.timestamp;
          if (timeElapsed < fiveMinutes) {
            const delay = fiveMinutes - timeElapsed;
            const parts = key.split(":");
            const voter = parts[2]; // JID del cliente (done:messageId:voter)

            logger.info(`[ALERTA] ⏱️ Programando alerta y agradecimiento pendientes tras reinicio para ${key} con delay de ${Math.round(delay / 1000)}s`);
            reprogramadasCount++;

            activeAlertTimeouts[key] = setTimeout(async () => {
              try {
                delete activeAlertTimeouts[key];
                const currentData = await persist.getItem(key);
                if (!currentData || !currentData.calificacion) return;

                const valorNumerico = obtenerValorNumerico(currentData.calificacion);

                // ── Enviar agradecimiento definitivo al cliente post-reinicio ──
                const mensajeAgradecimiento = obtenerMensajeAgradecimiento(currentData.calificacion);
                logger.info(`[AGRADECIMIENTO] Enviando respuesta definitiva al cliente (post-reinicio) | JID: ${voter} | Calificación: ${currentData.calificacion}`);
                await enviarMensajeWhatsApp(voter, mensajeAgradecimiento);

                // ── Enviar alerta al grupo interno si la calificación es < 4 ──
                if (valorNumerico !== null && valorNumerico < 4) {
                  const pollInfo = currentData.poll || {};
                  const cliente = `${pollInfo.nombre} ${pollInfo.apellido || ""}`.trim();
                  const telefonoCliente = pollInfo.telefono ? pollInfo.telefono.replace('+', '') : voter.split('@')[0];

                  const mensajeAlerta = `⚠️ *Alerta de Cliente Disconforme (Post-Reinicio)* ⚠️\n\n` +
                    `Un cliente ha finalizado su encuesta con una calificación baja:\n\n` +
                    `• *Cliente:* ${cliente}\n` +
                    `• *Teléfono:* +${telefonoCliente}\n` +
                    `• *Fecha/Hora Turno:* ${pollInfo.fecha || ""} ${pollInfo.hora || ""}hs\n` +
                    `• *Calificación:* ${currentData.calificacion} (${valorNumerico}/5)\n\n` +
                    `👉 *Acción recomendada:* Contactar al cliente para entender su disconformidad.\n\n` +
                    `🤖 Enviado automaticamente`;

                  logger.info(`[ALERTA] Enviando alerta de cliente disconforme (post-reinicio) al grupo interno para el cliente ${cliente}`);

                  await enviarMensajeWhatsApp(
                    "120363206309706318@g.us",
                    mensajeAlerta,
                    0,
                    `alert-${Date.now()}`
                  );
                }
              } catch (err) {
                console.error("Error al procesar alerta pendiente tras reinicio:", err);
              }
            }, delay);
          }
        }
      }
    }
    if (reprogramadasCount > 0) {
      console.log(`[ALERTA] Se reprogramaron exitosamente ${reprogramadasCount} alertas pendientes de envío.`);
    }
  } catch (err) {
    console.error("Error al inicializar alertas de disconformidad pendientes:", err);
  }
}

// Helper unificado para el envío físico de la encuesta por WaAPI
async function ejecutarEnvioEncuesta(datosPoll) {
  const { telefono, nombre, apellido, lavado, appointment_start_date, appointment_start_time } = datosPoll;
  const telNorm = normalizarTelefono(telefono);
  const chatId = `${telNorm.replace("+", "")}@c.us`;

  const pollBody = {
    chatId,
    caption: "¿Cómo calificas tu última experiencia con nosotros? 🧽",
    options: ["Excelente ⭐️", "Buena 👍", "Regular 😕", "Mala 👎"],
    multipleAnswers: false,
  };

  logger.info(`[ENCUESTA] Enviando create-poll físico a WaAPI para ${chatId}`);

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

  let messageId =
    resp.data?.data?.data?.id?.id ||
    resp.data?.data?.id?.id ||
    (resp.data?.data?.data?.id?._serialized
      ? resp.data.data.data.id._serialized.split("_")[2]
      : null);

  const pollData = {
    nombre,
    apellido,
    lavado,
    fecha: appointment_start_date,
    hora: appointment_start_time,
    telefono: telNorm,
    createdAt: Date.now(),
  };

  // Si existe el ID clásico, lo guardamos
  if (messageId) {
    await persist.setItem(`poll:${messageId}`, pollData);
  }
  
  // NUEVO: WaAPI dejó de devolver el messageId en la respuesta. 
  // Siempre guardamos un respaldo basado en el teléfono del cliente (chatId)
  await persist.setItem(`pending_poll:${chatId}`, pollData);

  logMensajeEnviado("Encuesta de satisfacción", chatId, `${nombre} ${apellido || ""}`, telNorm);
  
  const returnMessageId = messageId || `sent_${Date.now()}`;
  logger.info(`[ENCUESTA] ✅ Encuesta enviada físicamente con éxito. ID Local/WaAPI: ${returnMessageId}`);

  return returnMessageId;
}

// Reprogramar encuestas diferidas pendientes tras reinicio del servidor
async function inicializarEncuestasDiferidas() {
  try {
    const keys = await persist.keys();
    const now = Date.now();
    let reprogramadasCount = 0;
    let enviadasInmediatasCount = 0;

    for (const key of keys) {
      if (key.startsWith("delayed_poll:")) {
        const delayedData = await persist.getItem(key);
        if (delayedData && delayedData.sendAt && delayedData.pollData) {
          const delay = delayedData.sendAt - now;

          if (delay > 0) {
            // Caso 1: La encuesta aún debe esperar. Reprogramar.
            logger.info(`[DIFERIDO] ⏱️ Reprogramando envío de encuesta para ${key} con delay de ${Math.round(delay / 1000)}s`);
            reprogramadasCount++;

            activeSurveyTimeouts[key] = setTimeout(async () => {
              try {
                delete activeSurveyTimeouts[key];
                // Ejecutar envío
                await ejecutarEnvioEncuesta(delayedData.pollData);
                // Limpiar de persistencia
                await persist.removeItem(key);
              } catch (err) {
                logger.error(`[DIFERIDO] Error enviando encuesta diferida tras timeout reprogramado: ${err.message}`);
              }
            }, delay);
          } else {
            // Caso 2: El tiempo de espera ya transcurrió mientras el servidor estaba offline.
            // Enviar inmediatamente para no perder la encuesta.
            logger.info(`[DIFERIDO] ⚡ El tiempo programado para ${key} ya pasó. Enviando inmediatamente.`);
            enviadasInmediatasCount++;

            // Enviar en background
            (async () => {
              try {
                await ejecutarEnvioEncuesta(delayedData.pollData);
                await persist.removeItem(key);
              } catch (err) {
                logger.error(`[DIFERIDO] Error enviando encuesta diferida vencida: ${err.message}`);
              }
            })();
          }
        }
      }
    }

    if (reprogramadasCount > 0 || enviadasInmediatasCount > 0) {
      logger.info(`[DIFERIDO] Inicialización finalizada: ${reprogramadasCount} reprogramadas, ${enviadasInmediatasCount} enviadas de inmediato.`);
    }
  } catch (err) {
    logger.error("Error al inicializar encuestas diferidas pendientes:", err);
  }
}

// Funcion para analizar encuestas
async function analizarEncuesta(vote) {
  // WaAPI cambió su payload: voter ahora puede ser sender
  const voter = vote.voter || vote.sender; 
  
  // selectedOptions puede ser un array de objetos {name: "..."} o un array de strings ["..."]
  const opcion = vote.selectedOptions?.[0]?.name || vote.selectedOptions?.[0] || "—";
  
  // Extraer messageId probando diferentes rutas debido a cambios en la API de WhatsApp
  const messageId = 
    vote.parentMessage?.id?.id || 
    vote.pollCreationMessageId || 
    vote.msgId || 
    vote.pollCreationMessage?.id ||
    vote.id?.id ||
    vote.pollId; // WaAPI ahora usa pollId

  if (!messageId) {
    console.error("❌ No se pudo extraer el messageId del voto. Payload de WaAPI:", JSON.stringify(vote, null, 2));
  }
  
  if (!voter) {
    console.error("❌ No se pudo extraer el JID (voter/sender) del voto. Payload:", JSON.stringify(vote, null, 2));
  }

  const llaveDone = `done:${messageId}:${voter}`; // p/ idempotencia

  const firstVoteData = await persist.getItem(llaveDone);
  let poll;
  let esActualizacion = false;

  if (firstVoteData) {
    // Ya votó anteriormente. Comprobar ventana de 5 minutos.
    const timeElapsed = Date.now() - firstVoteData.timestamp;
    const fiveMinutes = 5 * 60 * 1000;

    if (timeElapsed > fiveMinutes) {
      console.log(`[INFO] Voto duplicado ignorado (fuera de la ventana de 5m) para ID ${messageId}`);
      return;
    }

    console.log(`[INFO] Actualización de voto detectada dentro de los 5m para ID ${messageId}`);
    poll = firstVoteData.poll;
    esActualizacion = true;
  } else {
    // Es el primer voto. Buscar la encuesta en pendientes por ID.
    poll = await persist.getItem(`poll:${messageId}`);
    
    // Si no se encuentra por ID, intentar el fallback por número de teléfono
    if (!poll) {
      poll = await persist.getItem(`pending_poll:${voter}`);
    }

    if (!poll) {
      console.warn("Voto huérfano: la encuesta no estaba pendiente", messageId, "para", voter);
      return;
    }
  }

  // ── Grabar/Actualizar en Google Sheets ─────────────────────────────
  try {
    await axios.post(
      SHEETS_URL,
      {
        nombre: poll.nombre,
        apellido: poll.apellido || "",
        lavado: poll.lavado,
        fecha: poll.fecha,
        hora: poll.hora,
        calificacion: opcion,
        messageId: messageId, // Enviamos el messageId único para identificar la fila
      },
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("⚠️  Error subiendo a Sheets. Se guardará localmente pero la planilla falló:", err.message);
    // IMPORTANTE: Ya no hacemos 'return;' aquí para que el bot no se quede mudo. 
    // El flujo continuará y el cliente recibirá su respuesta.
  }

  // ── Persistencia y Limpieza de Pendientes ─────────────────────────
  if (!esActualizacion) {
    // Guardar contexto del primer voto e incluir calificación inicial
    await persist.setItem(llaveDone, {
      timestamp: Date.now(),
      poll: poll,
      calificacion: opcion
    });
    // Eliminar de pendientes (limpiar tanto el registro por ID como el de respaldo)
    if (messageId) {
      await persist.removeItem(`poll:${messageId}`);
    }
    await persist.removeItem(`pending_poll:${voter}`);
  } else {
    // Es una actualización dentro del rango de 5 minutos, refrescar la calificación guardada
    await persist.setItem(llaveDone, {
      ...firstVoteData,
      calificacion: opcion
    });
  }

  // ── Gestión de Alertas y Respuestas Diferidas (5 Minutos) ──────────
  // Si ya existía un temporizador para este voto, cancelarlo (evita spam si el cliente cambia de parecer rápido)
  if (activeAlertTimeouts[llaveDone]) {
    clearTimeout(activeAlertTimeouts[llaveDone]);
    delete activeAlertTimeouts[llaveDone];
  }

  // Programar evaluación final de la calificación en 5 minutos
  activeAlertTimeouts[llaveDone] = setTimeout(async () => {
    try {
      delete activeAlertTimeouts[llaveDone];

      // Cargar datos actuales desde persistencia (voto definitivo)
      const voteData = await persist.getItem(llaveDone);
      if (!voteData || !voteData.calificacion) return;

      const valorNumerico = obtenerValorNumerico(voteData.calificacion);

      // ── Enviar agradecimiento definitivo al cliente ──────────────────
      const mensajeAgradecimiento = obtenerMensajeAgradecimiento(voteData.calificacion);
      logger.info(`[AGRADECIMIENTO] Enviando respuesta definitiva al cliente | JID: ${voter} | Calificación: ${voteData.calificacion}`);
      await enviarMensajeWhatsApp(voter, mensajeAgradecimiento);

      // Si la calificación definitiva es menor a 4 (Buena) -> es decir, Regular (3) o Mala (1)
      if (valorNumerico !== null && valorNumerico < 4) {
        const pollInfo = voteData.poll || {};
        const cliente = `${pollInfo.nombre} ${pollInfo.apellido || ""}`.trim();
        const telefonoCliente = pollInfo.telefono ? pollInfo.telefono.replace('+', '') : voter.split('@')[0];

        const mensajeAlerta = `⚠️ *Alerta de Cliente Disconforme* ⚠️\n\n` +
          `Un cliente ha finalizado su encuesta con una calificación baja:\n\n` +
          `• *Cliente:* ${cliente}\n` +
          `• *Teléfono:* +${telefonoCliente}\n` +
          `• *Fecha/Hora Turno:* ${pollInfo.fecha || ""} ${pollInfo.hora || ""}hs\n` +
          `• *Calificación:* ${voteData.calificacion} (${valorNumerico}/5)\n\n` +
          `👉 *Acción recomendada:* Contactar al cliente para entender su disconformidad y resolver el inconveniente.\n\n` +
          `🤖 Enviado automaticamente`;

        logger.info(`[ALERTA] Enviando alerta de cliente disconforme al grupo interno para el cliente ${cliente}`);

        await enviarMensajeWhatsApp(
          "120363206309706318@g.us",
          mensajeAlerta,
          0,
          `alert-${Date.now()}`
        );
      }
    } catch (err) {
      console.error("Error al procesar evaluación definitiva de encuesta:", err);
    }
  }, 5 * 60 * 1000); // 5 minutos

  console.log(`Voto procesado (${opcion}) para ID ${messageId} (Actualización: ${esActualizacion})`);
}

// Funciones de validación
const validaciones = {
  telefono: (tel) => {
    if (!tel || typeof tel !== 'string') return false;
    return tel.replace(/[^0-9]/g, '').length >= 8;
  },

  fecha: (fecha) => {
    if (!fecha) return false;

    let date;

    // Intentar parsear diferentes formatos de fecha
    if (typeof fecha === 'string') {
      // Si viene en formato DD/MM/YYYY (Booknetic), convertir a MM/DD/YYYY
      const ddmmyyyyMatch = fecha.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (ddmmyyyyMatch) {
        const [, day, month, year] = ddmmyyyyMatch;
        // Convertir DD/MM/YYYY a MM/DD/YYYY para que JavaScript lo entienda
        const usFormat = `${month}/${day}/${year}`;
        date = new Date(usFormat);
      } else {
        // Intentar parsear directamente
        date = new Date(fecha);
      }
    } else {
      date = new Date(fecha);
    }

    const isValid = date instanceof Date && !isNaN(date);
    return isValid;
  },

  hora: (hora) => {
    if (!hora) return false;
    return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(hora);
  },

  nombre: (nombre) => {
    if (!nombre || typeof nombre !== 'string') return false;
    return nombre.length >= 2 && nombre.length <= 50;
  }
};

// Middleware de validación para turno confirmado
const validarTurnoConfirmado = (req, res, next) => {
  const { telefono, customer_first_name, appointment_start_date, appointment_start_time } = req.body;

  if (!validaciones.telefono(telefono)) {
    logError400(req, 'Teléfono inválido', { telefono });
    return res.status(400).json({ success: false, message: 'Teléfono inválido' });
  }
  if (!validaciones.nombre(customer_first_name)) {
    logError400(req, 'Nombre inválido', { customer_first_name });
    return res.status(400).json({ success: false, message: 'Nombre inválido' });
  }
  if (!validaciones.fecha(appointment_start_date)) {
    logError400(req, 'Fecha inválida', { appointment_start_date });
    return res.status(400).json({ success: false, message: 'Fecha inválida' });
  }
  if (!validaciones.hora(appointment_start_time)) {
    logError400(req, 'Hora inválida', { appointment_start_time });
    return res.status(400).json({ success: false, message: 'Hora inválida' });
  }

  next();
};

/**
 * @swagger
 * tags:
 *   - name: Notificaciones
 *     description: Endpoints para envío de notificaciones vía WhatsApp
 *   - name: Encuestas
 *     description: Endpoints para gestión de encuestas
 *   - name: Webhooks
 *     description: Endpoints para recibir eventos y callbacks
 *   - name: Debug
 *     description: Endpoints de desarrollo y depuración
 */

/**
 * @swagger
 * /test:
 *   get:
 *     summary: Test endpoint que devuelve información del estado del servidor
 *     description: Retorna información detallada sobre el estado del servidor, incluyendo uptime, uso de memoria y endpoints disponibles
 *     tags: [Debug]
 *     responses:
 *       200:
 *         description: Estado del servidor
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2024-04-15T14:30:00.000Z"
 *                 environment:
 *                   type: string
 *                   example: "production"
 *                 serverUptime:
 *                   type: number
 *                   example: 6014.39665291
 *                 memoryUsage:
 *                   type: object
 *                   properties:
 *                     rss:
 *                       type: number
 *                     heapTotal:
 *                       type: number
 *                     heapUsed:
 *                       type: number
 *                     external:
 *                       type: number
 *                     arrayBuffers:
 *                       type: number
 *                 endpoints:
 *                   type: object
 *                   properties:
 *                     notificaciones:
 *                       type: array
 *                       items:
 *                         type: string
 *                     encuestas:
 *                       type: array
 *                       items:
 *                         type: string
 *                     webhook:
 *                       type: array
 *                       items:
 *                         type: string
 */

/**
 * @swagger
 * /notificacion/turno-confirmado:
 *   post:
 *     summary: Envía una notificación de turno confirmado vía WhatsApp
 *     tags: [Notificaciones]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TurnoConfirmado'
 *     responses:
 *       200:
 *         description: Mensaje enviado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       400:
 *         description: Datos inválidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: API key inválida
 *       500:
 *         description: Error del servidor
 */
app.post("/notificacion/turno-confirmado", validarTurnoConfirmado, async (req, res) => {
  const requestId = generarRequestId();
  const requestInfo = obtenerInfoRequest(req);
  const timestamp = new Date().toISOString();

  logger.info(`[${requestId}] 📥 REQUEST RECIBIDO | endpoint: /notificacion/turno-confirmado | IP: ${requestInfo.ip} | timestamp: ${timestamp}`);
  logger.info(`[${requestId}] Request details: ${JSON.stringify(requestInfo.headers)}`);
  logger.info(`[${requestId}] Body recibido: ${JSON.stringify(req.body)}`);

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
    logger.warn(`[${requestId}] ⚠️ Validación fallida: Faltan datos requeridos`);
    logError400(req, 'Faltan datos requeridos para turno confirmado', req.body);
    return res
      .status(400)
      .json({ success: false, message: "Faltan datos requeridos" });
  }

  try {
    const telefonoNormalizado = normalizarTelefono(telefono);
    const chatId = `${telefonoNormalizado.replace("+", "")}@c.us`;

    logger.info(`[${requestId}] Procesando envío | telefono: ${telefono} → normalizado: ${telefonoNormalizado} → chatId: ${chatId}`);

    const message = `¡Hola ${customer_first_name}!\nTu turno está confirmado ✅\nTe esperamos el 🗓️${appointment_start_date} a las ${appointment_start_time} en ServiLab 🚗\n\n🤖 Mensaje automático. No requiere respuesta.`;

    const result = await enviarMensajeWhatsApp(chatId, message, 0, requestId);

    if (result.duplicate) {
      logger.warn(`[${requestId}] ⚠️ Mensaje duplicado detectado, pero se procesó correctamente`);
    }

    logMensajeEnviado("Mensaje de turno confirmado", chatId, customer_first_name, telefonoNormalizado);
    logger.info(`[${requestId}] ✅ REQUEST COMPLETADO EXITOSAMENTE | chatId: ${chatId}`);

    res
      .status(200)
      .json({ success: true, message: "Mensaje enviado exitosamente" });
  } catch (error) {
    logger.error(`[${requestId}] ❌ ERROR EN REQUEST | error: ${error.message} | stack: ${error.stack}`);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /notificacion/seguro-lluvia:
 *   post:
 *     summary: Envía una notificación de seguro de lluvia
 *     tags: [Notificaciones]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SeguroLluvia'
 *     responses:
 *       200:
 *         description: Mensaje enviado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       400:
 *         description: Datos inválidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/notificacion/seguro-lluvia", async (req, res) => {
  const requestId = generarRequestId();
  const requestInfo = obtenerInfoRequest(req);
  const timestamp = new Date().toISOString();

  logger.info(`[${requestId}] 📥 REQUEST RECIBIDO | endpoint: /notificacion/seguro-lluvia | IP: ${requestInfo.ip} | timestamp: ${timestamp}`);
  logger.info(`[${requestId}] Request details: ${JSON.stringify(requestInfo.headers)}`);
  logger.info(`[${requestId}] Body recibido: ${JSON.stringify(req.body)}`);

  const { telefono, customer_first_name, cupon, fechaValidoHasta } = req.body;

  // Validación de campos requeridos (se corrigió para utilizar cupon y fechaValidoHasta)
  if (!telefono || !customer_first_name || !cupon || !fechaValidoHasta) {
    logger.warn(`[${requestId}] ⚠️ Validación fallida: Faltan datos requeridos`);
    logError400(req, 'Faltan datos requeridos para seguro de lluvia', req.body);
    return res
      .status(400)
      .json({ success: false, message: "Faltan datos requeridos" });
  }

  try {
    const telefonoNormalizado = normalizarTelefono(telefono);
    const chatId = `${telefonoNormalizado.replace("+", "")}@c.us`;

    logger.info(`[${requestId}] Procesando envío | telefono: ${telefono} → normalizado: ${telefonoNormalizado} → chatId: ${chatId}`);

    const message =
      `Tu seguro de lluvia está ACTIVADO ☂️ ✅\n\n` +
      `La protección incluida en tu SuperLavado te permite volver a lavar tu vehículo sin cargo 🙌\n` +
      `Reservá turno en nuestra web e ingresá este código en el paso del pago: *${cupon}*\n` +
      `http://turnos.servilab.ar\n\n` +
      `🗓️(Recordá que no es transferible y tiene validez hasta el ${fechaValidoHasta})`;

    const result = await enviarMensajeWhatsApp(chatId, message, 0, requestId);

    if (result.duplicate) {
      logger.warn(`[${requestId}] ⚠️ Mensaje duplicado detectado, pero se procesó correctamente`);
    }

    logMensajeEnviado("Mensaje de seguro de lluvia", chatId, customer_first_name, telefonoNormalizado);
    logger.info(`[${requestId}] ✅ REQUEST COMPLETADO EXITOSAMENTE | chatId: ${chatId}`);

    res
      .status(200)
      .json({ success: true, message: "Mensaje enviado exitosamente" });
  } catch (error) {
    logger.error(`[${requestId}] ❌ ERROR EN REQUEST | error: ${error.message} | stack: ${error.stack}`);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /notificacion/pin-llaves:
 *   post:
 *     summary: Envía una notificación con el PIN para retirar las llaves
 *     tags: [Notificaciones]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PinLlaves'
 *     responses:
 *       200:
 *         description: Mensaje enviado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       400:
 *         description: Datos inválidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/notificacion/pin-llaves", async (req, res) => {
  const requestId = generarRequestId();
  const requestInfo = obtenerInfoRequest(req);
  const timestamp = new Date().toISOString();

  logger.info(`[${requestId}] 📥 REQUEST RECIBIDO | endpoint: /notificacion/pin-llaves | IP: ${requestInfo.ip} | timestamp: ${timestamp}`);
  logger.info(`[${requestId}] Request details: ${JSON.stringify(requestInfo.headers)}`);
  logger.info(`[${requestId}] Body recibido: ${JSON.stringify(req.body)}`);

  const { telefono, customer_first_name, codigo } = req.body;

  // Validación de campos requeridos
  if (!telefono || !customer_first_name || !codigo) {
    logger.warn(`[${requestId}] ⚠️ Validación fallida: Faltan datos requeridos`);
    logError400(req, 'Faltan datos requeridos para pin de llaves', req.body);
    return res
      .status(400)
      .json({ success: false, message: "Faltan datos requeridos" });
  }

  try {
    const telefonoNormalizado = normalizarTelefono(telefono);
    const chatId = `${telefonoNormalizado.replace("+", "")}@c.us`;

    logger.info(`[${requestId}] Procesando envío | telefono: ${telefono} → normalizado: ${telefonoNormalizado} → chatId: ${chatId}`);

    const message =
      `🔑 Retirá las llaves de tu vehículo\n\n` +
      `Están disponibles las 24hs y de forma 100% segura en nuestro dispenser. Obtenelas ingresando tu pin: *${codigo}*\n\n` +
      `Si necesitas ayuda ingresá a este link: ( servilab.ar/llaves )`;

    const result = await enviarMensajeWhatsApp(chatId, message, 0, requestId);

    if (result.duplicate) {
      logger.warn(`[${requestId}] ⚠️ Mensaje duplicado detectado, pero se procesó correctamente`);
    }

    logMensajeEnviado("Mensaje de código de llaves", chatId, customer_first_name, telefonoNormalizado);
    logger.info(`[${requestId}] ✅ REQUEST COMPLETADO EXITOSAMENTE | chatId: ${chatId}`);

    res
      .status(200)
      .json({ success: true, message: "Mensaje enviado exitosamente" });
  } catch (error) {
    logger.error(`[${requestId}] ❌ ERROR EN REQUEST | error: ${error.message} | stack: ${error.stack}`);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /notificacion/recordatorio:
 *   post:
 *     summary: Envía un recordatorio de turno
 *     tags: [Notificaciones]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TurnoConfirmado'
 *     responses:
 *       200:
 *         description: Mensaje enviado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       400:
 *         description: Datos inválidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/notificacion/recordatorio", async (req, res) => {
  const requestId = generarRequestId();
  const requestInfo = obtenerInfoRequest(req);
  const timestamp = new Date().toISOString();

  logger.info(`[${requestId}] 📥 REQUEST RECIBIDO | endpoint: /notificacion/recordatorio | IP: ${requestInfo.ip} | timestamp: ${timestamp}`);
  logger.info(`[${requestId}] Request details: ${JSON.stringify(requestInfo.headers)}`);
  logger.info(`[${requestId}] Body recibido: ${JSON.stringify(req.body)}`);

  const {
    telefono,
    customer_first_name,
    appointment_start_date,
    appointment_start_time,
  } = req.body;

  if (!telefono || !customer_first_name) {
    logger.warn(`[${requestId}] ⚠️ Validación fallida: Faltan datos requeridos`);
    logError400(req, 'Faltan datos requeridos para recordatorio', req.body);
    return res
      .status(400)
      .json({ success: false, message: "Faltan datos requeridos" });
  }

  try {
    const telefonoNormalizado = normalizarTelefono(telefono);
    const chatId = `${telefonoNormalizado.replace("+", "")}@c.us`;

    logger.info(`[${requestId}] Procesando envío | telefono: ${telefono} → normalizado: ${telefonoNormalizado} → chatId: ${chatId}`);

    const message = `¡Hola ${customer_first_name}! \n⏰ Tu turno comienza las ${appointment_start_time}. Te esperamos en ServiLab 🚗 \n\n🤖 Mensaje automático. No requiere respuesta.`;

    const result = await enviarMensajeWhatsApp(chatId, message, 0, requestId);

    if (result.duplicate) {
      logger.warn(`[${requestId}] ⚠️ Mensaje duplicado detectado, pero se procesó correctamente`);
    }

    logMensajeEnviado("Mensaje de recordatorio", chatId, customer_first_name, telefonoNormalizado);
    logger.info(`[${requestId}] ✅ REQUEST COMPLETADO EXITOSAMENTE | chatId: ${chatId}`);

    res
      .status(200)
      .json({
        success: true,
        message: "Mensaje de recordatorio enviado exitosamente",
      });
  } catch (error) {
    logger.error(`[${requestId}] ❌ ERROR EN REQUEST | error: ${error.message} | stack: ${error.stack}`);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /notificacion/lavado-completado:
 *   post:
 *     summary: Envía una notificación de lavado completado
 *     tags: [Notificaciones]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: ['telefono', 'customer_first_name']
 *             properties:
 *               telefono:
 *                 type: string
 *                 example: '1135784301'
 *                 description: Número de teléfono sin prefijo internacional
 *               customer_first_name:
 *                 type: string
 *                 example: 'Erick'
 *                 description: Nombre del cliente
 *     responses:
 *       200:
 *         description: Mensaje enviado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       400:
 *         description: Datos inválidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/notificacion/lavado-completado", async (req, res) => {
  const requestId = generarRequestId();
  const requestInfo = obtenerInfoRequest(req);
  const timestamp = new Date().toISOString();

  logger.info(`[${requestId}] 📥 REQUEST RECIBIDO | endpoint: /notificacion/lavado-completado | IP: ${requestInfo.ip} | timestamp: ${timestamp}`);
  logger.info(`[${requestId}] Request details: ${JSON.stringify(requestInfo.headers)}`);
  logger.info(`[${requestId}] Body recibido: ${JSON.stringify(req.body)}`);

  const { telefono, customer_first_name } = req.body;

  if (!telefono || !customer_first_name) {
    logger.warn(`[${requestId}] ⚠️ Validación fallida: Faltan datos requeridos`);
    logError400(req, 'Faltan datos requeridos para lavado completado', req.body);
    return res
      .status(400)
      .json({ success: false, message: "Faltan datos requeridos" });
  }

  try {
    const telefonoNormalizado = normalizarTelefono(telefono);
    const chatId = `${telefonoNormalizado.replace("+", "")}@c.us`;

    logger.info(`[${requestId}] Procesando envío | telefono: ${telefono} → normalizado: ${telefonoNormalizado} → chatId: ${chatId}`);

    const message = `${customer_first_name}, tu vehículo está listo 🚗✨\n\n🤖 Mensaje automático. No requiere respuesta.`;

    const result = await enviarMensajeWhatsApp(chatId, message, 0, requestId);

    if (result.duplicate) {
      logger.warn(`[${requestId}] ⚠️ Mensaje duplicado detectado, pero se procesó correctamente`);
    }

    logMensajeEnviado("Mensaje de lavado completado", chatId, customer_first_name, telefonoNormalizado);
    logger.info(`[${requestId}] ✅ REQUEST COMPLETADO EXITOSAMENTE | chatId: ${chatId}`);

    res
      .status(200)
      .json({
        success: true,
        message:
          "Mensaje de lavado completado enviado exitosamente al" + chatId,
      });
  } catch (error) {
    logger.error(`[${requestId}] ❌ ERROR EN REQUEST | error: ${error.message} | stack: ${error.stack}`);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /notificacion/grupo-interno:
 *   post:
 *     summary: Envía un mensaje genérico al grupo interno de la empresa
 *     description: Permite enviar cualquier comunicación al grupo interno de ServiLab. Requiere una API Key con permisos de notificaciones.
 *     tags: [Notificaciones]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mensaje
 *             properties:
 *               mensaje:
 *                 type: string
 *                 description: El contenido del mensaje a enviar (también acepta el parámetro 'message')
 *                 example: '🚨 Alerta: Reporte de cierre de caja del día de hoy listo.'
 *     responses:
 *       200:
 *         description: Mensaje enviado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 messageId:
 *                   type: string
 *                   example: '3EB0123456'
 *       400:
 *         description: Datos inválidos o mensaje vacío
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/notificacion/grupo-interno", async (req, res) => {
  const requestId = generarRequestId();
  const requestInfo = obtenerInfoRequest(req);
  const timestamp = new Date().toISOString();

  logger.info(`[${requestId}] 📥 REQUEST RECIBIDO | endpoint: /notificacion/grupo-interno | IP: ${requestInfo.ip} | timestamp: ${timestamp}`);
  logger.info(`[${requestId}] Request details: ${JSON.stringify(requestInfo.headers)}`);
  logger.info(`[${requestId}] Body recibido: ${JSON.stringify(req.body)}`);

  const mensaje = req.body.mensaje || req.body.message;

  if (!mensaje || typeof mensaje !== 'string' || mensaje.trim() === '') {
    logger.warn(`[${requestId}] ⚠️ Validación fallida: Mensaje inválido o vacío`);
    logError400(req, 'Mensaje inválido o vacío para el grupo interno', req.body);
    return res.status(400).json({
      success: false,
      message: "El campo 'mensaje' es requerido y no puede estar vacío"
    });
  }

  const grupoJid = "120363206309706318@g.us";

  try {
    logger.info(`[${requestId}] Procesando envío a grupo interno | JID: ${grupoJid}`);

    const result = await enviarMensajeWhatsApp(grupoJid, mensaje.trim(), 0, requestId);

    if (result.duplicate) {
      logger.warn(`[${requestId}] ⚠️ Mensaje duplicado detectado para grupo interno`);
    }

    logMensajeEnviado("Mensaje a grupo interno", grupoJid, "Grupo Interno", "Grupo");
    logger.info(`[${requestId}] ✅ REQUEST COMPLETADO EXITOSAMENTE | JID: ${grupoJid}`);

    res.status(200).json({
      success: true,
      messageId: result.data?.id?.id || result.attemptId
    });
  } catch (error) {
    logger.error(`[${requestId}] ❌ ERROR EN REQUEST | error: ${error.message} | stack: ${error.stack}`);
    res.status(500).json({
      success: false,
      message: "Error al enviar el mensaje de WhatsApp al grupo interno",
      error: error.message
    });
  }
});

/**
 * @swagger
 * /enviar-encuesta:
 *   post:
 *     summary: Envía una encuesta de satisfacción
 *     tags: [Encuestas]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Encuesta'
 *     responses:
 *       200:
 *         description: Encuesta enviada exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 messageId:
 *                   type: string
 *                   example: '3EB0123456'
 *       400:
 *         description: Datos inválidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/enviar-encuesta", async (req, res) => {
  const {
    telefono,
    nombre,
    apellido,
    lavado,
    appointment_start_date,
    appointment_start_time,
    delay
  } = req.body;

  // ── Validación mínima ───────────────────────────────────────────
  if (
    !telefono ||
    !nombre ||
    !lavado ||
    !appointment_start_date ||
    !appointment_start_time
  ) {
    logError400(req, 'Faltan datos requeridos para enviar encuesta', req.body);
    return res
      .status(400)
      .json({ success: false, message: "Faltan datos requeridos" });
  }

  const delayMinutes = parseInt(delay, 10);
  const datosPoll = {
    telefono,
    nombre,
    apellido,
    lavado,
    appointment_start_date,
    appointment_start_time
  };

  try {
    // Escenario 1: Envío instantáneo (Sin delay o delay <= 0)
    if (isNaN(delayMinutes) || delayMinutes <= 0) {
      const messageId = await ejecutarEnvioEncuesta(datosPoll);
      return res.status(200).json({ success: true, messageId });
    }

    // Escenario 2: Envío diferido (delay > 0)
    const delayMs = delayMinutes * 60 * 1000;
    const sendAt = Date.now() + delayMs;
    const { v4: uuidv4 } = require('uuid');
    const delayedKey = `delayed_poll:${uuidv4()}`;

    logger.info(`[ENCUESTA] Programando envío diferido | Delay: ${delayMinutes} min | Destino: ${telefono}`);

    // Guardar en persistencia para resiliencia ante reinicios
    await persist.setItem(delayedKey, {
      pollData: datosPoll,
      sendAt
    });

    // Programar setTimeout local en memoria
    activeSurveyTimeouts[delayedKey] = setTimeout(async () => {
      try {
        delete activeSurveyTimeouts[delayedKey];
        await ejecutarEnvioEncuesta(datosPoll);
        await persist.removeItem(delayedKey);
      } catch (err) {
        logger.error(`[DIFERIDO] Error enviando encuesta diferida: ${err.message}`);
      }
    }, delayMs);

    // Responder inmediatamente indicando que se ha programado
    return res.status(202).json({
      success: true,
      status: "scheduled",
      message: `Envío de encuesta programado con un retraso de ${delayMinutes} minutos`,
      sendAt: new Date(sendAt).toISOString(),
      delayedKey
    });

  } catch (err) {
    console.error("Error al enviar/programar encuesta:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /webhook/waapi:
 *   post:
 *     summary: Webhook para recibir eventos de WhatsApp
 *     description: Endpoint que recibe y procesa eventos de la API de WhatsApp. Actualmente maneja eventos de encuestas (vote_update) pero está preparado para recibir cualquier tipo de evento.
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - event
 *               - data
 *             properties:
 *               event:
 *                 type: string
 *                 description: Tipo de evento recibido de WhatsApp
 *                 example: 'vote_update'
 *               data:
 *                 type: object
 *                 description: Datos específicos del evento. La estructura varía según el tipo de evento.
 *                 example:
 *                   vote:
 *                     voter: "5491112345678@c.us"
 *                     selectedOptions:
 *                       - name: "Excelente ⭐️"
 *                         localId: 0
 *                     parentMessage:
 *                       id:
 *                         id: "3EB0123456"
 *     responses:
 *       200:
 *         description: Evento procesado exitosamente (siempre devuelve 200 para confirmar recepción)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   description: Indica si el evento fue procesado correctamente
 *                   example: true
 */
// Webhook global de WaAPI
app.post(
  '/webhook/waapi',
  express.json({ limit: '10mb' }),      // evita PayloadTooLargeError
  async (req, res) => {
    const { event, data } = req.body;
    
    console.log(`\n🛎️ [WEBHOOK] Evento recibido de WaAPI: ${event}`);

    try {
      if (event === 'vote_update') {
        console.log(`📊 [WEBHOOK] Procesando vote_update. Payload completo de 'data':`, JSON.stringify(data, null, 2));
        if (data?.vote) {
          await analizarEncuesta(data.vote);
        } else {
          console.error(`❌ [WEBHOOK] Evento vote_update recibido pero no tiene el objeto 'data.vote' adentro.`);
        }
      } else if (event === 'message' || event === 'message_create') {
        console.log(`✉️ [WEBHOOK] Procesando ${event}. Payload completo:`, JSON.stringify(data, null, 2));
        
        // El objeto de mensaje puede venir dentro de data.message o ser data directamente
        const msg = data?.message || data;
        
        if (msg) {
          console.log(`[WEBHOOK] Analizando mensaje saliente: fromMe=${msg.fromMe}, type=${msg.type}`);
          // Detectar si nosotros enviamos una encuesta
          if (msg.fromMe && msg.type === 'poll_creation') {
            const chatId = msg.to || msg.id?.remote;
            const msgId = msg.id?.id;
            
            if (chatId && msgId) {
              // Buscar si tenemos una encuesta pendiente para este número
              const pending = await persist.getItem(`pending_poll:${chatId}`);
              if (pending) {
                // Vincular el ID oficial de WhatsApp con nuestra encuesta pendiente
                await persist.setItem(`poll:${msgId}`, pending);
                logger.info(`[ENCUESTA] 🔗 Encuesta vinculada con el ID oficial de WhatsApp asíncronamente. chatId: ${chatId} -> messageId: ${msgId}`);
              }
            }
          }
        }
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

/**
 * @swagger
 * /debug/pendientes:
 *   get:
 *     summary: Lista todas las encuestas pendientes
 *     tags: [Debug]
 *     responses:
 *       200:
 *         description: Lista de encuestas pendientes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   key:
 *                     type: string
 *                     example: 'poll:ABC123'
 *                   data:
 *                     type: object
 *                     properties:
 *                       nombre:
 *                         type: string
 *                       apellido:
 *                         type: string
 *                       lavado:
 *                         type: string
 *                       fecha:
 *                         type: string
 *                       hora:
 *                         type: string
 *                       createdAt:
 *                         type: number
 */

// Función helper para mapear calificaciones textuales a valores numéricos NPS
const obtenerValorNumerico = (calificacion) => {
  if (!calificacion || typeof calificacion !== 'string') return null;
  const texto = calificacion.toLowerCase();
  if (texto.includes('excelente')) return 5;
  if (texto.includes('buena')) return 4;
  if (texto.includes('regular')) return 3;
  if (texto.includes('mala')) return 1;
  return null;
};

// Función helper para normalizar cualquier formato de fecha a YYYY-MM-DD
const normalizarFechaYYYYMMDD = (fechaStr) => {
  if (!fechaStr || typeof fechaStr !== 'string') return '';

  // Si ya es YYYY-MM-DD, devolver directamente
  if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
    return fechaStr;
  }

  // Si es DD/MM/YYYY, convertir a YYYY-MM-DD
  const ddmmyyyyMatch = fechaStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyyMatch) {
    const [, day, month, year] = ddmmyyyyMatch;
    const paddedDay = day.padStart(2, '0');
    const paddedMonth = month.padStart(2, '0');
    return `${year}-${paddedMonth}-${paddedDay}`;
  }

  // Intentar parsear con Date
  try {
    const parsed = new Date(fechaStr);
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  } catch (e) {
    // Ignorar
  }

  return fechaStr; // Devolver original si no se puede normalizar
};

// Función helper para parsear fecha y hora para la comparación y ordenación
const parseFechaHora = (fechaStr, horaStr) => {
  const normalizedDate = normalizarFechaYYYYMMDD(fechaStr);
  const timePart = (horaStr && /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(horaStr)) ? horaStr : "00:00";

  const parsedDate = new Date(`${normalizedDate}T${timePart}`);
  if (isNaN(parsedDate.getTime())) {
    return new Date(0);
  }
  return parsedDate;
};

/**
 * @swagger
 * /encuesta/resultados:
 *   get:
 *     summary: Obtiene los resultados de las encuestas en tiempo real con estadísticas y promedio NPS
 *     description: Consulta en tiempo real la planilla de Google Sheets, aplica filtros de fecha YYYY-MM-DD, ordena cronológicamente por la fecha y hora del turno, y calcula la calificación promedio para el periodo seleccionado. Requiere API key autorizada.
 *     tags: [Encuestas]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: desde
 *         schema:
 *           type: string
 *           format: date
 *         description: Fecha de inicio de periodo (YYYY-MM-DD, inclusiva)
 *         example: '2026-05-01'
 *       - in: query
 *         name: hasta
 *         schema:
 *           type: string
 *           format: date
 *         description: Fecha de fin de periodo (YYYY-MM-DD, inclusiva)
 *         example: '2026-05-25'
 *     responses:
 *       200:
 *         description: Resultados de encuestas y promedio NPS del periodo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 promedio:
 *                   type: number
 *                   format: float
 *                   example: 4.67
 *                   description: Promedio de calificación numérica del periodo (null si no hay votos)
 *                 totalRespuestas:
 *                   type: integer
 *                   example: 3
 *                   description: Cantidad total de encuestas en el periodo
 *                 respuestas:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                       nombre:
 *                         type: string
 *                       apellido:
 *                         type: string
 *                       lavado:
 *                         type: string
 *                       fecha:
 *                         type: string
 *                       hora:
 *                         type: string
 *                       calificacion:
 *                         type: string
 *                       valor:
 *                         type: integer
 *                       messageId:
 *                         type: string
 */
// Función helper para generar una barra horizontal simétrica de 10 bloques de emojis
function generarBarraEmoji(porcentaje, emojiColor) {
  const pct = Math.min(100, Math.max(0, porcentaje || 0));
  let bloquesColor = Math.round(pct / 10);
  // Asegurarnos de que si hay porcentaje > 0, se muestre al menos 1 bloque del color
  if (pct > 0 && bloquesColor === 0) {
    bloquesColor = 1;
  }
  const bloquesVacios = 10 - bloquesColor;
  return `${emojiColor.repeat(bloquesColor)}${"⬜️".repeat(bloquesVacios)}`;
}

// Helper común para extraer y procesar encuestas de Google Sheets
async function obtenerEstadisticasEncuestas(desde, hasta) {
  if (!SHEETS_URL) {
    throw new Error("Google Sheets URL no configurada en las variables de entorno");
  }

  const response = await axios.get(SHEETS_URL, { timeout: 10000 });
  let resultados = response.data;

  if (!Array.isArray(resultados)) {
    throw new Error("Respuesta inválida de Google Sheets. Se esperaba un array.");
  }

  // Filtrar por fecha "desde" si se envía
  if (desde) {
    resultados = resultados.filter(r => {
      const normalized = normalizarFechaYYYYMMDD(r.fecha);
      return normalized >= desde;
    });
  }

  // Filtrar por fecha "hasta" si se envía
  if (hasta) {
    resultados = resultados.filter(r => {
      const normalized = normalizarFechaYYYYMMDD(r.fecha);
      return normalized <= hasta;
    });
  }

  // Mapear valor numérico y contar
  let suma = 0;
  let totalConValor = 0;
  let cantExcelente = 0;
  let cantBuena = 0;
  let cantRegular = 0;
  let cantMala = 0;

  const respuestasMapeadas = resultados.map(r => {
    const valor = obtenerValorNumerico(r.calificacion);
    if (valor !== null) {
      suma += valor;
      totalConValor++;
      if (valor === 5) cantExcelente++;
      else if (valor === 4) cantBuena++;
      else if (valor === 3) cantRegular++;
      else if (valor === 1) cantMala++;
    }
    return { ...r, valor };
  });

  // Ordenar cronológicamente por la fecha y hora del turno
  respuestasMapeadas.sort((a, b) => {
    const dateA = parseFechaHora(a.fecha, a.hora);
    const dateB = parseFechaHora(b.fecha, b.hora);
    return dateA.getTime() - dateB.getTime();
  });

  const promedio = totalConValor > 0 ? parseFloat((suma / totalConValor).toFixed(2)) : null;

  return {
    promedio,
    totalRespuestas: respuestasMapeadas.length,
    respuestas: respuestasMapeadas,
    detalles: {
      excelente: { cant: cantExcelente, porc: respuestasMapeadas.length > 0 ? Math.round((cantExcelente / respuestasMapeadas.length) * 100) : 0 },
      buena: { cant: cantBuena, porc: respuestasMapeadas.length > 0 ? Math.round((cantBuena / respuestasMapeadas.length) * 100) : 0 },
      regular: { cant: cantRegular, porc: respuestasMapeadas.length > 0 ? Math.round((cantRegular / respuestasMapeadas.length) * 100) : 0 },
      mala: { cant: cantMala, porc: respuestasMapeadas.length > 0 ? Math.round((cantMala / respuestasMapeadas.length) * 100) : 0 }
    }
  };
}

/**
 * @swagger
 * /encuesta/resultados:
 *   get:
 *     summary: Obtiene los resultados de las encuestas en tiempo real con estadísticas y promedio NPS
 *     description: Consulta en tiempo real la planilla de Google Sheets, aplica filtros de fecha YYYY-MM-DD, ordena cronológicamente por la fecha y hora del turno, y calcula la calificación promedio para el periodo seleccionado. Requiere API key autorizada.
 *     tags: [Encuestas]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: desde
 *         schema:
 *           type: string
 *           format: date
 *         description: Fecha de inicio de periodo (YYYY-MM-DD, inclusiva)
 *         example: '2026-05-01'
 *       - in: query
 *         name: hasta
 *         schema:
 *           type: string
 *           format: date
 *         description: Fecha de fin de periodo (YYYY-MM-DD, inclusiva)
 *         example: '2026-05-25'
 *     responses:
 *       200:
 *         description: Resultados de encuestas y promedio NPS del periodo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 promedio:
 *                   type: number
 *                   format: float
 *                   example: 4.67
 *                   description: Promedio de calificación numérica del periodo (null si no hay votos)
 *                 totalRespuestas:
 *                   type: integer
 *                   example: 3
 *                   description: Cantidad total de encuestas en el periodo
 *                 respuestas:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                       nombre:
 *                         type: string
 *                       apellido:
 *                         type: string
 *                       lavado:
 *                         type: string
 *                       fecha:
 *                         type: string
 *                       hora:
 *                         type: string
 *                       calificacion:
 *                         type: string
 *                       valor:
 *                         type: integer
 *                       messageId:
 *                         type: string
 */
app.get("/encuesta/resultados", async (req, res) => {
  try {
    const { desde, hasta } = req.query;

    // Validar formato de parámetro "desde" si se envía
    if (desde && !/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
      return res.status(400).json({
        success: false,
        message: "El parámetro 'desde' debe tener el formato YYYY-MM-DD"
      });
    }

    // Validar formato de parámetro "hasta" si se envía
    if (hasta && !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      return res.status(400).json({
        success: false,
        message: "El parámetro 'hasta' debe tener el formato YYYY-MM-DD"
      });
    }

    // Obtener estadísticas y respuestas a través del helper común
    const stats = await obtenerEstadisticasEncuestas(desde, hasta);

    res.json({
      promedio: stats.promedio,
      totalRespuestas: stats.totalRespuestas,
      respuestas: stats.respuestas
    });
  } catch (error) {
    console.error("Error obteniendo resultados de Google Sheets:", error);
    res.status(500).json({
      success: false,
      message: "Error al comunicarse con Google Sheets",
      error: error.message
    });
  }
});

// Tarea Programada Diaria: Envío automático del reporte NPS a las 13:30hs
cron.schedule('30 13 * * *', async () => {
  logger.info("⏱️ [CRON] Iniciando generación automática del reporte NPS diario...");

  try {
    // 1. Calcular la fecha de ayer (YYYY-MM-DD)
    const hoy = new Date();
    const ayer = new Date(hoy.getTime() - 24 * 60 * 60 * 1000);
    const y = ayer.getFullYear();
    const m = String(ayer.getMonth() + 1).padStart(2, '0');
    const d = String(ayer.getDate()).padStart(2, '0');
    const fechaAyer = `${y}-${m}-${d}`;

    logger.info(`[CRON] Consultando encuestas de la fecha de ayer: ${fechaAyer}`);

    // 2. Extraer métricas de ayer
    const stats = await obtenerEstadisticasEncuestas(fechaAyer, fechaAyer);

    // 3. Dar formato al mensaje exacto solicitado
    const total = stats.totalRespuestas;
    const promedioStr = stats.promedio !== null ? `${stats.promedio.toFixed(2)} / 5.00` : "-";

    let mensajeReporte =
      `📊 *REPORTE NPS*\n` +
      `Periodo: ${fechaAyer} al ${fechaAyer}\n\n` +
      `Promedio NPS: ${promedioStr} ⭐️ (${total} Respuestas)\n\n`;

    if (total > 0) {
      const ex = stats.detalles.excelente;
      const bu = stats.detalles.buena;
      const re = stats.detalles.regular;
      const ma = stats.detalles.mala;

      mensajeReporte +=
        `${generarBarraEmoji(ex.porc, "🟩")} ${ex.porc}% (${ex.cant})\n` +
        `${generarBarraEmoji(bu.porc, "🟦")} ${bu.porc}% (${bu.cant})\n` +
        `${generarBarraEmoji(re.porc, "🟧")} ${re.porc}% (${re.cant})\n` +
        `${generarBarraEmoji(ma.porc, "🟥")} ${ma.porc}% (${ma.cant})\n\n`;
    } else {
      mensajeReporte +=
        `${generarBarraEmoji(0, "🟩")} 0% (0)\n` +
        `${generarBarraEmoji(0, "🟦")} 0% (0)\n` +
        `${generarBarraEmoji(0, "🟧")} 0% (0)\n` +
        `${generarBarraEmoji(0, "🟥")} 0% (0)\n\n` +
        `_(Ayer no se registraron encuestas completadas)_\n\n`;
    }

    mensajeReporte += `🤖 Mensaje enviado automaticamente`;

    // 4. Enviar reporte al grupo interno corporativo
    const grupoJid = "120363206309706318@g.us";
    logger.info(`[CRON] Enviando reporte diario al grupo corporativo...`);

    await enviarMensajeWhatsApp(
      grupoJid,
      mensajeReporte,
      0,
      `cron-nps-${Date.now()}`
    );

    logger.info(`[CRON] ✅ Reporte NPS diario enviado exitosamente.`);
  } catch (error) {
    logger.error(`[CRON] ❌ Error generando/enviando el reporte NPS diario: ${error.message}`);
  }
});

// Validaciones de seguridad en producción
if (process.env.NODE_ENV === 'production') {
  // Verificar secretos requeridos
  const requiredSecrets = [
    'API_KEY_SECRET',
    'WHATSAPP_WEBHOOK_KEY',
    'NOTIFICATIONS_KEY',
    'WAAPI_INSTANCE_ID',
    'WAAPI_TOKEN'
  ];

  const missingSecrets = requiredSecrets.filter(secret => !process.env[secret]);

  if (missingSecrets.length > 0) {
    console.error('❌ Error: Faltan las siguientes variables de entorno requeridas:');
    missingSecrets.forEach(secret => console.error(`   - ${secret}`));
    process.exit(1);
  }
}

/**
 * @swagger
 * /dev/generate-key:
 *   post:
 *     summary: Genera una nueva API key
 *     description: Requiere API key maestra para acceder
 *     tags: [API Keys]
 *     security:
 *       - MasterKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Nombre descriptivo para la API key
 *                 example: "API Key para Sistema de Turnos"
 *               test:
 *                 type: boolean
 *                 description: Si es true, genera una key de prueba
 *                 default: false
 *     responses:
 *       200:
 *         description: API key generada exitosamente
 */
app.post('/dev/generate-key', async (req, res) => {
  try {
    const { name, test = false } = req.body;

    if (!name) {
      logError400(req, 'El nombre es requerido para generar API key', req.body);
      return res.status(400).json({
        success: false,
        message: 'El nombre es requerido'
      });
    }

    const apiKey = generateApiKey(test, name);
    const keyConfig = await registerApiKey(apiKey, name, test);

    res.json({
      apiKey,
      type: getKeyType(apiKey),
      isValid: await validateApiKey(apiKey),
      config: keyConfig
    });
  } catch (error) {
    console.error('Error generando API key:', error);
    res.status(500).json({
      success: false,
      message: 'Error generando API key'
    });
  }
});

/**
 * @swagger
 * /dev/list-keys:
 *   get:
 *     summary: Lista todas las API keys registradas
 *     description: Requiere API key maestra para acceder
 *     tags: [API Keys]
 *     security:
 *       - MasterKeyAuth: []
 *     responses:
 *       200:
 *         description: Lista de API keys
 */
app.get('/dev/list-keys', async (req, res) => {
  try {
    const keys = await listApiKeys();
    res.json(keys);
  } catch (error) {
    console.error('Error listando API keys:', error);
    res.status(500).json({
      success: false,
      message: 'Error listando API keys'
    });
  }
});

/**
 * @swagger
 * /dev/delete-key/{apiKey}:
 *   delete:
 *     summary: Elimina una API key
 *     description: Requiere API key maestra para acceder. La API key maestra no puede ser eliminada.
 *     tags: [API Keys]
 *     security:
 *       - MasterKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: apiKey
 *         required: true
 *         schema:
 *           type: string
 *         description: API key a eliminar
 *     responses:
 *       200:
 *         description: API key eliminada exitosamente
 *       404:
 *         description: API key no encontrada
 */
app.delete('/dev/delete-key/:apiKey', async (req, res) => {
  try {
    const { apiKey } = req.params;
    const deleted = await deleteApiKey(apiKey);

    if (deleted) {
      res.json({
        success: true,
        message: 'API key eliminada exitosamente'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'API key no encontrada'
      });
    }
  } catch (error) {
    if (error.message === 'La API key maestra no puede ser eliminada') {
      logError400(req, 'Intento de eliminar API key maestra', { apiKey: req.params.apiKey });
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    console.error('Error eliminando API key:', error);
    res.status(500).json({
      success: false,
      message: 'Error eliminando API key'
    });
  }
});

/**
 * @swagger
 * components:
 *   schemas:
 *     SeguroLluvia:
 *       type: object
 *       required:
 *         - telefono
 *         - customer_first_name
 *         - fecha
 *         - hora
 *       properties:
 *         telefono:
 *           type: string
 *           example: '1135784301'
 *           description: Número de teléfono sin prefijo internacional
 *         customer_first_name:
 *           type: string
 *           example: 'Erick'
 *           description: Nombre del cliente
 *         fecha:
 *           type: string
 *           example: '2024-04-15'
 *           description: Fecha del turno en formato YYYY-MM-DD
 *         hora:
 *           type: string
 *           example: '14:30'
 *           description: Hora del turno en formato HH:mm
 *
 *     PinLlaves:
 *       type: object
 *       required:
 *         - telefono
 *         - customer_first_name
 *         - pin
 *       properties:
 *         telefono:
 *           type: string
 *           example: '1135784301'
 *           description: Número de teléfono sin prefijo internacional
 *         customer_first_name:
 *           type: string
 *           example: 'Erick'
 *           description: Nombre del cliente
 *         pin:
 *           type: string
 *           example: '1234'
 *           description: PIN de 4 dígitos para retirar las llaves
 *
 *     TurnoConfirmado:
 *       type: object
 *       required:
 *         - telefono
 *         - customer_first_name
 *         - fecha
 *         - hora
 *       properties:
 *         telefono:
 *           type: string
 *           example: '1135784301'
 *           description: Número de teléfono sin prefijo internacional
 *         customer_first_name:
 *           type: string
 *           example: 'Erick'
 *           description: Nombre del cliente
 *         fecha:
 *           type: string
 *           example: '2024-04-15'
 *           description: Fecha del turno en formato YYYY-MM-DD
 *         hora:
 *           type: string
 *           example: '14:30'
 *           description: Hora del turno en formato HH:mm
 *
 *     Encuesta:
 *       type: object
 *       required:
 *         - telefono
 *         - nombre
 *         - apellido
 *         - lavado
 *         - fecha
 *         - hora
 *       properties:
 *         telefono:
 *           type: string
 *           example: '1135784301'
 *           description: Número de teléfono sin prefijo internacional
 *         nombre:
 *           type: string
 *           example: 'Erick'
 *           description: Nombre del cliente
 *         apellido:
 *           type: string
 *           example: 'Kahlke'
 *           description: Apellido del cliente
 *         lavado:
 *           type: string
 *           example: 'Lavado Completo'
 *           description: Tipo de lavado realizado
 *         fecha:
 *           type: string
 *           example: '2024-04-15'
 *           description: Fecha del lavado en formato YYYY-MM-DD
 *         hora:
 *           type: string
 *           example: '14:30'
 *           description: Hora del lavado en formato HH:mm
 *
 *     Success:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         messageId:
 *           type: string
 *           example: '3EB0123456'
 *
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           example: 'Datos inválidos'
 */

// Agregar el middleware de manejo de errores al final
app.use(errorHandler);

// Puerto en el que corre el servidor
const port = process.env.PORT || 3002;
app.listen(port, '0.0.0.0', () => {
  logger.info(`Servidor corriendo en http://localhost:${port}`);
});
