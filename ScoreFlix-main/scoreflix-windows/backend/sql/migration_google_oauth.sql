-- Migração: suporte a login com Google (rodar uma vez em bancos já existentes)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_id ON users (google_id) WHERE google_id IS NOT NULL;
