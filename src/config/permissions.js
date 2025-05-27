// Definición de permisos disponibles
const PERMISSIONS = {
    // Permisos para notificaciones
    'notifications:send': {
        description: 'Enviar notificaciones',
        endpoints: [
            '/notificacion/turno-confirmado',
            '/notificacion/seguro-lluvia',
            '/notificacion/pin-llaves',
            '/notificacion/recordatorio',
            '/notificacion/lavado-completado'
        ]
    },
    'notifications:all': {
        description: 'Acceso completo a notificaciones',
        includes: ['notifications:send']
    },

    // Permisos para encuestas
    'surveys:send': {
        description: 'Enviar encuestas',
        endpoints: ['/enviar-encuesta']
    },
    'surveys:read': {
        description: 'Leer resultados de encuestas',
        endpoints: ['/debug/pendientes']
    },
    'surveys:all': {
        description: 'Acceso completo a encuestas',
        includes: ['surveys:send', 'surveys:read']
    },

    // Permisos para webhooks
    'webhooks:receive': {
        description: 'Recibir webhooks',
        endpoints: ['/webhook/waapi']
    }
};

// Roles predefinidos
const ROLES = {
    'admin': {
        description: 'Acceso completo al sistema',
        permissions: ['notifications:all', 'surveys:all', 'webhooks:receive']
    },
    'notifications': {
        description: 'Solo envío de notificaciones',
        permissions: ['notifications:send']
    },
    'surveys': {
        description: 'Manejo de encuestas',
        permissions: ['surveys:all']
    },
    'webhook': {
        description: 'Receptor de webhooks',
        permissions: ['webhooks:receive']
    }
};

// Función para verificar si un conjunto de permisos tiene acceso a un endpoint
const hasPermissionForEndpoint = (userPermissions, endpoint) => {
    // Expandir permisos que incluyen otros
    const expandedPermissions = new Set();
    
    const expandPermission = (permission) => {
        if (PERMISSIONS[permission]) {
            expandedPermissions.add(permission);
            if (PERMISSIONS[permission].includes) {
                PERMISSIONS[permission].includes.forEach(includedPerm => {
                    expandPermission(includedPerm);
                });
            }
        }
    };

    userPermissions.forEach(permission => expandPermission(permission));

    // Verificar si alguno de los permisos expandidos da acceso al endpoint
    return Array.from(expandedPermissions).some(permission => 
        PERMISSIONS[permission].endpoints?.includes(endpoint)
    );
};

module.exports = {
    PERMISSIONS,
    ROLES,
    hasPermissionForEndpoint
}; 