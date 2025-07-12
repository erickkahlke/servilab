#!/bin/bash

# Script de verificación remota para ServiLab API
# Verifica el estado del servidor desde la máquina local

set -e

echo "🔍 Verificando estado remoto de ServiLab API..."

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

# Ejecutar verificación completa en el servidor
log_info "Ejecutando verificación en el servidor..."
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
    
    echo "🔍 Verificación completa del servidor..."
    
    # Verificar PM2
    log_info "Verificando procesos PM2..."
    if command -v pm2 &> /dev/null; then
        pm2 list
        echo ""
        
        # Verificar proceso específico
        if pm2 show servilab_notify &> /dev/null; then
            if pm2 list | grep -q "servilab_notify.*online"; then
                log_info "✅ Proceso servilab_notify está corriendo"
            else
                log_error "❌ Proceso servilab_notify no está corriendo"
                echo "Logs recientes:"
                pm2 logs servilab_notify --lines 5
            fi
        else
            log_error "❌ Proceso servilab_notify no está registrado"
        fi
    else
        log_error "❌ PM2 no está instalado"
    fi
    
    # Verificar puerto 3000
    log_info "Verificando puerto 3000..."
    if netstat -tlnp | grep -q ":3000"; then
        log_info "✅ Puerto 3000 está en uso"
    else
        log_error "❌ Puerto 3000 no está en uso"
    fi
    
    # Verificar conectividad directa
    log_info "Verificando conectividad directa..."
    if curl -s -f http://localhost:3000/test > /dev/null; then
        log_info "✅ Servicio responde correctamente en puerto 3000"
    else
        log_error "❌ El servicio no responde en puerto 3000"
    fi
    
    # Verificar nginx
    if command -v nginx &> /dev/null; then
        log_info "Verificando nginx..."
        if systemctl is-active --quiet nginx; then
            log_info "✅ Nginx está corriendo"
            
            # Verificar proxy
            if curl -s -f http://localhost/servilab/test > /dev/null; then
                log_info "✅ Proxy de nginx funciona correctamente"
            else
                log_error "❌ Proxy de nginx no responde"
            fi
        else
            log_error "❌ Nginx no está corriendo"
        fi
    else
        log_warn "⚠️ Nginx no está instalado"
    fi
    
    # Verificar estructura de directorios
    log_info "Verificando estructura de directorios..."
    if [ -d "/var/www/html/servilab/notify" ]; then
        log_info "✅ Directorio notify existe"
        
        # Verificar archivos importantes
        cd /var/www/html/servilab/notify
        if [ -f "server.js" ]; then
            log_info "✅ server.js existe"
        else
            log_error "❌ server.js no encontrado"
        fi
        
        if [ -f ".env" ]; then
            log_info "✅ .env existe"
        else
            log_warn "⚠️ .env no encontrado"
        fi
        
        if [ -d ".data" ]; then
            log_info "✅ .data existe"
        else
            log_warn "⚠️ .data no encontrado"
        fi
    else
        log_error "❌ Directorio notify no existe"
    fi
    
    # Verificar uso de recursos
    log_info "Verificando uso de recursos..."
    echo "Memoria:"
    free -h
    echo ""
    echo "CPU:"
    top -bn1 | grep "Cpu(s)" | head -n1
    echo ""
    echo "Espacio en disco:"
    df -h /var/www/html/
    
    echo ""
    echo "📋 Resumen:"
    echo "   - PM2: $(pm2 list | grep servilab_notify | awk '{print $12}' || echo 'N/A')"
    echo "   - Puerto 3000: $(netstat -tlnp | grep -q ":3000" && echo "✅ En uso" || echo "❌ Libre")"
    echo "   - Nginx: $(systemctl is-active nginx 2>/dev/null || echo "inactive")"
    echo "   - Directorio: $(test -d /var/www/html/servilab/notify && echo "✅ Existe" || echo "❌ No existe")"
    echo ""
    echo "📋 URLs:"
    echo "   - Directo: http://localhost:3000/test"
    echo "   - Nginx: http://localhost/servilab/test"
    echo "   - Docs: http://localhost/servilab/docs"
EOF

echo ""
log_info "🎉 Verificación remota completada!"
echo ""
log_info "📋 Comandos útiles:"
echo "   - Conectar: ssh mi-vm"
echo "   - Verificar estado: ./remote_check.sh"
echo "   - Ver logs: ssh mi-vm 'pm2 logs servilab_notify'"
echo "   - Reiniciar: ssh mi-vm 'pm2 restart servilab_notify'" 