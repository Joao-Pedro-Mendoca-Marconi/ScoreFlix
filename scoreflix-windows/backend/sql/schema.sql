-- ScoreFlix — schema PostgreSQL (versão com backend).
-- Execute como administrador (ex.: scoreflix_admin) conectado ao banco scoreflix.
-- Filmes NÃO são armazenados: vêm da TMDB. Guardamos só o ID numérico da TMDB (filme_id).

CREATE TABLE IF NOT EXISTS users (
  id             BIGSERIAL PRIMARY KEY,
  username       TEXT NOT NULL CHECK (username ~ '^[A-Za-z0-9._]{3,30}$'),
  nome           TEXT NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 80),
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  bio            TEXT,
  perfil_publico BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower    ON users (lower(email));

-- Estado pessoal em chave-valor (watchlist, listas, perfil, tema...)
CREATE TABLE IF NOT EXISTS user_state (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Avaliações públicas: uma por usuário e filme
CREATE TABLE IF NOT EXISTS reviews (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filme_id   INTEGER NOT NULL,
  nota       SMALLINT NOT NULL CHECK (nota BETWEEN 1 AND 5),
  texto      TEXT,
  spoiler    BOOLEAN NOT NULL DEFAULT FALSE,
  tags       TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, filme_id)
);
CREATE INDEX IF NOT EXISTS reviews_filme_idx      ON reviews (filme_id);
CREATE INDEX IF NOT EXISTS reviews_created_idx    ON reviews (created_at DESC);

-- Curtidas em avaliações (ainda não usadas pelo front)
CREATE TABLE IF NOT EXISTS review_likes (
  review_id BIGINT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (review_id, user_id)
);

-- Quem segue quem
CREATE TABLE IF NOT EXISTS follows (
  follower_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (follower_id, followed_id),
  CHECK (follower_id <> followed_id)
);
CREATE INDEX IF NOT EXISTS follows_followed_idx ON follows (followed_id);

-- Sessões guardadas no banco (o cookie tem o token; o banco guarda só o hash SHA-256)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx    ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- Permissões do usuário da aplicação (ajuste o nome se for diferente)
GRANT USAGE ON SCHEMA public TO scoreflix_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO scoreflix_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO scoreflix_app;
