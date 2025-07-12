# 🚀 Scripts de Migración - ServiLab API

Scripts para migrar el proyecto ServiLab de `/var/www/html/servilab/` a `/var/www/html/servilab/notify/`

## 📋 Archivos disponibles

### Scripts remotos (ejecutar desde tu máquina local)
- **`remote_migration.sh`** - Ejecuta la migración completa remotamente
- **`remote_check.sh`** - Verifica el estado del servidor remotamente

### Scripts locales (ejecutar en el servidor)
- **`migrate_to_notify.sh`** - Migración completa (ejecutar en el servidor)
- **`check_deployment.sh`** - Verificación completa (ejecutar en el servidor)

### Documentación
- **`migration_guide.md`** - Guía detallada paso a paso
- **`MIGRATION_README.md`** - Este archivo

## 🎯 Opción recomendada: Migración remota

La forma más fácil es usar el script remoto desde tu máquina local:

```bash
# Ejecutar migración completa remotamente
./remote_migration.sh

# Verificar estado remotamente
./remote_check.sh
```

## 🛠️ Uso paso a paso

### 1. Preparación
Asegúrate de que puedas conectarte al servidor:
```bash
ssh mi-vm
```

### 2. Migración
Ejecuta la migración completa:
```bash
./remote_migration.sh
```

Este script:
- ✅ Verifica la conexión SSH
- ✅ Detiene el proceso PM2 actual
- ✅ Migra datos persistentes (.data)
- ✅ Migra variables de entorno (.env)
- ✅ Actualiza el código desde el repositorio
- ✅ Instala dependencias
- ✅ Inicia el servicio con PM2
- ✅ Verifica que todo funcione

### 3. Verificación
Verifica que todo esté funcionando:
```bash
./remote_check.sh
```

## 🔧 Comandos útiles

### Desde tu máquina local:
```bash
# Conectar al servidor
ssh mi-vm

# Ver logs del servicio
ssh mi-vm 'pm2 logs servilab_notify'

# Reiniciar el servicio
ssh mi-vm 'pm2 restart servilab_notify'

# Ver estado de PM2
ssh mi-vm 'pm2 status'

# Probar el servicio
ssh mi-vm 'curl http://localhost:3000/test'
```

### Desde el servidor:
```bash
# Ver logs
pm2 logs servilab_notify

# Reiniciar
pm2 restart servilab_notify

# Estado
pm2 status

# Verificación completa
./check_deployment.sh
```

## 📊 Arquitectura después de la migración

```
/var/www/html/
├── servilab/
│   └── notify/          ← Código del proyecto aquí
│       ├── server.js
│       ├── .env
│       ├── .data/
│       └── ...
└── via/
    └── wise/           ← Otro microservicio
        └── ...
```

### Configuración PM2:
- **Proceso**: `servilab_notify`
- **Puerto**: 3000
- **Ruta**: `/var/www/html/servilab/notify/server.js`

### Configuración Nginx:
- **Location**: `/servilab/` → `servilab_notify` (puerto 3000)
- **URLs públicas**: 
  - `http://tu-servidor/servilab/test`
  - `http://tu-servidor/servilab/docs`

## 🚨 Troubleshooting

### Problema: "No se pudo conectar al servidor"
```bash
# Verificar conexión SSH
ssh mi-vm

# Si no funciona, revisar configuración SSH
cat ~/.ssh/config
```

### Problema: "El servicio no responde"
```bash
# Ver logs del servicio
ssh mi-vm 'pm2 logs servilab_notify'

# Reiniciar el servicio
ssh mi-vm 'pm2 restart servilab_notify'

# Verificar puerto
ssh mi-vm 'netstat -tlnp | grep :3000'
```

### Problema: "Nginx no responde"
```bash
# Verificar estado de nginx
ssh mi-vm 'systemctl status nginx'

# Reiniciar nginx
ssh mi-vm 'sudo systemctl restart nginx'

# Verificar configuración
ssh mi-vm 'sudo nginx -t'
```

## 📝 Notas importantes

1. **Backup automático**: Los scripts migran automáticamente datos del directorio anterior
2. **Sin downtime**: El proceso minimiza el tiempo de inactividad
3. **Verificación automática**: Todos los scripts incluyen verificaciones
4. **Rollback**: Si algo sale mal, puedes restaurar desde el directorio anterior

## 🎉 Después de la migración

Una vez completada la migración exitosamente:

1. El workflow de GitHub Actions ya está configurado para el nuevo directorio
2. Todos los deployments futuros se harán automáticamente en `servilab/notify/`
3. Puedes eliminar archivos antiguos del directorio `/var/www/html/servilab/` (excepto `notify/`)

¡La migración está completa! 🚀 