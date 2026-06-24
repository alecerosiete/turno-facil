require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const database = require('./database');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

app.use(cors());
app.use(express.json());

const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// ============================================================
// BASE DE DATOS SQLite (WAL mode = crash-safe)
// ============================================================
const db = database.init();

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// Stmt cache para prepared statements de uso frecuente
const stmts = {
  userById:       db.prepare('SELECT * FROM users WHERE id = ?'),
  userByUsername: db.prepare('SELECT * FROM users WHERE username = ? AND active = 1'),
  serviceById:    db.prepare('SELECT * FROM services WHERE id = ?'),
  stationById:    db.prepare('SELECT * FROM stations WHERE id = ?'),
  allServices:    db.prepare('SELECT * FROM services'),
  activeServices: db.prepare('SELECT * FROM services WHERE active = 1'),
  allStations:    db.prepare('SELECT * FROM stations'),
  allActiveUsers: db.prepare('SELECT * FROM users WHERE active = 1'),
  updateTicketStatus: db.prepare('UPDATE tickets SET status = ?, calledAt = ?, attendedAt = ?, completedAt = ?, stationId = ?, stationName = ?, agentId = ?, agentName = ? WHERE id = ?'),
  keyById:        db.prepare('SELECT * FROM api_keys WHERE id = ?'),
  allKeys:        db.prepare('SELECT * FROM api_keys ORDER BY createdAt DESC'),
};

// ============================================================
// HELPERS
// ============================================================
const findUser    = id => stmts.userById.get(id) || null;
const findService = id => stmts.serviceById.get(id) || null;

const formatStation = st => st ? { ...st, serviceIds: JSON.parse(st.serviceIds || '[]') } : null;
const formatStations = list => list.map(formatStation);

const findStation = id => formatStation(stmts.stationById.get(id) || null);

const getAgentStation = agentId => {
  // Buscar por agentId en la ventanilla (asignación desde Ventanillas)
  let station = formatStation(db.prepare('SELECT * FROM stations WHERE agentId = ? AND active = 1').get(agentId));
  if (station) return station;
  // Fallback: buscar por stationId en el usuario (asignación desde Usuarios)
  const user = findUser(agentId);
  if (!user || !user.stationId) return null;
  return formatStation(stmts.stationById.get(user.stationId));
};

const todayTickets = () => {
  return db.prepare("SELECT * FROM tickets WHERE DATE(createdAt, 'localtime') = DATE('now', 'localtime')").all();
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
  const services = stmts.allServices.all();
  io.emit('queue:update', {
    tickets,
    byService: services.map(s => ({
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
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  // Intentar sesión primero
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (session) {
    const user = findUser(session.userId);
    if (!user || !user.active) return res.status(401).json({ error: 'Sesión inválida' });
    req.user  = user;
    req.token = token;
    return next();
  }
  // Intentar API key
  const keys = stmts.allKeys.all().filter(k => k.active && bcrypt.compareSync(token, k.keyHash));
  if (keys.length) {
    db.prepare('UPDATE api_keys SET lastUsedAt = ? WHERE id = ?').run(now(), keys[0].id);
    req.user  = { id: keys[0].id, name: keys[0].name, role: 'admin', username: `apikey:${keys[0].name}` };
    req.isApiKey = true;
    req.token = token;
    return next();
  }
  return res.status(401).json({ error: 'No autorizado' });
};

const requireRole = (...roles) => (req, res, next) => {
  if (req.isApiKey) return next(); // API keys bypass role checks
  if (!roles.includes(req.user.role))
    return res.status(403).json({ error: 'Sin permisos suficientes' });
  next();
};

// Evita que API keys accedan a endpoints exclusivos de usuario real
const noApiKey = (req, res, next) => {
  if (req.isApiKey) return res.status(403).json({ error: 'API keys no pueden usar este endpoint' });
  next();
};

// ============================================================
// RUTAS AUTH
// ============================================================
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = stmts.userByUsername.get(username);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Credenciales incorrectas' });

  const token = uid();
  db.prepare('INSERT INTO sessions (token, userId) VALUES (?, ?)').run(token, user.id);
  const { password: _, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

app.post('/api/auth/logout', authenticate, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
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
  res.json(stmts.activeServices.all());
});

app.get('/api/services/all', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  res.json(stmts.allServices.all());
});

app.post('/api/services', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  const id = uid();
  db.prepare('INSERT INTO services (id, name, prefix, color, emoji, active, avgTime, priority, description, createdAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)')
    .run(id, req.body.name, req.body.prefix, req.body.color, req.body.emoji, req.body.avgTime || 5, req.body.priority || 1, req.body.description || '', now());
  db.prepare('INSERT INTO counters (prefix, value) VALUES (?, 0)').run(req.body.prefix);
  io.emit('services:update', stmts.allServices.all());
  res.json(findService(id));
});

app.put('/api/services/:id', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  const svc = findService(req.params.id);
  if (!svc) return res.status(404).json({ error: 'No encontrado' });
  const fields = ['name', 'prefix', 'color', 'emoji', 'avgTime', 'priority', 'description', 'active'];
  const sets = fields.filter(f => req.body[f] !== undefined).map(f => `${f} = ?`).join(', ');
  if (!sets) return res.json(svc);
  const vals = fields.filter(f => req.body[f] !== undefined).map(f => req.body[f]);
  db.prepare(`UPDATE services SET ${sets} WHERE id = ?`).run(...vals, req.params.id);
  io.emit('services:update', stmts.allServices.all());
  res.json(findService(req.params.id));
});

app.delete('/api/services/:id', authenticate, requireRole('admin'), (req, res) => {
  const svc = findService(req.params.id);
  if (!svc) return res.status(404).json({ error: 'No encontrado' });
  db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(req.params.id);
  io.emit('services:update', stmts.allServices.all());
  res.json({ ok: true });
});

// ============================================================
// RUTAS VENTANILLAS/ESTACIONES
// ============================================================
app.get('/api/stations', authenticate, (req, res) => res.json(formatStations(stmts.allStations.all())));

app.post('/api/stations', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  const id = uid();
  db.prepare('INSERT INTO stations (id, name, serviceIds, agentId, active, createdAt) VALUES (?, ?, ?, ?, 1, ?)')
    .run(id, req.body.name, JSON.stringify(req.body.serviceIds || []), req.body.agentId || null, now());
  io.emit('stations:update', formatStations(stmts.allStations.all()));
  res.json(findStation(id));
});

app.put('/api/stations/:id', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  const st = findStation(req.params.id);
  if (!st) return res.status(404).json({ error: 'No encontrado' });
  const fields = ['name', 'agentId', 'active'];
  const sets = [];
  const vals = [];
  fields.forEach(f => {
    if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  });
  if (req.body.serviceIds !== undefined) { sets.push('serviceIds = ?'); vals.push(JSON.stringify(req.body.serviceIds)); }
  if (!sets.length) return res.json(st);
  db.prepare(`UPDATE stations SET ${sets.join(', ')} WHERE id = ?`).run(...vals, req.params.id);
  io.emit('stations:update', formatStations(stmts.allStations.all()));
  res.json(findStation(req.params.id));
});

app.delete('/api/stations/:id', authenticate, requireRole('admin', 'gerente'), (req, res) => {
  db.prepare('DELETE FROM stations WHERE id = ?').run(req.params.id);
  io.emit('stations:update', formatStations(stmts.allStations.all()));
  res.json({ ok: true });
});

// ============================================================
// RUTAS USUARIOS
// ============================================================
app.get('/api/users', authenticate, requireRole('admin', 'gerente'), noApiKey, (req, res) => {
  const users = db.prepare('SELECT * FROM users').all();
  res.json(users.map(({ password, ...u }) => u));
});

app.post('/api/users', authenticate, requireRole('admin', 'gerente'), noApiKey, (req, res) => {
  const { role } = req.body;
  if (req.user.role === 'gerente' && !['agente'].includes(role))
    return res.status(403).json({ error: 'Solo puede crear agentes' });
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(req.body.username);
  if (existing) return res.status(400).json({ error: 'El nombre de usuario ya existe' });

  const id = uid();
  const hashedPw = bcrypt.hashSync(req.body.password, 10);
  db.prepare('INSERT INTO users (id, name, username, password, role, active, stationId, createdAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
    .run(id, req.body.name, req.body.username, hashedPw, role, req.body.stationId || null, now());
  const { password, ...safe } = findUser(id);
  res.json(safe);
});

app.put('/api/users/:id', authenticate, requireRole('admin', 'gerente'), noApiKey, (req, res) => {
  const target = findUser(req.params.id);
  if (!target) return res.status(404).json({ error: 'No encontrado' });
  if (req.user.role === 'gerente' && target.role !== 'agente')
    return res.status(403).json({ error: 'Sin permisos sobre este usuario' });

  const fields = ['name', 'username', 'role', 'stationId', 'active'];
  const sets = [];
  const vals = [];
  fields.forEach(f => {
    if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  });
  if (req.body.password) {
    sets.push('password = ?');
    vals.push(bcrypt.hashSync(req.body.password, 10));
  }
  if (!sets.length) {
    const { password, ...safe } = target;
    return res.json(safe);
  }
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, req.params.id);
  const { password, ...safe } = findUser(req.params.id);
  res.json(safe);
});

app.delete('/api/users/:id', authenticate, requireRole('admin', 'gerente'), noApiKey, (req, res) => {
  const target = findUser(req.params.id);
  if (!target) return res.status(404).json({ error: 'No encontrado' });
  if (req.user.role === 'gerente' && target.role !== 'agente')
    return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id);
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

  const { value: num } = db.prepare('UPDATE counters SET value = value + 1 WHERE prefix = ? RETURNING value').get(service.prefix);
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
    stationId: null, stationName: null, agentId: null, agentName: null,
    estimatedWait: queueLen * (service.avgTime || 5),
    queuePosition: queueLen + 1,
    redirectedFrom: null, redirectedTo: null,
    createdAt: now(), calledAt: null, attendedAt: null, completedAt: null,
  };

  db.prepare(`INSERT INTO tickets (id, number, numberRaw, serviceId, serviceName, serviceColor, serviceEmoji,
    status, stationId, stationName, agentId, agentName, estimatedWait, queuePosition,
    redirectedFrom, redirectedTo, createdAt, calledAt, attendedAt, completedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', null, null, null, null, ?, ?, null, null, ?, null, null, null)`)
    .run(ticket.id, ticket.number, ticket.numberRaw, ticket.serviceId, ticket.serviceName,
      ticket.serviceColor, ticket.serviceEmoji, ticket.estimatedWait, ticket.queuePosition, ticket.createdAt);

  io.emit('ticket:new', ticket);
  emitQueueUpdate();
  res.json(ticket);
});

// Resuelve estación/agente para API keys
const resolveAgentContext = (req) => {
  if (!req.isApiKey) return { station: getAgentStation(req.user.id) };
  const stationId = req.body?.stationId || req.query?.stationId;
  const station = stationId ? findStation(stationId) : null;
  return { station };
};

// Llamar siguiente
app.post('/api/tickets/call-next', authenticate, requireRole('agente'), (req, res) => {
  const ctx = resolveAgentContext(req);
  if (!ctx.station) return res.status(400).json({ error: req.isApiKey ? 'Se requiere stationId en el body' : 'Sin ventanilla asignada' });
  const agentId = req.isApiKey ? (req.body.agentId || 'apikey') : req.user.id;
  const agentName = req.isApiKey ? (req.body.agentName || `API:${req.user.name}`) : req.user.name;

  // Completar atención actual si existe
  const current = db.prepare("SELECT * FROM tickets WHERE agentId = ? AND (status = 'called' OR status = 'attending') AND DATE(createdAt, 'localtime') = DATE('now', 'localtime')")
    .get(agentId);
  if (current) {
    db.prepare("UPDATE tickets SET status = 'completed', completedAt = ? WHERE id = ?").run(now(), current.id);
    current.status = 'completed';
    current.completedAt = now();
    io.emit('ticket:completed', current);
  }

  const queue = getQueueForStation(ctx.station.id);
  if (queue.length === 0) return res.status(404).json({ error: 'No hay turnos en espera' });

  const ticket = queue[0];
  db.prepare('UPDATE tickets SET status = ?, calledAt = ?, stationId = ?, stationName = ?, agentId = ?, agentName = ? WHERE id = ?')
    .run('called', now(), ctx.station.id, ctx.station.name, agentId, agentName, ticket.id);
  ticket.status = 'called';
  ticket.calledAt = now();
  ticket.stationId = ctx.station.id;
  ticket.stationName = ctx.station.name;
  ticket.agentId = agentId;
  ticket.agentName = agentName;

  io.emit('ticket:called', ticket);
  emitQueueUpdate();
  res.json(ticket);
});

// Re-llamar mismo ticket
app.post('/api/tickets/:id/recall', authenticate, requireRole('agente'), (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'No encontrado' });
  if (!req.isApiKey && ticket.agentId !== req.user.id) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('UPDATE tickets SET calledAt = ? WHERE id = ?').run(now(), req.params.id);
  ticket.calledAt = now();
  io.emit('ticket:called', ticket);
  res.json(ticket);
});

// Iniciar atención
app.post('/api/tickets/:id/attend', authenticate, requireRole('agente'), (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'No encontrado' });
  db.prepare("UPDATE tickets SET status = 'attending', attendedAt = ? WHERE id = ?").run(now(), req.params.id);
  ticket.status = 'attending';
  ticket.attendedAt = now();
  io.emit('ticket:attending', ticket);
  emitQueueUpdate();
  res.json(ticket);
});

// Finalizar atención
app.post('/api/tickets/:id/complete', authenticate, requireRole('agente'), (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'No encontrado' });
  db.prepare("UPDATE tickets SET status = 'completed', completedAt = ? WHERE id = ?").run(now(), req.params.id);
  ticket.status = 'completed';
  ticket.completedAt = now();
  io.emit('ticket:completed', ticket);
  emitQueueUpdate();
  res.json(ticket);
});

// Saltar / ausente
app.post('/api/tickets/:id/skip', authenticate, requireRole('agente'), (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'No encontrado' });
  db.prepare("UPDATE tickets SET status = 'skipped', completedAt = ? WHERE id = ?").run(now(), req.params.id);
  ticket.status = 'skipped';
  ticket.completedAt = now();
  io.emit('ticket:skipped', ticket);
  emitQueueUpdate();
  res.json(ticket);
});

// Derivar a otro servicio
app.post('/api/tickets/:id/redirect', authenticate, requireRole('agente'), (req, res) => {
  const { targetServiceId } = req.body || {};
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'No encontrado' });
  const target = findService(targetServiceId);
  if (!target) return res.status(400).json({ error: 'Servicio destino no encontrado' });

  db.prepare("UPDATE tickets SET status = 'redirected', completedAt = ?, redirectedTo = ? WHERE id = ?")
    .run(now(), targetServiceId, req.params.id);
  ticket.status = 'redirected';
  ticket.completedAt = now();
  ticket.redirectedTo = targetServiceId;

  const { value: num } = db.prepare('UPDATE counters SET value = value + 1 WHERE prefix = ? RETURNING value').get(target.prefix);
  const newTicket = {
    id: uid(),
    number: `${target.prefix}${String(num).padStart(3, '0')}`,
    numberRaw: num,
    serviceId: targetServiceId,
    serviceName: target.name,
    serviceColor: target.color,
    serviceEmoji: target.emoji,
    status: 'waiting',
    stationId: null, stationName: null, agentId: null, agentName: null,
    redirectedFrom: ticket.id, redirectedTo: null,
    estimatedWait: getQueueForService(targetServiceId).length * (target.avgTime || 5),
    queuePosition: getQueueForService(targetServiceId).length + 1,
    createdAt: now(), calledAt: null, attendedAt: null, completedAt: null,
  };

  db.prepare(`INSERT INTO tickets (id, number, numberRaw, serviceId, serviceName, serviceColor, serviceEmoji,
    status, stationId, stationName, agentId, agentName, estimatedWait, queuePosition,
    redirectedFrom, redirectedTo, createdAt, calledAt, attendedAt, completedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', null, null, null, null, ?, ?, ?, null, ?, null, null, null)`)
    .run(newTicket.id, newTicket.number, newTicket.numberRaw, newTicket.serviceId, newTicket.serviceName,
      newTicket.serviceColor, newTicket.serviceEmoji, newTicket.estimatedWait, newTicket.queuePosition,
      newTicket.redirectedFrom, newTicket.createdAt);

  io.emit('ticket:redirected', { original: ticket, newTicket });
  emitQueueUpdate();
  res.json({ original: ticket, newTicket });
});

// ============================================================
// RUTAS NOTAS
// ============================================================
app.get('/api/tickets/:id/notes', authenticate, requireRole('agente', 'admin', 'gerente'), (req, res) => {
  const notes = db.prepare('SELECT * FROM ticket_notes WHERE ticketId = ? ORDER BY createdAt ASC').all(req.params.id);
  res.json(notes);
});

app.post('/api/tickets/:id/notes', authenticate, requireRole('agente', 'admin', 'gerente'), (req, res) => {
  const { note } = req.body || {};
  if (!note || !note.trim()) return res.status(400).json({ error: 'La nota no puede estar vacía' });
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });

  const noteId = uid();
  db.prepare('INSERT INTO ticket_notes (id, ticketId, agentId, agentName, note, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(noteId, req.params.id, req.user.id, req.user.name, note.trim(), now());

  const saved = db.prepare('SELECT * FROM ticket_notes WHERE id = ?').get(noteId);
  io.emit('ticket:notes:update', { ticketId: req.params.id, note: saved });
  res.json(saved);
});

// ============================================================
// RUTAS ESTADO AGENTE
// ============================================================
app.get('/api/agent/state', authenticate, requireRole('agente'), (req, res) => {
  const ctx = resolveAgentContext(req);
  if (!ctx.station) return res.status(400).json({ error: req.isApiKey ? 'Se requiere stationId en query (ej: ?stationId=1)' : 'Sin ventanilla asignada' });
  const agentId = req.isApiKey ? (req.query.agentId || 'apikey') : req.user.id;
  const agentName = req.isApiKey ? (req.query.agentName || `API:${req.user.name}`) : req.user.name;

  const today = todayTickets();
  const currentTicket = today.find(t =>
    t.agentId === agentId && (t.status === 'called' || t.status === 'attending')
  );
  const queue = getQueueForStation(ctx.station.id);
  const todayDone = today.filter(t =>
    t.agentId === agentId && t.status === 'completed'
  );
  const attTimes = todayDone
    .filter(t => t.attendedAt && t.completedAt)
    .map(t => (new Date(t.completedAt) - new Date(t.attendedAt)) / 1000);
  const avgTime = attTimes.length
    ? Math.round(attTimes.reduce((a, b) => a + b, 0) / attTimes.length)
    : 0;

  let notes = [];
  if (currentTicket) {
    notes = db.prepare('SELECT * FROM ticket_notes WHERE ticketId = ? ORDER BY createdAt ASC').all(currentTicket.id);
  }

  res.json({
    station: ctx.station,
    currentTicket,
    queue,
    todayCompleted: todayDone.length,
    avgTime,
    services: stmts.activeServices.all(),
    notes,
  });
});

// ============================================================
// RUTAS MONITOR / TÓTEM (públicas)
// ============================================================
app.get('/api/monitor/state', (req, res) => {
  const tickets = todayTickets();
  const recentlyCalled = tickets
    .filter(t => t.calledAt)
    .sort((a, b) => new Date(b.calledAt) - new Date(a.calledAt))
    .slice(0, 8);

  res.json({
    recentlyCalled,
    waiting: tickets.filter(t => t.status === 'waiting').length,
    services: stmts.activeServices.all().map(s => ({
      ...s,
      queueLength: tickets.filter(t => t.serviceId === s.id && t.status === 'waiting').length,
    })),
    config: db.prepare('SELECT * FROM app_config WHERE id = 1').get(),
  });
});

// Historial de tickets del agente (paginado, con filtros)
app.get('/api/agent/history', authenticate, requireRole('agente', 'admin', 'gerente'), (req, res) => {
  const { page = 1, perPage = 20, date, status, search } = req.query;
  const agentId = req.user.role === 'agente' ? req.user.id : req.query.agentId;

  let sql = agentId
    ? "SELECT * FROM tickets WHERE agentId = ?"
    : "SELECT * FROM tickets WHERE calledAt IS NOT NULL";

  const params = agentId ? [agentId] : [];

  if (date) { sql += " AND substr(createdAt, 1, 10) = ?"; params.push(date); }
  if (status) { sql += " AND status = ?"; params.push(status); }
  if (search) { sql += " AND (LOWER(number) LIKE ? OR LOWER(serviceName) LIKE ?)"; params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`); }

  sql += " ORDER BY createdAt DESC";

  const total = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as count')).get(...params).count;
  const p  = Math.max(1, parseInt(page));
  const pp = Math.min(100, Math.max(1, parseInt(perPage)));

  const items = db.prepare(`${sql} LIMIT ? OFFSET ?`).all(...params, pp, (p - 1) * pp);

  // Adjuntar notas a cada ticket
  for (const ticket of items) {
    ticket.notes = db.prepare('SELECT * FROM ticket_notes WHERE ticketId = ? ORDER BY createdAt ASC').all(ticket.id);
  }

  res.json({ items, total, page: p, perPage: pp, totalPages: Math.ceil(total / pp) });
});

// ============================================================
// RUTAS ESTADÍSTICAS
// ============================================================
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

  const services = stmts.allServices.all();
  const users = stmts.allActiveUsers.all();

  const byService = services.map(s => ({
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

  const byAgent = users
    .filter(u => u.role === 'agente')
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
    waiting: waiting.length, attending: attending.length,
    completed: completed.length, skipped: skipped.length,
    avgAttTime, avgWaitTime, byService, byHour, byAgent,
  });
});

// ============================================================
// RUTAS CONFIGURACIÓN
// ============================================================
const configRow = () => db.prepare('SELECT * FROM app_config WHERE id = 1').get();

app.get('/api/config', (req, res) => {
  const row = configRow();
  // Convertir INTEGER a Boolean para campos que la UI espera como boolean
  res.json({ ...row, soundEnabled: !!row.soundEnabled, autoReset: !!row.autoReset });
});

const CONFIG_FIELDS = [
  'businessName', 'businessSubtitle', 'primaryColor', 'welcomeMessage',
  'monitorTitle', 'footerMessage', 'soundEnabled', 'autoReset',
  'resetTime', 'logoUrl', 'ticketFooter'
];

app.put('/api/config', authenticate, requireRole('admin'), noApiKey, (req, res) => {
  const sets = [];
  const vals = [];
  CONFIG_FIELDS.forEach(f => {
    if (req.body[f] !== undefined) {
      sets.push(`${f} = ?`);
      // Los booleanos se guardan como INTEGER en SQLite
      vals.push(typeof req.body[f] === 'boolean' ? (req.body[f] ? 1 : 0) : req.body[f]);
    }
  });
  if (sets.length) {
    db.prepare(`UPDATE app_config SET ${sets.join(', ')} WHERE id = 1`).run(...vals);
  }
  const updated = configRow();
  const emitConfig = { ...updated, soundEnabled: !!updated.soundEnabled, autoReset: !!updated.autoReset };
  io.emit('config:update', emitConfig);
  res.json(emitConfig);
});

app.post('/api/admin/reset-counters', authenticate, requireRole('admin', 'gerente'), noApiKey, (req, res) => {
  db.prepare('UPDATE counters SET value = 0').run();
  io.emit('system:reset');
  res.json({ ok: true, message: 'Contadores reiniciados' });
});

app.post('/api/admin/reset-queue', authenticate, requireRole('admin', 'gerente'), noApiKey, (req, res) => {
  const open = db.prepare("SELECT * FROM tickets WHERE status IN ('waiting', 'called', 'attending') AND DATE(createdAt, 'localtime') = DATE('now', 'localtime')").all();
  const nowStr = now();
  const upd = db.prepare("UPDATE tickets SET status = 'completed', completedAt = ? WHERE status IN ('waiting', 'called', 'attending') AND DATE(createdAt, 'localtime') = DATE('now', 'localtime')");
  upd.run(nowStr);
  emitQueueUpdate();
  io.emit('system:reset');
  res.json({ ok: true, message: `${open.length} turnos cerrados` });
});

// ============================================================
// API KEYS
// ============================================================
app.get('/api/api-keys', authenticate, requireRole('admin'), noApiKey, (req, res) => {
  const keys = stmts.allKeys.all().map(k => ({ id: k.id, name: k.name, prefix: k.prefix, active: !!k.active, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt }));
  res.json(keys);
});

app.post('/api/api-keys', authenticate, requireRole('admin'), noApiKey, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre es obligatorio' });
  const id = uid();
  const raw = 'tf_' + crypto.randomBytes(24).toString('hex');
  const keyHash = bcrypt.hashSync(raw, 10);
  const prefix = raw.slice(0, 12) + '...';
  db.prepare('INSERT INTO api_keys (id, name, keyHash, prefix, active, createdAt) VALUES (?, ?, ?, ?, 1, ?)').run(id, name, keyHash, prefix, now());
  res.json({ id, name, prefix, key: raw, active: true, createdAt: now() });
});

app.delete('/api/api-keys/:id', authenticate, requireRole('admin'), noApiKey, (req, res) => {
  const key = stmts.keyById.get(req.params.id);
  if (!key) return res.status(404).json({ error: 'No encontrada' });
  db.prepare('UPDATE api_keys SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============================================================
// SWAGGER / OPENAPI
// ============================================================
app.get('/api/docs/swagger.json', (req, res) => {
  res.json({
    openapi: '3.0.3',
    info: {
      title: 'TurnoFácil API',
      version: '2.0.0',
      description: 'API de integración para el sistema de gestión de turnos TurnoFácil. Obtén una API Key desde el panel de administración.'
    },
    servers: [{ url: `http://localhost:${process.env.PORT || 3000}`, description: 'Local' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'UUID', description: 'Token de sesión (login)' },
        apiKeyAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'API Key', description: 'API Key (tf_...)' },
      }
    },
    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Autenticación' },
      { name: 'Tickets', description: 'Gestión de turnos' },
      { name: 'Servicios', description: 'Tipos de atención' },
      { name: 'Ventanillas', description: 'Puestos de atención' },
      { name: 'Usuarios', description: 'Agentes del sistema' },
      { name: 'Estadísticas', description: 'Métricas y reportes' },
      { name: 'Monitor', description: 'Estado público del sistema' },
      { name: 'Configuración', description: 'Configuración del sistema' },
      { name: 'API Keys', description: 'Gestión de claves de integración' },
    ],
    paths: {
      '/api/auth/login': {
        post: {
          tags: ['Auth'], summary: 'Iniciar sesión',
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { username: { type: 'string' }, password: { type: 'string' } }, required: ['username', 'password'] } } } },
          responses: { '200': { description: 'Token y datos del usuario' }, '401': { description: 'Credenciales inválidas' } }
        }
      },
      '/api/auth/me': {
        get: {
          tags: ['Auth'], summary: 'Usuario actual',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Datos del usuario autenticado' } }
        }
      },
      '/api/tickets': {
        post: {
          tags: ['Tickets'], summary: 'Crear turno (tótem)',
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { serviceId: { type: 'string' } }, required: ['serviceId'] } } } },
          responses: { '200': { description: 'Turno creado' } }
        }
      },
      '/api/tickets/call-next': {
        post: {
          tags: ['Tickets'], summary: 'Llamar siguiente turno',
          security: [{ apiKeyAuth: [] }],
          responses: { '200': { description: 'Turno llamado' }, '404': { description: 'No hay turnos en espera' } }
        }
      },
      '/api/tickets/{id}/recall': {
        post: { tags: ['Tickets'], summary: 'Re-llamar turno', security: [{ apiKeyAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Turno re-llamado' } } }
      },
      '/api/tickets/{id}/attend': {
        post: { tags: ['Tickets'], summary: 'Iniciar atención', security: [{ apiKeyAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Atención iniciada' } } }
      },
      '/api/tickets/{id}/complete': {
        post: { tags: ['Tickets'], summary: 'Finalizar atención', security: [{ apiKeyAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Turno finalizado' } } }
      },
      '/api/tickets/{id}/skip': {
        post: { tags: ['Tickets'], summary: 'Marcar ausente', security: [{ apiKeyAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Turno saltado' } } }
      },
      '/api/tickets/{id}/redirect': {
        post: { tags: ['Tickets'], summary: 'Derivar a otro servicio', security: [{ apiKeyAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { targetServiceId: { type: 'string' } } } } } }, responses: { '200': { description: 'Turno derivado' } } }
      },
      '/api/tickets/{id}/notes': {
        get: { tags: ['Tickets'], summary: 'Obtener notas de un turno', security: [{ apiKeyAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Lista de notas' } } },
        post: { tags: ['Tickets'], summary: 'Agregar nota a un turno', security: [{ apiKeyAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] } } } }, responses: { '200': { description: 'Nota creada' } } }
      },
      '/api/services': {
        get: { tags: ['Servicios'], summary: 'Listar servicios activos', security: [{ apiKeyAuth: [] }], responses: { '200': { description: 'Lista de servicios' } } },
        post: { tags: ['Servicios'], summary: 'Crear servicio', security: [{ apiKeyAuth: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, prefix: { type: 'string' }, color: { type: 'string' }, emoji: { type: 'string' }, avgTime: { type: 'integer' }, description: { type: 'string' } }, required: ['name', 'prefix'] } } } }, responses: { '200': { description: 'Servicio creado' } } }
      },
      '/api/services/all': {
        get: { tags: ['Servicios'], summary: 'Listar todos los servicios (inactivos incluidos)', security: [{ apiKeyAuth: [] }], responses: { '200': { description: 'Lista completa de servicios' } } }
      },
      '/api/services/{id}': {
        put: { tags: ['Servicios'], summary: 'Actualizar servicio', security: [{ apiKeyAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Servicio actualizado' } } },
        delete: { tags: ['Servicios'], summary: 'Desactivar servicio', security: [{ apiKeyAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Servicio desactivado' } } }
      },
      '/api/stations': {
        get: { tags: ['Ventanillas'], summary: 'Listar ventanillas', security: [{ apiKeyAuth: [] }], responses: { '200': { description: 'Lista de ventanillas' } } },
        post: { tags: ['Ventanillas'], summary: 'Crear ventanilla', security: [{ apiKeyAuth: [] }], responses: { '200': { description: 'Ventanilla creada' } } }
      },
      '/api/stations/{id}': {
        put: { tags: ['Ventanillas'], summary: 'Actualizar ventanilla', security: [{ apiKeyAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Ventanilla actualizada' } } },
        delete: { tags: ['Ventanillas'], summary: 'Eliminar ventanilla', security: [{ apiKeyAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Ventanilla eliminada' } } }
      },
      '/api/users': {
        get: { tags: ['Usuarios'], summary: 'Listar usuarios', security: [{ apiKeyAuth: [] }], responses: { '200': { description: 'Lista de usuarios' } } },
        post: { tags: ['Usuarios'], summary: 'Crear usuario', security: [{ apiKeyAuth: [] }], responses: { '200': { description: 'Usuario creado' } } }
      },
      '/api/users/{id}': {
        put: { tags: ['Usuarios'], summary: 'Actualizar usuario', security: [{ apiKeyAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Usuario actualizado' } } },
        delete: { tags: ['Usuarios'], summary: 'Desactivar usuario', security: [{ apiKeyAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Usuario desactivado' } } }
      },
      '/api/stats': {
        get: { tags: ['Estadísticas'], summary: 'Estadísticas del día', security: [{ apiKeyAuth: [] }], responses: { '200': { description: 'Estadísticas' } } }
      },
      '/api/agent/state': {
        get: { tags: ['Estadísticas'], summary: 'Estado del agente (cola, turno actual)', security: [{ apiKeyAuth: [] }], responses: { '200': { description: 'Estado del agente' } } }
      },
      '/api/agent/history': {
        get: { tags: ['Estadísticas'], summary: 'Historial de tickets', security: [{ apiKeyAuth: [] }], parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'perPage', in: 'query', schema: { type: 'integer' } },
          { name: 'date', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'agentId', in: 'query', schema: { type: 'string' } },
        ], responses: { '200': { description: 'Historial paginado' } } }
      },
      '/api/monitor/state': {
        get: { tags: ['Monitor'], summary: 'Estado del monitor público', responses: { '200': { description: 'Datos del monitor' } } }
      },
      '/api/config': {
        get: { tags: ['Configuración'], summary: 'Configuración actual', responses: { '200': { description: 'Configuración' } } },
        put: { tags: ['Configuración'], summary: 'Actualizar configuración', security: [{ apiKeyAuth: [] }], responses: { '200': { description: 'Configuración actualizada' } } }
      },
      '/api/admin/reset-counters': {
        post: { tags: ['Configuración'], summary: 'Reiniciar contadores', security: [{ apiKeyAuth: [] }], responses: { '200': { description: 'Contadores reiniciados' } } }
      },
      '/api/admin/reset-queue': {
        post: { tags: ['Configuración'], summary: 'Cerrar cola del día', security: [{ apiKeyAuth: [] }], responses: { '200': { description: 'Cola cerrada' } } }
      },
      '/api/api-keys': {
        get: { tags: ['API Keys'], summary: 'Listar API Keys', security: [{ apiKeyAuth: [] }], responses: { '200': { description: 'Lista de API Keys (sin el key completo)' } } },
        post: { tags: ['API Keys'], summary: 'Generar nueva API Key', security: [{ apiKeyAuth: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } } }, responses: { '200': { description: 'API Key generada (solo se muestra una vez)' } } }
      },
      '/api/api-keys/{id}': {
        delete: { tags: ['API Keys'], summary: 'Revocar API Key', security: [{ apiKeyAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'API Key revocada' } } }
      },
    }
  });
});

// ============================================================
// SOCKET.IO
// ============================================================
io.on('connection', socket => {
  console.log(`[WS] Cliente conectado: ${socket.id}`);

  const tickets = todayTickets();
  const row = configRow();
  const initConfig = { ...row, soundEnabled: !!row.soundEnabled, autoReset: !!row.autoReset };

  socket.emit('init', {
    tickets,
    services: stmts.allServices.all(),
    stations: formatStations(stmts.allStations.all()),
    config: initConfig,
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
  console.log('║          TurnoFácil v2.0               ║');
  console.log('╠═══════════════════════════════════════╣');
  console.log(`║  URL: http://localhost:${PORT}            ║`);
  console.log(`║  DB:  ${database.DB_PATH}  `);
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
