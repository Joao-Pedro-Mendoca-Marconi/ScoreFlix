// Sessões no banco (tabela sessions), cookie httpOnly e senhas com argon2id.
const crypto = require('crypto');
const argon2 = require('argon2');
const { query } = require('./db');

const COOKIE = 'sf_session';
const SESSAO_DIAS = Number(process.env.SESSION_DAYS) || 30;
const IS_PROD = process.env.NODE_ENV === 'production';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const hashSenha = (senha) => argon2.hash(senha, { type: argon2.argon2id });
const verificarSenha = (hash, senha) => argon2.verify(hash, senha);

// Hash fictício: faz o login gastar o mesmo tempo mesmo quando o e-mail não existe.
let hashFicticioCache;
const hashFicticio = () => (hashFicticioCache ??= argon2.hash('senha-ficticia-scoreflix', { type: argon2.argon2id }));

function extrairToken(req) {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i);
  return req.cookies?.[COOKIE] || (bearer ? bearer[1] : null);
}

async function criarSessao(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [hashToken(token), userId, SESSAO_DIAS]
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: SESSAO_DIAS * 24 * 60 * 60 * 1000,
  });
  return token;
}

async function requireAuth(req, res, next) {
  try {
    const token = extrairToken(req);
    if (!token) return res.status(401).json({ erro: 'Entre na sua conta para continuar.' });

    const { rows } = await query(
      `SELECT u.id, u.username, u.nome, u.bio, u.perfil_publico, u.created_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)]
    );
    if (!rows[0]) return res.status(401).json({ erro: 'Sua sessão expirou. Entre novamente.' });

    req.user = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

async function encerrarSessao(req, res) {
  const token = extrairToken(req);
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  res.clearCookie(COOKIE, { path: '/' });
}

module.exports = {
  criarSessao, requireAuth, encerrarSessao,
  hashSenha, verificarSenha, hashFicticio,
};
