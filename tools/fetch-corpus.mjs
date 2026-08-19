/**
 * Aspire le corpus des modules publics de la Module Library et les indexe par
 * "moteur" (technologie du site source).
 *
 * Pourquoi : pour un NOUVEAU site, écrire les 4 fonctions from scratch est lent
 * et le LLM hallucine les sélecteurs. Partir du module existant dont le moteur
 * est le plus proche est beaucoup plus rapide et fiable.
 *
 * Usage : node tools/fetch-corpus.mjs [--limit N]
 * Sortie : corpus/<slug>.js|.json + corpus/index.json
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const LIBRARY = 'https://library.cufiy.net/api/modules.json';
const OUT = 'corpus';
const args = process.argv.slice(2);
const limit = parseInt(args[args.indexOf('--limit') + 1], 10) || Infinity;

/**
 * Signatures de moteur : le premier motif trouvé dans le code décide.
 * Ordre du plus spécifique au plus générique.
 *
 * Les motifs "structure du site" passent AVANT les motifs "technique de
 * parsing" : savoir qu'un site est du DooPlay est plus actionnable que savoir
 * qu'il est scrapé au regex. La 1re version classait 53/149 en 'unknown' parce
 * que html-scrape exigeait `match(/<` littéralement — trop étroit.
 */
const ENGINES = [
  ['graphql', /graphql|catalogAnime|query\s+\w+\s*\(\s*\$/i],
  ['wp-dooplay', /dooplay|dtajax|admin-ajax\.php|\/wp-json\/|wp-content/i],
  ['wp-madara', /madara|manga-chapters|ajax\/chapters/i],
  ['consumet-api', /consumet|api\.consumet/i],
  ['aniwatch-api', /aniwatch|hianime|megacloud|rapid-?cloud/i],
  ['episodes-js', /episodes\.js|episode_index/i],
  // API JSON générique : le module dialogue avec un backend, pas avec du HTML.
  ['rest-json', /\/rest\/api\/|\/api\/v\d|\/api\/[a-z]+\?|\.json\b|await\s+\w*\.json\(\)/i],
  // Scraping HTML : n'importe quelle extraction de balises ou de DOM.
  ['html-scrape', /match\(\s*\/[^/]*<|<div|<a\s|querySelector|innerHTML|\/>|replace\(\s*\/</i],
  ['packer-embed', /eval\(function\(p,a,c,k,e,d\)/i],
];

/** Extracteurs d'hébergeurs, pour savoir qui sait déjà gérer quel player. */
const EXTRACTORS = [
  'voe', 'vidhide', 'streamwish', 'filemoon', 'doodstream', 'mp4upload',
  'sibnet', 'vidmoly', 'uqload', 'oneupload', 'sendvid', 'megacloud',
  'streamtape', 'lulustream', 'vk.com', 'okru', 'dailymotion', 'pixeldrain',
];

function detectEngine(code) {
  for (const [name, re] of ENGINES) if (re.test(code)) return name;
  return 'unknown';
}

async function get(url, asText = true) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0' },
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return asText ? r.text() : r.json();
}

await mkdir(OUT, { recursive: true });
const mods = await get(LIBRARY, false);
console.log(`library : ${mods.length} modules annoncés`);

const index = [];
let ok = 0, skip = 0, fail = 0;

for (const m of mods.slice(0, limit === Infinity ? mods.length : limit)) {
  const slug = (m.sourceName || 'unknown')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const jsPath = `${OUT}/${slug}.js`;

  if (existsSync(jsPath)) {
    // Déjà présent : on réindexe sans retélécharger.
    try {
      const code = await readFile(jsPath, 'utf-8');
      index.push(buildEntry(m, slug, code));
      skip++; continue;
    } catch {}
  }

  if (!m.scriptUrl) { fail++; continue; }
  try {
    const code = await get(m.scriptUrl);
    if (code.length < 200 || /^\s*<!DOCTYPE/i.test(code)) throw new Error('contenu non-JS');
    await writeFile(jsPath, code, 'utf-8');
    if (m.manifestUrl) {
      try { await writeFile(`${OUT}/${slug}.json`, await get(m.manifestUrl), 'utf-8'); } catch {}
    }
    index.push(buildEntry(m, slug, code));
    ok++;
    if (ok % 20 === 0) console.log(`  ...${ok} téléchargés`);
  } catch (e) {
    fail++;
  }
}

function buildEntry(m, slug, code) {
  const fns = ['searchResults', 'extractDetails', 'extractEpisodes', 'extractStreamUrl']
    .filter((f) => new RegExp(`function\\s+${f}\\b`).test(code));
  return {
    slug,
    sourceName: m.sourceName,
    baseUrl: m.baseUrl,
    language: m.language,
    type: m.type,
    streamType: m.streamType,
    engine: detectEngine(code),
    extractors: EXTRACTORS.filter((x) => code.toLowerCase().includes(x)),
    fnsPresent: fns.length,
    usesFetchv2: /fetchv2\s*\(/.test(code),
    hasTelemetry: /supabase|analytics|app_logs/i.test(code),
    lines: code.split('\n').length,
    bytes: code.length,
    installCount: m.installCount ?? 0,
  };
}

await writeFile(`${OUT}/index.json`, JSON.stringify(index, null, 2), 'utf-8');

console.log(`\ntéléchargés=${ok} déjà-présents=${skip} échecs=${fail}`);
const byEngine = {};
for (const e of index) byEngine[e.engine] = (byEngine[e.engine] || 0) + 1;
console.log('\nmoteurs :');
for (const [k, v] of Object.entries(byEngine).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(16)} ${v}`);
const fr = index.filter((e) => /french/i.test(e.language || ''));
console.log(`\nmodules FR : ${fr.length} -> ${fr.map((e) => e.sourceName).join(', ')}`);
