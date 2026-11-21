import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './hash.js';
import { BUSINESS, ADMIN, DEMO_CLIENT } from './config.js';
import { toISO, addDays, round2 } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.LUMIERE_DATA_DIR
  ? path.resolve(process.env.LUMIERE_DATA_DIR)
  : path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'studio.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  birthdate TEXT,
  role TEXT NOT NULL DEFAULT 'client',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  price REAL NOT NULL,
  duration_min INTEGER NOT NULL,
  maintenance_days INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES users(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  price REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  notes TEXT DEFAULT '',
  deposit_amount REAL NOT NULL DEFAULT 0,
  deposit_status TEXT NOT NULL DEFAULT 'pendente',
  payment_method TEXT DEFAULT 'pix',
  source TEXT DEFAULT 'online',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments(client_id);

CREATE TABLE IF NOT EXISTS finance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT DEFAULT 'pix',
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  date TEXT NOT NULL,
  appointment_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_finance_date ON finance(date);

CREATE TABLE IF NOT EXISTS portfolio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'cilios',
  image TEXT NOT NULL,
  sort INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
`);

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;

  const today = toISO();
  const nowIso = new Date().toISOString();
  const insertUser = db.prepare(`
    INSERT INTO users (name, email, phone, password_hash, birthdate, role, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    insertUser.run(ADMIN.name, ADMIN.email, ADMIN.phone, hashPassword(ADMIN.password), null, 'admin', 'Conta principal do estúdio.', nowIso);

    const year = new Date().getFullYear();
    const demoMonth = String(new Date().getMonth() + 1).padStart(2, '0');
    const clients = [
      ['Ana Clara Martins', DEMO_CLIENT.email, '27999990001', `1993-${demoMonth}-05`, 'Prefere efeito natural. Sensibilidade leve na fita adesiva.'],
      ['Beatriz Nunes', 'bia@demo.com', '27999990002', `1990-${demoMonth}-12`, 'Alergia a esmalte com formol.'],
      ['Camila Souza', 'camila@demo.com', '27999990003', `1996-${demoMonth}-27`, 'Sempre pede volume mais denso.'],
      ['Daniela Reis', 'daniela@demo.com', '27999990004', `1988-03-18`, 'Cliente fiel desde a abertura do estúdio.'],
      ['Eduarda Lima', 'duda@demo.com', '27999990005', `1999-${demoMonth}-19`, 'Gosta de unhas nude e curtas.'],
      ['Fernanda Alves', 'fer@demo.com', '27999990006', `1991-${demoMonth}-08`, 'Retorno de cílios a cada 21 dias.'],
      ['Gabriela Rocha', 'gabi@demo.com', '27999990007', `1995-07-30`, 'Prefere horários pela manhã.'],
      ['Helena Prado', 'helena@demo.com', '27999990008', `1985-${demoMonth}-24`, 'Fotografa os resultados para as redes.']
    ];
    const clientHash = hashPassword(DEMO_CLIENT.password);
    const clientIds = [];
    clients.forEach(([name, email, phone, birthdate, notes], index) => {
      const info = insertUser.run(name, email, phone, clientHash, birthdate, 'client', notes, new Date(Date.now() - (90 - index * 7) * 86400000).toISOString());
      clientIds.push(Number(info.lastInsertRowid));
    });
    const insertService = db.prepare(`
      INSERT INTO services (name, category, description, price, duration_min, maintenance_days, active, sort)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `);
    const serviceRows = [
      ['Extensão de Cílios Clássico', 'cilios', 'Fio a fio, efeito natural e olhar descansado.', 150, 120, 21],
      ['Volume Brasileiro', 'cilios', 'Leve, preenchido e com o volume na medida certa.', 190, 150, 21],
      ['Volume Russo', 'cilios', 'Máxima densidade e dramaticidade, feitas para durar.', 230, 180, 21],
      ['Manutenção de Cílios', 'cilios', 'Retoque completo para manter o desenho impecável.', 90, 60, 21],
      ['Lash Lifting', 'cilios', 'Curvatura e alongamento naturais, sem extensão.', 120, 60, 45],
      ['Alongamento em Gel', 'unhas', 'Estrutura resistente com acabamento fino e natural.', 160, 120, 21],
      ['Esmaltação em Gel', 'unhas', 'Cor impecável e brilho por semanas.', 80, 60, 18],
      ['Manicure Tradicional', 'manicure', 'Cutilagem, lixamento e esmaltação cuidadosa.', 50, 40, 15],
      ['Pedicure Completa', 'pedicure', 'Cuidado completo para pés macios e esmaltados.', 65, 50, 21],
      ['Spa dos Pés', 'pedicure', 'Esfoliação, hidratação intensa e massagem relaxante.', 95, 70, 30]
    ];
    const serviceIds = {};
    serviceRows.forEach((row, i) => {
      const info = insertService.run(...row, i + 1);
      serviceIds[row[0]] = Number(info.lastInsertRowid);
    });

    const insertAppt = db.prepare(`
      INSERT INTO appointments
      (client_id, service_id, date, time, duration_min, price, status, notes, deposit_amount, deposit_status, payment_method, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFinance = db.prepare(`
      INSERT INTO finance (kind, amount, method, category, description, date, appointment_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const services = db.prepare('SELECT * FROM services').all();
    const svcByName = Object.fromEntries(services.map(s => [s.name, s]));

    function createAppointment(clientIdx, serviceName, date, time, status, opts = {}) {
      const svc = svcByName[serviceName];
      const deposit = round2(svc.price * BUSINESS.depositPercent / 100);
      const depositStatus = opts.depositStatus || 'pendente';
      const method = opts.method || ['pix', 'cartao', 'dinheiro'][Math.floor(Math.random() * 3)];
      const createdAt = new Date(Date.now() - 3 * 86400000).toISOString();
      const info = insertAppt.run(
        clientIds[clientIdx], svc.id, date, time, svc.duration_min, svc.price, status,
        opts.notes || '', deposit, depositStatus, method, opts.source || 'online', createdAt, createdAt
      );
      const id = Number(info.lastInsertRowid);
      if (depositStatus === 'pago' && status !== 'cancelado') {
        insertFinance.run('entrada', deposit, method, 'Sinal', `Sinal · ${svc.name}`, date, id, createdAt);
      }
      if (status === 'concluido') {
        const remaining = round2(svc.price - (depositStatus === 'pago' ? deposit : 0));
        if (remaining > 0) {
          insertFinance.run('entrada', remaining, method, 'Atendimento', `${svc.name} · ${clients[clientIdx][0]}`, date, id, createdAt);
        }
      }
      return id;
    }

    // Atendimentos de hoje
    createAppointment(0, 'Volume Brasileiro', today, '09:00', 'concluido', { depositStatus: 'pago', method: 'pix' });
    createAppointment(1, 'Esmaltação em Gel', today, '11:30', 'confirmado', { depositStatus: 'pendente', method: 'pix' });
    createAppointment(2, 'Volume Russo', today, '13:30', 'pendente', { depositStatus: 'informado', method: 'pix', notes: 'Enviou comprovante do sinal pelo WhatsApp.' });
    createAppointment(4, 'Manicure Tradicional', today, '16:30', 'confirmado', { depositStatus: 'pago', method: 'cartao' });
    createAppointment(3, 'Pedicure Completa', today, '17:30', 'confirmado', { depositStatus: 'pendente', method: 'pix' });
    // Amanhã
    createAppointment(5, 'Volume Brasileiro', addDays(today, 1), '09:30', 'pendente', { depositStatus: 'pendente', source: 'online' });
    createAppointment(6, 'Spa dos Pés', addDays(today, 1), '13:00', 'confirmado', { depositStatus: 'pago', method: 'pix' });
    createAppointment(7, 'Lash Lifting', addDays(today, 1), '15:00', 'confirmado', { depositStatus: 'pendente' });
    createAppointment(0, 'Manutenção de Cílios', addDays(today, 2), '16:30', 'pendente', { depositStatus: 'pendente' });
    createAppointment(1, 'Alongamento em Gel', addDays(today, 3), '10:00', 'confirmado', { depositStatus: 'pago', method: 'pix' });
    createAppointment(2, 'Esmaltação em Gel', addDays(today, 4), '14:00', 'confirmado', { depositStatus: 'pendente' });

    // Histórico de atendimentos concluídos
    const history = [
      [0, 'Manutenção de Cílios', -3, '10:00', 'pago'],
      [1, 'Manicure Tradicional', -6, '15:00', 'pendente'],
      [2, 'Esmaltação em Gel', -8, '09:00', 'pago'],
      [3, 'Volume Russo', -12, '14:00', 'pago'],
      [4, 'Alongamento em Gel', -15, '11:00', 'pendente'],
      [5, 'Volume Brasileiro', -20, '16:00', 'pago'],
      [6, 'Pedicure Completa', -23, '10:00', 'pendente'],
      [7, 'Esmaltação em Gel', -26, '13:00', 'pago'],
      [2, 'Volume Russo', -28, '14:00', 'pago'],
      [1, 'Esmaltação em Gel', -19, '09:00', 'pago'],
      [0, 'Volume Brasileiro', -40, '10:00', 'pendente'],
      [3, 'Lash Lifting', -45, '15:00', 'pendente'],
      [4, 'Pedicure Completa', -52, '10:00', 'pendente'],
      [5, 'Manutenção de Cílios', -33, '11:00', 'pago'],
      [6, 'Spa dos Pés', -60, '16:00', 'pendente']
    ];
    history.forEach(([clientIdx, serviceName, daysAgo, time, depositStatus]) => {
      createAppointment(clientIdx, serviceName, addDays(today, daysAgo), time, 'concluido', { depositStatus, method: 'pix' });
    });

    // Despesas do estúdio
    const expenses = [
      ['Insumos', 'Cola, pinças e fitas para cílios', 186.9, 'pix', -1],
      ['Insumos', 'Esmaltes e produtos de unha', 240, 'cartao', -4],
      ['Estrutura', 'Aluguel do espaço', 950, 'transferencia', -9],
      ['Estúdio', 'Café, água e recepção', 120, 'dinheiro', -14]
    ];
    expenses.forEach(([category, description, amount, method, daysAgo]) => {
      insertFinance.run('saida', amount, method, category, description, addDays(today, daysAgo), null, nowIso);
    });

    const portfolio = [
      ['Volume brasileiro', 'Preenchimento leve, simétrico e fio a fio.', 'cilios', '/img/portfolio-1.jpg'],
      ['Clássico delicado', 'Olhar natural com efeito de rímel perfeito.', 'cilios', '/img/portfolio-2.jpg'],
      ['Híbrido iluminado', 'Contraste suave com pontas mais definidas.', 'cilios', '/img/portfolio-3.jpg'],
      ['Alongamento em gel', 'Estrutura fina, resistente e com brilho de espelho.', 'unhas', '/img/portfolio-4.jpg'],
      ['Francesinha gel', 'Clássica, clean e feita para durar semanas.', 'unhas', '/img/portfolio-5.jpg'],
      ['Nude acetinado', 'Cor neutra com acabamento sofisticado.', 'unhas', '/img/portfolio-6.jpg']
    ];
    const insertPortfolio = db.prepare(`
      INSERT INTO portfolio (title, description, category, image, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)
    `);
    portfolio.forEach(([title, description, category, image], index) => {
      insertPortfolio.run(title, description, category, image, index + 1, nowIso);
    });

    db.exec('COMMIT');
    console.log('[seed] Estúdio de demonstração criado com sucesso.');
  } catch (error) {
    db.exec('ROLLBACK');
    console.error('[seed] Falha ao criar dados iniciais:', error);
    throw error;
  }
}

seed();
