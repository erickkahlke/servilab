require('dotenv').config();
const { ROLES } = require('./permissions');

// Configuración de API keys con roles y permisos
const API_KEYS = {
    // Key de prueba para testing
    'sl_test_5260b49b-16be-4a54-901c-6da3fc8424df_277dbc': {
        name: 'Testing API Key',
        role: 'notifications',
        permissions: ROLES.notifications.permissions
    }
};

// Lista de endpoints públicos que no requieren API key
const PUBLIC_ENDPOINTS = [
    '/test',  // endpoint de prueba
    '/dev/generate-key',  // endpoint de generación de API keys (solo en desarrollo)
    '/dev/list-keys',  // endpoint para listar API keys (solo en desarrollo)
    '/dev/delete-key/:apiKey',  // endpoint para eliminar API keys (solo en desarrollo)
    '/docs',  // documentación Swagger UI
    '/docs/',  // documentación Swagger UI con slash
    '/docs/swagger.json',  // especificación OpenAPI
    '/docs/*'  // archivos estáticos de Swagger UI
];

// Lista de endpoints que usan la key de webhook
const WEBHOOK_ENDPOINTS = [
    '/webhook/waapi'
];

module.exports = {
    API_KEYS,
    PUBLIC_ENDPOINTS,
    WEBHOOK_ENDPOINTS
}; 