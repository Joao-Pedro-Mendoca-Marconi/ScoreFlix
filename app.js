// ===================== ESTADO E UTILITÁRIOS =====================
let heroIndex = 0;
let heroTimer = null;
let activeProfileTab = 'watchlist';

// ---------- Persistência local (watchlist, histórico, listas, avaliações) ----------
// Tudo isso roda 100% no navegador do usuário (localStorage) — nenhum dado sai da máquina.
const STORE_KEYS = {
  watchlist: 'sf_watchlist',
  assistidos: 'sf_assistidos',
  assistindo: 'sf_assistindo',
  listas: 'sf_listas',
  avaliacoes: 'sf_avaliacoes_usuario',
};

function loadStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function saveStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage indisponível: segue só em memória */ }
}

// Inicializa o estado do usuário a partir do localStorage, usando o seed de data.js
// apenas na primeira visita (quando ainda não existe nada salvo).
USUARIO_ATUAL.watchlist = loadStore(STORE_KEYS.watchlist, USUARIO_ATUAL.watchlist);
USUARIO_ATUAL.historico = loadStore(STORE_KEYS.assistidos, USUARIO_ATUAL.historico);
USUARIO_ATUAL.assistindo = loadStore(STORE_KEYS.assistindo, []); // filmes marcados como "assistindo agora"
USUARIO_ATUAL.listas = loadStore(STORE_KEYS.listas, USUARIO_ATUAL.listas);
let seguindo = loadStore('sf_seguindo', []); // usernames da comunidade que o usuário decidiu seguir (mock local)
let avaliacoesUsuario = loadStore(STORE_KEYS.avaliacoes, {}); // { imdbID: {nota, texto, spoiler, tags} }
const perfilSalvo = loadStore('sf_perfil', null);
if (perfilSalvo) Object.assign(USUARIO_ATUAL, perfilSalvo, { stats: { ...USUARIO_ATUAL.stats, genero_favorito: perfilSalvo.genero_favorito || USUARIO_ATUAL.stats.genero_favorito } });
let generosFavoritos = loadStore('sf_generos_favoritos', []); // usados para personalizar "Recomendados para você"
const onboardingConcluido = loadStore('sf_onboarding_feito', false);

function toast(msg, icon) {
  const t = document.getElementById('toast');
  t.innerHTML = `${icon ? `<i class="ti ${icon}" style="margin-right:6px;"></i>` : ''}${msg}`;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function starRow(nota) {
  let out = '';
  for (let i = 1; i <= 5; i++) out += `<i class="ti ${i <= Math.round(nota) ? 'ti-star-filled' : 'ti-star'}"></i>`;
  return out;
}

function votosNum(m) {
  return parseInt(String(m.imdbVotes || '0').replace(/,/g, '')) || 0;
}

function reviewItem(av) {
  const tags = av.tags || [];
  return `
  <div class="review-item">
    <div class="review-head">
      <div class="review-avatar" style="${av.propria ? 'background:var(--amber);color:#fff;' : ''}">${av.usuario.slice(0,2).toUpperCase()}</div>
      <div>
        <div style="font-weight:600;font-size:13px;">${av.usuario}${av.propria ? ' <span style="color:var(--amber-text);font-weight:600;">(você)</span>' : ''}</div>
        <div class="review-stars">${starRow(av.nota)}</div>
      </div>
    </div>
    ${av.spoiler ? `
      <div class="spoiler-label"><i class="ti ti-alert-triangle"></i> Contém spoiler</div>
      <div class="spoiler-blur" onclick="this.classList.toggle('revealed')">
        <p class="review-text">${av.texto}</p>
      </div>
    ` : `<p class="review-text">${av.texto}</p>`}
    ${tags.length ? `<div class="movie-tags" style="margin-top:8px;">${tags.map(t=>`<span class="tag">${t}</span>`).join('')}</div>` : ''}
  </div>`;
}

function loadingBlock(msg) {
  return `<div style="padding:100px 0;text-align:center;color:var(--ink-mute);">
    <i class="ti ti-loader-2" style="font-size:30px;display:inline-block;animation:spin 0.9s linear infinite;"></i>
    <p style="margin-top:12px;font-size:13px;">${msg || 'Carregando dados da TMDB...'}</p>
  </div>`;
}

// Skeleton específico para a Home (herói + grades), mostrado enquanto a TMDB responde.
// É bem mais leve visualmente que um spinner central e evita "layout jump".
function skeletonGrid(n = 10) {
  const cards = Array.from({ length: n }).map(() => `
    <div><div class="skel skel-poster"></div><div class="skel skel-line w60"></div><div class="skel skel-line w40"></div></div>
  `).join('');
  return `<div class="skel-grid">${cards}</div>`;
}
function skeletonHome() {
  return `
  <div class="skel skel-hero"></div>
  <div class="section"><div class="skel skel-line w40" style="height:20px;margin-bottom:16px;"></div>${skeletonGrid(5)}</div>
  <div class="section"><div class="skel skel-line w40" style="height:20px;margin-bottom:16px;"></div>${skeletonGrid(5)}</div>
  `;
}

function errorBlock(msg) {
  return `
  <div class="notice-box" style="background:var(--wine-soft);border-color:var(--wine);color:var(--wine-text);">
    <i class="ti ti-alert-triangle"></i><span>${msg}</span>
  </div>
  <button class="btn btn-ghost" data-nav="home"><i class="ti ti-arrow-left"></i> Voltar ao catálogo</button>
  `;
}

function emptyState(icon, title, desc, ctaHtml) {
  return `
  <div class="empty-state">
    <i class="ti ${icon}"></i>
    <h3>${title}</h3>
    <p>${desc}</p>
    ${ctaHtml || ''}
  </div>`;
}

// Pôster com fallback caso a imagem falhe ao carregar (rede lenta, URL quebrada, etc.)
function posterStyle(url) {
  return url ? `background-image:url('${url}');background-size:cover;background-position:center;` : 'background:var(--border);';
}

// Renderiza uma fileira de logos de provedores de streaming (Onde assistir)
function providerRow(label, lista) {
  if (!lista.length) return '';
  return `
  <div style="margin-bottom:12px;">
    <div style="font-size:12px;font-weight:600;color:var(--ink-mute);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.03em;">${label}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${lista.map(p => `<img src="${p.logo}" alt="${p.nome}" title="${p.nome}" loading="lazy" style="width:42px;height:42px;border-radius:11px;object-fit:cover;">`).join('')}
    </div>
  </div>`;
}

// Transforma uma string "Fulano, Beltrano" em nomes clicáveis que levam à filmografia
// da pessoa na TMDB (via /search/person). N/A permanece como texto simples.
function pessoaLinks(nomes) {
  if (!nomes || nomes === 'N/A') return 'N/A';
  return nomes.split(',').map(n => n.trim()).filter(Boolean)
    .map(n => `<span class="pessoa-link" data-nav="pessoa" data-nome="${n.replace(/"/g,'&quot;')}">${n}</span>`)
    .join(', ');
}

// ===================== TMDB API =====================
// Documentação: https://developer.themoviedb.org/docs
// Usa o Token de Leitura (Bearer) da TMDB.
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p';
const TMDB_DEFAULT_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIxZWFjNzA3ZGJlNmRlYTk4NTliMjVlYWE3NzM3ZmI3OSIsIm5iZiI6MTc4NzYwODA4MS4xOTcsInN1YiI6IjZhOGNiYzExZGE2YmYxNTM5YWMwZjY3OSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.VlZEXmVSn9JwNAtjEYwiT-GbtYG0vJxmKBVI9aNvHE0';

// Token de leitura (somente API read) da TMDB

async function tmdbFetch(path, params = {}) {
  const token = TMDB_DEFAULT_TOKEN;
  const qs = new URLSearchParams({ language: 'pt-BR', ...params }).toString();
  try {
    const res = await fetch(`${TMDB_BASE}${path}?${qs}`, {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' }
    });
    const data = await res.json();
    if (data.success === false) return { error: data.status_message || 'Erro na TMDB' };
    return { data };
  } catch (err) {
    return { error: 'Não foi possível conectar à TMDB. Verifique sua internet.' };
  }
}

// Mapa fixo dos IDs de gênero da TMDB (pt-BR) — necessário para o endpoint /discover/movie.
// Fonte: https://developer.themoviedb.org/reference/genre-movie-list
const TMDB_GENRE_IDS = {
  "Ação": 28, "Drama": 18, "Suspense": 53, "Ficção científica": 878,
  "Comédia": 35, "Terror": 27, "Animação": 16, "Romance": 10749,
  "Fantasia": 14, "Mistério": 9648, "Guerra": 10752, "Musical": 10402,
  "Família": 10751, "Documentário": 99, "Crime": 80, "Aventura": 12,
};

function tmdbImg(path, size = 'w500') {
  return path ? `${TMDB_IMG_BASE}/${size}${path}` : '';
}

// Adapta o payload da TMDB para o "formato" que o restante do app já espera
// (mesmos nomes de campo usados anteriormente com a OMDb, para não reescrever toda a UI).
function adaptTmdbMovie(m, origemImdbID) {
  if (!m) return null;
  const generos = (m.genres || []).map(g => g.name);
  const diretor = (m.credits?.crew || []).filter(p => p.job === 'Director').map(p => p.name).join(', ');
  const roteiristas = (m.credits?.crew || []).filter(p => ['Writer', 'Screenplay', 'Story'].includes(p.job)).map(p => p.name);
  const elenco = (m.credits?.cast || []).slice(0, 6).map(p => p.name).join(', ');
  const elencoCompleto = (m.credits?.cast || []).slice(0, 12).map(p => ({
    nome: p.name, personagem: p.character || '', foto: tmdbImg(p.profile_path, 'w185'),
  }));
  const ano = (m.release_date || '').slice(0, 4);
  const paises = (m.production_countries || []).map(c => c.name).join(', ');
  const idiomas = (m.spoken_languages || []).map(l => l.english_name || l.name).join(', ');
  const nota10 = typeof m.vote_average === 'number' ? m.vote_average.toFixed(1) : 'N/A';
  const imdbReal = origemImdbID || m.imdb_id || m.external_ids?.imdb_id || '';

  // Classificação indicativa oficial: prioriza Brasil, cai para Estados Unidos.
  const releaseDates = m.release_dates?.results || [];
  const certificacao =
    releaseDates.find(r => r.iso_3166_1 === 'BR')?.release_dates?.find(d => d.certification)?.certification ||
    releaseDates.find(r => r.iso_3166_1 === 'US')?.release_dates?.find(d => d.certification)?.certification || '';

  // Onde assistir (streaming/aluguel/compra) na região Brasil — dados JustWatch via TMDB.
  const providersBR = m['watch/providers']?.results?.BR;
  const mapProvider = p => ({ nome: p.provider_name, logo: tmdbImg(p.logo_path, 'w92') });
  const providers = providersBR ? {
    link: providersBR.link || '',
    flatrate: (providersBR.flatrate || []).map(mapProvider),
    rent: (providersBR.rent || []).map(mapProvider),
    buy: (providersBR.buy || []).map(mapProvider),
  } : null;

  const keywords = (m.keywords?.keywords || []).slice(0, 14).map(k => ({ id: k.id, nome: k.name }));

  const colecao = m.belongs_to_collection ? {
    id: m.belongs_to_collection.id,
    nome: m.belongs_to_collection.name,
    poster: tmdbImg(m.belongs_to_collection.poster_path, 'w342'),
    backdrop: tmdbImg(m.belongs_to_collection.backdrop_path, 'original'),
  } : null;

  const tmdbReviews = (m.reviews?.results || []).slice(0, 5).map(r => ({
    autor: r.author,
    texto: (r.content || '').length > 500 ? r.content.slice(0, 500) + '…' : (r.content || ''),
    nota: r.author_details?.rating || null,
  }));

  const backdrops = (m.images?.backdrops || []).slice(0, 8).map(b => tmdbImg(b.file_path, 'w780'));
  const producao = m.production_companies || [];

  return {
    // "imdbID" continua sendo a chave de rota/identidade em todo o app (usada em
    // watchlist, histórico, listas e avaliações do data.js). Quando o filme tem um
    // IMDb ID real, usamos ele; senão (ex.: resultado de busca sem correspondência),
    // caímos para o próprio ID da TMDB prefixado, só para manter a rota funcional.
    imdbID: imdbReal || `tmdb-${m.id}`,
    tmdbId: m.id,
    Title: m.title || m.original_title || 'Sem título',
    Year: ano || '—',
    Runtime: m.runtime ? `${m.runtime} min` : 'N/A',
    Genre: generos.join(', '),
    Rated: m.adult ? '18 anos' : 'Livre',
    Poster: tmdbImg(m.poster_path, 'w500'),
    Backdrop: tmdbImg(m.backdrop_path, 'original'),
    Plot: m.overview || 'Sinopse não disponível.',
    Director: diretor || 'N/A',
    Writer: roteiristas.join(', ') || 'N/A',
    Actors: elenco || 'N/A',
    Language: idiomas || 'N/A',
    Country: paises || 'N/A',
    Released: m.release_date || 'N/A',
    BoxOffice: m.revenue ? `US$ ${m.revenue.toLocaleString('pt-BR')}` : 'N/A',
    Production: (m.production_companies || [])[0]?.name || 'N/A',
    Awards: m.tagline || '',
    imdbRating: nota10,
    imdbVotes: (m.vote_count || 0).toLocaleString('pt-BR'),
    Ratings: [{ Source: 'TMDB', Value: `${nota10}/10` }],
    TrailerKey: pickTrailerKey(m.videos?.results),
    Certification: certificacao,
    Providers: providers,
    Keywords: keywords,
    Collection: colecao,
    RecommendationIds: (m.recommendations?.results || []).map(r => r.id),
    SimilarIds: (m.similar?.results || []).map(r => r.id),
    TmdbReviews: tmdbReviews,
    Backdrops: backdrops,
    CastFull: elencoCompleto,
    ProductionId: producao[0]?.id || null,
    Homepage: m.homepage || '',
  };
}

// Escolhe o melhor vídeo do tipo "Trailer" (prioriza dublado/legendado em pt-BR,
// oficial, e do YouTube — que é o que conseguimos incorporar via iframe).
function pickTrailerKey(videos) {
  if (!Array.isArray(videos) || !videos.length) return null;
  const youtube = videos.filter(v => v.site === 'YouTube');
  const trailers = youtube.filter(v => v.type === 'Trailer');
  const pool = trailers.length ? trailers : youtube;
  if (!pool.length) return null;
  const oficial = pool.find(v => v.official);
  return (oficial || pool[0]).key;
}

// Resolve um IMDb ID (tt...) para o ID numérico da TMDB via endpoint /find
async function imdbToTmdbId(imdbID) {
  const { data, error } = await tmdbFetch(`/find/${imdbID}`, { external_source: 'imdb_id' });
  if (error || !data) return null;
  return data.movie_results?.[0]?.id || null;
}

async function tmdbDetail(tmdbId) {
  // Um único request "append_to_response" traz praticamente tudo que a TMDB tem sobre o
  // filme: elenco/equipe, IDs externos, vídeos, palavras-chave, recomendações, similares,
  // críticas da comunidade TMDB, imagens, classificações indicativas por país e onde assistir.
  const { data, error } = await tmdbFetch(`/movie/${tmdbId}`, {
    append_to_response: 'credits,external_ids,videos,keywords,recommendations,similar,reviews,images,release_dates,watch/providers',
    include_image_language: 'pt,en,null',
  });
  if (error) return { error };
  return { movie: data };
}

// ===================== LISTAS TMDB (populares / em cartaz / mais bem avaliados / em breve) =====================
async function tmdbLista(categoria, pagina = 1) {
  const { data, error } = await tmdbFetch(`/movie/${categoria}`, { page: pagina, region: 'BR' });
  if (error) return { erro: error };
  return { resultados: data.results || [], totalPaginas: data.total_pages || 1 };
}

// ===================== TENDÊNCIAS (dia/semana) =====================
async function tmdbTendencias(janela = 'week', pagina = 1) {
  const { data, error } = await tmdbFetch(`/trending/movie/${janela}`, { page: pagina });
  if (error) return { erro: error };
  return { resultados: data.results || [], totalPaginas: data.total_pages || 1 };
}

// ===================== COLEÇÕES (sagas/franquias) =====================
async function tmdbColecao(id) {
  const { data, error } = await tmdbFetch(`/collection/${id}`);
  if (error) return null;
  return data;
}

// ===================== PROVEDORES DE STREAMING DISPONÍVEIS NO BRASIL =====================
let __providersCache = null;
async function tmdbListaProvedores() {
  if (__providersCache) return __providersCache;
  const { data, error } = await tmdbFetch('/watch/providers/movie', { watch_region: 'BR' });
  if (error) { __providersCache = []; return []; }
  __providersCache = (data.results || [])
    .sort((a, b) => (a.display_priorities?.BR ?? 999) - (b.display_priorities?.BR ?? 999))
    .slice(0, 26);
  return __providersCache;
}

// ===================== PERFIL COMPLETO DE PESSOA (ator/atriz/diretor/roteirista) =====================
async function tmdbPessoaDetalhe(id) {
  const { data, error } = await tmdbFetch(`/person/${id}`, { append_to_response: 'movie_credits,external_ids' });
  if (error) return null;
  return data;
}

async function tmdbSearch(query) {
  const { data, error } = await tmdbFetch('/search/movie', { query, include_adult: 'false' });
  if (error) return { error };
  if (!data.results || data.results.length === 0) return { error: 'Nenhum filme encontrado com esse termo.' };
  return { results: data.results };
}

// Cache em memória: evita rebuscar o mesmo filme várias vezes na mesma sessão
const tmdbCache = new Map(); // chave: id usado para navegação (tt... ou tmdb-numérico)

// getMovie aceita tanto um IMDb ID (tt...), vindo do catálogo curado em data.js e das
// listas do usuário, quanto um ID numérico "cru" da TMDB, vindo de resultados de busca.
async function getMovie(id) {
  if (!id) return null;
  const idStr = String(id);
  if (tmdbCache.has(idStr)) return tmdbCache.get(idStr);

  const isImdb = idStr.startsWith('tt');
  let tmdbId = idStr;
  let origemImdbID = isImdb ? idStr : '';

  if (isImdb) {
    tmdbId = await imdbToTmdbId(idStr);
    if (!tmdbId) { tmdbCache.set(idStr, null); return null; }
  }

  const { movie, error } = await tmdbDetail(tmdbId);
  if (error) { tmdbCache.set(idStr, null); return null; }
  const adapted = adaptTmdbMovie(movie, origemImdbID);
  tmdbCache.set(idStr, adapted);
  return adapted;
}

async function getMovies(ids) {
  const results = await Promise.all(ids.map(getMovie));
  return results.filter(Boolean);
}


// ===================== CARROSSEL COM SETAS (usado nas fileiras de filmes) =====================
let __carouselSeq = 0;
function carouselRow(itemsHtml) {
  if (!itemsHtml) return `<div class="row-scroll"></div>`;
  const id = `carousel-${__carouselSeq++}`;
  return `
  <div class="carousel-wrap">
    <button class="carousel-arrow carousel-arrow-left" onclick="scrollCarousel('${id}',-1)" aria-label="Ver filmes anteriores"><i class="ti ti-chevron-left"></i></button>
    <div class="row-scroll" id="${id}">${itemsHtml}</div>
    <button class="carousel-arrow carousel-arrow-right" onclick="scrollCarousel('${id}',1)" aria-label="Ver mais filmes"><i class="ti ti-chevron-right"></i></button>
  </div>`;
}
function scrollCarousel(id, dir) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollBy({ left: dir * (el.clientWidth * 0.85), behavior: 'smooth' });
}

// ===================== CARD DE FILME (usa dados reais da TMDB) =====================
function movieCard(m) {
  if (!m) return '';
  const poster = m.Poster || '';
  const nota = m.imdbRating && m.imdbRating !== 'N/A' ? m.imdbRating : '—';
  const generos = (m.Genre || '').split(',').map(g => g.trim()).filter(Boolean);
  const naWatchlist = USUARIO_ATUAL.watchlist.includes(m.imdbID);
  const assistido = USUARIO_ATUAL.historico.includes(m.imdbID);
  return `
  <div class="movie-card" data-nav="filme" data-id="${m.imdbID}" tabindex="0" role="link" aria-label="Ver detalhes de ${m.Title}">
    <div class="poster" style="${posterStyle(poster)}">
      <button class="quick-action ${naWatchlist ? 'saved' : ''}" aria-label="${naWatchlist ? 'Remover da minha lista' : 'Adicionar à minha lista'}"
        onclick="event.stopPropagation();toggleWatchlist('${m.imdbID}', event, true)">
        <i class="ti ${naWatchlist ? 'ti-check' : 'ti-plus'}"></i>
      </button>
      <div class="stamp-badge"><i class="ti ti-star-filled"></i>${nota}</div>
      <div class="poster-scrim"></div>
      <div class="poster-shine"></div>
      <div class="poster-title">${m.Title}${assistido ? ' <i class="ti ti-circle-check-filled" style="font-size:13px;color:var(--success);vertical-align:middle;" title="Já assistido"></i>' : ''}</div>
    </div>
    <div class="movie-meta">
      <span>${m.Year || ''}</span>${generos[0] ? `<span>·</span><span>${generos[0]}</span>` : ''}
    </div>
    <div class="movie-tags">
      ${generos.slice(0,2).map(g => `<span class="tag">${g}</span>`).join('')}
    </div>
  </div>`;
}

// ===================== COMUNIDADE (perfis mockados + feed de atividade) =====================
function perfilCard(p) {
  const seguindoEle = seguindo.includes(p.usuario);
  return `
  <div class="card" style="min-width:160px;text-align:center;flex-shrink:0;">
    <div class="profile-avatar-lg" style="width:56px;height:56px;font-size:18px;margin:0 auto 10px;">${p.iniciais}</div>
    <div style="font-weight:600;font-size:13px;">${p.nome}</div>
    <div style="font-size:11px;color:var(--ink-mute);margin-bottom:10px;">@${p.usuario}</div>
    <button class="btn ${seguindoEle ? 'btn-ghost' : 'btn-primary'}" style="width:100%;font-size:12px;padding:7px 10px;" onclick="toggleSeguir('${p.usuario}', this)">
      <i class="ti ${seguindoEle ? 'ti-user-check' : 'ti-user-plus'}"></i> ${seguindoEle ? 'Seguindo' : 'Seguir'}
    </button>
  </div>`;
}

function toggleSeguir(usuario, btn) {
  const idx = seguindo.indexOf(usuario);
  const agoraSeguindo = idx === -1;
  if (agoraSeguindo) seguindo.push(usuario);
  else seguindo.splice(idx, 1);
  saveStore('sf_seguindo', seguindo);
  toast(agoraSeguindo ? `Agora você segue @${usuario}` : `Você deixou de seguir @${usuario}`, agoraSeguindo ? 'ti-user-check' : 'ti-user-minus');
  if (btn) {
    btn.classList.toggle('btn-primary', !agoraSeguindo);
    btn.classList.toggle('btn-ghost', agoraSeguindo);
    btn.innerHTML = `<i class="ti ${agoraSeguindo ? 'ti-user-check' : 'ti-user-plus'}"></i> ${agoraSeguindo ? 'Seguindo' : 'Seguir'}`;
  }
}

function feedItem(item) {
  const f = item.filme;
  return `
  <div class="card" style="display:flex;gap:14px;">
    <div class="review-avatar" style="flex-shrink:0;">${item.usuario.slice(0,2).toUpperCase()}</div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:13px;">
        <strong>${item.usuario}</strong> avaliou
        <span data-nav="filme" data-id="${f.imdbID}" style="color:var(--amber-text);font-weight:600;cursor:pointer;">${f.Title}</span>
        <span class="review-stars" style="margin-left:6px;">${starRow(item.nota)}</span>
      </div>
      <p class="review-text" style="margin-top:4px;">${item.texto}</p>
    </div>
    <div class="detail-poster" style="${posterStyle(f.Poster)};width:52px;height:78px;flex-shrink:0;border-radius:8px;cursor:pointer;" data-nav="filme" data-id="${f.imdbID}"></div>
  </div>`;
}

// ===================== ROTAS / PÁGINAS =====================
// ===================== RECOMENDAÇÕES PERSONALIZADAS =====================
// Usa os gêneros escolhidos no onboarding (generosFavoritos) via /discover/movie.
// Se o usuário não escolheu nenhum gênero (ou pulou o onboarding), cai no fallback
// estático RECOMENDADOS_IDS já curado em data.js.
async function getRecomendados() {
  if (!generosFavoritos.length) return { filmes: await getMovies(RECOMENDADOS_IDS), personalizado: false };

  const idsGeneros = generosFavoritos.map(g => TMDB_GENRE_IDS[g]).filter(Boolean).join(',');
  if (!idsGeneros) return { filmes: await getMovies(RECOMENDADOS_IDS), personalizado: false };

  const { data, error } = await tmdbFetch('/discover/movie', {
    with_genres: idsGeneros, sort_by: 'popularity.desc', 'vote_count.gte': 200,
  });
  if (error || !data?.results?.length) return { filmes: await getMovies(RECOMENDADOS_IDS), personalizado: false };

  const filmes = await getMovies(data.results.slice(0, 10).map(r => r.id));
  return { filmes, personalizado: true };
}

// ===================== HUB "POPULARES" (categorias ao vivo da TMDB) =====================
const POPULARES_TABS = {
  populares: { label: 'Populares', icon: 'ti-flame', endpoint: 'popular' },
  em_alta: { label: 'Em alta', icon: 'ti-trending-up' },
  top: { label: 'Mais bem avaliados', icon: 'ti-award', endpoint: 'top_rated' },
  cartaz: { label: 'Em cartaz', icon: 'ti-movie', endpoint: 'now_playing' },
  breve: { label: 'Em breve', icon: 'ti-calendar-event', endpoint: 'upcoming' },
};
let popularesState = { tab: 'populares', genero: '', ordem: 'popularity.desc', pagina: 1, totalPaginas: 1, carregando: false };

// Busca uma página de resultados para a aba/gênero/ordem atuais. Sem gênero selecionado,
// usa os endpoints "prontos" da TMDB (mais fiéis à curadoria deles); com gênero, usa
// /discover/movie (único jeito de cruzar gênero + categoria) com filtros de data equivalentes.
async function buscarPopularesPagina(tab, genero, ordem, pagina) {
  const hoje = new Date().toISOString().slice(0, 10);
  const dias60Atras = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);

  if (genero) {
    const params = { with_genres: genero, sort_by: ordem || 'popularity.desc', page: pagina, include_adult: 'false', 'vote_count.gte': tab === 'breve' ? 0 : 10 };
    if (tab === 'cartaz') { params['primary_release_date.gte'] = dias60Atras; params['primary_release_date.lte'] = hoje; }
    if (tab === 'breve') { params['primary_release_date.gte'] = hoje; }
    if (tab === 'top') params['vote_count.gte'] = 100;
    const { data, error } = await tmdbFetch('/discover/movie', params);
    if (error) return { erro: error };
    return { resultados: data.results || [], totalPaginas: Math.min(data.total_pages || 1, 500) };
  }

  if (tab === 'em_alta') return tmdbTendencias('week', pagina);
  return tmdbLista(POPULARES_TABS[tab]?.endpoint || 'popular', pagina);
}

function mudarOrdemPopulares(ordem) {
  navigate('populares', { tab: popularesState.tab, genero: popularesState.genero || '', ordem });
}

async function carregarMaisPopulares() {
  if (popularesState.carregando || popularesState.pagina >= popularesState.totalPaginas) return;
  popularesState.carregando = true;
  const btn = document.getElementById('populares-load-more');
  if (btn) btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .9s linear infinite;"></i> Carregando...';

  const proxima = popularesState.pagina + 1;
  const { resultados, erro } = await buscarPopularesPagina(popularesState.tab, popularesState.genero, popularesState.ordem, proxima);
  popularesState.carregando = false;
  if (erro || !resultados.length) { btn?.remove(); return; }

  const filmes = await getMovies(resultados.map(r => r.id));
  const grid = document.getElementById('populares-grid');
  if (grid) grid.insertAdjacentHTML('beforeend', filmes.map(movieCard).join(''));
  popularesState.pagina = proxima;
  if (popularesState.pagina >= popularesState.totalPaginas) btn?.remove();
  else if (btn) btn.innerHTML = '<i class="ti ti-chevron-down"></i> Carregar mais';
}

// ===================== FILTRAR (gênero + nota + duração) =====================
let filtrarState = { genero: '', nota: '0', duracao: '', pagina: 1, totalPaginas: 1, carregando: false };

function duracaoParaRuntime(duracao) {
  if (duracao === 'curta') return { lte: 90 };
  if (duracao === 'media') return { gte: 90, lte: 120 };
  if (duracao === 'longa') return { gte: 120 };
  return {};
}

function aplicarFiltros() {
  const genero = document.getElementById('filtro-genero')?.value || '';
  const nota = document.getElementById('filtro-nota')?.value || '0';
  const duracao = document.getElementById('filtro-duracao')?.value || '';
  navigate('filtrar', { genero, nota, duracao });
}

async function carregarMaisFiltrados() {
  if (filtrarState.carregando || filtrarState.pagina >= filtrarState.totalPaginas) return;
  filtrarState.carregando = true;
  const btn = document.getElementById('filtrar-load-more');
  if (btn) btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .9s linear infinite;"></i> Carregando...';

  const proxima = filtrarState.pagina + 1;
  const durParams = duracaoParaRuntime(filtrarState.duracao);
  const discoverParams = {
    sort_by: 'vote_average.desc',
    'vote_average.gte': filtrarState.nota,
    'vote_count.gte': 20,
    include_adult: 'false',
    page: proxima,
  };
  if (filtrarState.genero) discoverParams.with_genres = filtrarState.genero;
  if (durParams.gte) discoverParams['with_runtime.gte'] = durParams.gte;
  if (durParams.lte) discoverParams['with_runtime.lte'] = durParams.lte;

  const { data, error } = await tmdbFetch('/discover/movie', discoverParams);
  filtrarState.carregando = false;
  if (error || !data?.results?.length) { btn?.remove(); return; }

  const filmes = await getMovies(data.results.map(r => r.id));
  const grid = document.getElementById('filtrar-grid');
  if (grid) grid.insertAdjacentHTML('beforeend', filmes.map(movieCard).join(''));
  filtrarState.pagina = proxima;
  if (filtrarState.pagina >= filtrarState.totalPaginas) btn?.remove();
  else if (btn) btn.innerHTML = '<i class="ti ti-chevron-down"></i> Carregar mais';
}

const pages = {

  async home() {
    const [destaque, lancamentos, { filmes: recomendados, personalizado }, populares, continuarAssistindo] = await Promise.all([
      getMovie(DESTAQUE_ID),
      getMovies(LANCAMENTOS_IDS),
      getRecomendados(),
      getMovies(CATALOGO_IDS),
      getMovies(USUARIO_ATUAL.assistindo),
    ]);
    if (!destaque) return errorBlock('Não foi possível carregar o catálogo da TMDB agora. Verifique sua chave/token ou tente novamente.');
    const maisPopulares = [...populares].sort((a,b) => votosNum(b) - votosNum(a));

    // Slides do carrossel do hero: o destaque da semana + os lançamentos (evita repetir o
    // mesmo filme dele mesmo se ele já estiver na lista de lançamentos).
    const heroSlides = [destaque, ...lancamentos.filter(f => f.imdbID !== destaque.imdbID)].slice(0, 5);
    window.__heroSlides = heroSlides; // usado por startHeroRotation/trocarHeroSlide

    return `
    <section class="hero" id="hero">
      ${heroSlides.map((f, i) => heroSlideMarkup(f, i === 0)).join('')}
      ${heroSlides.length > 1 ? `
      <button class="carousel-arrow carousel-arrow-left hero-arrow" onclick="trocarHeroSlide(heroIndex - 1)" aria-label="Filme anterior"><i class="ti ti-chevron-left"></i></button>
      <button class="carousel-arrow carousel-arrow-right hero-arrow" onclick="trocarHeroSlide(heroIndex + 1)" aria-label="Próximo filme"><i class="ti ti-chevron-right"></i></button>` : ''}
      <div class="hero-dots">
        ${heroSlides.map((_,i) => `<span class="${i===0?'active':''}" onclick="trocarHeroSlide(${i})"></span>`).join('')}
      </div>
    </section>

    ${continuarAssistindo.length ? `
    <section class="section">
      <div class="section-head"><h2><i class="ti ti-player-play-filled" style="color:var(--amber);vertical-align:-2px;"></i> Continuar assistindo</h2></div>
      ${carouselRow(continuarAssistindo.map(movieCard).join(''))}
    </section>` : ''}

    <section class="section">
      <div class="section-head"><h2>Lançamentos em destaque</h2><span class="see-all" data-nav="populares">Ver todos →</span></div>
      <div class="movie-grid">${lancamentos.map(movieCard).join('')}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Recomendados para você</h2><span class="see-all" data-nav="indicacoes">Ver todos →</span></div>
      <p style="font-size:13px;color:var(--ink-mute);margin:-10px 0 16px;">
        ${personalizado ? `Baseado nos seus gêneros favoritos: ${generosFavoritos.join(', ')}` : `Baseado no seu gosto por ${USUARIO_ATUAL.stats.genero_favorito}`}
      </p>
      ${carouselRow(recomendados.map(movieCard).join(''))}
    </section>

    <section class="section">
      <div class="section-head"><h2>Mais populares</h2></div>
      <div class="movie-grid">${maisPopulares.map(movieCard).join('')}</div>
    </section>
    `;
  },

  async populares(params) {
    // Aceita tanto o nome do gênero (vindo de tags/páginas antigas, ex: "Ação")
    // quanto o ID numérico da TMDB (vindo dos chips desta própria página).
    let genero = params.genero || '';
    if (genero && isNaN(genero)) genero = String(TMDB_GENRE_IDS[genero] || '');
    const tab = POPULARES_TABS[params.tab] ? params.tab : 'populares';
    const ordem = params.ordem || 'popularity.desc';

    const { resultados, totalPaginas, erro } = await buscarPopularesPagina(tab, genero, ordem, 1);
    if (erro) return errorBlock('Não foi possível carregar os filmes agora. Verifique sua chave/token ou tente novamente.');
    const filmes = await getMovies(resultados.map(r => r.id));
    popularesState = { tab, genero, ordem, pagina: 1, totalPaginas, carregando: false };

    return `
    <div class="eyebrow">Explorar · dados ao vivo da TMDB</div>
    <h1 style="font-size:30px;margin-bottom:18px;">${POPULARES_TABS[tab].label}</h1>

    <div class="tabs-row" role="tablist" style="margin-bottom:18px;overflow-x:auto;">
      ${Object.entries(POPULARES_TABS).map(([key, t]) => `
        <div class="tab-item ${tab === key ? 'active' : ''}" role="tab" data-nav="populares" data-tab="${key}" data-genero="${genero}" data-ordem="${ordem}">
          <i class="ti ${t.icon}"></i> ${t.label}
        </div>`).join('')}
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px;">
      <div class="chip-row" style="margin-bottom:0;">
        <span class="chip ${!genero ? 'active' : ''}" data-nav="populares" data-tab="${tab}" data-ordem="${ordem}">Todos os gêneros</span>
        ${GENEROS.map(g => `<span class="chip ${genero === String(TMDB_GENRE_IDS[g]) ? 'active' : ''}" data-nav="populares" data-tab="${tab}" data-genero="${TMDB_GENRE_IDS[g]}" data-ordem="${ordem}">${g}</span>`).join('')}
      </div>
      <div class="field-group" style="margin-bottom:0;min-width:190px;">
        <select onchange="mudarOrdemPopulares(this.value)">
          <option value="popularity.desc" ${ordem === 'popularity.desc' ? 'selected' : ''}>Mais populares</option>
          <option value="vote_average.desc" ${ordem === 'vote_average.desc' ? 'selected' : ''}>Melhor nota</option>
          <option value="primary_release_date.desc" ${ordem === 'primary_release_date.desc' ? 'selected' : ''}>Mais recentes</option>
          <option value="revenue.desc" ${ordem === 'revenue.desc' ? 'selected' : ''}>Maior bilheteria</option>
        </select>
      </div>
    </div>

    ${filmes.length ? `<div class="movie-grid" id="populares-grid">${filmes.map(movieCard).join('')}</div>` :
      emptyState('ti-movie-off', 'Nada por aqui', 'Experimente outro gênero ou outra categoria.',
        `<button class="btn btn-primary" data-nav="populares"><i class="ti ti-refresh"></i> Ver populares</button>`)}

    <div id="populares-sentinel" style="height:1px;"></div>
    ${popularesState.pagina < popularesState.totalPaginas ? `
    <div style="text-align:center;margin-top:28px;" id="populares-load-more-wrap">
      <button class="btn btn-ghost" id="populares-load-more" onclick="carregarMaisPopulares()"><i class="ti ti-chevron-down"></i> Carregar mais</button>
    </div>` : ''}
    `;
  },

  async generos() {
    // Busca a contagem REAL de cada gênero ao vivo na TMDB (em vez de contar só dentro
    // da lista estática CATALOGO_IDS, que tem só ~40 filmes e distorcia os números).
    const contagens = await Promise.all(
      GENEROS.map(async g => {
        const id = TMDB_GENRE_IDS[g];
        if (!id) return 0;
        const { data, error } = await tmdbFetch('/discover/movie', { with_genres: id, 'vote_count.gte': 10, include_adult: 'false', page: 1 });
        return error ? 0 : (data.total_results || 0);
      })
    );
    return `
    <div class="eyebrow">Explorar</div>
    <h1 style="font-size:30px;margin-bottom:24px;">Gêneros</h1>
    <div class="movie-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));">
      ${GENEROS.map((g, i) => `
        <div class="card" style="text-align:center;padding:28px 16px;cursor:pointer;" data-nav="populares" data-genero="${g}">
          <i class="ti ti-movie" style="font-size:26px;color:var(--amber);margin-bottom:10px;display:block;"></i>
          <div style="font-weight:600;font-size:16px;">${g}</div>
          <div style="font-size:12px;color:var(--ink-mute);margin-top:4px;">${contagens[i].toLocaleString('pt-BR')} filmes na TMDB</div>
        </div>
      `).join('')}
    </div>
    `;
  },

  async indicacoes() {
    const { filmes, personalizado } = await getRecomendados();
    // Complementa com a lista curada estática para dar mais opções na página dedicada
    const extras = await getMovies(INDICACOES_IDS);
    const vistos = new Set(filmes.map(f => f.imdbID));
    const combinados = [...filmes, ...extras.filter(f => !vistos.has(f.imdbID))];
    return `
    <div class="eyebrow">Personalizado para você</div>
    <h1 style="font-size:30px;margin-bottom:8px;">Indicações para você</h1>
    <p style="color:var(--ink-soft);font-size:14px;margin-bottom:28px;max-width:520px;">
      ${personalizado
        ? `Essas recomendações são baseadas nos gêneros que você escolheu: ${generosFavoritos.join(', ')}. Você pode alterá-los editando seu perfil.`
        : 'Escolha seus gêneros favoritos no seu perfil para receber recomendações mais precisas.'}
    </p>
    <div class="movie-grid">${combinados.map(movieCard).join('')}</div>
    `;
  },

  async filme(params) {
    const f = await getMovie(params.id);
    if (!f) return errorBlock('Não foi possível carregar esse filme na TMDB.');

    const emWatchlist = USUARIO_ATUAL.watchlist.includes(f.imdbID);
    const assistindo = USUARIO_ATUAL.assistindo.includes(f.imdbID);
    const assistido = USUARIO_ATUAL.historico.includes(f.imdbID);
    const avaliacaoPropria = avaliacoesUsuario[f.imdbID] || null;
    const avaliacoesComunidade = MOCK_AVALIACOES[f.imdbID] || [];
    // Avaliação do usuário aparece primeiro na lista, se existir.
    const todasAvaliacoes = avaliacaoPropria
      ? [{ usuario: USUARIO_ATUAL.usuario, propria: true, ...avaliacaoPropria }, ...avaliacoesComunidade]
      : avaliacoesComunidade;
    const poster = f.Poster && f.Poster !== 'N/A' ? f.Poster : '';
    const generos = (f.Genre || '').split(',').map(g => g.trim()).filter(Boolean);
    const ratingsExternos = (f.Ratings || []).map(r => `<span class="tag olive">${r.Source}: ${r.Value}</span>`).join('');
    // Recomendações e filmes similares reais, vindos direto da TMDB (com fallback pro
    // catálogo curado caso a TMDB não retorne nada para este título).
    const idsRelacionados = [...new Set([...(f.RecommendationIds || []), ...(f.SimilarIds || [])])].slice(0, 12);
    const relacionados = idsRelacionados.length
      ? await getMovies(idsRelacionados)
      : await getMovies(CATALOGO_IDS.filter(id => id !== f.imdbID).slice(0, 6));

    return `
    <div class="detail-hero">
      <div class="detail-poster" style="${posterStyle(poster)}"></div>
      <div>
        <h1 class="detail-title">${f.Title}</h1>
        <div class="detail-meta-row">
          <span>${f.Year}</span><span>·</span><span>${f.Runtime}</span><span>·</span><span>${f.Genre}</span><span>·</span><span>${f.Rated}</span>
          ${f.Certification ? `<span>·</span><span class="tag wine">${f.Certification}</span>` : ''}
        </div>
        <div class="detail-score">
          <div class="score-circle" style="--score-pct:${Math.max(0, Math.min(100, (parseFloat(f.imdbRating) || 0) * 10))}">${f.imdbRating}<span>/ 10</span></div>
          <div>
            <div style="font-weight:600;font-size:14px;">${f.imdbVotes} avaliações</div>
            <div style="font-size:12px;color:var(--ink-mute);">na TMDB</div>
          </div>
          ${avaliacaoPropria ? `<div class="tag success" style="margin-left:auto;"><i class="ti ti-star-filled"></i> Você deu ${avaliacaoPropria.nota}/5</div>` : ''}
        </div>
        <p class="detail-synopsis">${f.Plot}</p>
        <div class="crew-row">
          <div><span>Direção</span>${pessoaLinks(f.Director)}</div>
          <div><span>Roteiro</span>${pessoaLinks(f.Writer)}</div>
        </div>
        <div class="crew-row">
          <div><span>Elenco</span>${pessoaLinks(f.Actors)}</div>
        </div>
        ${f.CastFull && f.CastFull.length ? `
        <div class="row-scroll" style="margin:2px 0 16px;">
          ${f.CastFull.map(a => `
            <div style="min-width:78px;text-align:center;flex-shrink:0;cursor:pointer;" data-nav="pessoa" data-nome="${a.nome.replace(/"/g, '&quot;')}">
              <div style="width:60px;height:60px;border-radius:50%;margin:0 auto 6px;${posterStyle(a.foto)}"></div>
              <div style="font-size:11px;font-weight:600;line-height:1.3;">${a.nome}</div>
              <div style="font-size:10px;color:var(--ink-mute);line-height:1.3;">${a.personagem}</div>
            </div>`).join('')}
        </div>` : ''}
        <div class="movie-tags" style="margin-bottom:12px;">
          ${generos.map(g => `<span class="tag" data-nav="populares" data-genero="${g}" style="cursor:pointer;">${g}</span>`).join('')}
          ${ratingsExternos}
          ${f.Awards && f.Awards !== 'N/A' ? `<span class="tag wine">${f.Awards}</span>` : ''}
        </div>
        ${f.Keywords && f.Keywords.length ? `
        <div class="movie-tags" style="margin-bottom:20px;">
          ${f.Keywords.map(k => `<span class="tag olive" data-nav="keyword" data-kid="${k.id}" data-nome="${k.nome.replace(/"/g, '&quot;')}" style="cursor:pointer;">#${k.nome}</span>`).join('')}
        </div>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-primary" id="watchlist-btn-detail" onclick="toggleWatchlist('${f.imdbID}', event)">
            <i class="ti ti-${emWatchlist ? 'bookmark-filled' : 'bookmark-plus'}"></i> ${emWatchlist ? 'Na sua lista' : 'Quero assistir'}
          </button>
          <button class="btn ${assistindo ? 'btn-primary' : 'btn-ghost'}" id="assistindo-btn-detail" onclick="toggleAssistindo('${f.imdbID}', event)">
            <i class="ti ti-player-play${assistindo ? '-filled' : ''}"></i> ${assistindo ? 'Assistindo agora' : 'Comecei a assistir'}
          </button>
          <button class="btn ${assistido ? 'btn-primary' : 'btn-ghost'}" id="assistido-btn-detail" onclick="toggleAssistido('${f.imdbID}', event)">
            <i class="ti ti-${assistido ? 'circle-check-filled' : 'circle-check'}"></i> ${assistido ? 'Assistido' : 'Marcar como assistido'}
          </button>
          <button class="btn btn-ghost" onclick="abrirModalListas('${f.imdbID}', '${(f.Title || '').replace(/'/g,"\\'")}')"><i class="ti ti-list"></i> Adicionar a uma lista</button>
          <button class="btn btn-ghost" onclick="compartilharFilme('${f.imdbID}', '${(f.Title || '').replace(/'/g,"\\'")}')"><i class="ti ti-share"></i> Compartilhar</button>
          <button class="btn btn-ghost" onclick="comparadorIds=['${f.imdbID}'];navigate('comparar')"><i class="ti ti-scale"></i> Comparar</button>
        </div>
      </div>
    </div>

    ${f.Collection ? `
    <div class="notice-box" style="cursor:pointer;" data-nav="colecao" data-cid="${f.Collection.id}">
      <i class="ti ti-stack-2"></i>
      <span>Este filme faz parte da coleção <strong>${f.Collection.nome}</strong> — toque para ver a saga completa</span>
    </div>` : ''}

    <div class="eyebrow" style="margin-top:8px;">Ficha técnica</div>
    <div class="streaming-row" style="margin-bottom:8px;flex-wrap:wrap;">
      <span class="platform-pill"><i class="ti ti-language"></i> ${f.Language}</span>
      <span class="platform-pill"><i class="ti ti-world"></i> ${f.Country}</span>
      <span class="platform-pill"><i class="ti ti-calendar"></i> Estreia: ${f.Released}</span>
      ${f.BoxOffice && f.BoxOffice !== 'N/A' ? `<span class="platform-pill"><i class="ti ti-cash"></i> Bilheteria: ${f.BoxOffice}</span>` : ''}
      ${f.Production && f.Production !== 'N/A' ? `<span class="platform-pill" style="cursor:pointer;" data-nav="estudio" data-coid="${f.ProductionId || ''}" data-nome="${f.Production.replace(/"/g, '&quot;')}"><i class="ti ti-building"></i> ${f.Production}</span>` : ''}
      ${f.Homepage ? `<a class="platform-pill" href="${f.Homepage}" target="_blank" style="text-decoration:none;"><i class="ti ti-link"></i> Site oficial</a>` : ''}
    </div>

    ${f.Providers && (f.Providers.flatrate.length || f.Providers.rent.length || f.Providers.buy.length) ? `
    <div class="card" style="margin-bottom:20px;">
      <div class="eyebrow" style="margin-bottom:10px;">Onde assistir · Brasil</div>
      ${providerRow('Streaming', f.Providers.flatrate)}
      ${providerRow('Alugar', f.Providers.rent)}
      ${providerRow('Comprar', f.Providers.buy)}
      <p style="font-size:11px;color:var(--ink-mute);margin-top:4px;">Dados via JustWatch/TMDB.${f.Providers.link ? ` <a href="${f.Providers.link}" target="_blank" style="color:var(--amber-text);font-weight:600;">Ver todas as opções →</a>` : ''}</p>
    </div>` : ''}

    ${f.TrailerKey ? `
    <div class="trailer-box has-video" id="trailer-box">
      <button class="btn btn-primary" style="position:relative;z-index:2;" onclick="carregarTrailer('${f.TrailerKey}')">
        <i class="ti ti-player-play-filled"></i> Assistir ao trailer
      </button>
      <span class="trailer-play-label">YouTube · abre incorporado nesta página</span>
    </div>` : `
    <div class="trailer-box" onclick="window.open('https://www.themoviedb.org/movie/${f.tmdbId}','_blank')">
      <i class="ti ti-movie-off"></i>
      <span class="trailer-play-label">Trailer indisponível — ver na TMDB</span>
    </div>`}

    ${f.Backdrops && f.Backdrops.length ? `
    <div class="row-scroll" style="margin:16px 0;">
      ${f.Backdrops.map(url => `<div style="width:220px;height:124px;border-radius:12px;flex-shrink:0;cursor:pointer;${posterStyle(url)}" onclick="window.open('${url}','_blank')"></div>`).join('')}
    </div>` : ''}

    ${f.TmdbReviews && f.TmdbReviews.length ? `
    <div class="section">
      <h2 style="margin-bottom:14px;">O que dizem na TMDB</h2>
      <div style="display:flex;flex-direction:column;gap:12px;">
        ${f.TmdbReviews.map(r => `
        <div class="card">
          <div class="review-head">
            <div class="review-avatar">${r.autor.slice(0,2).toUpperCase()}</div>
            <div>
              <div style="font-weight:600;font-size:13px;">${r.autor}</div>
              ${r.nota ? `<div class="review-stars">${starRow(r.nota / 2)}</div>` : ''}
            </div>
          </div>
          <p class="review-text">${r.texto}</p>
        </div>`).join('')}
      </div>
    </div>` : ''}

    <div class="section">
      <h2 style="margin-bottom:18px;">Avaliações da comunidade</h2>
      <div class="card review-form" id="review-form" style="margin-bottom:28px;">
        <div class="field-label">${avaliacaoPropria ? 'Sua avaliação' : 'Sua nota'}</div>
        <div class="star-picker" id="star-picker">
          ${[1,2,3,4,5].map(i => `<i class="ti ${avaliacaoPropria && i <= avaliacaoPropria.nota ? 'ti-star-filled active' : 'ti-star'}" data-star="${i}" onclick="setStar(${i})"></i>`).join('')}
        </div>
        <textarea id="review-text" maxlength="500" placeholder="O que você achou? Compartilhe sua opinião com a comunidade...">${avaliacaoPropria ? avaliacaoPropria.texto : ''}</textarea>
        <div class="spoiler-toggle">
          <input type="checkbox" id="spoiler-check" ${avaliacaoPropria?.spoiler ? 'checked' : ''}> <label for="spoiler-check">Este comentário contém spoiler</label>
        </div>
        <div class="chip-row" id="review-tag-chips">
          ${generos.slice(0,4).map(g => {
            const tagLabel = `#${g.replace(/\s+/g,'')}`;
            const ativo = avaliacaoPropria?.tags?.includes(tagLabel);
            return `<span class="chip ${ativo ? 'active' : ''}" onclick="this.classList.toggle('active')">${tagLabel}</span>`;
          }).join('')}
        </div>
        <div style="display:flex;gap:10px;align-items:center;">
          <button class="btn btn-primary" style="align-self:flex-start;margin-top:6px;" onclick="publicarAvaliacao('${f.imdbID}')">
            <i class="ti ti-send"></i> ${avaliacaoPropria ? 'Atualizar avaliação' : 'Publicar avaliação'}
          </button>
          ${avaliacaoPropria ? `<button class="btn btn-ghost" style="margin-top:6px;" onclick="removerAvaliacao('${f.imdbID}')"><i class="ti ti-trash"></i> Remover</button>` : ''}
        </div>
      </div>

      <div class="card" id="reviews-list">
        ${todasAvaliacoes.length === 0 ? emptyState('ti-message-circle', 'Nenhuma avaliação ainda', 'Seja a primeira pessoa a avaliar este filme para a comunidade.') :
          todasAvaliacoes.map(reviewItem).join('')}
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Você também pode gostar</h2></div>
      ${carouselRow(relacionados.map(movieCard).join(''))}
    </div>
    `;
  },

  async comunidade() {
    // Ordena o feed do mais recente pro mais antigo simulando um "created_at" pela ordem
    // de declaração (não há timestamp real nos dados mockados).
    const feedComFilmes = await Promise.all(
      [...FEED_ATIVIDADE].reverse().slice(0, 15).map(async (item) => ({ ...item, filme: await getMovie(item.imdbID) }))
    );

    return `
    <div class="eyebrow">Comunidade</div>
    <h1 style="font-size:30px;margin-bottom:24px;">Atividade recente</h1>

    <div class="section-head"><h2 style="font-size:16px;">Perfis para seguir</h2></div>
    <div class="row-scroll" style="margin-bottom:32px;">
      ${USUARIOS_COMUNIDADE.map(perfilCard).join('')}
    </div>

    <div class="section-head"><h2 style="font-size:16px;">O que a comunidade está avaliando</h2></div>
    <div style="display:flex;flex-direction:column;gap:14px;">
      ${feedComFilmes.filter(i => i.filme).map(feedItem).join('') || emptyState('ti-message-circle', 'Nada por aqui ainda', 'Assim que a comunidade avaliar filmes, a atividade aparece aqui.')}
    </div>
    `;
  },

  async perfil() {
    const u = USUARIO_ATUAL;
    const avaliadosCount = Object.keys(avaliacoesUsuario).length;

    return `
    <div class="profile-header">
      <div class="profile-avatar-lg avatar-cor-${u.cor || 'amber'}">${u.iniciais}</div>
      <div>
        <h1 style="font-size:24px;">${u.nome}</h1>
        <p style="color:var(--ink-mute);font-size:13px;">@${u.usuario} · membro desde ${u.membro_desde}${u.perfil_publico === false ? ' · <i class="ti ti-lock" title="Perfil privado"></i> privado' : ''}</p>
        ${u.bio ? `<p style="color:var(--ink-soft);font-size:13px;margin-top:6px;max-width:420px;">${u.bio}</p>` : ''}
      </div>
      <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost" onclick="exportarDados()"><i class="ti ti-download"></i> Exportar dados</button>
        <button class="btn btn-ghost" onclick="abrirSeletorImportacao()"><i class="ti ti-upload"></i> Importar</button>
        <button class="btn btn-ghost" onclick="abrirModalEditarPerfil()"><i class="ti ti-settings"></i> Editar perfil</button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value" data-count="${u.historico.length}">0</div><div class="stat-label">Filmes assistidos</div></div>
      <div class="stat-card"><div class="stat-value" data-count="${avaliadosCount}">0</div><div class="stat-label">Avaliações feitas</div></div>
      <div class="stat-card"><div class="stat-value">${u.stats.genero_favorito}</div><div class="stat-label">Gênero favorito</div></div>
    </div>

    <div class="tabs-row" role="tablist">
      <div class="tab-item ${activeProfileTab==='watchlist'?'active':''}" role="tab" data-tab="watchlist" onclick="mudarTabPerfil('watchlist')">Watchlist (${u.watchlist.length})</div>
      <div class="tab-item ${activeProfileTab==='historico'?'active':''}" role="tab" data-tab="historico" onclick="mudarTabPerfil('historico')">Histórico (${u.historico.length})</div>
      <div class="tab-item ${activeProfileTab==='listas'?'active':''}" role="tab" data-tab="listas" onclick="mudarTabPerfil('listas')">Minhas listas (${u.listas.length})</div>
      <div class="tab-item ${activeProfileTab==='stats'?'active':''}" role="tab" data-tab="stats" onclick="mudarTabPerfil('stats')">Estatísticas</div>
    </div>

    <div id="profile-tab-content">${await renderProfileTab(activeProfileTab)}</div>
    `;
  },

  async lista(params) {
    const lista = USUARIO_ATUAL.listas.find(l => l.id === params.id);
    if (!lista) return errorBlock('Essa lista não existe ou foi removida.');
    const filmes = await getMovies(lista.filmes);
    const duracaoTotalMin = filmes.reduce((soma, f) => soma + (parseInt(f.Runtime) || 0), 0);
    const horas = Math.floor(duracaoTotalMin / 60);
    const minutos = duracaoTotalMin % 60;
    return `
    <div class="eyebrow">Minhas listas</div>
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;flex-wrap:wrap;">
      <h1 style="font-size:28px;">${lista.titulo}</h1>
      <span class="tag ${lista.publica ? 'olive' : 'wine'}">${lista.publica ? 'Pública' : 'Privada'}</span>
      <button class="btn btn-ghost" style="margin-left:auto;" onclick="excluirLista('${lista.id}');navigate('perfil')"><i class="ti ti-trash"></i> Excluir lista</button>
    </div>
    ${filmes.length ? `
    <div class="notice-box" style="margin-bottom:24px;">
      <i class="ti ti-clock-play"></i>
      <span><strong>Modo maratona:</strong> ${filmes.length} filme${filmes.length!==1?'s':''}, ${horas > 0 ? `${horas}h${minutos>0?minutos+'min':''}` : `${minutos}min`} no total ${horas >= 24 ? `(cerca de ${(horas/24).toFixed(1)} dias direto)` : ''}</span>
    </div>` : ''}
    ${filmes.length ? `<div class="movie-grid">${filmes.map(movieCard).join('')}</div>` :
      emptyState('ti-movie-off', 'Essa lista está vazia', 'Adicione filmes a partir da página de detalhes, usando "Adicionar a uma lista".',
        `<button class="btn btn-primary" data-nav="populares"><i class="ti ti-compass"></i> Explorar filmes</button>`)}
    `;
  },

  async comparar(params) {
    const idsComparados = comparadorIds.length ? comparadorIds : (params.ids ? params.ids.split(',') : []);
    const filmes = await getMovies(idsComparados);

    return `
    <div class="eyebrow">Ferramenta</div>
    <h1 style="font-size:28px;margin-bottom:8px;">Comparar filmes</h1>
    <p style="color:var(--ink-soft);font-size:14px;margin-bottom:24px;max-width:560px;">
      Adicione até 3 filmes para comparar nota, ano, duração e elenco lado a lado.
    </p>
    <div class="field-group" style="max-width:420px;position:relative;">
      <input type="text" id="comparador-search" placeholder="Buscar filme para adicionar..." autocomplete="off">
      <div class="search-drop" id="comparador-drop"></div>
    </div>
    <div id="comparador-tabela" style="margin-top:24px;">${comparadorTabela(filmes)}</div>
    `;
  },

  async pessoa(params) {
    const nome = params.nome;
    if (!nome) return errorBlock('Nenhuma pessoa especificada.');

    const { data: busca, error: erroBusca } = await tmdbFetch('/search/person', { query: nome });
    if (erroBusca || !busca?.results?.length) {
      return errorBlock(`Não encontramos "${nome}" na TMDB.`);
    }
    const pessoa = await tmdbPessoaDetalhe(busca.results[0].id);
    if (!pessoa) return errorBlock('Não foi possível carregar os detalhes dessa pessoa na TMDB.');

    const foto = tmdbImg(pessoa.profile_path, 'w300');
    const idade = pessoa.birthday
      ? Math.floor((new Date(pessoa.deathday || Date.now()) - new Date(pessoa.birthday)) / 3.15576e10)
      : null;
    const departamentoLabel = { Directing: 'Diretor(a)', Writing: 'Roteirista', Acting: 'Ator/Atriz', Production: 'Produtor(a)' }[pessoa.known_for_department] || pessoa.known_for_department || 'Cinema';

    // Filmografia real via /person/{id}?append_to_response=movie_credits (elenco + equipe, sem duplicar).
    const creditos = pessoa.movie_credits || {};
    const idsUnicos = [...new Map([...(creditos.cast || []), ...(creditos.crew || [])].map(c => [c.id, c])).values()]
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
      .slice(0, 18)
      .map(c => c.id);
    const filmes = await getMovies(idsUnicos);

    const redes = [];
    if (pessoa.external_ids?.instagram_id) redes.push({ icon: 'ti-brand-instagram', url: `https://instagram.com/${pessoa.external_ids.instagram_id}` });
    if (pessoa.external_ids?.twitter_id) redes.push({ icon: 'ti-brand-x', url: `https://x.com/${pessoa.external_ids.twitter_id}` });
    if (pessoa.external_ids?.facebook_id) redes.push({ icon: 'ti-brand-facebook', url: `https://facebook.com/${pessoa.external_ids.facebook_id}` });
    if (pessoa.external_ids?.imdb_id) redes.push({ icon: 'ti-brand-imdb', url: `https://www.imdb.com/name/${pessoa.external_ids.imdb_id}` });
    if (pessoa.homepage) redes.push({ icon: 'ti-world', url: pessoa.homepage });

    return `
    <div style="display:flex;align-items:flex-start;gap:22px;margin-bottom:24px;flex-wrap:wrap;">
      <div class="detail-poster" style="${posterStyle(foto)};width:120px;height:120px;border-radius:50%;flex-shrink:0;"></div>
      <div style="flex:1;min-width:240px;">
        <div class="eyebrow">${departamentoLabel}</div>
        <h1 style="font-size:28px;margin-bottom:6px;">${pessoa.name}</h1>
        <div class="movie-meta" style="margin-bottom:10px;">
          ${pessoa.birthday ? `<span><i class="ti ti-cake"></i> ${new Date(pessoa.birthday + 'T00:00').toLocaleDateString('pt-BR')}${idade != null ? ` (${idade} anos${pessoa.deathday ? ', em memória' : ''})` : ''}</span>` : ''}
          ${pessoa.place_of_birth ? `<span>·</span><span><i class="ti ti-map-pin"></i> ${pessoa.place_of_birth}</span>` : ''}
        </div>
        ${redes.length ? `<div style="display:flex;gap:8px;margin-bottom:10px;">${redes.map(r => `<a href="${r.url}" target="_blank" class="icon-btn" aria-label="Rede social"><i class="ti ${r.icon}"></i></a>`).join('')}</div>` : ''}
        ${pessoa.also_known_as?.length ? `<p style="font-size:12px;color:var(--ink-mute);">Também conhecido(a) como: ${pessoa.also_known_as.slice(0, 4).join(', ')}</p>` : ''}
      </div>
    </div>
    ${pessoa.biography ? `<p class="detail-synopsis" style="margin-bottom:28px;max-width:720px;">${pessoa.biography.length > 600 ? pessoa.biography.slice(0, 600) + '…' : pessoa.biography}</p>` : ''}
    <div class="section-head"><h2>Filmografia</h2></div>
    ${filmes.length ? `<div class="movie-grid">${filmes.map(movieCard).join('')}</div>` :
      emptyState('ti-movie-off', 'Filmografia não encontrada', 'Não conseguimos localizar outros filmes dessa pessoa no catálogo da TMDB.')}
    `;
  },

  async colecao(params) {
    if (!params.cid) return errorBlock('Coleção não especificada.');
    const dados = await tmdbColecao(params.cid);
    if (!dados) return errorBlock('Não foi possível carregar essa coleção na TMDB.');
    const filmes = await getMovies((dados.parts || []).map(p => p.id));
    const backdrop = tmdbImg(dados.backdrop_path, 'original');
    return `
    ${backdrop ? `<div style="height:220px;border-radius:20px;margin-bottom:20px;background-image:url('${backdrop}');background-size:cover;background-position:center;"></div>` : ''}
    <div class="eyebrow">Coleção TMDB</div>
    <h1 style="font-size:28px;margin-bottom:10px;">${dados.name}</h1>
    <p style="color:var(--ink-soft);font-size:14px;margin-bottom:24px;max-width:640px;">${dados.overview || ''}</p>
    ${filmes.length ? `<div class="movie-grid">${filmes.map(movieCard).join('')}</div>` :
      emptyState('ti-movie-off', 'Nenhum filme encontrado', 'Não conseguimos carregar os filmes dessa coleção.')}
    `;
  },

  async keyword(params) {
    if (!params.kid) return errorBlock('Palavra-chave não especificada.');
    const { data, error } = await tmdbFetch('/discover/movie', { with_keywords: params.kid, sort_by: 'popularity.desc' });
    if (error) return errorBlock('Não foi possível carregar filmes com essa palavra-chave.');
    const filmes = await getMovies((data.results || []).slice(0, 20).map(r => r.id));
    return `
    <div class="eyebrow">Palavra-chave</div>
    <h1 style="font-size:28px;margin-bottom:24px;">#${params.nome || ''}</h1>
    ${filmes.length ? `<div class="movie-grid">${filmes.map(movieCard).join('')}</div>` :
      emptyState('ti-movie-off', 'Nenhum filme encontrado', 'Tente outra palavra-chave.')}
    `;
  },

  async estudio(params) {
    if (!params.coid) return errorBlock('Estúdio não especificado.');
    const { data, error } = await tmdbFetch('/discover/movie', { with_companies: params.coid, sort_by: 'popularity.desc' });
    if (error) return errorBlock('Não foi possível carregar filmes desse estúdio.');
    const filmes = await getMovies((data.results || []).slice(0, 20).map(r => r.id));
    return `
    <div class="eyebrow">Estúdio</div>
    <h1 style="font-size:28px;margin-bottom:24px;">${params.nome || ''}</h1>
    ${filmes.length ? `<div class="movie-grid">${filmes.map(movieCard).join('')}</div>` :
      emptyState('ti-movie-off', 'Nenhum filme encontrado', 'Não encontramos filmes desse estúdio no catálogo TMDB.')}
    `;
  },

  async filtrar(params) {
    const genero = params.genero || '';
    const nota = params.nota || '0';
    const duracao = params.duracao || '';
    filtrarState = { genero, nota, duracao, pagina: 1, totalPaginas: 1, carregando: false };

    const durParams = duracaoParaRuntime(duracao);
    const discoverParams = {
      sort_by: 'vote_average.desc',
      'vote_average.gte': nota,
      'vote_count.gte': 20,
      include_adult: 'false',
      page: 1,
    };
    if (genero) discoverParams.with_genres = genero;
    if (durParams.gte) discoverParams['with_runtime.gte'] = durParams.gte;
    if (durParams.lte) discoverParams['with_runtime.lte'] = durParams.lte;

    const { data, error } = await tmdbFetch('/discover/movie', discoverParams);
    const resultados = error ? [] : (data.results || []);
    filtrarState.totalPaginas = data?.total_pages || 1;
    const filmes = await getMovies(resultados.map(r => r.id));

    return `
    <div class="eyebrow">Explorar</div>
    <h1 style="font-size:30px;margin-bottom:8px;">Filtrar filmes</h1>
    <p style="color:var(--ink-soft);font-size:14px;margin-bottom:22px;max-width:520px;">
      Combine gênero, nota mínima e duração para achar exatamente o que você quer assistir.
    </p>
    <div class="card" style="margin-bottom:24px;">
      <div class="form-grid-2" style="align-items:end;gap:14px;">
        <div class="field-group" style="margin-bottom:0;">
          <label class="field-label">Gênero</label>
          <select id="filtro-genero">
            <option value="">Qualquer gênero</option>
            ${GENEROS.map(g => `<option value="${TMDB_GENRE_IDS[g] || ''}" ${genero === String(TMDB_GENRE_IDS[g]) ? 'selected' : ''}>${g}</option>`).join('')}
          </select>
        </div>
        <div class="field-group" style="margin-bottom:0;">
          <label class="field-label">Nota mínima</label>
          <select id="filtro-nota">
            <option value="0" ${nota==='0'?'selected':''}>Qualquer nota</option>
            <option value="5" ${nota==='5'?'selected':''}>5.0+</option>
            <option value="6" ${nota==='6'?'selected':''}>6.0+</option>
            <option value="7" ${nota==='7'?'selected':''}>7.0+</option>
            <option value="8" ${nota==='8'?'selected':''}>8.0+</option>
            <option value="9" ${nota==='9'?'selected':''}>9.0+</option>
          </select>
        </div>
        <div class="field-group" style="margin-bottom:0;">
          <label class="field-label">Duração</label>
          <select id="filtro-duracao">
            <option value="" ${!duracao?'selected':''}>Qualquer duração</option>
            <option value="curta" ${duracao==='curta'?'selected':''}>Até 90 min</option>
            <option value="media" ${duracao==='media'?'selected':''}>90–120 min</option>
            <option value="longa" ${duracao==='longa'?'selected':''}>Mais de 120 min</option>
          </select>
        </div>
        <button class="btn btn-primary" onclick="aplicarFiltros()"><i class="ti ti-filter"></i> Filtrar</button>
      </div>
    </div>

    ${filmes.length ? `<div class="movie-grid" id="filtrar-grid">${filmes.map(movieCard).join('')}</div>` :
      emptyState('ti-movie-off', 'Nada por aqui', 'Tente afrouxar os filtros — outro gênero, nota mais baixa ou outra duração.',
        `<button class="btn btn-primary" data-nav="filtrar"><i class="ti ti-refresh"></i> Limpar filtros</button>`)}

    <div id="filtrar-sentinel" style="height:1px;"></div>
    ${filtrarState.pagina < filtrarState.totalPaginas ? `
    <div style="text-align:center;margin-top:28px;">
      <button class="btn btn-ghost" id="filtrar-load-more" onclick="carregarMaisFiltrados()"><i class="ti ti-chevron-down"></i> Carregar mais</button>
    </div>` : ''}
    `;
  },

  async roleta() {
    const provedores = await tmdbListaProvedores();
    return `
    <div class="eyebrow">Descubra</div>
    <h1 style="font-size:28px;margin-bottom:8px;">Não sabe o que assistir?</h1>
    <p style="color:var(--ink-soft);font-size:14px;margin-bottom:24px;max-width:520px;">
      Ajuste os filtros — a gente sorteia um filme aleatório direto do catálogo da TMDB para você.
    </p>
    <div class="card" style="max-width:480px;">
      <div class="field-group">
        <label class="field-label">Gênero</label>
        <select id="roleta-genero">
          <option value="">Qualquer gênero</option>
          ${GENEROS.map(g => `<option value="${TMDB_GENRE_IDS[g] || ''}">${g}</option>`).join('')}
        </select>
      </div>
      <div class="field-group">
        <label class="field-label">Nota mínima na TMDB</label>
        <select id="roleta-nota">
          <option value="0">Qualquer nota</option>
          <option value="6">6.0+</option>
          <option value="7" selected>7.0+</option>
          <option value="8">8.0+</option>
        </select>
      </div>
      <div class="form-grid-2">
        <div class="field-group">
          <label class="field-label">Ano — de</label>
          <input type="number" id="roleta-ano-de" placeholder="1970" min="1900" max="2030">
        </div>
        <div class="field-group">
          <label class="field-label">Ano — até</label>
          <input type="number" id="roleta-ano-ate" placeholder="2026" min="1900" max="2030">
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Idioma original</label>
        <select id="roleta-idioma">
          <option value="">Qualquer idioma</option>
          <option value="en">Inglês</option>
          <option value="pt">Português</option>
          <option value="es">Espanhol</option>
          <option value="fr">Francês</option>
          <option value="ja">Japonês</option>
          <option value="ko">Coreano</option>
          <option value="it">Italiano</option>
          <option value="de">Alemão</option>
        </select>
      </div>
      ${provedores.length ? `
      <div class="field-group">
        <label class="field-label">Onde assistir</label>
        <select id="roleta-provedor">
          <option value="">Qualquer plataforma</option>
          ${provedores.map(p => `<option value="${p.provider_id}">${p.provider_name}</option>`).join('')}
        </select>
      </div>` : ''}
      <button class="btn btn-primary btn-block" onclick="sortearFilme()"><i class="ti ti-dice"></i> Sortear filme</button>
    </div>
    <div style="max-width:480px;margin-top:16px;">
      <button class="btn btn-ghost btn-block" onclick="surpreendaMe()"><i class="ti ti-sparkles"></i> Surpreenda-me (totalmente aleatório)</button>
      <p style="font-size:12px;color:var(--ink-mute);margin-top:8px;text-align:center;">Ignora todos os filtros acima e sorteia qualquer filme do catálogo da TMDB.</p>
    </div>
    <div id="roleta-resultado" style="margin-top:28px;max-width:640px;"></div>
    `;
  },

  404() {
    return emptyState('ti-error-404', 'Página não encontrada', 'O link que você seguiu pode estar quebrado, ou a página foi movida.',
      `<button class="btn btn-primary" data-nav="home"><i class="ti ti-home"></i> Voltar ao início</button>`);
  },
};

// ===================== BUSCA TMDB (navbar) =====================
let buscaAtual = { query: '', pagina: 1, totalPaginas: 1, carregando: false };

async function buscarTMDB(query) {
  if (!query || !query.trim()) return;
  clearInterval(heroTimer);
  const app = document.getElementById('app');
  reelBar(true);


  app.innerHTML = `
    <div class="eyebrow">Busca TMDB</div>
    <h1 style="font-size:26px;margin-bottom:20px;">Resultados para "${query}"</h1>
    ${skeletonGrid(8)}
  `;
  window.scrollTo({ top: 0, behavior: 'instant' });

  const { data, error } = await tmdbFetch('/search/movie', { query, include_adult: 'false', page: 1 });

  if (error || !data?.results?.length) {
    reelBar(false);
    app.innerHTML = `
      <div class="eyebrow">Busca TMDB</div>
      <h1 style="font-size:26px;margin-bottom:12px;">Resultados para "${query}"</h1>
      ${emptyState('ti-mood-sad', 'Nenhum resultado encontrado', error || 'Tente outro termo de busca.', `<button class="btn btn-primary" data-nav="home"><i class="ti ti-home"></i> Voltar ao início</button>`)}
    `;
    return;
  }

  buscaAtual = { query, pagina: 1, totalPaginas: data.total_pages || 1, carregando: false };

  // Pré-aquece o cache com os detalhes completos (nota, gênero) de cada resultado
  const detalhados = await getMovies(data.results.map(r => r.id));
  reelBar(false);

  app.innerHTML = `
    <div class="eyebrow">Busca TMDB · ${data.total_results} resultado${data.total_results > 1 ? 's' : ''}</div>
    <h1 style="font-size:26px;margin-bottom:20px;">Resultados para "${query}"</h1>
    <div class="movie-grid" id="busca-grid">${detalhados.map(movieCard).join('')}</div>
    <div id="busca-sentinel" style="height:1px;"></div>
    ${buscaAtual.pagina < buscaAtual.totalPaginas ? `<div id="busca-loading-more" style="text-align:center;padding:24px 0;">${skeletonGrid(4)}</div>` : ''}
  `;
  document.querySelectorAll('.nav-links a, .mobile-drawer nav a').forEach(a => a.classList.remove('active-link'));
  attachInfiniteScroll('busca-sentinel', carregarMaisBusca);
}

// Carrega mais uma página de resultados da busca e anexa ao grid existente (infinite scroll).
async function carregarMaisBusca() {
  if (buscaAtual.carregando || buscaAtual.pagina >= buscaAtual.totalPaginas) return;
  buscaAtual.carregando = true;
  const proximaPagina = buscaAtual.pagina + 1;
  const { data, error } = await tmdbFetch('/search/movie', { query: buscaAtual.query, include_adult: 'false', page: proximaPagina });
  const loadingEl = document.getElementById('busca-loading-more');

  if (error || !data?.results?.length) {
    loadingEl?.remove();
    buscaAtual.carregando = false;
    return;
  }

  const detalhados = await getMovies(data.results.map(r => r.id));
  const grid = document.getElementById('busca-grid');
  if (grid) grid.insertAdjacentHTML('beforeend', detalhados.map(movieCard).join(''));

  buscaAtual.pagina = proximaPagina;
  buscaAtual.carregando = false;
  if (buscaAtual.pagina >= buscaAtual.totalPaginas) loadingEl?.remove();
}

// ===================== NAVEGAÇÃO =====================
function reelBar(active) {
  const bar = document.getElementById('reel-bar');
  if (bar) bar.classList.toggle('active', !!active);
}

// Skeletons dedicados por página — evita o spinner central genérico e reduz "layout jump"
// entre o carregamento e o conteúdo final (bom para performance percebida e Core Web Vitals).
const SKELETON_BY_PAGE = {
  home: skeletonHome,
  populares: () => `<div class="skel skel-line w40" style="height:30px;margin-bottom:20px;"></div>${skeletonGrid(10)}`,
  indicacoes: () => `<div class="skel skel-line w40" style="height:30px;margin-bottom:20px;"></div>${skeletonGrid(7)}`,
  generos: () => skeletonGrid(8),
  filme: () => `<div class="skel skel-hero" style="height:340px;"></div>`,
  filtrar: () => `<div class="skel skel-line w40" style="height:30px;margin-bottom:20px;"></div>${skeletonGrid(10)}`,
  perfil: () => skeletonGrid(6),
  colecao: () => skeletonGrid(8),
  keyword: () => skeletonGrid(8),
  estudio: () => skeletonGrid(8),
  pessoa: () => skeletonGrid(8),
};

async function navigate(page, params = {}) {
  clearInterval(heroTimer);
  closeMobileDrawer();
  const app = document.getElementById('app');
  reelBar(true);
  app.classList.remove('page-enter');
  app.style.opacity = 0;
  await new Promise(r => setTimeout(r, 120));
  const skel = SKELETON_BY_PAGE[page];
  app.innerHTML = skel ? skel() : loadingBlock();
  app.style.opacity = 1;
  window.scrollTo({ top: 0, behavior: 'instant' });

  const pageFn = pages[page] || pages['404'];
  let html;
  try {
    html = await pageFn(params);
  } catch (err) {
    html = errorBlock('Algo deu errado ao carregar esta página. Tente novamente em instantes.');
  }
  app.innerHTML = html;
  reelBar(false);
  // força reflow para reiniciar a animação de entrada
  void app.offsetWidth;
  app.classList.add('page-enter');
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (page === 'home') startHeroRotation();
  if (page === 'comparar') {
    setupLiveSearch(document.getElementById('comparador-search'), document.getElementById('comparador-drop'), (tmdbId) => adicionarAoComparador(tmdbId));
  }
  if (page === 'populares') attachInfiniteScroll('populares-sentinel', carregarMaisPopulares);
  if (page === 'filtrar') attachInfiniteScroll('filtrar-sentinel', carregarMaisFiltrados);
  animateStatCounters();

  // Atualiza o estado "ativo" dos links da navbar/drawer para refletir a página atual
  document.querySelectorAll('.nav-links a, .mobile-drawer nav a').forEach(a => {
    a.classList.toggle('active-link', a.getAttribute('data-nav') === page);
  });
}

// ===================== SCROLL INFINITO (genérico, reaproveitado em populares/filtrar) =====================
// Guarda um observer por sentinela para poder desconectar o antigo ao trocar de página
// (evita disparar carregamento de uma página que o usuário já deixou).
const infiniteObservers = {};
function attachInfiniteScroll(sentinelId, loadMoreFn) {
  infiniteObservers[sentinelId]?.disconnect();
  const sentinela = document.getElementById(sentinelId);
  if (!sentinela) return;
  const obs = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadMoreFn();
  }, { rootMargin: '600px' });
  obs.observe(sentinela);
  infiniteObservers[sentinelId] = obs;
}

// ===================== SPOTLIGHT (mantido só no hero — removido dos pôsteres/carrossel a pedido) =====================
document.addEventListener('pointermove', (e) => {
  const target = e.target.closest('.hero');
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  target.style.setProperty('--spot-x', `${x}%`);
  target.style.setProperty('--spot-y', `${y}%`);
});

// ===================== SOMBRA DE SCROLL NA NAVBAR =====================
const navEl = document.querySelector('.nav');
window.addEventListener('scroll', () => {
  if (!navEl) return;
  navEl.classList.toggle('scrolled', window.scrollY > 8);
}, { passive: true });

// ===================== CONTADORES ANIMADOS (estatísticas do perfil) =====================
function animateStatCounters() {
  const nodes = document.querySelectorAll('.stat-value[data-count]');
  nodes.forEach(node => {
    const target = parseFloat(node.getAttribute('data-count')) || 0;
    const suffix = node.getAttribute('data-suffix') || '';
    const duration = 900;
    const start = performance.now();
    function tick(now) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = Math.round(target * eased);
      node.textContent = val + suffix;
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

// Cada slide do hero é uma camada absoluta empilhada; a troca acontece via classe
// .active (opacidade), o que permite uma transição suave em vez de "sumir e voltar".
function heroSlideMarkup(f, ativo) {
  const fundo = (f.Backdrop && f.Backdrop !== 'N/A') ? f.Backdrop : (f.Poster && f.Poster !== 'N/A' ? f.Poster : '');
  return `
  <div class="hero-slide ${ativo ? 'active' : ''}" data-hero-id="${f.imdbID}">
    <div class="hero-bg" style="${fundo ? `background-image:url('${fundo}');` : 'background:var(--border);'}"></div>
    <div class="hero-scrim"></div>
    <div class="hero-vignette"></div>
    <div class="hero-spotlight"></div>
    <div class="hero-content">
      <span class="hero-eyebrow"><i class="ti ti-flame"></i> ${ativo ? 'Destaque da semana' : 'Lançamento'}</span>
      <h1 class="hero-title">${f.Title}</h1>
      <div class="hero-meta">
        <span class="stamp"><i class="ti ti-star-filled" style="color:var(--amber)"></i> ${f.imdbRating} (${f.imdbVotes} avaliações)</span>
        <span>${f.Runtime}</span>
        <span>${(f.Genre || '').split(',')[0]}</span>
      </div>
      <div class="hero-actions">
        <button class="btn btn-primary" data-nav="filme" data-id="${f.imdbID}"><i class="ti ti-player-play-filled"></i> Ver detalhes</button>
        <button class="btn btn-ghost" style="color:#fff;border-color:rgba(255,255,255,0.4)" onclick="toggleWatchlist('${f.imdbID}', event)"><i class="ti ti-bookmark"></i> Quero assistir</button>
      </div>
    </div>
  </div>`;
}

// Troca o slide ativo do hero (usado tanto pelo timer automático quanto pelo clique nos dots).
function trocarHeroSlide(indice) {
  const hero = document.getElementById('hero');
  if (!hero) return;
  const slides = hero.querySelectorAll('.hero-slide');
  const dots = hero.querySelectorAll('.hero-dots span');
  if (!slides.length) return;
  heroIndex = ((indice % slides.length) + slides.length) % slides.length; // normaliza índices negativos
  slides.forEach((s, i) => s.classList.toggle('active', i === heroIndex));
  dots.forEach((d, i) => d.classList.toggle('active', i === heroIndex));
}

function startHeroRotation() {
  const hero = document.getElementById('hero');
  if (!hero) return;
  const totalSlides = hero.querySelectorAll('.hero-slide').length;
  if (totalSlides < 2) return; // sem necessidade de rotacionar com um único slide
  heroIndex = 0;
  heroTimer = setInterval(() => trocarHeroSlide(heroIndex + 1), 5500);
}

function toggleWatchlist(imdbID, e, fromCard) {
  if (e) e.stopPropagation();
  const idx = USUARIO_ATUAL.watchlist.indexOf(imdbID);
  const adicionando = idx === -1;
  if (adicionando) USUARIO_ATUAL.watchlist.push(imdbID);
  else USUARIO_ATUAL.watchlist.splice(idx, 1);
  saveStore(STORE_KEYS.watchlist, USUARIO_ATUAL.watchlist);
  toast(adicionando ? 'Adicionado à sua lista!' : 'Removido da sua lista', adicionando ? 'ti-bookmark-filled' : 'ti-bookmark-off');

  // Atualização otimista: só troca o ícone/classe do botão clicado, sem recarregar a página inteira.
  if (fromCard && e?.currentTarget) {
    const btn = e.currentTarget;
    btn.classList.toggle('saved', adicionando);
    btn.setAttribute('aria-label', adicionando ? 'Remover da minha lista' : 'Adicionar à minha lista');
    const icon = btn.querySelector('i');
    if (icon) icon.className = `ti ${adicionando ? 'ti-bookmark-filled' : 'ti-bookmark-plus'}`;
  } else {
    // Botão grande na página de detalhes: atualiza texto/ícone diretamente.
    const bigBtn = document.getElementById('watchlist-btn-detail');
    if (bigBtn) {
      bigBtn.innerHTML = `<i class="ti ${adicionando ? 'ti-bookmark-filled' : 'ti-bookmark-plus'}"></i> ${adicionando ? 'Na sua lista' : 'Quero assistir'}`;
    }
  }
}

// Marca/desmarca um filme como assistido (histórico) — libera avaliação e conta nas estatísticas.
// Marcar como assistido sempre remove de "assistindo agora", já que os estados são exclusivos.
function toggleAssistido(imdbID, e) {
  if (e) e.stopPropagation();
  const idx = USUARIO_ATUAL.historico.indexOf(imdbID);
  const marcando = idx === -1;
  if (marcando) {
    USUARIO_ATUAL.historico.push(imdbID);
    removerDeAssistindo(imdbID, false);
  } else {
    USUARIO_ATUAL.historico.splice(idx, 1);
  }
  saveStore(STORE_KEYS.assistidos, USUARIO_ATUAL.historico);
  toast(marcando ? 'Marcado como assistido!' : 'Removido do histórico', marcando ? 'ti-circle-check-filled' : 'ti-circle-x');
  atualizarBotoesDetalhe(imdbID);
}

// "Assistindo agora" é um estado intermediário entre watchlist e histórico — pensado para
// séries longas ou filmes vistos aos poucos. Marcar como assistindo remove da watchlist pura.
function toggleAssistindo(imdbID, e) {
  if (e) e.stopPropagation();
  const idx = USUARIO_ATUAL.assistindo.indexOf(imdbID);
  const marcando = idx === -1;
  if (marcando) {
    USUARIO_ATUAL.assistindo.push(imdbID);
    const wIdx = USUARIO_ATUAL.watchlist.indexOf(imdbID);
    if (wIdx > -1) { USUARIO_ATUAL.watchlist.splice(wIdx, 1); saveStore(STORE_KEYS.watchlist, USUARIO_ATUAL.watchlist); }
  } else {
    USUARIO_ATUAL.assistindo.splice(idx, 1);
  }
  saveStore(STORE_KEYS.assistindo, USUARIO_ATUAL.assistindo);
  toast(marcando ? 'Marcado como "assistindo agora"' : 'Removido de "assistindo agora"', 'ti-player-play');
  atualizarBotoesDetalhe(imdbID);
}

function removerDeAssistindo(imdbID, persistir = true) {
  const idx = USUARIO_ATUAL.assistindo.indexOf(imdbID);
  if (idx === -1) return;
  USUARIO_ATUAL.assistindo.splice(idx, 1);
  if (persistir) saveStore(STORE_KEYS.assistindo, USUARIO_ATUAL.assistindo);
}

// Atualiza os três botões de estado (watchlist/assistindo/assistido) na página de detalhes
// sem precisar recarregar a página inteira — mantém a UI consistente após qualquer toggle.
function atualizarBotoesDetalhe(imdbID) {
  const emWatchlist = USUARIO_ATUAL.watchlist.includes(imdbID);
  const assistindo = USUARIO_ATUAL.assistindo.includes(imdbID);
  const assistido = USUARIO_ATUAL.historico.includes(imdbID);

  const wBtn = document.getElementById('watchlist-btn-detail');
  if (wBtn) wBtn.innerHTML = `<i class="ti ${emWatchlist ? 'bookmark-filled' : 'bookmark-plus'}"></i> ${emWatchlist ? 'Na sua lista' : 'Quero assistir'}`;

  const aBtn = document.getElementById('assistindo-btn-detail');
  if (aBtn) {
    aBtn.classList.toggle('btn-primary', assistindo);
    aBtn.classList.toggle('btn-ghost', !assistindo);
    aBtn.innerHTML = `<i class="ti ti-player-play${assistindo ? '-filled' : ''}"></i> ${assistindo ? 'Assistindo agora' : 'Comecei a assistir'}`;
  }

  const bigBtn = document.getElementById('assistido-btn-detail');
  if (bigBtn) {
    bigBtn.classList.toggle('btn-primary', assistido);
    bigBtn.classList.toggle('btn-ghost', !assistido);
    bigBtn.innerHTML = `<i class="ti ${assistido ? 'ti-circle-check-filled' : 'ti-circle-check'}"></i> ${assistido ? 'Assistido' : 'Marcar como assistido'}`;
  }
}

let notaSelecionada = 0;
function setStar(n) {
  notaSelecionada = n;
  document.querySelectorAll('#star-picker i').forEach((el, i) => {
    el.className = `ti ${i < n ? 'ti-star-filled active' : 'ti-star'}`;
    el.setAttribute('data-star', i + 1);
  });
}

// Publica (ou atualiza) a avaliação do usuário para um filme e persiste em localStorage.
// A avaliação aparece imediatamente no topo da lista de "Avaliações da comunidade".
function publicarAvaliacao(imdbID) {
  const jaTinha = avaliacoesUsuario[imdbID];
  const notaAtual = notaSelecionada || jaTinha?.nota || 0;
  if (!notaAtual) { toast('Escolha uma nota de 1 a 5 estrelas primeiro', 'ti-alert-triangle'); return; }
  const texto = document.getElementById('review-text')?.value.trim() || 'Sem comentário.';
  const spoiler = document.getElementById('spoiler-check')?.checked || false;
  const tags = Array.from(document.querySelectorAll('#review-tag-chips .chip.active')).map(c => c.textContent);

  avaliacoesUsuario[imdbID] = { nota: notaAtual, texto, spoiler, tags };
  saveStore(STORE_KEYS.avaliacoes, avaliacoesUsuario);
  notaSelecionada = 0;
  toast(jaTinha ? 'Avaliação atualizada!' : 'Avaliação publicada!', 'ti-star-filled');
  navigate('filme', { id: imdbID });
}

function removerAvaliacao(imdbID) {
  delete avaliacoesUsuario[imdbID];
  saveStore(STORE_KEYS.avaliacoes, avaliacoesUsuario);
  toast('Avaliação removida');
  navigate('filme', { id: imdbID });
}

// Troca o botão de "Assistir trailer" por um iframe incorporado do YouTube (carregado sob demanda,
// só quando o usuário clica — evita gastar dados/banda de quem não quer ver o trailer).
function carregarTrailer(youtubeKey) {
  const box = document.getElementById('trailer-box');
  if (!box) return;
  box.innerHTML = `<iframe src="https://www.youtube.com/embed/${youtubeKey}?autoplay=1&rel=0" title="Trailer" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
}

function compartilharFilme(imdbID, titulo) {
  const url = `${location.origin}${location.pathname}#filme-${imdbID}`;
  if (navigator.share) {
    navigator.share({ title: titulo, text: `Dá uma olhada em "${titulo}" no ScoreFlix`, url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => toast('Link copiado para a área de transferência!', 'ti-link'));
  } else {
    toast('Não foi possível compartilhar neste navegador');
  }
}

// ===================== MODAL: ADICIONAR A UMA LISTA =====================
function fecharModal() {
  const root = document.getElementById('modal-root');
  const scrim = root.querySelector('.modal-scrim');
  if (!scrim) return;
  scrim.classList.remove('open');
  setTimeout(() => { root.innerHTML = ''; }, 250);
}

function abrirModalListas(imdbID, titulo) {
  const root = document.getElementById('modal-root');
  const listas = USUARIO_ATUAL.listas;
  root.innerHTML = `
    <div class="modal-scrim" id="list-modal-scrim">
      <div class="modal-box" role="dialog" aria-modal="true" aria-label="Adicionar a uma lista">
        <div class="modal-head">
          <h3>Adicionar "${titulo}"</h3>
          <button class="modal-close" onclick="fecharModal()" aria-label="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <div id="modal-list-options" style="display:flex;flex-direction:column;gap:4px;margin-bottom:14px;">
          ${listas.length === 0 ? `<p style="font-size:13px;color:var(--ink-mute);">Você ainda não tem listas.</p>` :
            listas.map(l => {
              const dentro = l.filmes.includes(imdbID);
              return `
              <div class="modal-list-option ${dentro ? 'in-list' : ''}" onclick="alternarFilmeNaLista('${l.id}','${imdbID}', this)">
                <div class="check-circle"><i class="ti ti-check"></i></div>
                <div>
                  <div style="font-weight:600;font-size:13px;">${l.titulo}</div>
                  <div style="font-size:11px;color:var(--ink-mute);">${l.filmes.length} filme${l.filmes.length!==1?'s':''}</div>
                </div>
              </div>`;
            }).join('')}
        </div>
        <div class="field-group" style="display:flex;gap:8px;margin-bottom:0;">
          <input type="text" id="nova-lista-input" placeholder="Nome de uma nova lista..." style="flex:1;">
          <button class="btn btn-primary" onclick="criarListaEAdicionar('${imdbID}')"><i class="ti ti-plus"></i></button>
        </div>
      </div>
    </div>
  `;
  requestAnimationFrame(() => document.getElementById('list-modal-scrim').classList.add('open'));
  document.getElementById('list-modal-scrim').addEventListener('click', (e) => {
    if (e.target.id === 'list-modal-scrim') fecharModal();
  });
}

function alternarFilmeNaLista(listaId, imdbID, el) {
  const lista = USUARIO_ATUAL.listas.find(l => l.id === listaId);
  if (!lista) return;
  const idx = lista.filmes.indexOf(imdbID);
  if (idx > -1) { lista.filmes.splice(idx, 1); el.classList.remove('in-list'); }
  else { lista.filmes.push(imdbID); el.classList.add('in-list'); }
  saveStore(STORE_KEYS.listas, USUARIO_ATUAL.listas);
  const meta = el.querySelector('div > div:last-child');
  if (meta) meta.textContent = `${lista.filmes.length} filme${lista.filmes.length!==1?'s':''}`;
  toast(idx > -1 ? `Removido de "${lista.titulo}"` : `Adicionado a "${lista.titulo}"`);
}

// Filtro de gênero reutilizado nas abas de Watchlist e Histórico do perfil.
// activeProfileGenreFilter é resetado sempre que o usuário troca de aba.
let activeProfileGenreFilter = null;

function generoFilterChips(filmes, tab) {
  const generosPresentes = [...new Set(filmes.flatMap(f => (f.Genre || '').split(',').map(g => g.trim()).filter(Boolean)))];
  if (!generosPresentes.length) return '';
  return `
  <div class="chip-row" style="margin-bottom:18px;">
    <span class="chip ${!activeProfileGenreFilter ? 'active' : ''}" onclick="filtrarPerfilPorGenero('${tab}', null)">Todos</span>
    ${generosPresentes.map(g => `<span class="chip ${activeProfileGenreFilter===g ? 'active' : ''}" onclick="filtrarPerfilPorGenero('${tab}', '${g}')">${g}</span>`).join('')}
  </div>`;
}

function filtrarPerfilPorGenero(tab, genero) {
  activeProfileGenreFilter = genero;
  mudarTabPerfil(tab, true);
}

// ===================== ROLETA DE DESCOBERTA =====================
// Usa /discover/movie com uma página aleatória (a TMDB pagina os resultados por popularidade)
// para trazer um filme que atenda aos filtros, sem repetir sempre os mesmos títulos populares.
function cardSorteado(filme, rotulo, onclick, eyebrow) {
  const plot = filme.Plot || '';
  return `
    <div class="card" style="display:flex;gap:20px;flex-wrap:wrap;">
      ${eyebrow ? `<div class="eyebrow" style="width:100%;"><i class="ti ti-sparkles"></i> ${eyebrow}</div>` : ''}
      <div class="detail-poster" style="${posterStyle(filme.Poster)};width:140px;height:210px;flex-shrink:0;cursor:pointer;" data-nav="filme" data-id="${filme.imdbID}"></div>
      <div style="flex:1;min-width:200px;">
        <h3 style="font-size:20px;margin-bottom:6px;">${filme.Title}</h3>
        <div class="movie-meta" style="margin-bottom:10px;">
          <span><i class="ti ti-star-filled" style="color:var(--amber);"></i> ${filme.imdbRating}</span><span>·</span><span>${filme.Year}</span><span>·</span><span>${filme.Runtime}</span>
        </div>
        <p style="font-size:13px;color:var(--ink-soft);line-height:1.6;margin-bottom:16px;">${plot.slice(0, 220)}${plot.length > 220 ? '...' : ''}</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-primary" data-nav="filme" data-id="${filme.imdbID}"><i class="ti ti-info-circle"></i> Ver detalhes</button>
          <button class="btn btn-ghost" onclick="${onclick}"><i class="ti ti-refresh"></i> ${rotulo}</button>
        </div>
      </div>
    </div>`;
}

async function sortear(params, vazio, rotulo, onclick, eyebrow) {
  const resultado = document.getElementById('roleta-resultado');
  if (!resultado) return;
  resultado.innerHTML = skeletonGrid(1);
  const { data, error } = await tmdbFetch('/discover/movie', { sort_by: 'popularity.desc', include_adult: 'false', ...params });
  if (error || !data?.results?.length) { resultado.innerHTML = vazio; return; }
  const sorteado = data.results[Math.floor(Math.random() * data.results.length)];
  const filme = await getMovie(sorteado.id);
  resultado.innerHTML = filme ? cardSorteado(filme, rotulo, onclick, eyebrow)
    : errorBlock('Não foi possível carregar os detalhes do filme sorteado.');
}

function sortearFilme() {
  const v = id => document.getElementById(id)?.value || '';
  const params = {
    'vote_average.gte': v('roleta-nota') || '0',
    'vote_count.gte': 100, // evita filmes com 1-2 votos distorcendo a nota
    page: Math.floor(Math.random() * 20) + 1,
  };
  if (v('roleta-genero')) params.with_genres = v('roleta-genero');
  if (v('roleta-ano-de')) params['primary_release_date.gte'] = `${v('roleta-ano-de')}-01-01`;
  if (v('roleta-ano-ate')) params['primary_release_date.lte'] = `${v('roleta-ano-ate')}-12-31`;
  if (v('roleta-idioma')) params.with_original_language = v('roleta-idioma');
  if (v('roleta-provedor')) { params.with_watch_providers = v('roleta-provedor'); params.watch_region = 'BR'; }
  return sortear(params,
    emptyState('ti-mood-sad', 'Nenhum filme encontrado', 'Tente afrouxar os filtros (nota mínima mais baixa ou outro gênero).'),
    'Sortear outro', 'sortearFilme()');
}

// "Surpreenda-me": ignora os filtros do formulário e sorteia de todo o catálogo da TMDB.
function surpreendaMe() {
  return sortear({ 'vote_count.gte': 50, page: Math.floor(Math.random() * 500) + 1 },
    emptyState('ti-mood-sad', 'Ops', 'Não deu para sortear agora, tente de novo.'),
    'Sortear outra surpresa', 'surpreendaMe()', 'Surpresa total');
}


// ===================== COMPARADOR DE FILMES =====================
let comparadorIds = []; // até 3 imdbIDs sendo comparados na sessão atual

function comparadorTabela(filmes) {
  if (!filmes.length) return emptyState('ti-scale', 'Nenhum filme selecionado', 'Use a busca acima para adicionar filmes à comparação.');
  const linhas = [
    { label: 'Nota', get: f => `<i class="ti ti-star-filled" style="color:var(--amber);"></i> ${f.imdbRating}` },
    { label: 'Ano', get: f => f.Year },
    { label: 'Duração', get: f => f.Runtime },
    { label: 'Gênero', get: f => f.Genre },
    { label: 'Direção', get: f => f.Director },
    { label: 'Elenco', get: f => f.Actors },
    { label: 'Classificação', get: f => f.Rated },
  ];
  return `
  <div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;min-width:${filmes.length * 220}px;">
      <thead>
        <tr>
          <td style="width:120px;"></td>
          ${filmes.map(f => `
            <td style="padding:12px;vertical-align:top;">
              <div class="detail-poster" style="${posterStyle(f.Poster)};height:180px;margin-bottom:10px;cursor:pointer;" data-nav="filme" data-id="${f.imdbID}"></div>
              <div style="font-weight:600;font-size:14px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <span data-nav="filme" data-id="${f.imdbID}" style="cursor:pointer;">${f.Title}</span>
                <button class="icon-btn" style="width:26px;height:26px;font-size:11px;flex-shrink:0;" onclick="removerDoComparador('${f.imdbID}')" aria-label="Remover"><i class="ti ti-x"></i></button>
              </div>
            </td>
          `).join('')}
        </tr>
      </thead>
      <tbody>
        ${linhas.map(l => `
          <tr style="border-top:1px solid var(--border);">
            <td style="padding:10px 12px;font-size:12px;font-weight:600;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.03em;">${l.label}</td>
            ${filmes.map(f => `<td style="padding:10px 12px;font-size:13px;">${l.get(f)}</td>`).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  `;
}

async function adicionarAoComparador(imdbID) {
  if (comparadorIds.includes(imdbID)) { toast('Esse filme já está na comparação'); return; }
  if (comparadorIds.length >= 3) { toast('Você pode comparar até 3 filmes por vez'); return; }
  comparadorIds.push(imdbID);
  const filmes = await getMovies(comparadorIds);
  const tabela = document.getElementById('comparador-tabela');
  if (tabela) tabela.innerHTML = comparadorTabela(filmes);
  const input = document.getElementById('comparador-search');
  if (input) input.value = '';
  document.getElementById('comparador-drop')?.classList.remove('open');
}

async function removerDoComparador(imdbID) {
  comparadorIds = comparadorIds.filter(id => id !== imdbID);
  const filmes = await getMovies(comparadorIds);
  const tabela = document.getElementById('comparador-tabela');
  if (tabela) tabela.innerHTML = comparadorTabela(filmes);
}

// ===================== TABS DO PERFIL (Watchlist / Histórico / Minhas listas / Estatísticas) =====================
async function renderProfileTab(tab) {
  const u = USUARIO_ATUAL;

  if (tab === 'watchlist') {
    const todos = await getMovies(u.watchlist);
    const filmes = activeProfileGenreFilter ? todos.filter(m => (m.Genre||'').includes(activeProfileGenreFilter)) : todos;
    if (!todos.length) return emptyState('ti-bookmark', 'Sua watchlist está vazia', 'Adicione filmes que você quer assistir clicando no marcador em qualquer pôster.',
      `<button class="btn btn-primary" data-nav="populares"><i class="ti ti-compass"></i> Explorar filmes</button>`);
    return `${generoFilterChips(todos, 'watchlist')}<div class="movie-grid">${filmes.map(movieCard).join('') || `<p style="color:var(--ink-mute);font-size:13px;">Nenhum filme de ${activeProfileGenreFilter} na sua watchlist.</p>`}</div>`;
  }

  if (tab === 'historico') {
    const todos = await getMovies(u.historico);
    const filmes = activeProfileGenreFilter ? todos.filter(m => (m.Genre||'').includes(activeProfileGenreFilter)) : todos;
    if (!todos.length) return emptyState('ti-history', 'Nenhum filme assistido ainda', 'Marque filmes como "assistido" na página de detalhes para começar seu histórico.',
      `<button class="btn btn-primary" data-nav="populares"><i class="ti ti-compass"></i> Explorar filmes</button>`);
    return `${generoFilterChips(todos, 'historico')}<div class="movie-grid">${filmes.map(movieCard).join('') || `<p style="color:var(--ink-mute);font-size:13px;">Nenhum filme de ${activeProfileGenreFilter} no seu histórico.</p>`}</div>`;
  }

  if (tab === 'stats') return renderStatsTab();

  // tab === 'listas'
  const listasComFilmes = await Promise.all(u.listas.map(async l => ({ ...l, filmesObjs: await getMovies(l.filmes) })));
  const listasHtml = listasComFilmes.length ? listasComFilmes.map(l => `
      <div class="list-card" data-nav="lista" data-id="${l.id}">
        <div style="display:flex;align-items:center;gap:16px;min-width:0;">
          <div class="mini-poster-stack">
            ${l.filmesObjs.slice(0,4).map(f => `<div style="${posterStyle(f.Poster && f.Poster!=='N/A' ? f.Poster : '')}"></div>`).join('') || `<div style="background:var(--border);"></div>`}
          </div>
          <div style="min-width:0;">
            <div class="list-card-title">${l.titulo}</div>
            <div class="list-card-meta">${l.filmes.length} filme${l.filmes.length!==1?'s':''} · ${l.publica ? 'Pública' : 'Privada'}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
          <button class="icon-btn" style="width:30px;height:30px;font-size:13px;" onclick="event.stopPropagation();excluirLista('${l.id}')" aria-label="Excluir lista"><i class="ti ti-trash"></i></button>
          <i class="ti ti-chevron-right" style="color:var(--ink-mute);"></i>
        </div>
      </div>
  `).join('') : emptyState('ti-list', 'Você ainda não criou listas', 'Organize seus filmes favoritos em coleções temáticas, como "Terror pra maratonar" ou "Clássicos".');

  return `
    ${listasHtml}
    <div class="field-group" style="display:flex;gap:8px;margin-top:16px;margin-bottom:0;">
      <input type="text" id="perfil-nova-lista" placeholder="Nome da nova lista...">
      <button class="btn btn-primary" onclick="criarListaVazia()"><i class="ti ti-plus"></i> Criar lista</button>
    </div>
  `;
}

async function mudarTabPerfil(tab, manterFiltro) {
  activeProfileTab = tab;
  if (!manterFiltro) activeProfileGenreFilter = null;
  document.querySelectorAll('.tabs-row .tab-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  const content = document.getElementById('profile-tab-content');
  if (content) {
    content.style.opacity = 0;
    content.innerHTML = skeletonGrid(6);
    content.innerHTML = await renderProfileTab(tab);
    content.style.opacity = 1;
  }
}

// Gráfico de barras simples em SVG puro (sem lib) mostrando a distribuição de gêneros
// no histórico do usuário — base para "gênero favorito" e para embasar futuras recomendações.
async function renderStatsTab() {
  const u = USUARIO_ATUAL;
  const filmes = await getMovies(u.historico);
  if (!filmes.length) {
    return emptyState('ti-chart-bar', 'Sem dados suficientes ainda', 'Marque alguns filmes como assistidos para ver suas estatísticas de gênero.',
      `<button class="btn btn-primary" data-nav="populares"><i class="ti ti-compass"></i> Explorar filmes</button>`);
  }

  const contagem = {};
  filmes.forEach(f => (f.Genre || '').split(',').map(g => g.trim()).filter(Boolean).forEach(g => {
    contagem[g] = (contagem[g] || 0) + 1;
  }));
  const entradas = Object.entries(contagem).sort((a,b) => b[1] - a[1]);
  const max = entradas[0]?.[1] || 1;
  const cores = ['#E31E42', '#1E9C8B', '#4B3F8C', '#E38A1E', '#1E7CE3', '#9C1E8C', '#3F8C4B', '#8C3F1E'];

  const notasFilmes = filmes.map(f => parseFloat(f.imdbRating)).filter(n => !isNaN(n));
  const notaMedia = notasFilmes.length ? (notasFilmes.reduce((a,b)=>a+b,0) / notasFilmes.length).toFixed(1) : '—';
  const decadas = {};
  filmes.forEach(f => { const ano = parseInt(f.Year); if (ano) { const dec = Math.floor(ano/10)*10; decadas[dec] = (decadas[dec]||0)+1; } });
  const decadaTop = Object.entries(decadas).sort((a,b)=>b[1]-a[1])[0];

  return `
  <div class="stats-grid" style="margin-bottom:24px;">
    <div class="stat-card"><div class="stat-value">${notaMedia}</div><div class="stat-label">Nota média dos seus filmes</div></div>
    <div class="stat-card"><div class="stat-value">${entradas[0]?.[0] || '—'}</div><div class="stat-label">Gênero mais assistido</div></div>
    <div class="stat-card"><div class="stat-value">${decadaTop ? decadaTop[0]+'s' : '—'}</div><div class="stat-label">Década favorita</div></div>
  </div>
  <div class="card">
    <div class="field-label" style="margin-bottom:16px;">Distribuição por gênero (${filmes.length} filme${filmes.length!==1?'s':''} assistido${filmes.length!==1?'s':''})</div>
    <div style="display:flex;flex-direction:column;gap:12px;">
      ${entradas.map(([genero, count], i) => `
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:110px;font-size:13px;font-weight:600;flex-shrink:0;">${genero}</div>
          <div style="flex:1;background:var(--border);border-radius:6px;overflow:hidden;height:18px;">
            <div style="width:${(count/max*100)}%;height:100%;background:${cores[i % cores.length]};border-radius:6px;transition:width 0.6s var(--ease-out);"></div>
          </div>
          <div style="width:28px;font-size:12px;color:var(--ink-mute);text-align:right;flex-shrink:0;">${count}</div>
        </div>
      `).join('')}
    </div>
  </div>
  `;
}

function criarListaVazia() {
  const input = document.getElementById('perfil-nova-lista');
  const nome = input?.value.trim();
  if (!nome) { toast('Dê um nome para a lista'); return; }
  USUARIO_ATUAL.listas.push({ id: 'l' + Date.now(), titulo: nome, filmes: [], publica: true });
  saveStore(STORE_KEYS.listas, USUARIO_ATUAL.listas);
  toast(`Lista "${nome}" criada!`, 'ti-list-check');
  mudarTabPerfil('listas');
}

function excluirLista(listaId) {
  const lista = USUARIO_ATUAL.listas.find(l => l.id === listaId);
  USUARIO_ATUAL.listas = USUARIO_ATUAL.listas.filter(l => l.id !== listaId);
  saveStore(STORE_KEYS.listas, USUARIO_ATUAL.listas);
  toast(`Lista "${lista?.titulo || ''}" excluída`);
  mudarTabPerfil('listas');
}

// ===================== ONBOARDING DE GÊNEROS FAVORITOS =====================
// Perguntado uma única vez no primeiro acesso; alimenta "Recomendados para você" na home
// junto com o histórico do usuário, em vez de depender só da lista estática RECOMENDADOS_IDS.
function abrirOnboarding() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-scrim" id="onboarding-scrim">
      <div class="modal-box" role="dialog" aria-modal="true" aria-label="Escolha seus gêneros favoritos">
        <div class="modal-head">
          <h3>Do que você mais gosta?</h3>
        </div>
        <p style="font-size:13px;color:var(--ink-soft);margin-bottom:16px;">
          Escolha de 1 a 4 gêneros para personalizarmos suas recomendações. Você pode mudar isso depois no seu perfil.
        </p>
        <div class="chip-row" id="onboarding-chips" style="margin-bottom:20px;">
          ${GENEROS.map(g => `<span class="chip" data-genero="${g}" onclick="this.classList.toggle('active')">${g}</span>`).join('')}
        </div>
        <button class="btn btn-primary btn-block" onclick="concluirOnboarding()"><i class="ti ti-check"></i> Confirmar</button>
        <button class="btn btn-ghost btn-block" style="margin-top:8px;" onclick="pularOnboarding()">Pular por agora</button>
      </div>
    </div>
  `;
  requestAnimationFrame(() => document.getElementById('onboarding-scrim').classList.add('open'));
}

function concluirOnboarding() {
  const escolhidos = Array.from(document.querySelectorAll('#onboarding-chips .chip.active')).map(c => c.getAttribute('data-genero'));
  generosFavoritos = escolhidos;
  saveStore('sf_generos_favoritos', generosFavoritos);
  saveStore('sf_onboarding_feito', true);
  if (escolhidos.length) {
    USUARIO_ATUAL.stats.genero_favorito = escolhidos[0];
    saveStore('sf_perfil', { nome: USUARIO_ATUAL.nome, usuario: USUARIO_ATUAL.usuario, iniciais: USUARIO_ATUAL.iniciais, genero_favorito: escolhidos[0] });
  }
  fecharModal();
  toast('Preferências salvas! Suas recomendações já foram atualizadas.', 'ti-sparkles');
  navigate('home');
}

function pularOnboarding() {
  saveStore('sf_onboarding_feito', true);
  fecharModal();
}

function abrirModalEditarPerfil() {
  const root = document.getElementById('modal-root');
  const u = USUARIO_ATUAL;
  const cores = [
    { id: 'amber', hex: '#E3A21E' }, { id: 'wine', hex: '#8A2540' }, { id: 'olive', hex: '#5B6E3A' },
    { id: 'ocean', hex: '#2563EB' }, { id: 'violet', hex: '#7C3AED' }, { id: 'rose', hex: '#E31E42' },
  ];
  root.innerHTML = `
    <div class="modal-scrim" id="edit-modal-scrim">
      <div class="modal-box" role="dialog" aria-modal="true" aria-label="Editar perfil">
        <div class="modal-head">
          <h3>Editar perfil</h3>
          <button class="modal-close" onclick="fecharModal()" aria-label="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <div class="field-group">
          <label class="field-label">Nome de exibição</label>
          <input type="text" id="edit-nome" value="${u.nome}">
        </div>
        <div class="field-group">
          <label class="field-label">Usuário</label>
          <input type="text" id="edit-usuario" value="${u.usuario}">
        </div>
        <div class="field-group">
          <label class="field-label">Bio</label>
          <textarea id="edit-bio" placeholder="Conte um pouco sobre seu gosto de cinema...">${u.bio || ''}</textarea>
        </div>
        <div class="field-group">
          <label class="field-label">Cor do perfil</label>
          <div class="color-swatch-row" id="edit-cor-perfil">
            ${cores.map(c => `<span class="color-swatch ${u.cor === c.id ? 'active' : ''}" data-cor="${c.id}" style="background:${c.hex};" onclick="selecionarCorPerfil('${c.id}')" role="button" aria-label="Cor ${c.id}"></span>`).join('')}
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Gênero favorito</label>
          <select id="edit-genero">${GENEROS.map(g => `<option ${g===u.stats.genero_favorito?'selected':''}>${g}</option>`).join('')}</select>
        </div>
        <div class="field-group">
          <label class="field-label">Gêneros favoritos (recomendações)</label>
          <div class="chip-row" id="edit-generos-favoritos">
            ${GENEROS.map(g => `<span class="chip ${generosFavoritos.includes(g)?'active':''}" data-genero="${g}" onclick="this.classList.toggle('active')">${g}</span>`).join('')}
          </div>
        </div>
        <div class="field-group" style="display:flex;align-items:center;justify-content:space-between;">
          <label class="field-label" style="margin-bottom:0;">Perfil público (visível para a comunidade)</label>
          <label class="switch">
            <input type="checkbox" id="edit-publico" ${u.perfil_publico !== false ? 'checked' : ''}>
            <span class="switch-track"></span>
          </label>
        </div>
        <button class="btn btn-primary btn-block" onclick="salvarPerfil()"><i class="ti ti-device-floppy"></i> Salvar alterações</button>
      </div>
    </div>
  `;
  requestAnimationFrame(() => document.getElementById('edit-modal-scrim').classList.add('open'));
  document.getElementById('edit-modal-scrim').addEventListener('click', (e) => {
    if (e.target.id === 'edit-modal-scrim') fecharModal();
  });
}

function selecionarCorPerfil(cor) {
  USUARIO_ATUAL.cor = cor;
  document.querySelectorAll('#edit-cor-perfil .color-swatch').forEach(s => s.classList.toggle('active', s.getAttribute('data-cor') === cor));
}

// ===================== EXPORTAR / IMPORTAR DADOS =====================
// Como tudo hoje vive em localStorage, isso funciona como um backup manual do usuário
// e também como uma forma simples de levar os dados para outro navegador/dispositivo.
function exportarDados() {
  const pacote = {
    versao: 1,
    exportado_em: new Date().toISOString(),
    watchlist: USUARIO_ATUAL.watchlist,
    historico: USUARIO_ATUAL.historico,
    assistindo: USUARIO_ATUAL.assistindo,
    listas: USUARIO_ATUAL.listas,
    avaliacoes: avaliacoesUsuario,
    perfil: { nome: USUARIO_ATUAL.nome, usuario: USUARIO_ATUAL.usuario, genero_favorito: USUARIO_ATUAL.stats.genero_favorito },
  };
  const blob = new Blob([JSON.stringify(pacote, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scoreflix-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Backup baixado!', 'ti-download');
}

function abrirSeletorImportacao() {
  document.getElementById('import-file-input')?.click();
}

function importarDados(fileInput) {
  const file = fileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const pacote = JSON.parse(reader.result);
      if (!pacote || typeof pacote !== 'object') throw new Error('formato inválido');

      USUARIO_ATUAL.watchlist = Array.isArray(pacote.watchlist) ? pacote.watchlist : USUARIO_ATUAL.watchlist;
      USUARIO_ATUAL.historico = Array.isArray(pacote.historico) ? pacote.historico : USUARIO_ATUAL.historico;
      USUARIO_ATUAL.assistindo = Array.isArray(pacote.assistindo) ? pacote.assistindo : USUARIO_ATUAL.assistindo;
      USUARIO_ATUAL.listas = Array.isArray(pacote.listas) ? pacote.listas : USUARIO_ATUAL.listas;
      avaliacoesUsuario = (pacote.avaliacoes && typeof pacote.avaliacoes === 'object') ? pacote.avaliacoes : avaliacoesUsuario;
      if (pacote.perfil) Object.assign(USUARIO_ATUAL, { nome: pacote.perfil.nome || USUARIO_ATUAL.nome, usuario: pacote.perfil.usuario || USUARIO_ATUAL.usuario });

      saveStore(STORE_KEYS.watchlist, USUARIO_ATUAL.watchlist);
      saveStore(STORE_KEYS.assistidos, USUARIO_ATUAL.historico);
      saveStore(STORE_KEYS.assistindo, USUARIO_ATUAL.assistindo);
      saveStore(STORE_KEYS.listas, USUARIO_ATUAL.listas);
      saveStore(STORE_KEYS.avaliacoes, avaliacoesUsuario);

      toast('Dados importados com sucesso!', 'ti-check');
      navigate('perfil');
    } catch (err) {
      toast('Arquivo inválido. Verifique se é um backup do ScoreFlix.', 'ti-alert-triangle');
    }
  };
  reader.readAsText(file);
  fileInput.value = ''; // permite reimportar o mesmo arquivo depois, se precisar
}

function salvarPerfil() {
  const nome = document.getElementById('edit-nome')?.value.trim();
  const usuario = document.getElementById('edit-usuario')?.value.trim();
  const genero = document.getElementById('edit-genero')?.value;
  const bio = document.getElementById('edit-bio')?.value.trim() || '';
  const publico = document.getElementById('edit-publico')?.checked !== false;
  if (!nome || !usuario) { toast('Preencha nome e usuário'); return; }
  USUARIO_ATUAL.nome = nome;
  USUARIO_ATUAL.usuario = usuario.replace(/^@/, '');
  USUARIO_ATUAL.iniciais = nome.split(' ').slice(0,2).map(p => p[0]).join('').toUpperCase();
  USUARIO_ATUAL.stats.genero_favorito = genero;
  USUARIO_ATUAL.bio = bio;
  USUARIO_ATUAL.perfil_publico = publico;
  // USUARIO_ATUAL.cor já foi atualizado ao vivo por selecionarCorPerfil()
  saveStore('sf_perfil', {
    nome: USUARIO_ATUAL.nome, usuario: USUARIO_ATUAL.usuario, iniciais: USUARIO_ATUAL.iniciais,
    genero_favorito: genero, bio: USUARIO_ATUAL.bio, cor: USUARIO_ATUAL.cor, perfil_publico: publico,
  });
  generosFavoritos = Array.from(document.querySelectorAll('#edit-generos-favoritos .chip.active')).map(c => c.getAttribute('data-genero'));
  saveStore('sf_generos_favoritos', generosFavoritos);
  fecharModal();
  toast('Perfil atualizado!', 'ti-check');
  navigate('perfil');
}

function criarListaEAdicionar(imdbID) {
  const input = document.getElementById('nova-lista-input');
  const nome = input?.value.trim();
  if (!nome) { toast('Dê um nome para a lista'); return; }
  const nova = { id: 'l' + Date.now(), titulo: nome, filmes: [imdbID], publica: true };
  USUARIO_ATUAL.listas.push(nova);
  saveStore(STORE_KEYS.listas, USUARIO_ATUAL.listas);
  toast(`Lista "${nome}" criada!`, 'ti-list-check');
  abrirModalListas(imdbID, document.querySelector('.modal-head h3')?.textContent.replace(/^Adicionar "|"$/g,'') || '');
}

// Delegação de clique global para data-nav (também repassa data-id e data-genero)
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-nav]');
  if (!el) return;
  const page = el.getAttribute('data-nav');
  const id = el.getAttribute('data-id');
  const genero = el.getAttribute('data-genero');
  const ordem = el.getAttribute('data-ordem');
  const nome = el.getAttribute('data-nome');
  const tab = el.getAttribute('data-tab');
  const cid = el.getAttribute('data-cid');
  const kid = el.getAttribute('data-kid');
  const coid = el.getAttribute('data-coid');
  const params = {};
  if (id) params.id = id;
  if (genero) params.genero = genero;
  if (ordem) params.ordem = ordem;
  if (nome) params.nome = nome;
  if (tab) params.tab = tab;
  if (cid) params.cid = cid;
  if (kid) params.kid = kid;
  if (coid) params.coid = coid;
  navigate(page, params);
});

// Suporte a teclado: Enter/Espaço ativam qualquer elemento navegável focável
// (cards de filme, avatar, brand-mark), igualando o comportamento a um clique.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('[data-nav][tabindex]');
  if (!el) return;
  e.preventDefault();
  el.click();
});

// ===================== BUSCA COM SUGESTÕES AO VIVO (debounce) =====================
// Alterna entre um dropdown de prévia (enquanto digita) e a página de resultados completa (Enter).
function setupLiveSearch(inputEl, dropEl, onSelect) {
  if (!inputEl) return;
  let debounceTimer = null;
  let lastQuery = '';

  inputEl.addEventListener('input', () => {
    const q = inputEl.value.trim();
    clearTimeout(debounceTimer);
    if (!dropEl) return;
    if (q.length < 2) { dropEl.classList.remove('open'); dropEl.innerHTML = ''; return; }
    debounceTimer = setTimeout(() => runLiveSearch(q, dropEl, inputEl), 350);
  });

  inputEl.addEventListener('keydown', (e) => {
    const open = dropEl?.classList.contains('open');
    const itens = open ? Array.from(dropEl.querySelectorAll('.search-drop-item')) : [];

    if (e.key === 'ArrowDown' && itens.length) {
      e.preventDefault();
      const atual = dropEl.querySelector('.search-drop-item.focused');
      const idx = atual ? itens.indexOf(atual) : -1;
      const prox = itens[Math.min(idx + 1, itens.length - 1)];
      atual?.classList.remove('focused');
      prox.classList.add('focused');
      prox.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'ArrowUp' && itens.length) {
      e.preventDefault();
      const atual = dropEl.querySelector('.search-drop-item.focused');
      const idx = atual ? itens.indexOf(atual) : 0;
      const prev = itens[Math.max(idx - 1, 0)];
      atual?.classList.remove('focused');
      prev.classList.add('focused');
      prev.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const focado = dropEl?.querySelector('.search-drop-item.focused');
      if (focado) { focado.click(); return; }
      if (dropEl) dropEl.classList.remove('open');
      buscarTMDB(inputEl.value);
    } else if (e.key === 'Escape' && dropEl) {
      dropEl.classList.remove('open');
    }
  });

  async function runLiveSearch(q, dropEl, inputEl) {
    lastQuery = q;
    const { results, error } = await tmdbSearch(q);
    if (lastQuery !== q) return; // resposta obsoleta (usuário já digitou algo novo)
    if (error || !results.length) {
      dropEl.innerHTML = `<div class="search-drop-empty">Nenhum filme encontrado para "${q}"</div>`;
      dropEl.classList.add('open');
      return;
    }
    const top = results.slice(0, 6);
    dropEl.innerHTML = `
      ${top.map(r => `
        <div class="search-drop-item" ${onSelect ? `data-tmdb-id="${r.id}"` : `data-nav="filme" data-id="${r.id}"`}>
          <div class="search-drop-poster" style="${posterStyle(r.poster_path ? tmdbImg(r.poster_path, 'w92') : '')}"></div>
          <div class="search-drop-info">
            <div class="search-drop-title">${r.title || r.original_title}</div>
            <div class="search-drop-meta">${(r.release_date || '').slice(0,4) || 'Data desconhecida'}</div>
          </div>
        </div>
      `).join('')}
      ${onSelect ? '' : `
      <div class="search-drop-footer" onclick="document.getElementById('search-drop').classList.remove('open');buscarTMDB('${q.replace(/'/g,"\\'")}')">
        Ver todos os resultados para "${q}"
      </div>`}
    `;
    if (onSelect) {
      dropEl.querySelectorAll('.search-drop-item').forEach(el => {
        el.addEventListener('click', () => onSelect(el.getAttribute('data-tmdb-id')));
      });
    }
    dropEl.classList.add('open');
  }
}
setupLiveSearch(document.getElementById('nav-search-input'), document.getElementById('search-drop'));
setupLiveSearch(document.getElementById('drawer-search-input'), null);

// Fecha o dropdown de busca ao clicar fora dele
document.addEventListener('click', (e) => {
  const drop = document.getElementById('search-drop');
  if (drop && !e.target.closest('.nav-search')) drop.classList.remove('open');
});

// Enter no campo de busca do menu mobile também dispara a busca completa
const drawerSearchInput = document.getElementById('drawer-search-input');
drawerSearchInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); buscarTMDB(drawerSearchInput.value); closeMobileDrawer(); }
});

// ===================== MENU MOBILE (drawer) =====================
function openMobileDrawer() {
  document.getElementById('mobile-drawer')?.classList.add('open');
  document.getElementById('drawer-scrim')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeMobileDrawer() {
  document.getElementById('mobile-drawer')?.classList.remove('open');
  document.getElementById('drawer-scrim')?.classList.remove('open');
  document.body.style.overflow = '';
}
document.getElementById('burger-btn')?.addEventListener('click', openMobileDrawer);
document.getElementById('drawer-close')?.addEventListener('click', closeMobileDrawer);
document.getElementById('drawer-scrim')?.addEventListener('click', closeMobileDrawer);

// Fecha modal/drawer com a tecla ESC — melhora acessibilidade e uso por teclado
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('mobile-drawer')?.classList.contains('open')) closeMobileDrawer();
  if (document.querySelector('.modal-scrim.open')) fecharModal();
});

// Atalho "/" foca a busca (padrão de sites como GitHub/YouTube) — ignora quando o
// usuário já está digitando em outro campo de texto, pra não atrapalhar formulários.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  e.preventDefault();
  document.getElementById('nav-search-input')?.focus();
});

// ===================== TEMA (persistido em localStorage) =====================
const themeBtn = document.getElementById('theme-toggle');
const temaSalvo = localStorage.getItem('sf_tema');
if (temaSalvo) {
  document.documentElement.setAttribute('data-theme', temaSalvo);
  themeBtn.setAttribute('aria-label', temaSalvo === 'dark' ? 'Alternar para modo claro' : 'Alternar para modo escuro');
} else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
  // Respeita a preferência do sistema operacional na primeira visita
  document.documentElement.setAttribute('data-theme', 'dark');
  themeBtn.setAttribute('aria-label', 'Alternar para modo claro');
}
themeBtn.addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const novoTema = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', novoTema);
  localStorage.setItem('sf_tema', novoTema);
  themeBtn.setAttribute('aria-label', novoTema === 'dark' ? 'Alternar para modo claro' : 'Alternar para modo escuro');
});

// Feedback visual leve de "sem internet" — importante já que o app depende 100% da TMDB
window.addEventListener('offline', () => toast('Sem conexão com a internet. Os dados podem não carregar.', 'ti-wifi-off'));
window.addEventListener('online', () => toast('Conexão restabelecida!', 'ti-wifi'));

// ===================== PWA: registro do Service Worker =====================
// Habilita instalação do app e navegação básica offline (filmes já visitados
// ficam disponíveis via cache mesmo sem internet).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Falha silenciosa: o app continua funcionando normalmente sem o service worker
    });
  });
}

// Boot
document.getElementById('app').style.transition = 'opacity 0.15s ease';
navigate('home').then(() => {
  if (!onboardingConcluido) abrirOnboarding();
});
