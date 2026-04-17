# TurnoFácil — Documentación para Agentes IA

Proyecto completo de sistema de gestión de turnos para locales. Aplicación full-stack con frontend y backend en un único repositorio.

---

## Proyecto

| Campo | Valor |
|------|------|
| **Nombre** | TurnoFácil |
| **Versión** | 1.0.0 |
| **Descripción** | Sistema de gestión de turnos para locales |
| **Node.js** | Entorno de ejecución |
| **Puerto default** | 3000 |

---

## Estructura de Archivos

```
turnofacil/
├── server.js          # Backend: API REST + WebSockets
├── package.json      # Dependencias y scripts
├── package-lock.json # Lockfile de npm
├── public/
│   └── index.html    # Frontend SPA completo (React + Tailwind)
├── README.md         # Documentación的用户
└── AGENTS.md        # Este archivo
```

---

## Scripts Disponibles

```bash
npm start       # Iniciar servidor (node server.js)
npm run dev    # Desarrollo con nodemon (reinicio automático)
```

---

## Stack Tecnológico

### Backend
- **Runtime**: Node.js
- **Framework**: Express 4.18.2
- **WebSockets**: Socket.io 4.7.2
- **CORS**: cors 2.8.5

### Frontend
- **UI Library**: React 18 (CDN: unpkg.com)
- **Estilos**: Tailwind CSS (CDN: cdn.tailwindcss.com)
- **Transpiler**: Babel Standalone (CDN)
- **WebSockets Client**: Socket.io 4.7.2 (CDN)

### Desarrollo
- **Hot Reload**: nodemon 3.0.2

---

## Ejecutar el Proyecto

```bash
cd /home/alejandro/Descargas/files\ \(2\)
npm install   # Instalar dependencias (ya hecho)
npm start    # Iniciar servidor
```

El servidor arranca en `http://localhost:3000`

---

## Rutas de la Aplicación

| URL | Descripción |
|-----|-------------|
| `http://localhost:3000/` | Página de inicio |
| `http://localhost:3000/#/totem` | Tótem de autoservicio |
| `http://localhost:3000/#/monitor` | Monitor público de turnos |
| `http://localhost:3000/#/agent` | Panel del agente |
| `http://localhost:3000/#/admin` | Panel de administración |

---

## API REST

### Autenticación

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/login` | Iniciar sesión | ❌ |
| POST | `/api/auth/logout` | Cerrar sesión | ✅ |
| GET | `/api/auth/me` | Usuario actual | ✅ |

### Tickets

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| POST | `/api/tickets` | Crear ticket (tótem) | ❌ |
| POST | `/api/tickets/call-next` | Llamar siguiente turno | ✅ (agente) |
| POST | `/api/tickets/:id/recall` | Re-llamar mismo turno | ✅ (agente) |
| POST | `/api/tickets/:id/attend` | Iniciar atención | ✅ (agente) |
| POST | `/api/tickets/:id/complete` | Finalizar atención | ✅ (agente) |
| POST | `/api/tickets/:id/skip` | Marcar ausente | ✅ (agente) |
| POST | `/api/tickets/:id/redirect` | Derivar a otro servicio | ✅ (agente) |

### Servicios

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/api/services` | Lista servicios (activos) | ❌ |
| GET | `/api/services/all` | Todos los servicios | ✅ |
| POST | `/api/services` | Crear servicio | ✅ (admin/gerente) |
| PUT | `/api/services/:id` | Actualizar servicio | ✅ (admin/gerente) |
| DELETE | `/api/services/:id` | Desactivar servicio | ✅ (admin) |

### Ventanillas

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/api/stations` | Lista ventanillas | ✅ |
| POST | `/api/stations` | Crear ventanilla | ✅ (admin/gerente) |
| PUT | `/api/stations/:id` | Actualizar ventanilla | ✅ (admin/gerente) |
| DELETE | `/api/stations/:id` | Eliminar ventanilla | ✅ (admin/gerente) |

### Usuarios

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/api/users` | Lista usuarios | ✅ (admin/gerente) |
| POST | `/api/users` | Crear usuario | ✅ (admin/gerente) |
| PUT | `/api/users/:id` | Actualizar usuario | ✅ (admin/gerente) |
| DELETE | `/api/users/:id` | Desactivar usuario | ✅ (admin/gerente) |

### Estadísticas

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/api/stats` | Estadísticas del día | ✅ |
| GET | `/api/agent/history` | Historial de tickets | ✅ |
| GET | `/api/agent/state` | Estado del agente | ✅ (agente) |

### Configuración

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/api/config` | Configuración actual | ❌ |
| PUT | `/api/config` | Actualizar config | ✅ (admin) |
| POST | `/api/admin/reset-counters` | Reiniciar contadores | ✅ (admin/gerente) |
| POST | `/api/admin/reset-queue` | Cerrar cola | ✅ (admin/gerente) |

### Estado Público

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/api/monitor/state` | Estado del monitor | ❌ |

---

## WebSocket (Socket.io)

### Eventos del Servidor → Cliente

| Evento | Datos | Descripción |
|--------|-------|-------------|
| `init` | `{tickets, services, stations, config}` | Estado inicial |
| `ticket:new` | `ticket` | Nuevo ticket emitido |
| `ticket:called` | `ticket` | Turno llamado |
| `ticket:attending` | `ticket` | Atención iniciada |
| `ticket:completed` | `ticket` | Turno completado |
| `ticket:skipped` | `ticket` | Turno ausente |
| `ticket:redirected` | `{original, newTicket}` | Turno derivado |
| `queue:update` | `{tickets, byService}` | Actualización de cola |
| `config:update` | `config` | Configuración actualizada |
| `services:update` | `services` | Servicios actualizados |
| `stations:update` | `stations` | Ventanillas actualizadas |
| `system:reset` | — | Sistema reiniciado |

---

## Usuarios por Defecto

| Usuario | Contraseña | Rol | Ventanilla |
|---------|-----------|-----|------------|
| admin | admin123 | admin | — |
| gerente | gerente123 | gerente | — |
| caja1 | 1234 | agente | Caja 1 |
| atencion1 | 1234 | agente | Ventanilla 2 |
| info1 | 1234 | agente | Mesa Info |

---

## Roles y Permisos

| Acción | Admin | Gerente | Agente | Cliente |
|--------|-------|---------|--------|---------|
| Gestionar servicios | ✅ | ✅ | ❌ | ❌ |
| Gestionar ventanillas | ✅ | ✅ | ❌ | ❌ |
| Crear/editar agentes | ✅ | ✅ | ❌ | ❌ |
| Crear otros admins | ✅ | ❌ | ❌ | ❌ |
| Ver estadísticas | ✅ | ✅ | ✅* | ❌ |
| Llamar turnos | ❌ | ❌ | ✅ | ❌ |
| Configuración sistema | ✅ | ❌ | ❌ | ❌ |
| Emitir ticket (tótem) | Público | Público | Público | Público |

---

## Datos en Memoria (server.js)

### Estructura de la Base de Datos

```javascript
const db = {
  users: [
    { id, name, username, password, role, active, stationId, createdAt }
  ],
  services: [
    { id, name, prefix, color, emoji, active, avgTime, priority, description }
  ],
  stations: [
    { id, name, serviceIds[], agentId, active }
  ],
  tickets: [
    { id, number, numberRaw, serviceId, serviceName, serviceColor, serviceEmoji,
      status, stationId, stationName, agentId, agentName,
      estimatedWait, queuePosition, redirectedFrom,
      createdAt, calledAt, attendedAt, completedAt }
  ],
  sessions: { token: userId },  // Sesiones activas
  counters: { prefix: número }, // Contadores por prefijo
  config: {
    businessName, businessSubtitle, primaryColor,
    welcomeMessage, monitorTitle, footerMessage,
    soundEnabled, autoReset, resetTime, logoUrl, ticketFooter
  }
}
```

### Estados de Ticket

| Estado | Descripción |
|--------|-------------|
| `waiting` | En espera |
| `called` | Llamado (en pantalla) |
| `attending` | En atención |
| `completed` | Finalizado |
| `skipped` | Ausente |
| `redirected` | Derivado a otro servicio |

---

## Comandos cURL Útiles

### Autenticación
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

### Crear ticket
```bash
curl -X POST http://localhost:3000/api/tickets \
  -H "Content-Type: application/json" \
  -d '{"serviceId":"1"}'
```

### Ver servicios
```bash
curl http://localhost:3000/api/services
```

### Ver estadísticas
```bash
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:3000/api/stats
```

---

## Notas para Desarrollo

1. **Persistencia**: Los datos se pierden al reiniciar el servidor (base de datos en memoria)

2. **Autenticación simple**: Usa tokens simples (UUID) sin expiración

3. **SPA**: El frontend es un solo archivo HTML que usa hash routing (`#/`)

4. **Tailwind CDN**: En producción debería usarse build completo

5. **Audio**: Requiere interacción del usuario para reproducir sonidos (política del navegador)

---

## Dependencias InstALLED

```json
{
  "cors": "^2.8.5",
  "express": "^4.18.2",
  "socket.io": "^4.7.2"
}
```

```json
{
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
```

---

## Archivo server.js - Puntos Clave

- **Líneas**: 659
- **Puerto**: `process.env.PORT || 3000`
- **CORS**: Configurado para permitir todo (`origin: '*'`)
- **Static**: Archivos servidos desde `public/`
- **SPA**: Catch-all route para `/index.html`

---

## Archivo public/index.html - Puntos Clave

- **Tipo**: SPA React sin build
- **React**: v18 (CDN)
- **Tailwind**: v3 (CDN)
- **Babel**: Standalone para JSX
- **Routing**: Basado en hash (`window.location.hash`)
- **Theme**: Soporte claro/oscuro
- **Audio**: Web Audio API para sonidos
- **Toasts**: Sistema de notificaciones

---

## Funcionalidades Implementadas

- [x] Tótem de autoservicio
- [x] Monitor público
- [x] Panel de agente
- [x] Panel de administración
- [x] Autenticación
- [x] Gestión de usuarios
- [x] Gestión de servicios
- [x] Gestión de ventanillas
- [x] Estadísticas en tiempo real
- [x] Tema claro/oscuro
- [x] Sonidos al llamar turno
- [x] Impresión de tickets
- [x] WebSockets para actualización en tiempo real

---

## Mejoras Sugeridas (para futuro)

- [ ] Base de datos persistente (SQLite / PostgreSQL)
- [ ] Autenticación JWT con expiración
- [ ] Historial por fechas con filtros
- [ ] App móvil para cliente
- [ ] Notificaciones push / SMS
- [ ] Exportar reportes a Excel/PDF
- [ ] Múltiples sucursales
- [ ] Encuesta de satisfacción post-atención

---

## Errores Comunes y Soluciones

### "Cannot find module"
```bash
cd /home/alejandro/Descargas/files\ \(2\)
npm install
```

### "Port already in use"
```bash
# Buscar proceso en puerto 3000
lsof -i :3000
# O usar otro puerto
PORT=3001 npm start
```

### "CORS error"
El servidor ya tiene CORS configurado. Verificar que el cliente use la URL correcta.

---

## Contacto / info

Para este proyecto, referirse al `README.md` para documentación adicional del usuario.