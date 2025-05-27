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
    tags: [
      {
        name: 'Notificaciones',
        description: 'Endpoints para envío de notificaciones vía WhatsApp'
      },
      {
        name: 'Encuestas',
        description: 'Endpoints para gestión de encuestas'
      },
      {
        name: 'API Keys',
        description: 'Endpoints para gestión de API keys (requiere master key)'
      },
      {
        name: 'Debug',
        description: 'Endpoints de desarrollo y depuración'
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'API key para autenticación. Formato: sl_[live|test]_uuid_suffix'
        },
        MasterKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'Master API key para gestión de otras keys. Formato: sl_master_uuid_admin'
        }
      },
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
        },
        ApiKey: {
          type: 'object',
          properties: {
            apiKey: {
              type: 'string',
              example: 'sl_live_d0c567d6-6ce0-4665-8329-d551f3ec64a2_3b0350',
              description: 'API key generada'
            },
            config: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  example: 'API Key para Sistema de Turnos',
                  description: 'Nombre descriptivo de la API key'
                },
                type: {
                  type: 'string',
                  enum: ['test', 'live', 'master'],
                  example: 'live',
                  description: 'Tipo de API key'
                },
                role: {
                  type: 'string',
                  example: 'notifications',
                  description: 'Rol asignado a la API key'
                },
                permissions: {
                  type: 'array',
                  items: {
                    type: 'string'
                  },
                  example: ['notifications:send'],
                  description: 'Permisos asignados'
                },
                createdAt: {
                  type: 'string',
                  format: 'date-time',
                  example: '2024-05-27T21:22:42.025Z',
                  description: 'Fecha de creación'
                }
              }
            },
            isValid: {
              type: 'boolean',
              example: true,
              description: 'Indica si la API key es válida'
            },
            type: {
              type: 'string',
              enum: ['test', 'live', 'master'],
              example: 'live',
              description: 'Tipo de API key'
            }
          }
        },
        ApiKeyList: {
          type: 'object',
          additionalProperties: {
            $ref: '#/components/schemas/ApiKey/properties/config'
          },
          example: {
            "sl_master_8f4c5a91-b6d2-4e8c-a252-1d7c3f5e9b8a_admin": {
              "name": "Master API Key",
              "type": "master",
              "role": "admin",
              "permissions": ["*"],
              "createdAt": "2024-01-01T00:00:00.000Z"
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