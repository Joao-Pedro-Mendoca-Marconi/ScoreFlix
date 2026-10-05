// db.js — camada de dados do ScoreFlix. Só usa o servidor; NADA é gravado no navegador.
//  - Sessão: cookie httpOnly definido pelo servidor (o JS nunca vê o token).
//  - Estado do usuário: lido uma vez no boot para um espelho em memória (some ao fechar a aba).
//  - Escritas: vão ao servidor com debounce. Sem fila persistente: alterações não enviadas
//    são reenviadas ao voltar a conexão, enquanto a página estiver aberta.
const DB_CONFIG = {
  apiBase: '/api/v1', // mesmo domínio do site (o nginx da VM repassa /api/ ao backend). Vazio = modo sem backend.
};
const DEBOUNCE_MS = 500;

const DB = (() => {
  const cache = new Map();
  const timers = new Map();
  const pendentes = new Set();
  // Têm rotas próprias (reviews/follows) e não entram em /me/state
  const ROTAS_PROPRIAS = new Set(['sf_avaliacoes_usuario', 'sf_seguindo']);
  const remoto = () => !!DB_CONFIG.apiBase;

  async function api(path, opts = {}) {
    const { quiet, ...init } = opts;
    const res = await fetch(DB_CONFIG.apiBase + path, {
      credentials: 'same-origin',
      ...init,
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.status === 401 && !quiet) { window.dispatchEvent(new Event('sf:auth-required')); throw new Error('401'); }
    if (!res.ok) {
      let msg = ''; try { msg = (await res.json()).erro; } catch {}
      throw new Error(msg || String(res.status));
    }
    return res.status === 204 ? null : res.json();
  }

  async function enviar(key) {
    try {
      await api(`/me/state/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value: cache.get(key), updatedAt: Date.now() }),
      });
      pendentes.delete(key);
    } catch (err) {
      if (err.message === '401') return;
      pendentes.add(key);
      window.dispatchEvent(new CustomEvent('sf:sync-error', { detail: key }));
    }
  }
  window.addEventListener('online', () => [...pendentes].forEach(enviar));

  async function hidratar() {
    const [estado, reviews, seguindo] = await Promise.all([
      api('/me/state'),          // { chave: { value, updatedAt } }
      api('/me/reviews'),        // { filmeId: { nota, texto, spoiler, tags } }
      api('/me/following'),      // [usuario, ...]
    ]);
    for (const [k, { value }] of Object.entries(estado || {})) cache.set(k, value);
    cache.set('sf_avaliacoes_usuario', reviews || {});
    cache.set('sf_seguindo', seguindo || []);
  }

  const self = {
    get(key, fallback) { return cache.has(key) ? cache.get(key) : fallback; },
    set(key, value) {
      cache.set(key, value);
      if (!remoto() || ROTAS_PROPRIAS.has(key)) return;
      pendentes.add(key);
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => enviar(key), DEBOUNCE_MS));
    },
    // Chamado no boot. Retorna o usuário logado, ou null (sem sessão válida).
    async init() {
      if (!remoto()) return null;
      const me = await self.auth.me();
      if (!me) return null;
      try { await hidratar(); }
      catch { window.dispatchEvent(new CustomEvent('sf:sync-error', { detail: 'boot' })); }
      return me;
    },
  };

  self.auth = {
    async login(email, senha) {
      const r = await api('/auth/login', { method: 'POST', quiet: true, body: JSON.stringify({ email, senha }) });
      return r.user;
    },
    async registrar({ nome, usuario, email, senha }) {
      const r = await api('/auth/register', { method: 'POST', quiet: true, body: JSON.stringify({ nome, usuario, email, senha }) });
      return r.user;
    },
    async me() { // { nome, usuario, bio, perfil_publico, membro_desde }
      if (!remoto()) return null;
      try { return await api('/auth/me', { quiet: true }); } catch { return null; }
    },
    async sair() {
      try { await api('/auth/logout', { method: 'POST', quiet: true }); } catch {}
      cache.clear();
      location.reload();
    },
  };

  // Dados sociais (compartilhados entre usuários). IDs são sempre o numérico da TMDB.
  self.social = {
    async avaliacoes(filmeId) {
      if (!remoto()) return [];
      try { return await api(`/movies/${filmeId}/reviews`); } catch { return []; }
    },
    async feed() {
      if (!remoto()) return [];
      try { return await api('/feed?limit=15'); } catch { return []; }
    },
    async usuarios() {
      if (!remoto()) return [];
      try { return await api('/users/suggested'); } catch { return []; }
    },
    async seguir(usuario, seguir) {
      if (!remoto()) return true;
      try { await api(`/users/${encodeURIComponent(usuario)}/follow`, { method: seguir ? 'POST' : 'DELETE' }); return true; }
      catch { return false; }
    },
    async publicarAvaliacao(filmeId, av) {
      if (!remoto()) return true;
      try { await api(`/movies/${filmeId}/review`, { method: 'PUT', body: JSON.stringify(av) }); return true; }
      catch { return false; }
    },
    async removerAvaliacao(filmeId) {
      if (!remoto()) return true;
      try { await api(`/movies/${filmeId}/review`, { method: 'DELETE' }); return true; }
      catch { return false; }
    },
  };
  return self;
})();
