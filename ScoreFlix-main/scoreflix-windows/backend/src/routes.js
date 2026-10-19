const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('./db');
const {
  criarSessao, requireAuth, encerrarSessao,
  hashSenha, verificarSenha, hashFicticio,
  googleConfigurado, criarStateGoogle, stateGoogleValido,
  trocarCodePorPerfilGoogle, GOOGLE_STATE_COOKIE, IS_PROD,
} = require('./auth');

const router = express.Router();

// Chaves aceitas em /me/state (sf_avaliacoes_usuario e sf_seguindo têm tabelas próprias)
const CHAVES_ESTADO = new Set([
  'sf_watchlist', 'sf_assistidos', 'sf_assistindo', 'sf_listas', 'sf_perfil',
  'sf_generos_favoritos', 'sf_onboarding_feito', 'sf_tema',
]);

const REGEX_USUARIO = /^[A-Za-z0-9._]{3,30}$/;
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const erro = (res, status, msg) => res.status(status).json({ erro: msg });
const ehIdTmdb = (v) => /^\d{1,10}$/.test(String(v)) && Number(v) > 0 && Number(v) <= 2147483647;

function membroDesde(data) {
  const txt = new Date(data)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })
    .replace(' de ', ' ');
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

const iniciais = (nome) =>
  nome.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

// Formato exposto pela API (usuario/membro_desde, conforme API.md)
const usuarioPublico = (u) => ({
  nome: u.nome,
  usuario: u.username,
  bio: u.bio || '',
  perfil_publico: u.perfil_publico,
  membro_desde: membroDesde(u.created_at),
});

function erroAvaliacao(b) {
  const nota = Number(b.nota);
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) return 'A nota deve ser um número de 1 a 5.';
  if (b.texto != null && typeof b.texto !== 'string') return 'Texto inválido.';
  if (typeof b.texto === 'string' && b.texto.length > 2000) return 'O comentário pode ter até 2000 caracteres.';
  if (b.spoiler != null && typeof b.spoiler !== 'boolean') return 'Spoiler deve ser verdadeiro ou falso.';
  const tags = b.tags ?? [];
  if (!Array.isArray(tags) || tags.length > 10 || tags.some((t) => typeof t !== 'string' || t.length > 40)) {
    return 'Tags inválidas (até 10 textos de até 40 caracteres).';
  }
  return null;
}

async function buscarUsuario(username) {
  const { rows } = await query(
    'SELECT id, username, perfil_publico FROM users WHERE lower(username) = lower($1)',
    [username]
  );
  return rows[0] || null;
}

// ---------- Autenticação (pública, exceto /auth/me) ----------

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' },
});

router.post('/auth/register', async (req, res) => {
  const { nome, usuario, email, senha } = req.body || {};

  if (typeof nome !== 'string' || nome.trim().length < 2 || nome.trim().length > 80)
    return erro(res, 400, 'Informe um nome com de 2 a 80 caracteres.');
  if (typeof usuario !== 'string' || !REGEX_USUARIO.test(usuario))
    return erro(res, 400, 'Usuário deve ter de 3 a 30 caracteres: letras, números, ponto ou underline.');
  if (typeof email !== 'string' || email.length > 254 || !REGEX_EMAIL.test(email.trim()))
    return erro(res, 400, 'E-mail inválido.');
  if (typeof senha !== 'string' || senha.length < 8 || senha.length > 200)
    return erro(res, 400, 'A senha deve ter entre 8 e 200 caracteres.');

  const hash = await hashSenha(senha);
  let row;
  try {
    ({ rows: [row] } = await query(
      `INSERT INTO users (username, nome, email, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, nome, bio, perfil_publico, created_at`,
      [usuario, nome.trim(), email.trim().toLowerCase(), hash]
    ));
  } catch (err) {
    if (err.code === '23505') return erro(res, 409, 'Este e-mail ou usuário já está cadastrado.');
    throw err;
  }

  const token = await criarSessao(res, row.id);
  res.status(201).json({ token, user: usuarioPublico(row) });
});

router.post('/auth/login', loginLimiter, async (req, res) => {
  const { email, senha } = req.body || {};
  if (typeof email !== 'string' || typeof senha !== 'string' || !email || !senha)
    return erro(res, 400, 'Informe e-mail e senha.');

  const { rows: [u] } = await query(
    `SELECT id, username, nome, bio, perfil_publico, created_at, password_hash
       FROM users WHERE lower(email) = lower($1)`,
    [email.trim()]
  );
  const ok = await verificarSenha(u?.password_hash || await hashFicticio(), senha).catch(() => false);
  if (!u || !ok) {
    if (u && !u.password_hash) return erro(res, 401, 'Esta conta usa login com Google. Entre pelo botão "Entrar com Google".');
    return erro(res, 401, 'E-mail ou senha incorretos.');
  }

  const token = await criarSessao(res, u.id);
  res.json({ token, user: usuarioPublico(u) });
});

router.post('/auth/logout', async (req, res) => {
  await encerrarSessao(req, res);
  res.status(204).end();
});

router.get('/auth/me', requireAuth, (req, res) => {
  res.json(usuarioPublico(req.user));
});

// ---------- Login com Google (redirect tradicional) ----------

// Gera um @usuario único a partir do nome/email do Google (ex.: "joao.cine", "joao.cine2")
async function usernameDisponivel(base) {
  let candidato = base;
  for (let i = 0; i < 50; i++) {
    const existe = await buscarUsuario(candidato);
    if (!existe) return candidato;
    candidato = `${base}${Math.floor(Math.random() * 9000) + 1000}`;
  }
  return `${base}${Date.now()}`;
}

router.get('/auth/google', (req, res) => {
  if (!googleConfigurado()) return erro(res, 503, 'Login com Google não está configurado no servidor.');

  const state = criarStateGoogle();
  res.cookie(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/', maxAge: 10 * 60 * 1000,
  });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/auth/google/callback', async (req, res) => {
  const falhar = (motivo) => res.redirect(`/?erro=${encodeURIComponent(motivo)}`);

  if (!googleConfigurado()) return falhar('Login com Google não está configurado.');

  const { code, state } = req.query;
  const stateCookie = req.cookies?.[GOOGLE_STATE_COOKIE];
  res.clearCookie(GOOGLE_STATE_COOKIE, { path: '/' });

  if (!code || !state || state !== stateCookie || !stateGoogleValido(state)) {
    return falhar('Não foi possível validar a autenticação com o Google. Tente novamente.');
  }

  let perfil;
  try {
    perfil = await trocarCodePorPerfilGoogle(code);
  } catch {
    return falhar('Não foi possível entrar com o Google. Tente novamente.');
  }
  if (!perfil.email || !perfil.emailVerificado) {
    return falhar('Sua conta Google precisa ter um e-mail verificado.');
  }

  try {
    // 1) já existe conta ligada a esse google_id?
    let { rows: [user] } = await query(
      `SELECT id, username, nome, bio, perfil_publico, created_at FROM users WHERE google_id = $1`,
      [perfil.googleId]
    );

    if (!user) {
      // 2) existe conta por e-mail (criada com senha) ainda não ligada ao Google? liga as duas.
      const { rows: [porEmail] } = await query(
        `SELECT id FROM users WHERE lower(email) = lower($1)`,
        [perfil.email]
      );
      if (porEmail) {
        ({ rows: [user] } = await query(
          `UPDATE users SET google_id = $1, avatar_url = COALESCE(avatar_url, $2)
           WHERE id = $3
           RETURNING id, username, nome, bio, perfil_publico, created_at`,
          [perfil.googleId, perfil.avatarUrl, porEmail.id]
        ));
      } else {
        // 3) conta nova, sem senha (password_hash fica NULL)
        const baseUsuario = (perfil.nome || perfil.email.split('@')[0])
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
          .toLowerCase().replace(/[^a-z0-9._]/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '')
          .slice(0, 25) || 'usuario';
        const usuario = await usernameDisponivel(baseUsuario);

        ({ rows: [user] } = await query(
          `INSERT INTO users (username, nome, email, password_hash, google_id, avatar_url)
           VALUES ($1, $2, $3, NULL, $4, $5)
           RETURNING id, username, nome, bio, perfil_publico, created_at`,
          [usuario, perfil.nome, perfil.email.toLowerCase(), perfil.googleId, perfil.avatarUrl]
        ));
      }
    }

    await criarSessao(res, user.id);
    res.redirect('/');
  } catch (err) {
    if (err.code === '23505') return falhar('Este e-mail já está cadastrado.');
    console.error(err);
    return falhar('Erro interno ao entrar com o Google.');
  }
});

// ---------- Rotas protegidas ----------

router.use(['/me', '/movies', '/feed', '/users'], requireAuth);

// Estado do usuário (watchlist, listas, perfil, tema...). Last-write-wins pelo servidor.
router.get('/me/state', async (req, res) => {
  const { rows } = await query(
    'SELECT key, value, updated_at FROM user_state WHERE user_id = $1',
    [req.user.id]
  );
  res.json(Object.fromEntries(
    rows.map((r) => [r.key, { value: r.value, updatedAt: new Date(r.updated_at).getTime() }])
  ));
});

router.put('/me/state/:chave', async (req, res) => {
  const chave = req.params.chave;
  if (!CHAVES_ESTADO.has(chave)) return erro(res, 400, 'Chave de estado desconhecida.');

  const body = req.body || {};
  if (body.value === undefined) return erro(res, 400, 'O campo "value" é obrigatório.');

  const json = JSON.stringify(body.value);
  if (json.length > 1_000_000) return erro(res, 413, 'Conteúdo grande demais para esta chave.');

  await query(
    `INSERT INTO user_state (user_id, key, value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (user_id, key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [req.user.id, chave, json]
  );
  res.status(204).end();
});

router.get('/me/reviews', async (req, res) => {
  const { rows } = await query(
    'SELECT filme_id, nota, texto, spoiler, tags FROM reviews WHERE user_id = $1',
    [req.user.id]
  );
  res.json(Object.fromEntries(rows.map((r) => [
    String(r.filme_id),
    { nota: r.nota, texto: r.texto, spoiler: r.spoiler, tags: r.tags },
  ])));
});

router.get('/me/following', async (req, res) => {
  const { rows } = await query(
    `SELECT u.username FROM follows f
       JOIN users u ON u.id = f.followed_id
      WHERE f.follower_id = $1
      ORDER BY u.username`,
    [req.user.id]
  );
  res.json(rows.map((r) => r.username));
});

// ---------- Avaliações ----------

router.get('/movies/:filmeId/reviews', async (req, res) => {
  if (!ehIdTmdb(req.params.filmeId)) return erro(res, 400, 'ID do filme inválido.');
  const { rows } = await query(
    `SELECT u.username AS usuario, r.nota, r.texto, r.spoiler, r.tags
       FROM reviews r
       JOIN users u ON u.id = r.user_id
      WHERE r.filme_id = $1 AND (u.perfil_publico OR u.id = $2)
      ORDER BY r.created_at DESC
      LIMIT 100`,
    [Number(req.params.filmeId), req.user.id]
  );
  res.json(rows);
});

router.put('/movies/:filmeId/review', async (req, res) => {
  if (!ehIdTmdb(req.params.filmeId)) return erro(res, 400, 'ID do filme inválido.');
  const body = req.body || {};
  const problema = erroAvaliacao(body);
  if (problema) return erro(res, 400, problema);

  const texto = (body.texto || '').trim() || 'Sem comentário.';
  await query(
    `INSERT INTO reviews (user_id, filme_id, nota, texto, spoiler, tags)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, filme_id)
     DO UPDATE SET nota = EXCLUDED.nota, texto = EXCLUDED.texto,
                   spoiler = EXCLUDED.spoiler, tags = EXCLUDED.tags, created_at = now()`,
    [req.user.id, Number(req.params.filmeId), Number(body.nota), texto, body.spoiler === true, body.tags ?? []]
  );
  res.status(204).end();
});

router.delete('/movies/:filmeId/review', async (req, res) => {
  if (!ehIdTmdb(req.params.filmeId)) return erro(res, 400, 'ID do filme inválido.');
  await query('DELETE FROM reviews WHERE user_id = $1 AND filme_id = $2', [req.user.id, Number(req.params.filmeId)]);
  res.status(204).end();
});

router.get('/feed', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 50);
  const { rows } = await query(
    `SELECT r.filme_id, u.username AS usuario, r.nota, r.texto, r.spoiler, r.tags
       FROM reviews r
       JOIN users u ON u.id = r.user_id
      WHERE u.perfil_publico
      ORDER BY r.created_at DESC
      LIMIT $1`,
    [limit]
  );
  res.json(rows.map((r) => ({
    filmeId: r.filme_id, usuario: r.usuario, nota: r.nota,
    texto: r.texto, spoiler: r.spoiler, tags: r.tags,
  })));
});

// ---------- Usuários e seguidores ----------

router.get('/users/suggested', async (req, res) => {
  const { rows } = await query(
    `SELECT u.username AS usuario, u.nome
       FROM users u
      WHERE u.perfil_publico
        AND u.id <> $1
        AND NOT EXISTS (
          SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = u.id
        )
      ORDER BY u.created_at DESC
      LIMIT 20`,
    [req.user.id]
  );
  res.json(rows.map((r) => ({ usuario: r.usuario, nome: r.nome, iniciais: iniciais(r.nome) })));
});

router.post('/users/:usuario/follow', async (req, res) => {
  const alvo = await buscarUsuario(req.params.usuario);
  if (!alvo || !alvo.perfil_publico) return erro(res, 404, 'Usuário não encontrado.');
  if (alvo.id === req.user.id) return erro(res, 400, 'Você não pode seguir a si mesmo.');

  await query(
    'INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [req.user.id, alvo.id]
  );
  res.status(204).end();
});

router.delete('/users/:usuario/follow', async (req, res) => {
  const alvo = await buscarUsuario(req.params.usuario);
  if (!alvo) return erro(res, 404, 'Usuário não encontrado.');

  await query('DELETE FROM follows WHERE follower_id = $1 AND followed_id = $2', [req.user.id, alvo.id]);
  res.status(204).end();
});

module.exports = router;
