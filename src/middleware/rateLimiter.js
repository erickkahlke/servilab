const rateLimit = require('express-rate-limit');

// Limiter general: 50 requests por minuto por IP
const generalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 50, // 50 requests por ventana
    message: {
        success: false,
        message: 'Demasiadas solicitudes desde esta IP, por favor intente nuevamente en un minuto'
    },
    standardHeaders: true, // Devolver info de rate limit en los headers `RateLimit-*`
    legacyHeaders: false, // Deshabilitar los headers `X-RateLimit-*`
});

// Limiter más estricto para intentos de autenticación
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // 5 intentos fallidos
    message: {
        success: false,
        message: 'Demasiados intentos fallidos, por favor intente nuevamente en 15 minutos'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = {
    generalLimiter,
    authLimiter
}; 