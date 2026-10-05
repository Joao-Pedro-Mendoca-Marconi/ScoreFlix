// login.js — porta de entrada do ScoreFlix.
// Verifica a sessão no servidor. Sem sessão válida (com backend ativo), mostra entrar/criar conta.
// Com sessão, carrega o app.js — assim o app só começa depois do estado do usuário estar pronto.
(function () {
  const root = document.getElementById('auth-root');
  let modo = 'entrar';
  let enviando = false;

  function formHtml() {
    const cadastro = modo === 'criar';
    return `
    <div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-titulo">
      <div class="brand auth-brand"><span class="brand-mark" aria-hidden="true">SF</span><span class="brand-name">ScoreFlix</span></div>
      <h1 id="auth-titulo">${cadastro ? 'Crie sua conta' : 'Entre na sua conta'}</h1>
      <p class="auth-sub">${cadastro ? 'Avalie filmes, organize sua lista e siga a comunidade.' : 'Bem-vindo de volta ao cinema em comunidade.'}</p>
      <div class="auth-tabs" role="tablist">
        <button type="button" role="tab" aria-selected="${!cadastro}" data-modo="entrar" class="${!cadastro ? 'active' : ''}">Entrar</button>
        <button type="button" role="tab" aria-selected="${cadastro}" data-modo="criar" class="${cadastro ? 'active' : ''}">Criar conta</button>
      </div>
      <form id="auth-form" novalidate>
        ${cadastro ? `
        <label>Nome completo<input name="nome" autocomplete="name" required maxlength="80"></label>
        <label>Usuário<input name="usuario" autocomplete="username" required maxlength="30" pattern="[A-Za-z0-9._]+" placeholder="ex.: joao.cine"></label>` : ''}
        <label>E-mail<input name="email" type="email" autocomplete="email" required></label>
        <label>Senha<input name="senha" type="password" autocomplete="${cadastro ? 'new-password' : 'current-password'}" required${cadastro ? ' minlength="8"' : ''}></label>
        ${cadastro ? '<p class="auth-dica">Mínimo de 8 caracteres.</p>' : ''}
        <p class="auth-erro" id="auth-erro" role="alert" hidden></p>
        <button type="submit" class="auth-submit" id="auth-submit">${cadastro ? 'Criar conta' : 'Entrar'}</button>
      </form>
    </div>`;
  }

  function mostrar() {
    root.innerHTML = formHtml();
    root.hidden = false;
    document.body.classList.add('auth-aberto');
    root.querySelectorAll('[data-modo]').forEach(b => b.addEventListener('click', () => { modo = b.dataset.modo; mostrar(); }));
    root.querySelector('#auth-form').addEventListener('submit', enviar);
    setTimeout(() => root.querySelector('input')?.focus(), 0);
  }

  function mostrarErro(msg) {
    const el = document.getElementById('auth-erro');
    el.textContent = msg;
    el.hidden = false;
  }

  async function enviar(e) {
    e.preventDefault();
    if (enviando) return;
    const dados = Object.fromEntries(new FormData(e.target).entries());
    const btn = document.getElementById('auth-submit');
    enviando = true;
    btn.disabled = true;
    btn.textContent = 'Aguarde…';
    try {
      if (modo === 'criar') {
        await DB.auth.registrar({ nome: dados.nome.trim(), usuario: dados.usuario.trim(), email: dados.email.trim(), senha: dados.senha });
      } else {
        await DB.auth.login(dados.email.trim(), dados.senha);
      }
      location.reload(); // o próximo boot lê a sessão pelo cookie
    } catch (err) {
      const msg = err.message && !/^\d+$/.test(err.message) ? err.message : 'Não foi possível concluir. Tente de novo.';
      mostrarErro(err.message === '401' ? 'E-mail ou senha incorretos.' : msg);
      enviando = false;
      btn.disabled = false;
      btn.textContent = modo === 'criar' ? 'Criar conta' : 'Entrar';
    }
  }

  function aplicarUsuario(me) {
    if (!me) return;
    const iniciais = String(me.nome || me.usuario).split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
    Object.assign(USUARIO_ATUAL, {
      nome: me.nome, usuario: me.usuario, bio: me.bio || '',
      perfil_publico: me.perfil_publico !== false, membro_desde: me.membro_desde, iniciais,
    });
    document.querySelectorAll('.avatar').forEach(a => { a.textContent = iniciais; });
  }

  function carregarApp() {
    const s = document.createElement('script');
    s.src = 'app.js';
    document.body.appendChild(s);
  }

  // Sessão expirou no meio do uso: volta para o login sem perder a página.
  window.addEventListener('sf:auth-required', mostrar);
  window.sairDaConta = () => DB.auth.sair();

  (async () => {
    const me = await DB.init();
    if (DB_CONFIG.apiBase && !me) { mostrar(); return; }
    aplicarUsuario(me);
    carregarApp();
  })();
})();
