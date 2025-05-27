const { v4: uuidv4 } = require('uuid');
const CryptoJS = require('crypto-js');
const { ROLES } = require('../config/permissions');
const persist = require('node-persist');

// Inicializar node-persist
(async () => {
    await persist.init({
        dir: '.data/apikeys',
        stringify: JSON.stringify,
        parse: JSON.parse,
        encoding: 'utf8',
        logging: false,
        ttl: false
    });
})();

// Prefijos válidos para las API keys
const KEY_PREFIXES = {
    LIVE: 'sl_live_',
    TEST: 'sl_test_'
};

// Obtener el secreto del checksum desde variables de entorno
const CHECKSUM_SECRET = process.env.API_KEY_SECRET || 'default-secret-do-not-use-in-production';

// Verificar si estamos usando el secreto por defecto
if (process.env.NODE_ENV === 'production' && CHECKSUM_SECRET === 'default-secret-do-not-use-in-production') {
    console.error('⚠️  ADVERTENCIA: Usando secreto por defecto en producción. Esto es inseguro.');
    console.error('   Configura la variable de entorno API_KEY_SECRET con un valor seguro.');
}

/**
 * Genera una nueva API key
 * @param {boolean} isTest - Si es true, genera una key de prueba
 * @returns {string} API key generada
 */
const generateApiKey = (isTest = false) => {
    const prefix = isTest ? KEY_PREFIXES.TEST : KEY_PREFIXES.LIVE;
    const uuid = uuidv4();
    const baseKey = `${prefix}${uuid}`;
    const checksum = generateChecksum(baseKey);
    return `${baseKey}_${checksum}`;
};

/**
 * Registra una API key en el sistema
 * @param {string} apiKey - La API key a registrar
 * @param {boolean} isTest - Si es una key de prueba
 * @returns {Promise<Object>} Configuración de la key registrada
 */
const registerApiKey = async (apiKey, isTest = false) => {
    const keyConfig = {
        name: isTest ? 'Testing API Key' : 'Production API Key',
        role: 'notifications',
        permissions: ROLES.notifications.permissions,
        createdAt: new Date().toISOString(),
        type: isTest ? 'test' : 'live'
    };
    
    await persist.setItem(`apikey:${apiKey}`, keyConfig);
    return keyConfig;
};

/**
 * Obtiene la configuración de una API key
 * @param {string} apiKey - La API key a buscar
 * @returns {Promise<Object|null>} Configuración de la key o null si no existe
 */
const getApiKeyConfig = async (apiKey) => {
    return await persist.getItem(`apikey:${apiKey}`);
};

/**
 * Lista todas las API keys registradas
 * @returns {Promise<Object>} Objeto con todas las API keys y sus configuraciones
 */
const listApiKeys = async () => {
    const keys = await persist.keys();
    const apiKeys = {};
    
    for (const key of keys) {
        if (key.startsWith('apikey:')) {
            const apiKey = key.replace('apikey:', '');
            apiKeys[apiKey] = await persist.getItem(key);
        }
    }
    
    return apiKeys;
};

/**
 * Elimina una API key del sistema
 * @param {string} apiKey - La API key a eliminar
 * @returns {Promise<boolean>} true si se eliminó correctamente
 */
const deleteApiKey = async (apiKey) => {
    const exists = await persist.getItem(`apikey:${apiKey}`);
    if (exists) {
        await persist.removeItem(`apikey:${apiKey}`);
        return true;
    }
    return false;
};

/**
 * Genera el checksum para una API key
 * @param {string} baseKey - La key base sin el checksum
 * @returns {string} Checksum generado
 */
const generateChecksum = (baseKey) => {
    const hash = CryptoJS.HmacSHA256(baseKey, CHECKSUM_SECRET);
    return hash.toString(CryptoJS.enc.Hex).substring(0, 6);
};

/**
 * Valida una API key
 * @param {string} apiKey - La API key completa a validar
 * @returns {boolean} true si la key es válida
 */
const validateApiKey = (apiKey) => {
    // Verificar formato básico
    const parts = apiKey.split('_');
    if (parts.length !== 3) return false;

    // Verificar prefijo
    const prefix = `${parts[0]}_${parts[1]}_`;
    if (!Object.values(KEY_PREFIXES).includes(prefix)) return false;

    // Verificar UUID
    const uuid = parts[1];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(uuid)) return false;

    // Verificar checksum
    const baseKey = apiKey.substring(0, apiKey.lastIndexOf('_'));
    const providedChecksum = parts[2];
    const calculatedChecksum = generateChecksum(baseKey);

    return providedChecksum === calculatedChecksum;
};

/**
 * Obtiene el tipo de API key (live o test)
 * @param {string} apiKey - La API key a analizar
 * @returns {string} 'live' o 'test'
 */
const getKeyType = (apiKey) => {
    if (apiKey.startsWith(KEY_PREFIXES.LIVE)) return 'live';
    if (apiKey.startsWith(KEY_PREFIXES.TEST)) return 'test';
    return null;
};

module.exports = {
    generateApiKey,
    validateApiKey,
    getKeyType,
    KEY_PREFIXES,
    registerApiKey,
    getApiKeyConfig,
    listApiKeys,
    deleteApiKey
}; 