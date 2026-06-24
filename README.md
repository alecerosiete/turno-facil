# 🎫 TurnoFácil — Sistema de Gestión de Turnos

Sistema completo para gestionar filas de atención en locales concurridos.
Incluye tótem de autoservicio, monitor público, panel de agente y administración con persistencia SQLite, API Keys y documentación Swagger.

---

## 🚀 Instalación y arranque

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar el servidor
npm start

# 3. Abrir en el navegador
http://localhost:3000
```

---

## 📱 Pantallas disponibles

| URL | Descripción |
|-----|-------------|
| `/#/`        | Página de inicio con accesos directos |
| `/#/totem`   | 🏧 Tótem de autoservicio (pantalla táctil) |
| `/#/monitor` | 📺 Monitor público de turnos (con TTS) |
| `/#/agent`   | 💼 Panel del agente de atención |
| `/#/admin`   | ⚙️  Panel de administración |

---

## 👤 Usuarios por defecto

| Usuario | Contraseña | Rol |
|---------|-----------|-----|
| `admin` | `admin123` | Administrador |
| `gerente` | `gerente123` | Gerente |
| `caja1` | `1234` | Agente (Caja 1) |
| `atencion1` | `1234` | Agente (Ventanilla 2) |
| `info1` | `1234` | Agente (Mesa Info) |

---

## 🏗️ Arquitectura

```
turnofacil/
├── server.js          ← API REST + WebSockets (Express + Socket.io)
├── database.js        ← Módulo SQLite (WAL mode, schema, seed)
├── package.json
├── data/
│   └── turnofacil.db  ← Base de datos SQLite (se crea sola)
├── public/
│   └── index.html     ← SPA React (todas las pantallas en un archivo)
├── AGENTS.md          ← Documentación para asistentes IA
└── README.md
```

### Stack técnico

- **Backend:** Node.js + Express 4 + Socket.io 4
- **Frontend:** React 18 (CDN) + Tailwind CSS (CDN) + Babel Standalone 7
- **Base de datos:** SQLite (better-sqlite3) con WAL mode
- **Autenticación:** Sesiones con UUID + bcryptjs (hash de contraseñas)
- **API Keys:** Prefijo `tf_` + bcrypt hash, gestión desde panel admin
- **Documentación:** Swagger UI 5.17.14 embebido en el panel admin
- **Comunicación:** REST API + WebSockets en tiempo real
- **TTS:** Web Speech API para anunciar turnos en el monitor

---

## 🔄 Ciclo de vida de un turno

```
TÓTEM                AGENTE              MONITOR
  │                    │                    │
  ├─ Cliente elige      │                    │
  │  servicio          │                    │
  │                    │                    │
  ├─ Ticket generado   │                    │
  │  (estado: waiting) │                    │
  │                    │                    │
  │              ┌─────┴─────────────────────┐
  │              │  Agente llama siguiente    │
  │              │  (estado: called)          │
  │              │  🔔 Sonido + voz TTS      │
  │              └───────────────────────────┘
  │                    │
  │              ┌─────┴─────────┐
  │              │  Opciones:    │
  │              │  ▶ Atender    │ → estado: attending
  │              │  🔊 Re-llamar │ → vuelve a sonar
  │              │  ⏭ Ausente   │ → estado: skipped
  │              │  ↪ Derivar   │ → nuevo ticket otro svc
  │              │  📝 Notas    │ → bitácora por ticket
  │              └───────────────┘
  │                    │
  │              ┌─────┴──────────┐
  │              │ ✓ Finalizar    │ → estado: completed
  │              └────────────────┘
```

---

## ✨ Nuevas funcionalidades

### 🗄️ Persistencia SQLite
- Base de datos local en `data/turnofacil.db` (se crea automáticamente)
- WAL (Write-Ahead Logging) para integridad ante cortes inesperados
- Datos persistentes entre reinicios del servidor
- Contraseñas con hash bcrypt (no texto plano)

### 📝 Notas por ticket (bitácora)
- Notas múltiples por ticket, visibles en el panel del agente
- Autor y timestamp en cada nota
- Columna con badge contador en historial (Admin y Agente)
- Endpoints `GET/POST /api/tickets/:id/notes`

### 🔊 Text-to-Speech (TTS)
- Anuncio por voz del ticket llamado y la ventanilla de atención
- Ejemplo: *"Ticket C001, atención en Caja 1"*
- Voz precargada al iniciar la aplicación
- Compatible con navegadores basados en Chromium

### 🔑 API Keys
- Generación de claves con prefijo `tf_` + 48 caracteres hex
- Hash bcrypt almacenado (la clave raw solo se muestra una vez)
- Gestión completa desde el panel de administración (crear, copiar, revocar)
- Acceso funcional a todos los endpoints del sistema
- Endpoints sensibles protegidos (gestión de usuarios, API keys, config)
- Compatibles con agentes: soporte de `stationId`/`agentId` opcional

### 📖 Documentación Swagger UI
- Especificación OpenAPI 3.0.3 generada dinámicamente
- Todos los endpoints documentados con schemas y ejemplos
- Embebido en el panel de administración (pestaña "Documentación")
- Tema oscuro adaptado automáticamente al sistema

---

## 📡 API REST

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
| GET | `/api/tickets/:id/notes` | Obtener notas del ticket | ✅ |
| POST | `/api/tickets/:id/notes` | Agregar nota al ticket | ✅ |

### Servicios
| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/api/services` | Servicios activos (público) | ❌ |
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

### API Keys
| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/api/api-keys` | Listar API keys | ✅ (admin) |
| POST | `/api/api-keys` | Crear API key | ✅ (admin) |
| DELETE | `/api/api-keys/:id` | Revocar API key | ✅ (admin) |

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
| PUT | `/api/config` | Actualizar configuración | ✅ (admin) |
| POST | `/api/admin/reset-counters` | Reiniciar contadores | ✅ (admin/gerente) |
| POST | `/api/admin/reset-queue` | Cerrar cola | ✅ (admin/gerente) |

### Estado Público
| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/api/monitor/state` | Estado del monitor | ❌ |

### Documentación
| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/api/docs/swagger.json` | Especificación OpenAPI | ❌ |

---

## 📡 WebSocket Events (Socket.io)

| Evento | Datos | Descripción |
|--------|-------|-------------|
| `init` | `{tickets, services, stations, config}` | Estado inicial |
| `ticket:new` | `ticket` | Nuevo ticket emitido |
| `ticket:called` | `ticket` | Turno llamado |
| `ticket:attending` | `ticket` | Atención iniciada |
| `ticket:completed` | `ticket` | Turno finalizado |
| `ticket:skipped` | `ticket` | Turno marcado ausente |
| `ticket:redirected` | `{original, newTicket}` | Turno derivado |
| `queue:update` | `{tickets, byService}` | Actualización general de cola |
| `config:update` | `config` | Cambio de configuración |
| `services:update` | `services` | Servicios actualizados |
| `stations:update` | `stations` | Ventanillas actualizadas |
| `system:reset` | — | Sistema reiniciado |

---

## 🔑 Autenticación con API Keys

Las API Keys permiten integración con sistemas externos sin necesidad de credenciales de usuario.

### Uso

```bash
# Reemplazar TOKEN por la API Key
curl -H "Authorization: Bearer tf_abc123..." http://localhost:3000/api/stats
```

### Para agentes automatizados

Los endpoints de agente aceptan `stationId` y `agentId` opcionales:

```bash
# Llamar siguiente turno en Caja 1 (stationId: 1)
curl -X POST http://localhost:3000/api/tickets/call-next \
  -H "Authorization: Bearer tf_abc123..." \
  -H "Content-Type: application/json" \
  -d '{"stationId": "1"}'
```

### Generación

Admin → pestaña "🔑 API Keys" → "Generar nueva API Key"

---

## 👥 Permisos por rol

| Acción | Admin | Gerente | Agente | API Key |
|--------|-------|---------|--------|---------|
| Gestionar servicios | ✅ | ✅ | ❌ | ✅ |
| Gestionar ventanillas | ✅ | ✅ | ❌ | ✅ |
| Crear/editar agentes | ✅ | ✅ | ❌ | ❌ |
| Gestionar API Keys | ✅ | ❌ | ❌ | ❌ |
| Ver estadísticas | ✅ | ✅ | ✅* | ✅ |
| Llamar turnos | ❌ | ❌ | ✅ | ✅ |
| Configuración del sistema | ✅ | ❌ | ❌ | ❌ |
| Reiniciar cola/contadores | ✅ | ✅ | ❌ | ❌ |
| Emitir ticket (tótem) | Público | Público | Público | Público |

---

## 🖨️ Impresión de tickets

La impresión funciona vía `window.print()` con CSS de impresión incluido.
Compatible con:
- Impresoras de tickets USB/red (80mm o 72mm)
- Cualquier impresora PDF
- Impresoras de red que respondan al diálogo de impresión del navegador

---

## 🧪 Probar con cURL

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

### Ver estadísticas (con API Key)
```bash
curl -H "Authorization: Bearer tf_<tu-key-aqui>" \
  http://localhost:3000/api/stats
```

---

## 💡 Próximas mejoras sugeridas

- [ ] Autenticación JWT con expiración
- [ ] Historial por fechas con filtros
- [ ] App móvil para cliente (tomar número desde el celular)
- [ ] Notificaciones push / SMS cuando el turno se acerca
- [ ] Exportar reportes a Excel/PDF
- [ ] Múltiples sucursales
- [ ] Pantalla de encuesta de satisfacción post-atención
