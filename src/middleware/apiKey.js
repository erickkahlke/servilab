const { PUBLIC_ENDPOINTS } = require('../config/keys');
const { hasPermissionForEndpoint } = require('../config/permissions');
const { getApiKeyConfig } = require('../utils/apiKeyGenerator');

const validateApiKey = async (req, res, next) => {
    // Convertir la ruta actual a un formato que podamos comparar con los endpoints públicos
    const currentPath = req.path.split('/').map(segment => {
        // Si el segmento parece un parámetro (no contiene caracteres especiales), reemplazarlo con :param
        return /^[a-zA-Z0-9_-]+$/.test(segment) ? ':' + segment.split('-')[0] : segment;
    }).join('/');

    // Si es un endpoint público o coincide con un patrón público, permitir sin API key
    const isPublic = PUBLIC_ENDPOINTS.some(endpoint => {
        // Convertir el endpoint a regex reemplazando :param con ([^/]+)
        const pattern = new RegExp('^' + endpoint.replace(/:[^/]+/g, '([^/]+)') + '$');
        return pattern.test(req.path);
    });

    if (isPublic) {
        return next();
    }

    const apiKey = req.header('X-API-Key');
    
    if (!apiKey) {
        return res.status(401).json({
            success: false,
            message: 'API Key no proporcionada'
        });
    }

    try {
        // Verificar si la API key existe y obtener su configuración
        const keyConfig = await getApiKeyConfig(apiKey);
        
        if (!keyConfig) {
            return res.status(401).json({
                success: false,
                message: 'API Key inválida'
            });
        }

        // Verificar si la key tiene permiso para acceder al endpoint
        if (!hasPermissionForEndpoint(keyConfig.permissions, req.path)) {
            return res.status(403).json({
                success: false,
                message: 'No tienes permiso para acceder a este endpoint'
            });
        }

        // Agregar información de la key al request para uso posterior
        req.apiKeyInfo = {
            name: keyConfig.name,
            role: keyConfig.role,
            permissions: keyConfig.permissions,
            type: keyConfig.type
        };

        next();
    } catch (error) {
        console.error('Error validando API key:', error);
        return res.status(500).json({
            success: false,
            message: 'Error interno validando API key'
        });
    }
};

module.exports = validateApiKey; 