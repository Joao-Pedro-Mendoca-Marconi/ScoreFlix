// Sessões no banco (tabela sessions), cookie httpOnly e senhas com argon2id.
const crypto = require('crypto');
const https = require('https');
const { URLSearchParams } = require('url');
const argon2 = require('argon2');
const { query } = require('./db');

const COOKIE = 'sf_session';
const SESSAO_DIAS = Number(process.env.SESSION_DAYS) || 30;
const IS_PROD = process.env.NODE_ENV === 'production';

// ---------- Login com Google (OAuth 2.0 "Authorization Code", redirect tradicional) ----------
const GOOGLE_STATE_COOKIE = 'sf_google_state';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI; // ex.: https://seusite.com/api/v1/auth/google/callback

function googleConfigurado() {
  return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);
}

// state assinado (HMAC) em vez de guardado em banco: evita CSRF sem precisar de tabela extra
function criarStateGoogle() {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const assinatura = crypto.createHmac('sha256', GOOGLE_CLIENT_SECRET).update(nonce).digest('base64url');
  return `${nonce}.${assinatura}`;
}
function stateGoogleValido(state) {
  if (!state || typeof state !== 'string') return false;
  const [nonce, assinatura] = state.split('.');
  if (!nonce || !assinatura) return false;
  const esperado = crypto.createHmac('sha256', GOOGLE_CLIENT_SECRET).update(nonce).digest('base64url');
  try {
    return crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperado));
  } catch {
    return false; // tamanhos diferentes
  }
}

function postJson(hostname, path, form) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(form).toString();
    const req = https.request(
      { hostname, path, method: 'POST', headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getJson(hostname, path, accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// Troca o "code" do redirect pelo access_token e busca o perfil (sub, email, nome, foto)
async function trocarCodePorPerfilGoogle(code) {
  const { status, json: tokenData } = await postJson('oauth2.googleapis.com', '/token', {
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  if (status !== 200 || !tokenData.access_token) throw new Error('Falha ao obter token do Google.');

  const { status: s2, json: perfil } = await getJson(
    'www.googleapis.com', '/oauth2/v3/userinfo', tokenData.access_token
  );
  if (s2 !== 200 || !perfil.sub) throw new Error('Falha ao obter perfil do Google.');

  return {
    googleId: perfil.sub,
    email: perfil.email,
    emailVerificado: perfil.email_verified === true || perfil.email_verified === 'true',
    nome: perfil.name || perfil.email,
    avatarUrl: perfil.picture || null,
  };
}

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
  googleConfigurado, criarStateGoogle, stateGoogleValido,
  trocarCodePorPerfilGoogle, GOOGLE_STATE_COOKIE, IS_PROD,
};
