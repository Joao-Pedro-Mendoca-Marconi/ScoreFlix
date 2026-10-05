const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const routes = require('./routes');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // atrás do Nginx: IP real e cookie Secure corretos

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// O Nginx repassa /api/ sem alterar o caminho, então a API responde em /api/v1
app.use('/api/v1', routes);

app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'Requisição grande demais.' });
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

module.exports = app;
