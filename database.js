const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'turnofacil.db');
const SALT_ROUNDS = 10;

let db;

function init() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);

  // WAL mode: crash-safe ante cortes inesperados + mejor rendimiento en lecturas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables();
  seed();

  return db;
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','gerente','agente')),
      active INTEGER NOT NULL DEFAULT 1,
      stationId TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      color TEXT NOT NULL,
      emoji TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      avgTime INTEGER NOT NULL DEFAULT 5,
      priority INTEGER NOT NULL DEFAULT 1,
      description TEXT DEFAULT '',
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      serviceIds TEXT NOT NULL DEFAULT '[]',
      agentId TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL,
      numberRaw INTEGER NOT NULL,
      serviceId TEXT NOT NULL,
      serviceName TEXT NOT NULL,
      serviceColor TEXT NOT NULL,
      serviceEmoji TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      stationId TEXT,
      stationName TEXT,
      agentId TEXT,
      agentName TEXT,
      estimatedWait INTEGER DEFAULT 0,
      queuePosition INTEGER DEFAULT 0,
      redirectedFrom TEXT,
      redirectedTo TEXT,
      createdAt TEXT,
      calledAt TEXT,
      attendedAt TEXT,
      completedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS ticket_notes (
      id TEXT PRIMARY KEY,
      ticketId TEXT NOT NULL,
      agentId TEXT NOT NULL,
      agentName TEXT NOT NULL,
      note TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS counters (
      prefix TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      businessName TEXT DEFAULT 'TurnoFácil',
      businessSubtitle TEXT DEFAULT 'Sistema de Gestión de Turnos',
      primaryColor TEXT DEFAULT '#6366F1',
      welcomeMessage TEXT DEFAULT '¡Bienvenido! Seleccione el servicio que necesita.',
      monitorTitle TEXT DEFAULT 'TURNO EN ATENCIÓN',
      footerMessage TEXT DEFAULT 'Gracias por su espera. Lo atenderemos en breve.',
      soundEnabled INTEGER DEFAULT 1,
      autoReset INTEGER DEFAULT 0,
      resetTime TEXT DEFAULT '00:00',
      logoUrl TEXT DEFAULT '',
      ticketFooter TEXT DEFAULT 'Conserve este ticket hasta ser atendido.'
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      userId TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      keyHash TEXT NOT NULL,
      prefix TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      lastUsedAt TEXT
    );
  `);
}

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount > 0) return;

  const now = new Date().toISOString();
  const hash = pw => bcrypt.hashSync(pw, SALT_ROUNDS);

  const insStation = db.prepare(
    'INSERT INTO stations (id, name, serviceIds, agentId, active, createdAt) VALUES (?, ?, ?, ?, 1, ?)'
  );
  insStation.run('1', 'Caja 1',       JSON.stringify(['1']),      '3', now);
  insStation.run('2', 'Ventanilla 2', JSON.stringify(['2']),      '4', now);
  insStation.run('3', 'Mesa Info',    JSON.stringify(['3', '2']), '5', now);

  const insUser = db.prepare(
    'INSERT INTO users (id, name, username, password, role, active, stationId, createdAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
  );
  insUser.run('1', 'Administrador', 'admin',     hash('admin123'),   'admin',   null, now);
  insUser.run('2', 'Gerente',       'gerente',   hash('gerente123'), 'gerente', null, now);
  insUser.run('3', 'Cajero 1',      'caja1',     hash('1234'),       'agente',  '1',  now);
  insUser.run('4', 'Atención 1',    'atencion1', hash('1234'),       'agente',  '2',  now);
  insUser.run('5', 'Info Desk',     'info1',     hash('1234'),       'agente',  '3',  now);

  const insSvc = db.prepare(
    'INSERT INTO services (id, name, prefix, color, emoji, active, avgTime, priority, description, createdAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)'
  );
  insSvc.run('1', 'Caja',                'C', '#3B82F6', '💳', 5,  1, 'Pagos, cobros y facturación',        now);
  insSvc.run('2', 'Atención al Cliente', 'A', '#10B981', '👤', 10, 2, 'Consultas, reclamos y soporte',       now);
  insSvc.run('3', 'Información',         'I', '#F59E0B', 'ℹ️', 3,  3, 'Información general y orientación',   now);

  const insCounter = db.prepare('INSERT INTO counters (prefix, value) VALUES (?, 0)');
  insCounter.run('C');
  insCounter.run('A');
  insCounter.run('I');

  db.prepare(`
    INSERT INTO app_config (id, businessName, businessSubtitle, primaryColor,
      welcomeMessage, monitorTitle, footerMessage, soundEnabled,
      autoReset, resetTime, logoUrl, ticketFooter)
    VALUES (1, 'TurnoFácil', 'Sistema de Gestión de Turnos', '#6366F1',
      '¡Bienvenido! Seleccione el servicio que necesita.', 'TURNO EN ATENCIÓN',
      'Gracias por su espera. Lo atenderemos en breve.', 1,
      0, '00:00', '', 'Conserve este ticket hasta ser atendido.')
  `).run();
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call init() first.');
  return db;
}

module.exports = { init, getDb, DB_PATH };
