#!/bin/bash

# Script para arreglar configuración de WhatsApp API
# Asegura que esté usando credenciales de producción

echo "🔧 Arreglando configuración de WhatsApp API..."

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Verificar conexión
if ! ssh mi-vm 'echo "Conectado"' 2>/dev/null; then
    log_error "No se pudo conectar al servidor"
    exit 1
fi

log_info "Ejecutando corrección en el servidor..."

ssh mi-vm << 'EOF'
    # Colores para output remoto
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    NC='\033[0m'
    
    log_info() {
        echo -e "${GREEN}[REMOTO]${NC} $1"
    }
    
    log_warn() {
        echo -e "${YELLOW}[REMOTO]${NC} $1"
    }
    
    log_error() {
        echo -e "${RED}[REMOTO]${NC} $1"
    }
    
    echo "🔧 Arreglando configuración de WhatsApp..."
    
    # 1. Verificar y detener proceso actual
    log_info "Deteniendo proceso actual..."
    pm2 delete servilab_notify || true
    
    # 2. Asegurar que estamos en el directorio correcto
    TARGET_DIR="/var/www/html/servilab/notify"
    if [ ! -d "$TARGET_DIR" ]; then
        log_error "Directorio $TARGET_DIR no existe"
        exit 1
    fi
    
    cd "$TARGET_DIR"
    log_info "Trabajando en directorio: $(pwd)"
    
    # 3. Verificar y corregir archivo .env
    log_info "Verificando archivo .env..."
    
    if [ ! -f ".env" ]; then
        log_warn "No se encontró .env en $TARGET_DIR"
        
        # Buscar .env en el directorio padre
        if [ -f "/var/www/html/servilab/.env" ]; then
            log_info "Copiando .env desde directorio padre..."
            cp "/var/www/html/servilab/.env" ".env"
        else
            log_error "No se encontró archivo .env en ningún directorio"
            log_error "Necesitas crear un archivo .env con las credenciales de producción"
            exit 1
        fi
    fi
    
    # 4. Verificar y corregir NODE_ENV
    log_info "Verificando NODE_ENV..."
    if grep -q "NODE_ENV" .env; then
        CURRENT_ENV=$(grep "NODE_ENV" .env | cut -d'=' -f2)
        log_info "NODE_ENV actual: $CURRENT_ENV"
        
        if [ "$CURRENT_ENV" != "production" ]; then
            log_warn "NODE_ENV no está en production, corrigiendo..."
            sed -i 's/NODE_ENV=.*/NODE_ENV=production/' .env
            log_info "NODE_ENV actualizado a production"
        fi
    else
        log_info "Agregando NODE_ENV=production..."
        echo "NODE_ENV=production" >> .env
    fi
    
    # 5. Verificar que existan las variables de WAAPI
    log_info "Verificando variables de WAAPI..."
    
    if ! grep -q "WAAPI_INSTANCE_ID" .env; then
        log_error "WAAPI_INSTANCE_ID no encontrada en .env"
        echo "# Necesitas agregar tu WAAPI_INSTANCE_ID de producción" >> .env
        echo "WAAPI_INSTANCE_ID=tu_instance_id_aqui" >> .env
    fi
    
    if ! grep -q "WAAPI_TOKEN" .env; then
        log_error "WAAPI_TOKEN no encontrada en .env"
        echo "# Necesitas agregar tu WAAPI_TOKEN de producción" >> .env
        echo "WAAPI_TOKEN=tu_token_aqui" >> .env
    fi
    
    # 6. Mostrar configuración actual (sin mostrar valores sensibles)
    log_info "Configuración actual:"
    echo "Variables encontradas:"
    grep -E "^[A-Z_]+" .env | cut -d'=' -f1 | sort
    
    # 7. Actualizar código desde repositorio
    log_info "Actualizando código desde repositorio..."
    git fetch origin main
    git reset --hard origin/main
    
    # 8. Instalar dependencias
    log_info "Instalando dependencias..."
    npm ci --production
    
    # 9. Iniciar proceso con PM2
    log_info "Iniciando proceso con PM2..."
    pm2 start server.js --name servilab_notify
    pm2 save
    
    # 10. Esperar y verificar
    log_info "Esperando que el servicio se inicie..."
    sleep 5
    
    # 11. Verificar estado
    log_info "Verificando estado del proceso..."
    pm2 status
    
    # 12. Probar endpoint
    log_info "Probando endpoint de test..."
    if curl -s -f http://localhost:3000/test > /dev/null; then
        log_info "✅ Servicio responde correctamente"
        
        # Mostrar información del environment
        ENVIRONMENT=$(curl -s http://localhost:3000/test | jq -r '.environment // "unknown"' 2>/dev/null || echo "unknown")
        log_info "Environment detectado: $ENVIRONMENT"
    else
        log_error "❌ Servicio no responde"
        echo "Logs recientes:"
        pm2 logs servilab_notify --lines 5
    fi
    
    echo ""
    echo "📋 Resumen de cambios:"
    echo "   - Directorio: $TARGET_DIR"
    echo "   - NODE_ENV: $(grep "NODE_ENV" .env | cut -d'=' -f2)"
    echo "   - Variables WAAPI: $(grep -c "WAAPI_" .env) configuradas"
    echo "   - Proceso PM2: $(pm2 list | grep servilab_notify | awk '{print $12}' || echo 'No encontrado')"
    
    # Verificar si las credenciales parecen ser de desarrollo
    if grep -q "test\|dev\|development" .env; then
        log_warn "⚠️  ADVERTENCIA: El archivo .env parece contener credenciales de desarrollo"
        log_warn "    Revisa manualmente las credenciales de WAAPI"
    fi
EOF

echo ""
log_info "📋 Próximos pasos:"
echo "1. Verificar que las credenciales de WAAPI sean de producción:"
echo "   ssh mi-vm 'grep WAAPI /var/www/html/servilab/notify/.env'"
echo ""
echo "2. Si necesitas actualizar credenciales:"
echo "   ssh mi-vm 'nano /var/www/html/servilab/notify/.env'"
echo ""
echo "3. Reiniciar después de cambios:"
echo "   ssh mi-vm 'pm2 restart servilab_notify'"
echo ""
echo "4. Probar envío de mensaje:"
echo "   ssh mi-vm 'curl -X POST http://localhost:3000/notificacion/turno-confirmado -H \"Content-Type: application/json\" -d \"{\\\"test\\\": true}\"'" 