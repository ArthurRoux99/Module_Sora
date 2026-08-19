/**
 * Trouve, pour un site cible, les modules du corpus dont le moteur est le plus
 * proche — pour partir d'un module qui marche au lieu d'écrire from scratch.
 *
 * Sonde le site (HTML + endpoints usuels), en déduit son moteur, puis classe
 * les modules du corpus par proximité.
 *
 * Usage : node tools/match-engine.mjs https://exemple.tv/
 */
import { readFile } from 'node:fs/promises';

const url = process.argv[2];
if (!url) { console.log('usage: node tools/match-engine.mjs <https://site/>'); process.exit(1); }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const origin = new URL(url).origin;

async function probe(u, opts = {}) {
  try {
    const r = await fetch(u, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8', ...(opts.headers || {}) },
      method: opts.method || 'GET',
      body: opts.body,
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    return { status: r.status, text, ct: r.headers.get('content-type') || '' };
  } catch (e) { return { status: null, text: '', ct: '', error: e.message }; }
}

console.log(`\x1b[1mcible\x1b[0m ${url}\n`);
const home = await probe(url);
console.log(`page d'accueil : status=${home.status} taille=${home.text.length} type=${home.ct.split(';')[0]}`);
if (home.error) console.log(`  erreur : ${home.error}`);

const html = home.text;
/** Indices de technologie relevés dans la page. */
const signals = {
  'WordPress': /wp-content|wp-json|wp-includes/i,
  'DooPlay (thème WP vidéo)': /dooplay|dtajax|\/tmdb\/|player-option/i,
  'Madara (thème WP manga)': /madara|wp-manga/i,
  'Next.js': /__NEXT_DATA__|\/_next\//i,
  'Nuxt/Vue': /__NUXT__|nuxt-link/i,
  'React (SPA)': /react|_app-|hydrate/i,
  'GraphQL': /graphql/i,
  'Cloudflare': /cloudflare|cf-ray/i,
  'HLS (m3u8)': /m3u8/i,
  'iframe embed': /<iframe/i,
};
console.log('\nsignaux détectés :');
const found = [];
for (const [name, re] of Object.entries(signals)) {
  if (re.test(html)) { console.log(`  ✓ ${name}`); found.push(name); }
}
if (!found.length) console.log('  (aucun — page probablement rendue côté client)');

// Endpoints fréquents : révèlent une API exploitable, bien plus stable que du scraping.
console.log('\nendpoints candidats :');
const endpoints = [
  ['/api/', 'GET'], ['/wp-json/wp/v2/posts?per_page=1', 'GET'], ['/graphql', 'POST'],
  ['/wp-admin/admin-ajax.php', 'GET'], ['/api/search?q=test', 'GET'], ['/rest/api/servers', 'GET'],
  ['/sitemap.xml', 'GET'],
];
for (const [path, method] of endpoints) {
  const r = await probe(origin + path, method === 'POST'
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"query":"{__typename}"}' }
    : {});
  if (r.status && r.status !== 404) {
    const json = /json/i.test(r.ct);
    console.log(`  [${r.status}]${json ? ' \x1b[32mJSON\x1b[0m' : '      '} ${method} ${path}  (${r.text.length}b)`);
  }
}

// Déduction du moteur probable.
//
// ATTENTION : la page d'accueil seule est un mauvais témoin. Validé contre
// Anime-Sama, que le corpus classe 'episodes-js' : son accueil (1,5 Mo rendu
// côté client) ne montre AUCUN signal, et la 1re version en déduisait
// 'html-scrape' — donc de mauvais modèles. On croise donc l'accueil avec le
// sitemap et une page de contenu réelle.
let engine = null;
const evidence = [];

// 1. Un module du corpus couvre-t-il déjà exactement cet hôte ? Réponse la plus fiable.
const index = JSON.parse(await readFile('corpus/index.json', 'utf-8'));
const host = new URL(url).host.replace(/^www\./, '');
const exact = index.filter((e) => {
  try { return e.baseUrl && new URL(e.baseUrl).host.replace(/^www\./, '') === host; } catch { return false; }
});
if (exact.length) {
  engine = exact[0].engine;
  evidence.push(`module existant pour ${host} -> moteur ${engine}`);
}

// 2. Sinon, sonder une page de CONTENU (les signatures y vivent, pas sur l'accueil).
if (!engine) {
  let sample = '';
  const sm = await probe(origin + '/sitemap.xml');
  const locs = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const contentUrl = locs.find((u) => /catalogue|anime|serie|film|watch|episode/i.test(u)) || locs[1];
  if (contentUrl) {
    const page = await probe(contentUrl);
    sample = page.text;
    evidence.push(`page de contenu sondée : ${contentUrl.slice(0, 70)} (${page.text.length}b)`);
  }
  const both = html + '\n' + sample;
  if (/episodes\.js|episode_index/i.test(both)) { engine = 'episodes-js'; evidence.push("signature 'episodes.js' trouvée"); }
  else if (/graphql/i.test(both)) { engine = 'graphql'; evidence.push('GraphQL détecté'); }
  else if (/dooplay|dtajax|player-option/i.test(both)) { engine = 'wp-dooplay'; evidence.push('thème DooPlay'); }
  else if (/wp-manga|madara/i.test(both)) { engine = 'wp-madara'; evidence.push('thème Madara'); }
  else if (/wp-content|wp-json/i.test(both)) { engine = 'wp-dooplay'; evidence.push('WordPress générique'); }
  else if (/__NEXT_DATA__|__NUXT__/i.test(both)) { engine = 'rest-json'; evidence.push('SPA Next/Nuxt -> API JSON'); }
  else { engine = 'html-scrape'; evidence.push('aucune signature franche -> scraping HTML par défaut'); }
}

console.log(`\n\x1b[1mmoteur probable\x1b[0m : ${engine}`);
for (const e of evidence) console.log(`  · ${e}`);

// Modules du corpus à réutiliser
const sameEngine = index.filter((e) => e.engine === engine && e.fnsPresent === 4);
sameEngine.sort((a, b) => b.installCount - a.installCount);

console.log(`\n\x1b[1mmodèles recommandés\x1b[0m (moteur ${engine}, 4 fonctions complètes) :`);
if (!sameEngine.length) console.log('  aucun — repartir du template');
for (const e of sameEngine.slice(0, 6)) {
  console.log(`  corpus/${e.slug}.js`.padEnd(34) + `${e.sourceName} · ${e.language} · ${e.streamType} · ${e.lines} lignes · ${e.installCount} installs`);
  if (e.extractors.length) console.log(`      extracteurs : ${e.extractors.join(', ')}`);
}

// Bonus : modules FR du même moteur (conventions de langue VOSTFR/VF déjà gérées)
const fr = index.filter((e) => /french/i.test(e.language || '') && e.fnsPresent === 4);
if (fr.length) {
  console.log(`\nmodules FR (gestion VOSTFR/VF de référence) :`);
  for (const e of fr.slice(0, 6)) console.log(`  corpus/${e.slug}.js`.padEnd(34) + `${e.sourceName} · ${e.engine}`);
}
