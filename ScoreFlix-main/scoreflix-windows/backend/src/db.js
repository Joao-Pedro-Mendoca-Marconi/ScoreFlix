const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DATABASE_NAME || process.env.DB_NAME || 'scoreflix',
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => console.error('Erro inesperado no pool do PostgreSQL:', err));

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};