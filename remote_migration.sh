#!/bin/bash

# Script de migración remota para ServiLab API
# Ejecuta la migración completa desde la máquina local

set -e

echo "🚀 Iniciando migración remota de ServiLab API..."

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Función para logs
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Verificar conexión SSH
log_info "Verificando conexión SSH..."
if ! ssh mi-vm 'echo "✅ Conexión SSH exitosa"' 2>/dev/null; then
    log_error "❌ No se pudo conectar al servidor"
    log_error "Verifica que puedas conectarte con: ssh mi-vm"
    exit 1
fi

# Verificar que el directorio notify existe
log_info "Verificando estructura de directorios..."
if ! ssh mi-vm 'test -d /var/www/html/servilab/notify'; then
    log_error "❌ El directorio /var/www/html/servilab/notify no existe"
    log_error "Asegúrate de que el código esté en el directorio correcto"
    exit 1
fi

# Ejecutar migración completa
log_info "Ejecutando migración en el servidor..."
ssh mi-vm << 'EOF'
    set -e
    
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
    
    # Cambiar al directorio del proyecto
    cd /var/www/html/servilab/notify
    
    log_info "Verificando procesos PM2 actuales..."
    pm2 list
    
    # Detener proceso PM2 actual
    log_info "Deteniendo proceso PM2 actual..."
    pm2 delete servilab_notify || true
    
    # Migrar datos persistentes si existen
    OLD_DATA_DIR="/var/www/html/servilab/.data"
    NEW_DATA_DIR="/var/www/html/servilab/notify/.data"
    
    if [ -d "$OLD_DATA_DIR" ]; then
        log_info "Migrando datos persistentes..."
        cp -r "$OLD_DATA_DIR" "$NEW_DATA_DIR"
        log_info "Datos migrados exitosamente"
    else
        log_warn "No se encontraron datos persistentes en el directorio anterior"
    fi
    
    # Migrar variables de entorno
    if [ ! -f ".env" ]; then
        OLD_ENV_FILE="/var/www/html/servilab/.env"
        if [ -f "$OLD_ENV_FILE" ]; then
            log_info "Copiando archivo .env del directorio anterior..."
            cp "$OLD_ENV_FILE" ".env"
        else
            log_warn "No se encontró archivo .env"
        fi
    fi
    
    # Actualizar código desde repositorio
    log_info "Actualizando código desde repositorio..."
    git fetch origin main
    git reset --hard origin/main
    
    # Instalar dependencias
    log_info "Instalando dependencias..."
    npm ci --production
    
    # Iniciar aplicación con PM2
    log_info "Iniciando aplicación con PM2..."
    pm2 start /var/www/html/servilab/notify/server.js --name servilab_notify
    pm2 save
    
    # Verificar estado
    log_info "Verificando estado de la aplicación..."
    sleep 3
    pm2 status
    
    # Probar conectividad
    log_info "Probando conectividad..."
    if curl -s -f http://localhost:3000/test > /dev/null; then
        log_info "✅ Servicio responde correctamente en puerto 3000"
    else
        log_error "❌ El servicio no responde en puerto 3000"
        pm2 logs servilab_notify --lines 10
        exit 1
    fi
    
    # Probar nginx si está disponible
    if command -v nginx &> /dev/null; then
        if curl -s -f http://localhost/servilab/test > /dev/null; then
            log_info "✅ Nginx está funcionando correctamente"
        else
            log_warn "⚠️ Nginx no responde - verificar configuración"
        fi
    fi
    
    log_info "✅ Migración completada exitosamente!"
EOF

# Verificación final desde local
log_info "Haciendo verificación final..."
ssh mi-vm << 'EOF'
    echo ""
    echo "📋 Resumen del estado:"
    echo "   - Proceso PM2: servilab_notify"
    echo "   - Puerto: 3000"
    echo "   - Ruta: /var/www/html/servilab/notify/"
    echo ""
    echo "📋 Estado actual:"
    pm2 list | grep servilab_notify
    echo ""
    echo "📋 URLs disponibles:"
    echo "   - Directo: http://localhost:3000/test"
    echo "   - A través de nginx: http://localhost/servilab/test"
    echo "   - Documentación: http://localhost/servilab/docs"
EOF

echo ""
log_info "🎉 Migración remota completada exitosamente!"
echo ""
log_info "📋 Comandos útiles para el servidor:"
echo "   - Conectar: ssh mi-vm"
echo "   - Ver logs: ssh mi-vm 'pm2 logs servilab_notify'"
echo "   - Reiniciar: ssh mi-vm 'pm2 restart servilab_notify'"
echo "   - Estado: ssh mi-vm 'pm2 status'"
echo "   - Verificar: ssh mi-vm 'curl http://localhost:3000/test'" 