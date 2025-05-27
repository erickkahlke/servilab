# ServiLab API

API de notificaciones y encuestas para ServiLab Car Wash. Gestiona el envío de mensajes de WhatsApp para confirmaciones de turno, recordatorios, encuestas de satisfacción y más.

## 🚀 Características

- Envío de notificaciones vía WhatsApp:
  - Confirmación de turnos
  - Recordatorios
  - Seguro de lluvia
  - PIN de llaves
  - Lavado completado
- Sistema de encuestas de satisfacción
- Gestión de API keys
- Rate limiting
- Persistencia de datos
- Integración con Google Sheets para resultados de encuestas

## 📋 Requisitos Previos

- Node.js (v14 o superior)
- npm o yarn
- Cuenta en WaAPI.app
- Cuenta de Google Cloud (para Sheets API)

## 🔧 Instalación

1. Clonar el repositorio:
```bash
git clone https://github.com/erickkahlke/servilab.git
cd servilab
```

2. Instalar dependencias:
```bash
npm install
```

3. Configurar variables de entorno:
```bash
cp .env.example .env
```

Editar `.env` con tus credenciales:
```env
NODE_ENV=development
PORT=3000
WAAPI_TOKEN=tu_token_aqui
WAAPI_INSTANCE_ID=tu_instance_id
SHEETS_URL=tu_url_de_google_sheets
```

4. Iniciar el servidor:
```bash
npm start
```

Para desarrollo:
```bash
npm run dev
```

## 🔑 Variables de Entorno

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| NODE_ENV | Ambiente de ejecución (development/production) | Sí |
| PORT | Puerto del servidor | No (default: 3000) |
| WAAPI_TOKEN | Token de autenticación de WaAPI | Sí |
| WAAPI_INSTANCE_ID | ID de instancia de WaAPI | Sí |
| SHEETS_URL | URL del endpoint de Google Sheets | Sí |

## 📱 Endpoints

### Notificaciones

#### POST /notificacion/turno-confirmado
Envía confirmación de turno vía WhatsApp.
```json
{
  "telefono": "1135784301",
  "customer_first_name": "Erick",
  "appointment_start_date": "2024-10-10",
  "appointment_start_time": "15:30"
}
```

#### POST /notificacion/seguro-lluvia
Envía información del seguro de lluvia.
```json
{
  "telefono": "1135784301",
  "customer_first_name": "Erick",
  "cupon": "LLUVIA123",
  "fechaValidoHasta": "2024-05-30"
}
```

[Ver documentación completa de endpoints en /docs/swagger]

## 🔐 Autenticación

La API utiliza un sistema de API keys para autenticación. Cada request debe incluir el header:
```
X-API-Key: sl_live_xxxxxxxx
```

### Tipos de API Keys
- Testing: `sl_test_*`
- Producción: `sl_live_*`

## 📊 Encuestas

El sistema de encuestas utiliza WaAPI para enviar encuestas de satisfacción y procesar respuestas. Los resultados se almacenan en Google Sheets.

### Flujo de Encuesta
1. Se envía la encuesta post-lavado
2. Cliente responde
3. Se procesa la respuesta vía webhook
4. Se almacena en Google Sheets
5. Se envía agradecimiento al cliente

## 🛠️ Desarrollo

### Estructura del Proyecto
```
/
├── src/
│   ├── middleware/
│   │   ├── apiKey.js
│   │   └── rateLimiter.js
│   ├── utils/
│   │   └── apiKeyGenerator.js
│   └── server.js
├── .env
├── .gitignore
└── package.json
```

### Scripts Disponibles
```bash
npm start          # Inicia el servidor
npm run dev       # Inicia el servidor en modo desarrollo
npm test          # Ejecuta tests
```

## 📈 Monitoreo

El servidor incluye logs básicos para monitoreo:
- Requests entrantes
- Errores de envío de mensajes
- Procesamiento de encuestas
- Errores de API

## 🤝 Contribución

1. Fork el proyecto
2. Crea tu Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push al Branch (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📝 Licencia

Este proyecto es privado y de uso exclusivo para ServiLab Car Wash.

## 👥 Autores

- Erick Kahlke - *Desarrollo inicial* - [erickkahlke](https://github.com/erickkahlke) 