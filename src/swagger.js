const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ServiLab API',
      version: '1.0.0',
      description: 'API de notificaciones y encuestas para ServiLab Car Wash',
      contact: {
        name: 'Erick Kahlke',
        url: 'https://github.com/erickkahlke',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Servidor de desarrollo',
      },
      {
        url: 'http://149.50.139.142/servilab',
        description: 'Servidor de producción',
      },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key para autenticación',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            message: {
              type: 'string',
              example: 'Descripción del error',
            },
          },
        },
        Success: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            message: {
              type: 'string',
              example: 'Operación exitosa',
            },
          },
        },
        TurnoConfirmado: {
          type: 'object',
          required: ['telefono', 'customer_first_name', 'appointment_start_date', 'appointment_start_time'],
          properties: {
            telefono: {
              type: 'string',
              example: '1135784301',
              description: 'Número de teléfono sin prefijo internacional',
            },
            customer_first_name: {
              type: 'string',
              example: 'Erick',
              description: 'Nombre del cliente',
            },
            appointment_start_date: {
              type: 'string',
              format: 'date',
              example: '2024-10-10',
              description: 'Fecha del turno (YYYY-MM-DD)',
            },
            appointment_start_time: {
              type: 'string',
              example: '15:30',
              description: 'Hora del turno (HH:mm)',
            },
          },
        },
        SeguroLluvia: {
          type: 'object',
          required: ['telefono', 'customer_first_name', 'cupon', 'fechaValidoHasta'],
          properties: {
            telefono: {
              type: 'string',
              example: '1135784301',
            },
            customer_first_name: {
              type: 'string',
              example: 'Erick',
            },
            cupon: {
              type: 'string',
              example: 'LLUVIA123',
            },
            fechaValidoHasta: {
              type: 'string',
              format: 'date',
              example: '2024-05-30',
            },
          },
        },
        PinLlaves: {
          type: 'object',
          required: ['telefono', 'customer_first_name', 'codigo'],
          properties: {
            telefono: {
              type: 'string',
              example: '1135784301',
            },
            customer_first_name: {
              type: 'string',
              example: 'Erick',
            },
            codigo: {
              type: 'string',
              example: '1234',
            },
          },
        },
        Encuesta: {
          type: 'object',
          required: ['telefono', 'customer_first_name', 'lavado', 'appointment_start_date', 'appointment_start_time'],
          properties: {
            telefono: {
              type: 'string',
              example: '1135784301',
            },
            customer_first_name: {
              type: 'string',
              example: 'Erick',
            },
            lavado: {
              type: 'string',
              example: 'Lavado Premium',
            },
            appointment_start_date: {
              type: 'string',
              format: 'date',
              example: '2024-10-10',
            },
            appointment_start_time: {
              type: 'string',
              example: '15:30',
            },
          },
        },
      },
    },
    security: [
      {
        ApiKeyAuth: [],
      },
    ],
  },
  apis: [path.join(__dirname, '../server.js')], // Ruta absoluta al archivo server.js
};

const specs = swaggerJsdoc(options);

module.exports = specs; 