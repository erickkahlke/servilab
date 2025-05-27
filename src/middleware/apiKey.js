const { PUBLIC_ENDPOINTS } = require('../config/keys');
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
    }

    next();
};

module.exports = validateApiKeyMiddleware; 