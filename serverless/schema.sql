CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  birthdate TEXT,
  role TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  maintenance_days INTEGER NOT NULL,
  active INTEGER NOT NULL,
  sort INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  notes TEXT,
  deposit_cents INTEGER NOT NULL,
  deposit_status TEXT NOT NULL,
  payment_method TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS finance (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  method TEXT,
  category TEXT,
  description TEXT,
  date TEXT NOT NULL,
  appointment_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS portfolio (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  image TEXT NOT NULL,
  sort INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  client_id TEXT,
  appointment_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS appointments_date_idx ON appointments (date);
CREATE INDEX IF NOT EXISTS appointments_client_idx ON appointments (client_id);
CREATE INDEX IF NOT EXISTS appointments_service_idx ON appointments (service_id);
CREATE INDEX IF NOT EXISTS finance_date_idx ON finance (date);
CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications (created_at);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
