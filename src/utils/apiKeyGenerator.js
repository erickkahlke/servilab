const crypto = require('crypto');
const persist = require('node-persist');

// API key maestra que será válida en todos los ambientes y no puede ser revocada
const MASTER_API_KEY = process.env.MASTER_API_KEY || 'sl_master_8f4c5a91-b6d2-4e8c-a252-1d7c3f5e9b8a_admin';

// Validar que la master key tenga el formato correcto
if (!MASTER_API_KEY.startsWith('sl_master_') || !MASTER_API_KEY.endsWith('_admin')) {
  console.error('⚠️  ADVERTENCIA: El formato de MASTER_API_KEY no es válido');
  process.exit(1);
}

const generateApiKey = (isTest = false, name = '') => {
  if (!name) {
    throw new Error('El nombre es requerido para generar una API key');
  }
  
  const uuid = crypto.randomUUID();
  const prefix = isTest ? 'sl_test_' : 'sl_live_';
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${prefix}${uuid}_${suffix}`;
};

const validateApiKey = async (apiKey) => {
  // La master key siempre es válida
  if (apiKey === MASTER_API_KEY) {
    return true;
  }

  // Validar formato
  if (!apiKey || typeof apiKey !== 'string') {
    return false;
  }

  const pattern = /^sl_(live|test)_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_[0-9a-f]{6}$/;
  if (!pattern.test(apiKey)) {
    return false;
  }

  // Verificar si existe en el registro
  const keys = await listApiKeys();
  return !!keys[apiKey];
};

const isMasterKey = (apiKey) => {
  return apiKey === MASTER_API_KEY;
};

const getKeyType = (apiKey) => {
  if (apiKey === MASTER_API_KEY) return 'master';
  if (apiKey.startsWith('sl_test_')) return 'test';
  if (apiKey.startsWith('sl_live_')) return 'live';
  return 'unknown';
};

const registerApiKey = async (apiKey, name, isTest = false) => {
  if (!name) {
    throw new Error('El nombre es requerido para registrar una API key');
  }

  await persist.init({ dir: '.data/api-keys' });
  
  const config = {
    name,
    type: getKeyType(apiKey),
    role: 'notifications',
    permissions: ['notifications:send'],
    createdAt: new Date().toISOString()
  };

  await persist.setItem(apiKey, config);
  return config;
};

const listApiKeys = async () => {
  await persist.init({ dir: '.data/api-keys' });
  const keys = await persist.keys();
  const result = {};

  // Agregar la master key al listado
  result[MASTER_API_KEY] = {
    name: 'Master API Key',
    type: 'master',
    role: 'admin',
    permissions: ['*'],
    createdAt: '2024-01-01T00:00:00.000Z'
  };

  // Agregar el resto de las keys
  for (const key of keys) {
    result[key] = await persist.getItem(key);
  }

  return result;
};

const deleteApiKey = async (apiKey) => {
  // No permitir eliminar la master key
  if (apiKey === MASTER_API_KEY) {
    throw new Error('La API key maestra no puede ser eliminada');
  }

  await persist.init({ dir: '.data/api-keys' });
  const exists = await persist.getItem(apiKey);
  
  if (!exists) {
    return false;
  }

  await persist.removeItem(apiKey);
  return true;
};

module.exports = {
  generateApiKey,
  validateApiKey,
  isMasterKey,
  getKeyType,
  registerApiKey,
  listApiKeys,
  deleteApiKey,
  MASTER_API_KEY
}; 