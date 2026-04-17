/**
 * TurnoFácil — Servidor Principal
 * Express + Socket.io con almacenamiento en memoria
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

app.use(cors());
app.use(express.json());

// Servir archivos estáticos desde /public
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Ruta raíz explícita
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Catch-all: devolver index.html para cualquier ruta no-API (SPA)
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// ============================================================
// BASE DE DATOS EN MEMORIA
// ============================================================
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

const db = {
  users: [
    { id: '1', name: 'Administrador', username: 'admin',     password: 'admin123',   role: 'admin',   active: true, stationId: null, createdAt: now() },
    { id: '2', name: 'Gerente',        username: 'gerente',   password: 'gerente123', role: 'gerente', active: true, stationId: null, createdAt: now() },
    { id: '3', name: 'Cajero 1',       username: 'caja1',     password: '1234',       role: 'agente',  active: true, stationId: '1',  createdAt: now() },
    { id: '4', name: 'Atención 1',     username: 'atencion1', password: '1234',       role: 'agente',  active: true, stationId: '2',  createdAt: now() },
    { id: '5', name: 'Info Desk',      username: 'info1',     password: '1234',       role: 'agente',  active: true, stationId: '3',  createdAt: now() },
  ],
  services: [
    { id: '1', name: 'Caja',                prefix: 'C', color: '#3B82F6', emoji: '💳', active: true, avgTime: 5,  priority: 1, description: 'Pagos, cobros y facturación' },
    { id: '2', name: 'Atención al Cliente',  prefix: 'A', color: '#10B981', emoji: '👤', active: true, avgTime: 10, priority: 2, description: 'Consultas, reclamos y soporte' },
    { id: '3', name: 'Información',          prefix: 'I', color: '#F59E0B', emoji: 'ℹ️', active: true, avgTime: 3,  priority: 3, description: 'Información general y orientación' },
  ],
  stations: [
    { id: '1', name: 'Caja 1',       serviceIds: ['1'],      agentId: '3', active: true },
    { id: '2', name: 'Ventanilla 2', serviceIds: ['2'],      agentId: '4', active: true },
    { id: '3', name: 'Mesa Info',    serviceIds: ['3', '2'], agentId: '5', active: true },
  ],
  tickets: [],
  sessions: {},
  counters: {},
  config: {
    businessName: 'TurnoFácil',
    businessSubtitle: 'Sistema de Gestión de Turnos',
    primaryColor: '#6366F1',
    welcomeMessage: '¡Bienvenido! Seleccione el servicio que necesita.',
    monitorTitle: 'TURNO EN ATENCIÓN',
    footerMessage: 'Gracias por su espera. Lo atenderemos en breve.',
    soundEnabled: true,
    autoReset: false,
    resetTime: '00:00',
    logoUrl: '',
    ticketFooter: 'Conserve este ticket hasta ser atendido.',
  },
};

// Inicializar contadores
db.services.forEach(s => { db.counters[s.prefix] = 0; });

// ============================================================
// HELPERS
// ============================================================
const findUser    = id => db.users.find(u => u.id === id);
const findService = id => db.services.find(s => s.id === id);
const findStation = id => db.stations.find(s => s.id === id);

const getAgentStation = agentId =>
  db.stations.find(s => s.agentId === agentId && s.active);

const todayTickets = () => {
  const today = new Date().toDateString();
  return db.tickets.filter(t => new Date(t.createdAt).toDateString() === today);
};

const getQueueForStation = stationId => {
  const station = findStation(stationId);
  if (!station) return [];
  return todayTickets()
    .filter(t => station.serviceIds.includes(t.serviceId) && t.status === 'waiting')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
};

const getQueueForService = serviceId =>
  todayTickets()
    .filter(t => t.serviceId === serviceId && t.status === 'waiting')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

const emitQueueUpdate = () => {
  const tickets = todayTickets();
  io.emit('queue:update', {
    tickets,
    byService: db.services.map(s => ({
      serviceId: s.id,
      waiting: tickets.filter(t => t.serviceId === s.id && t.status === 'waiting').length,
      attending: tickets.filter(t => t.serviceId === s.id && (t.status === 'called' || t.status === 'attending')).length,
    })),
  });
};

// ============================================================
// AUTENTICACIÓN
// ============================================================
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !db.sessions[token]) return res.status(401).json({ error: 'No autorizado' });
  const user = findUser(db.sessions[token]);
  if (!user || !user.active) return res.status(401).json({ error: 'Sesión inválida' });
  req.user  = user;
  req.token = token;
  next();
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return res.status(403).json({ error: 'Sin permisos suficientes' });
  next();
};

// ============================================================
// RUTAS AUTH
// ============================================================
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.users.find(u =>
    u.username === username && u.password === password && u.active
  );
  if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

  const token = uid();
  db.sessions[token] = user.id;
  const { password: _, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

app.post('/api/auth/logout', authenticate, (req, res) => {
  delete db.sessions[req.token];
  res.json({ ok: true });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const { password, ...u } = req.user;
  res.json(u);
});

// ============================================================
// RUTAS SERVICIOS
// ============================================================
app.get('/api/services', (req, res) => {
  res.json(db.services.filter(s => s.active));
});

app.get('/api/services/all', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  res.json(db.services);
});

app.post('/api/services', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  const svc = { id: uid(), ...req.body, active: true, createdAt: now() };
  db.counters[svc.prefix] = 0;
  db.services.push(svc);
  io.emit('services:update', db.services);
  res.json(svc);
});

app.put('/api/services/:id', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  const idx = db.services.findIndex(s => s.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'No encontrado' });
  db.services[idx] = { ...db.services[idx], ...req.body, id: db.services[idx].id };
  io.emit('services:update', db.services);
  res.json(db.services[idx]);
});

app.delete('/api/services/:id', authenticate, requireRole('admin'), (req, res) => {
  const idx = db.services.findIndex(s => s.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'No encontrado' });
  db.services[idx].active = false;
  io.emit('services:update', db.services);
  res.json({ ok: true });
});

// ============================================================
// RUTAS VENTANILLAS/ESTACIONES
// ============================================================
app.get('/api/stations', authenticate, (req, res) => res.json(db.stations));

app.post('/api/stations', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  const st = { id: uid(), ...req.body, active: true, createdAt: now() };
  db.stations.push(st);
  io.emit('stations:update', db.stations);
  res.json(st);
});

app.put('/api/stations/:id', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  const idx = db.stations.findIndex(s => s.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'No encontrado' });
  db.stations[idx] = { ...db.stations[idx], ...req.body, id: db.stations[idx].id };
  io.emit('stations:update', db.stations);
  res.json(db.stations[idx]);
});

app.delete('/api/stations/:id', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  db.stations = db.stations.filter(s => s.id !== req.params.id);
  io.emit('stations:update', db.stations);
  res.json({ ok: true });
});

// ============================================================
// RUTAS USUARIOS
// ============================================================
app.get('/api/users', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  res.json(db.users.map(({ password, ...u }) => u));
});

app.post('/api/users', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  const { role } = req.body;
  if (req.user.role === 'gerente' && !['agente'].includes(role))
    return res.status(403).json({ error: 'Solo puede crear agentes' });
  if (db.users.find(u => u.username === req.body.username))
    return res.status(400).json({ error: 'El nombre de usuario ya existe' });

  const user = { id: uid(), ...req.body, active: true, createdAt: now() };
  db.users.push(user);
  const { password, ...safe } = user;
  res.json(safe);
});

app.put('/api/users/:id', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  const idx = db.users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'No encontrado' });
  const target = db.users[idx];
  if (req.user.role === 'gerente' && target.role !== 'agente')
    return res.status(403).json({ error: 'Sin permisos sobre este usuario' });

  // Si no envían contraseña nueva, conservar la actual
  const newData = { ...target, ...req.body, id: target.id };
  if (!req.body.password) newData.password = target.password;
  db.users[idx] = newData;
  const { password, ...safe } = db.users[idx];
  res.json(safe);
});

app.delete('/api/users/:id', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  const idx = db.users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'No encontrado' });
  const target = db.users[idx];
  if (req.user.role === 'gerente' && target.role !== 'agente')
    return res.status(403).json({ error: 'Sin permisos' });
  db.users[idx].active = false;
  res.json({ ok: true });
});

// ============================================================
// RUTAS TICKETS
// ============================================================

// Nuevo ticket desde tótem
app.post('/api/tickets', (req, res) => {
  const { serviceId } = req.body || {};
  const service = findService(serviceId);
  if (!service || !service.active) return res.status(400).json({ error: 'Servicio no disponible' });

  db.counters[service.prefix] = (db.counters[service.prefix] || 0) + 1;
  const num = db.counters[service.prefix];
  const numberStr = `${service.prefix}${String(num).padStart(3, '0')}`;
  const queueLen = getQueueForService(serviceId).length;

  const ticket = {
    id: uid(),
    number: numberStr,
    numberRaw: num,
    serviceId,
    serviceName:  service.name,
    serviceColor: service.color,
    serviceEmoji: service.emoji,
    status: 'waiting',
    stationId:   null,
    stationName: null,
    agentId:     null,
    agentName:   null,
    estimatedWait: queueLen * (service.avgTime || 5),
    queuePosition: queueLen + 1,
    redirectedFrom: null,
    createdAt:   now(),
    calledAt:    null,
    attendedAt:  null,
    completedAt: null,
  };

  db.tickets.push(ticket);
  io.emit('ticket:new', ticket);
  emitQueueUpdate();
  res.json(ticket);
});

// Llamar siguiente
app.post('/api/tickets/call-next', authenticate, requireRole('agente'), (req, res) => {
  const station = getAgentStation(req.user.id);
  if (!station) return res.status(400).json({ error: 'Sin ventanilla asignada' });

  // Completar atención actual si existe y notificar al monitor
  const current = db.tickets.find(t =>
    t.agentId === req.user.id && (t.status === 'called' || t.status === 'attending')
  );
  if (current) {
    current.status = 'completed';
    current.completedAt = now();
    io.emit('ticket:completed', current); // ← faltaba este emit
  }

  const queue = getQueueForStation(station.id);
  if (queue.length === 0) return res.status(404).json({ error: 'No hay turnos en espera' });

  const ticket = queue[0];
  ticket.status      = 'called';
  ticket.stationId   = station.id;
  ticket.stationName = station.name;
  ticket.agentId     = req.user.id;
  ticket.agentName   = req.user.name;
  ticket.calledAt    = now();

  io.emit('ticket:called', ticket);
  emitQueueUpdate();
  res.json(ticket);
});

// Re-llamar mismo ticket
app.post('/api/tickets/:id/recall', authenticate, requireRole('agente'), (req, res) => {
  const ticket = db.tickets.find(t => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'No encontrado' });
  if (ticket.agentId !== req.user.id) return res.status(403).json({ error: 'Sin permisos' });
  ticket.calledAt = now();
  io.emit('ticket:called', ticket);
  res.json(ticket);
});

// Iniciar atención
app.post('/api/tickets/:id/attend', authenticate, requireRole('agente'), (req, res) => {
  const ticket = db.tickets.find(t => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'No encontrado' });
  ticket.status     = 'attending';
  ticket.attendedAt = now();
  io.emit('ticket:attending', ticket);
  emitQueueUpdate();
  res.json(ticket);
});

// Finalizar atención
app.post('/api/tickets/:id/complete', authenticate, requireRole('agente'), (req, res) => {
  const ticket = db.tickets.find(t => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'No encontrado' });
  ticket.status      = 'completed';
  ticket.completedAt = now();
  io.emit('ticket:completed', ticket);
  emitQueueUpdate();
  res.json(ticket);
});

// Saltar / ausente
app.post('/api/tickets/:id/skip', authenticate, requireRole('agente'), (req, res) => {
  const ticket = db.tickets.find(t => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'No encontrado' });
  ticket.status      = 'skipped';
  ticket.completedAt = now();
  io.emit('ticket:skipped', ticket);
  emitQueueUpdate();
  res.json(ticket);
});

// Derivar a otro servicio
app.post('/api/tickets/:id/redirect', authenticate, requireRole('agente'), (req, res) => {
  const { targetServiceId } = req.body || {};
  const ticket = db.tickets.find(t => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'No encontrado' });
  const target = findService(targetServiceId);
  if (!target) return res.status(400).json({ error: 'Servicio destino no encontrado' });

  ticket.status         = 'redirected';
  ticket.completedAt    = now();
  ticket.redirectedTo   = targetServiceId;

  db.counters[target.prefix] = (db.counters[target.prefix] || 0) + 1;
  const num = db.counters[target.prefix];
  const newTicket = {
    id: uid(),
    number:        `${target.prefix}${String(num).padStart(3, '0')}`,
    numberRaw:     num,
    serviceId:     targetServiceId,
    serviceName:   target.name,
    serviceColor:  target.color,
    serviceEmoji:  target.emoji,
    status:        'waiting',
    stationId: null, stationName: null, agentId: null, agentName: null,
    redirectedFrom: ticket.id,
    estimatedWait: getQueueForService(targetServiceId).length * (target.avgTime || 5),
    queuePosition: getQueueForService(targetServiceId).length + 1,
    createdAt: now(),
    calledAt: null, attendedAt: null, completedAt: null,
  };

  db.tickets.push(newTicket);
  io.emit('ticket:redirected', { original: ticket, newTicket });
  emitQueueUpdate();
  res.json({ original: ticket, newTicket });
});

// ============================================================
// RUTAS ESTADO AGENTE
// ============================================================
app.get('/api/agent/state', authenticate, requireRole('agente'), (req, res) => {
  const station = getAgentStation(req.user.id);
  if (!station) return res.status(400).json({ error: 'Sin ventanilla asignada' });

  const currentTicket = todayTickets().find(t =>
    t.agentId === req.user.id && (t.status === 'called' || t.status === 'attending')
  );
  const queue         = getQueueForStation(station.id);
  const todayDone     = todayTickets().filter(t =>
    t.agentId === req.user.id && t.status === 'completed'
  );
  const attTimes = todayDone
    .filter(t => t.attendedAt && t.completedAt)
    .map(t => (new Date(t.completedAt) - new Date(t.attendedAt)) / 1000);
  const avgTime = attTimes.length
    ? Math.round(attTimes.reduce((a, b) => a + b, 0) / attTimes.length)
    : 0;

  res.json({
    station,
    currentTicket,
    queue,
    todayCompleted: todayDone.length,
    avgTime,
    services: db.services.filter(s => s.active),
  });
});

// ============================================================
// RUTAS MONITOR / TÓTEM (públicas)
// ============================================================
app.get('/api/monitor/state', (req, res) => {
  const tickets = todayTickets();

  // Últimos llamados: cualquier ticket que haya sido llamado alguna vez
  const recentlyCalled = tickets
    .filter(t => t.calledAt)
    .sort((a, b) => new Date(b.calledAt) - new Date(a.calledAt))
    .slice(0, 8);

  console.log(`[Monitor] tickets hoy: ${tickets.length} | con calledAt: ${recentlyCalled.length}`);

  res.json({
    recentlyCalled,
    waiting: tickets.filter(t => t.status === 'waiting').length,
    services: db.services.filter(s => s.active).map(s => ({
      ...s,
      queueLength: tickets.filter(t => t.serviceId === s.id && t.status === 'waiting').length,
    })),
    config: db.config,
  });
});

// Historial de tickets del agente (paginado, con filtros)
app.get('/api/agent/history', authenticate, requireRole('agente', 'admin', 'gerente'), (req, res) => {
  const { page = 1, perPage = 20, date, status, search } = req.query;
  const agentId = req.user.role === 'agente' ? req.user.id : req.query.agentId;

  let tickets = agentId
    ? db.tickets.filter(t => t.agentId === agentId)
    : db.tickets.filter(t => t.calledAt); // admin/gerente ven todos los llamados

  // Filtro fecha (YYYY-MM-DD)
  if (date) {
    tickets = tickets.filter(t => t.createdAt.slice(0, 10) === date);
  }

  // Filtro estado
  if (status) {
    tickets = tickets.filter(t => t.status === status);
  }

  // Búsqueda por número
  if (search) {
    const q = search.toLowerCase();
    tickets = tickets.filter(t =>
      t.number.toLowerCase().includes(q) ||
      t.serviceName?.toLowerCase().includes(q)
    );
  }

  // Ordenar más reciente primero
  tickets = tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total   = tickets.length;
  const p       = Math.max(1, parseInt(page));
  const pp      = Math.min(100, Math.max(1, parseInt(perPage)));
  const items   = tickets.slice((p - 1) * pp, p * pp);

  res.json({
    items,
    total,
    page: p,
    perPage: pp,
    totalPages: Math.ceil(total / pp),
  });
});
app.get('/api/stats', authenticate, (req, res) => {
  const tickets  = todayTickets();
  const completed = tickets.filter(t => t.status === 'completed');
  const skipped   = tickets.filter(t => t.status === 'skipped');
  const waiting   = tickets.filter(t => t.status === 'waiting');
  const attending = tickets.filter(t => t.status === 'attending' || t.status === 'called');

  const attTimes = completed
    .filter(t => t.attendedAt && t.completedAt)
    .map(t => (new Date(t.completedAt) - new Date(t.attendedAt)) / 1000 / 60);
  const avgAttTime = attTimes.length
    ? (attTimes.reduce((a, b) => a + b, 0) / attTimes.length).toFixed(1)
    : 0;

  const waitTimes = completed
    .filter(t => t.calledAt && t.createdAt)
    .map(t => (new Date(t.calledAt) - new Date(t.createdAt)) / 1000 / 60);
  const avgWaitTime = waitTimes.length
    ? (waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length).toFixed(1)
    : 0;

  const byService = db.services.map(s => ({
    ...s,
    total:     tickets.filter(t => t.serviceId === s.id).length,
    waiting:   tickets.filter(t => t.serviceId === s.id && t.status === 'waiting').length,
    completed: tickets.filter(t => t.serviceId === s.id && t.status === 'completed').length,
    skipped:   tickets.filter(t => t.serviceId === s.id && t.status === 'skipped').length,
  }));

  const byHour = Array.from({ length: 24 }, (_, h) => ({
    hour:  h,
    label: `${String(h).padStart(2, '0')}:00`,
    count: tickets.filter(t => new Date(t.createdAt).getHours() === h).length,
  }));

  const byAgent = db.users
    .filter(u => u.role === 'agente' && u.active)
    .map(u => ({
      id:        u.id,
      name:      u.name,
      completed: tickets.filter(t => t.agentId === u.id && t.status === 'completed').length,
      skipped:   tickets.filter(t => t.agentId === u.id && t.status === 'skipped').length,
      avgTime: (() => {
        const times = tickets
          .filter(t => t.agentId === u.id && t.attendedAt && t.completedAt)
          .map(t => (new Date(t.completedAt) - new Date(t.attendedAt)) / 1000 / 60);
        return times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : 0;
      })(),
    }));

  res.json({
    total: tickets.length,
    waiting: waiting.length,
    attending: attending.length,
    completed: completed.length,
    skipped: skipped.length,
    avgAttTime,
    avgWaitTime,
    byService,
    byHour,
    byAgent,
  });
});

// ============================================================
// RUTAS CONFIGURACIÓN
// ============================================================
app.get('/api/config', (req, res) => res.json(db.config));

app.put('/api/config', authenticate, requireRole('admin'), (req, res) => {
  db.config = { ...db.config, ...req.body };
  io.emit('config:update', db.config);
  res.json(db.config);
});

app.post('/api/admin/reset-counters', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  db.services.forEach(s => { db.counters[s.prefix] = 0; });
  io.emit('system:reset');
  res.json({ ok: true, message: 'Contadores reiniciados' });
});

app.post('/api/admin/reset-queue', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  const openTickets = db.tickets.filter(t =>
    ['waiting', 'called', 'attending'].includes(t.status)
  );
  openTickets.forEach(t => { t.status = 'completed'; t.completedAt = now(); });
  emitQueueUpdate();
  io.emit('system:reset');
  res.json({ ok: true, message: `${openTickets.length} turnos cerrados` });
});

// ============================================================
// SOCKET.IO
// ============================================================
io.on('connection', socket => {
  console.log(`[WS] Cliente conectado: ${socket.id}`);

  // Estado inicial
  const tickets = todayTickets();
  socket.emit('init', {
    tickets,
    services:  db.services,
    stations:  db.stations,
    config:    db.config,
  });

  socket.on('disconnect', () => {
    console.log(`[WS] Cliente desconectado: ${socket.id}`);
  });
});

// ============================================================
// ARRANCAR SERVIDOR
// ============================================================
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log('\n╔═══════════════════════════════════════╗');
  console.log('║          TurnoFácil v1.0               ║');
  console.log('╠═══════════════════════════════════════╣');
  console.log(`║  URL: http://localhost:${PORT}            ║`);
  console.log('╠═══════════════════════════════════════╣');
  console.log(`║  📺 Monitor:   /#/monitor              ║`);
  console.log(`║  🏧 Tótem:     /#/totem                ║`);
  console.log(`║  💼 Agente:    /#/agent                ║`);
  console.log(`║  ⚙️  Admin:     /#/admin                ║`);
  console.log('╠═══════════════════════════════════════╣');
  console.log('║  Usuarios por defecto:                 ║');
  console.log('║  admin / admin123                      ║');
  console.log('║  gerente / gerente123                  ║');
  console.log('║  caja1 / 1234                          ║');
  console.log('║  atencion1 / 1234                      ║');
  console.log('║  info1 / 1234                          ║');
  console.log('╚═══════════════════════════════════════╝\n');
});
