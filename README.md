# 🎫 TurnoFácil — Sistema de Gestión de Turnos

Sistema completo para gestionar filas de atención en locales concurridos.
Incluye tótem de autoservicio, monitor público, panel de agente y administración.

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
| `/#/monitor` | 📺 Monitor público de turnos |
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
├── server.js          ← API REST + WebSockets (Node.js + Express + Socket.io)
├── package.json
├── public/
│   └── index.html     ← SPA React (todas las pantallas en un archivo)
└── README.md
```

### Stack técnico

- **Backend:** Node.js + Express 4 + Socket.io 4
- **Frontend:** React 18 (CDN) + Tailwind CSS (CDN) + Babel Standalone
- **Comunicación:** REST API + WebSockets en tiempo real
- **Datos:** En memoria (reinicia con el servidor)

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
  │              │  🔔 Sonido en monitor      │
  │              └───────────────────────────┘
  │                    │
  │              ┌─────┴─────────┐
  │              │  Opciones:    │
  │              │  ▶ Atender    │ → estado: attending
  │              │  🔊 Re-llamar │ → vuelve a sonar
  │              │  ⏭ Ausente   │ → estado: skipped
  │              │  ↪ Derivar   │ → nuevo ticket otro svc
  │              └───────────────┘
  │                    │
  │              ┌─────┴──────────┐
  │              │ ✓ Finalizar    │ → estado: completed
  │              └────────────────┘
```

---

## 📡 API REST

### Autenticación
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/auth/login` | Iniciar sesión |
| POST | `/api/auth/logout` | Cerrar sesión |
| GET  | `/api/auth/me` | Usuario actual |

### Tickets
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/tickets` | Crear ticket (tótem) |
| POST | `/api/tickets/call-next` | Llamar siguiente turno |
| POST | `/api/tickets/:id/recall` | Re-llamar mismo turno |
| POST | `/api/tickets/:id/attend` | Iniciar atención |
| POST | `/api/tickets/:id/complete` | Finalizar atención |
| POST | `/api/tickets/:id/skip` | Turno ausente |
| POST | `/api/tickets/:id/redirect` | Derivar a otro servicio |

### Consultas públicas (sin autenticación)
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/services` | Servicios activos (para tótem) |
| GET | `/api/monitor/state` | Estado del monitor |

### Gestión (requiere auth)
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET/POST/PUT/DELETE | `/api/users` | Gestión de usuarios |
| GET/POST/PUT/DELETE | `/api/services` | Gestión de servicios |
| GET/POST/PUT/DELETE | `/api/stations` | Gestión de ventanillas |
| GET/PUT | `/api/config` | Configuración del sistema |
| GET | `/api/stats` | Estadísticas del día |

### WebSocket Events (Socket.io)
| Evento | Descripción |
|--------|-------------|
| `ticket:new` | Nuevo ticket emitido |
| `ticket:called` | Turno llamado |
| `ticket:attending` | Atención iniciada |
| `ticket:completed` | Turno finalizado |
| `ticket:skipped` | Turno marcado ausente |
| `ticket:redirected` | Turno derivado |
| `queue:update` | Actualización general de la cola |
| `config:update` | Cambio de configuración |

---

## 👥 Permisos por rol

| Acción | Admin | Gerente | Agente | Cliente |
|--------|-------|---------|--------|---------|
| Gestionar servicios | ✅ | ✅ | ❌ | ❌ |
| Gestionar ventanillas | ✅ | ✅ | ❌ | ❌ |
| Crear/editar agentes | ✅ | ✅ | ❌ | ❌ |
| Crear otros roles | ✅ | ❌ | ❌ | ❌ |
| Ver estadísticas | ✅ | ✅ | ✅* | ❌ |
| Llamar turnos | ❌ | ❌ | ✅ | ❌ |
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

## 💡 Próximas mejoras sugeridas

- [ ] Base de datos persistente (SQLite / PostgreSQL)
- [ ] Autenticación JWT con expiración
- [ ] Historial por fechas con filtros
- [ ] App móvil para cliente (tomar número desde el celular)
- [ ] Notificaciones push / SMS cuando el turno se acerca
- [ ] Exportar reportes a Excel/PDF
- [ ] Múltiples sucursales
- [ ] Pantalla de encuesta de satisfacción post-atención
