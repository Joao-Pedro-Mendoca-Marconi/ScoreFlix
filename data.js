// Curadoria do catálogo — os dados completos (pôster, sinopse, elenco, nota, etc.)
// vêm ao vivo da TMDB API (veja TMDB_DEFAULT_TOKEN em app.js). Aqui só guardamos
// os IMDb IDs reais e os dados fictícios de comunidade (usuário, avaliações).

const GENEROS = [
  "Ação", "Drama", "Suspense", "Ficção científica", "Comédia", "Terror",
  "Animação", "Romance", "Fantasia", "Mistério", "Guerra", "Musical",
  "Família", "Documentário", "Crime", "Aventura",
];

// Pool principal do catálogo — filmes reais
const CATALOGO_IDS = [
  "tt1375666", // Inception
  "tt0468569", // The Dark Knight
  "tt0111161", // The Shawshank Redemption
  "tt0137523", // Fight Club
  "tt0109830", // Forrest Gump
  "tt0110912", // Pulp Fiction
  "tt0133093", // The Matrix
  "tt0816692", // Interstellar
  "tt0114369", // Se7en
  "tt0102926", // The Silence of the Lambs
  "tt0407887", // The Departed
  "tt0172495", // Gladiator
  "tt0361748", // Inglourious Basterds
  "tt0482571", // The Prestige
  "tt0209144", // Memento
  "tt6751668", // Parasite
  "tt2582802", // Whiplash
  "tt4154796", // Avengers: Endgame
  "tt0245429", // Spirited Away
  "tt0080684", // The Empire Strikes Back
  "tt0068646", // The Godfather
  "tt0071562", // The Godfather Part II
  "tt0120737", // The Lord of the Rings: The Fellowship of the Ring
  "tt0167260", // The Lord of the Rings: The Return of the King
  "tt0993846", // The Wolf of Wall Street
  "tt0120815", // Saving Private Ryan
  "tt0088763", // Back to the Future
  "tt0076759", // Star Wars
  "tt0338013", // Eternal Sunshine of the Spotless Mind
  "tt7286456", // Joker
  "tt0417741", // Harry Potter and the Order of the Phoenix
  "tt0910970", // WALL·E
  "tt0435761", // Toy Story 3
  "tt1049413", // Up
  "tt0398286", // Tangled
  "tt2380307", // Coco
  "tt0499549", // Avatar
  "tt0770828", // Ratatouille
  "tt1130884", // Shutter Island
];

const DESTAQUE_ID = "tt1375666";
const LANCAMENTOS_IDS = ["tt6751668", "tt2582802", "tt4154796", "tt0816692", "tt0468569", "tt7286456"];
const RECOMENDADOS_IDS = [
  "tt0468569", "tt0114369", "tt0137523", "tt0133093", "tt0209144",
  "tt0068646", "tt0120737", "tt0993846", "tt1130884", "tt0338013",
];
const INDICACOES_IDS = [
  "tt0468569", "tt0114369", "tt0137523", "tt0133093", "tt0209144", "tt0361748", "tt6751668",
  "tt0068646", "tt0071562", "tt0120737", "tt0167260", "tt0993846", "tt0120815", "tt7286456",
  "tt0910970", "tt1049413", "tt2380307",
];

// Avaliações fictícias da comunidade, associadas ao IMDb ID de cada filme
const MOCK_AVALIACOES = {
  "tt1375666": [
    { usuario: "biamoraes", nota: 5, texto: "Estrutura de sonhos dentro de sonhos impecável. Nolan no auge.", spoiler: false, tags: ["#RoteiroInteligente"] },
    { usuario: "cine_tuca", nota: 5, texto: "O pião no final ainda me deixa sem dormir de madrugada.", spoiler: true, tags: ["#FinalSurpreendente"] },
  ],
  "tt0468569": [
    { usuario: "julia.reads", nota: 5, texto: "Heath Ledger merece cada prêmio que recebeu por esse Coringa.", spoiler: false, tags: ["#AtuaçãoImpecável"] },
  ],
  "tt6751668": [
    { usuario: "pedro_hs", nota: 5, texto: "Cada cômodo da casa representa uma camada social diferente. Genial.", spoiler: false, tags: ["#RoteiroInteligente"] },
    { usuario: "anacaon", nota: 4, texto: "Tensão constante, a virada no meio do filme muda tudo.", spoiler: false, tags: [] },
  ],
  "tt0209144": [
    { usuario: "julia.reads", nota: 5, texto: "Narrativa não-linear que exige atenção total, mas compensa muito.", spoiler: false, tags: ["#RoteiroInteligente"] },
  ],
};

// Perfis mockados da comunidade — os mesmos "usuarios" que aparecem em MOCK_AVALIACOES,
// usados para o feed de atividade e para o recurso de "seguir usuários" (também mockado,
// sem backend: seguir/deixar de seguir só persiste localmente em quem está logado).
const USUARIOS_COMUNIDADE = [
  { usuario: "biamoraes", nome: "Beatriz Moraes", iniciais: "BM" },
  { usuario: "cine_tuca", nome: "Arthur Bezerra", iniciais: "AB" },
  { usuario: "julia.reads", nome: "Julia Andrade", iniciais: "JA" },
  { usuario: "pedro_hs", nome: "Pedro Henrique", iniciais: "PH" },
  { usuario: "anacaon", nome: "Ana Caon", iniciais: "AC" },
];

// Feed de atividade — derivado das próprias avaliações mockadas acima, então não duplica
// dados: cada entrada aponta pro filme (imdbID) e pro texto que a pessoa já escreveu.
const FEED_ATIVIDADE = Object.entries(MOCK_AVALIACOES).flatMap(([imdbID, avaliacoes]) =>
  avaliacoes.map(av => ({ ...av, imdbID }))
);

// Usuário logado (mock) — watchlist/histórico referenciam IMDb IDs reais.
// Estes são apenas os valores DEFAULT/seed; em runtime, app.js sobrescreve
// watchlist/historico/listas com o que estiver salvo no localStorage do usuário.
const USUARIO_ATUAL = {
  nome: "João Pedro",
  usuario: "joaopedro",
  iniciais: "JP",
  bio: "Apaixonado por cinema desde sempre. Suspense e ficção científica são meu forte.",
  cor: "amber",
  perfil_publico: true,
  membro_desde: "Março 2024",
  stats: { genero_favorito: "Suspense" },
  watchlist: ["tt0102926", "tt0816692", "tt0361748"],
  historico: ["tt1375666", "tt0110912", "tt0468569", "tt4154796"],
  listas: [
    { id: "l1", titulo: "Suspenses que me deixaram paranoico", filmes: ["tt0102926", "tt0114369"], publica: true },
    { id: "l2", titulo: "Obras-primas do Nolan", filmes: ["tt1375666", "tt0468569", "tt0209144"], publica: true },
  ]
};
