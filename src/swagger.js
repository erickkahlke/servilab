const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ServiLab API',
      version: '1.0.0',
      description: 'API de notificaciones y encuestas para ServiLab Car Wash'
    },
    servers: [
      {
        url: '/',
        description: 'API Server'
      }
    ],
    components: {
      schemas: {
        TurnoConfirmado: {
          type: 'object',
          required: ['telefono', 'customer_first_name', 'appointment_start_date', 'appointment_start_time'],
          properties: {
            telefono: {
              type: 'string',
              example: '1135784301',
              description: 'Número de teléfono sin prefijo internacional'
            },
            customer_first_name: {
              type: 'string',
              example: 'Erick',
              description: 'Nombre del cliente'
            },
            appointment_start_date: {
              type: 'string',
              format: 'date',
              example: '2024-03-27',
              description: 'Fecha del turno (YYYY-MM-DD)'
            },
            appointment_start_time: {
              type: 'string',
              example: '15:30',
              description: 'Hora del turno (HH:mm)'
            }
          }
        },
        SeguroLluvia: {
          type: 'object',
          required: ['telefono', 'customer_first_name', 'cupon', 'fechaValidoHasta'],
          properties: {
            telefono: {
              type: 'string',
              example: '1135784301',
              description: 'Número de teléfono sin prefijo internacional'
            },
            customer_first_name: {
              type: 'string',
              example: 'Erick',
              description: 'Nombre del cliente'
            },
            cupon: {
              type: 'string',
              example: 'LLUVIA123',
              description: 'Código del cupón para el seguro de lluvia'
            },
            fechaValidoHasta: {
              type: 'string',
              format: 'date',
              example: '2024-03-30',
              description: 'Fecha de vencimiento del cupón (YYYY-MM-DD)'
            }
          }
        },
        PinLlaves: {
          type: 'object',
          required: ['telefono', 'customer_first_name', 'codigo'],
          properties: {
            telefono: {
              type: 'string',
              example: '1135784301',
              description: 'Número de teléfono sin prefijo internacional'
            },
            customer_first_name: {
              type: 'string',
              example: 'Erick',
              description: 'Nombre del cliente'
            },
            codigo: {
              type: 'string',
              example: '1234',
              description: 'Código PIN para retirar las llaves'
            }
          }
        },
        Encuesta: {
          type: 'object',
          required: ['telefono', 'nombre', 'lavado', 'appointment_start_date', 'appointment_start_time'],
          properties: {
            telefono: {
              type: 'string',
              example: '1135784301',
              description: 'Número de teléfono sin prefijo internacional'
            },
            nombre: {
              type: 'string',
              example: 'Erick',
              description: 'Nombre del cliente'
            },
            apellido: {
              type: 'string',
              example: 'Kahlke',
              description: 'Apellido del cliente (opcional)'
            },
            lavado: {
              type: 'string',
              example: 'Lavado Premium',
              description: 'Tipo de lavado realizado'
            },
            appointment_start_date: {
              type: 'string',
              format: 'date',
              example: '2024-03-27',
              description: 'Fecha del turno (YYYY-MM-DD)'
            },
            appointment_start_time: {
              type: 'string',
              example: '15:30',
              description: 'Hora del turno (HH:mm)'
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            message: {
              type: 'string',
              example: 'Descripción del error'
            }
          }
        },
        Success: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            message: {
              type: 'string',
              example: 'Operación exitosa'
            }
          }
        }
      }
    }
  },
  apis: ['./server.js']
};

const specs = swaggerJsdoc(options);

module.exports = specs; 