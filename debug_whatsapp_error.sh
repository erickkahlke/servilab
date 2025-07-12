#!/bin/bash

# Script para diagnosticar problema de WhatsApp API
# Verifica configuración y credenciales

echo "🔍 Diagnosticando problema de WhatsApp API..."

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

log_info "Ejecutando diagnóstico en el servidor..."

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
    
    echo "🔍 Diagnosticando configuración de WhatsApp..."
    
    # 1. Verificar procesos PM2
    log_info "Verificando procesos PM2..."
    pm2 list
    echo ""
    
    # 2. Verificar cual proceso está corriendo
    log_info "Verificando proceso servilab_notify..."
    if pm2 show servilab_notify &> /dev/null; then
        echo "📍 Información del proceso:"
        pm2 show servilab_notify | grep -E "(script|cwd|exec_mode|status|pid|pm2_env)"
        echo ""
    else
        log_error "Proceso servilab_notify no encontrado"
    fi
    
    # 3. Verificar directorio y variables de entorno
    log_info "Verificando directorio y variables de entorno..."
    
    # Verificar directorio actual del proceso
    if [ -d "/var/www/html/servilab/notify" ]; then
        log_info "Directorio notify existe"
        cd /var/www/html/servilab/notify
        
        if [ -f ".env" ]; then
            log_info "Archivo .env encontrado en /var/www/html/servilab/notify/"
            echo "Variables de entorno (sin valores):"
            grep -E "^[A-Z_]+" .env | cut -d'=' -f1 | sort
        else
            log_warn "No se encontró .env en /var/www/html/servilab/notify/"
        fi
    fi
    
    # Verificar si hay .env en el directorio padre
    if [ -f "/var/www/html/servilab/.env" ]; then
        log_warn "Se encontró .env en /var/www/html/servilab/ (directorio padre)"
        cd /var/www/html/servilab/
        echo "Variables de entorno en directorio padre:"
        grep -E "^[A-Z_]+" .env | cut -d'=' -f1 | sort
    fi
    
    # 4. Verificar puerto 3000
    log_info "Verificando puerto 3000..."
    if netstat -tlnp | grep ":3000" | head -1; then
        log_info "Puerto 3000 está en uso"
    else
        log_error "Puerto 3000 no está en uso"
    fi
    
    # 5. Verificar logs recientes
    log_info "Verificando logs recientes..."
    echo "Últimas 10 líneas de logs:"
    pm2 logs servilab_notify --lines 10
    
    # 6. Verificar NODE_ENV
    log_info "Verificando NODE_ENV..."
    if [ -f "/var/www/html/servilab/notify/.env" ]; then
        cd /var/www/html/servilab/notify
        NODE_ENV_VALUE=$(grep "NODE_ENV" .env 2>/dev/null | cut -d'=' -f2)
        if [ -n "$NODE_ENV_VALUE" ]; then
            log_info "NODE_ENV configurado como: $NODE_ENV_VALUE"
        else
            log_warn "NODE_ENV no está configurado"
        fi
    fi
    
    # 7. Verificar endpoint de test
    log_info "Probando endpoint de test..."
    if curl -s http://localhost:3000/test > /dev/null; then
        log_info "✅ Endpoint /test responde"
        echo "Respuesta del endpoint:"
        curl -s http://localhost:3000/test | jq '.environment // .NODE_ENV // empty' 2>/dev/null || echo "No se pudo obtener información del environment"
    else
        log_error "❌ Endpoint /test no responde"
    fi
    
    echo ""
    echo "📋 Resumen del diagnóstico:"
    echo "   - Proceso PM2: $(pm2 list | grep servilab_notify | awk '{print $12}' 2>/dev/null || echo 'No encontrado')"
    echo "   - Directorio: $(pm2 show servilab_notify 2>/dev/null | grep 'exec cwd' | awk '{print $4}' || echo 'No disponible')"
    echo "   - Puerto 3000: $(netstat -tlnp | grep -q ":3000" && echo "En uso" || echo "Libre")"
    echo "   - NODE_ENV: $(grep "NODE_ENV" /var/www/html/servilab/notify/.env 2>/dev/null | cut -d'=' -f2 || echo 'No configurado')"
EOF

echo ""
log_info "📋 Posibles soluciones:"
echo "1. Si está corriendo desde el directorio incorrecto:"
echo "   ./remote_migration.sh"
echo ""
echo "2. Si el .env tiene credenciales de desarrollo:"
echo "   ssh mi-vm 'nano /var/www/html/servilab/notify/.env'"
echo "   # Actualizar WAAPI_TOKEN y WAAPI_INSTANCE_ID con valores de producción"
echo ""
echo "3. Si NODE_ENV no está en production:"
echo "   ssh mi-vm 'echo \"NODE_ENV=production\" >> /var/www/html/servilab/notify/.env'"
echo ""
echo "4. Reiniciar el proceso después de cambios:"
echo "   ssh mi-vm 'pm2 restart servilab_notify'" 