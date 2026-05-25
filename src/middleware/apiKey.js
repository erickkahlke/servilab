const { hasPermissionForEndpoint } = require('../config/permissions');
const { getApiKeyConfig, validateApiKey, isMasterKey } = require('../utils/apiKeyGenerator');

const validateApiKeyMiddleware = async (req, res, next) => {
    const apiKey = req.header('x-api-key');

    // Verificar si es un endpoint de gestión de API keys
    const isApiKeyManagementEndpoint = req.path.startsWith('/dev/');
    
    if (isApiKeyManagementEndpoint) {
        // Para endpoints de gestión de API keys, requerir master key
        if (!apiKey || !isMasterKey(apiKey)) {
            return res.status(401).json({
                success: false,
                message: 'Se requiere API key maestra para esta operación'
            });
        }
    } else {
        // Para el resto de los endpoints, validar API key normal
        if (!apiKey) {
            return res.status(401).json({
                success: false,
                message: 'API Key no proporcionada'
            });
        }

        const isValid = await validateApiKey(apiKey);
        if (!isValid) {
            return res.status(401).json({
                success: false,
                message: 'API Key inválida'
            });
        }

        // Obtener la configuración de la API Key para validar permisos
        const config = await getApiKeyConfig(apiKey);
        if (!config) {
            return res.status(401).json({
                success: false,
                message: 'API Key sin configuración'
            });
        }

        // Si es master key o admin, permitir acceso total
        if (config.permissions && config.permissions.includes('*')) {
            return next();
        }

        // Validar permisos del endpoint
        const hasPermission = hasPermissionForEndpoint(config.permissions || [], req.path);
        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'No tienes permisos para acceder a este recurso'
            });
        }
    }

    next();
};

module.exports = validateApiKeyMiddleware; 