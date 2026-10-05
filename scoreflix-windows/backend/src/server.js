require('dotenv').config();

const app = require('./app');
const { pool, query } = require('./db');

const PORT = Number(process.env.PORT) || 3000;

// Escuta só em localhost: quem acessa é o IIS (ARR) da mesma máquina
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`ScoreFlix API em http://127.0.0.1:${PORT}/api/v1`);
});

pool.query('SELECT 1')
  .then(() => console.log('PostgreSQL conectado.'))
  .catch((err) => {
    console.error('Falha ao conectar no PostgreSQL:', err.message);
    process.exit(1);
  });

// Remove sessões expiradas a cada hora (dispensa tarefa agendada)
async function limparSessoes() {
  try {
    const { rowCount } = await query('DELETE FROM sessions WHERE expires_at < now()');
    if (rowCount) console.log(`Sessões expiradas removidas: ${rowCount}`);
  } catch (err) {
    console.error('Falha ao limpar sessões:', err.message);
  }
}
limparSessoes();
const timerLimpeza = setInterval(limparSessoes, 60 * 60 * 1000);

async function desligar() {
  clearInterval(timerLimpeza);
  server.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', desligar);
process.on('SIGTERM', desligar);
