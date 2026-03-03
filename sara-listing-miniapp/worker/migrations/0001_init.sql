-- D1 schema for incoming leads
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  telegram_user_id TEXT,
  telegram_username TEXT,
  telegram_name TEXT,
  chat_id TEXT,
  project_name TEXT,
  symbol TEXT,
  network TEXT,
  urgency TEXT,
  contract TEXT,
  links TEXT,
  goal TEXT,
  raw_message TEXT,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_symbol ON leads(symbol);
CREATE INDEX IF NOT EXISTS idx_leads_project_name ON leads(project_name);
