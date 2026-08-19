/**
 * Runner de conformité pour modules Sora / ShiroX.
 *
 * Exécute la chaîne searchResults -> extractDetails -> extractEpisodes ->
 * extractStreamUrl et valide chaque sortie contre le contrat de la doc :
 *   - tout doit être une string JSON (JSON.stringify obligatoire)
 *   - episode.number doit être un Number
 *   - l'URL de stream doit répondre (HEAD/GET) : une URL qui 403 = module cassé
 *
 * Usage :
 *   node tools/test.mjs <chemin_module.js> --search "frieren" [--lang VOSTFR] [-v]
 */
import { loadModule } from './runtime.mjs';
import { argv } from 'node:process';

// Sortie propre : ne PAS utiliser process.exit() brutalement — sous Windows ça
// crash (UV_HANDLE_CLOSING) quand undici a encore des sockets ouverts. On set
// juste exitCode et on laisse Node fermer les connexions ; un timer unrefé de
// secours évite un hang si une requête reste vraiment pending.
function quit(n) {
  process.exitCode = n;
  setTimeout(() => {}, 300).unref();
}
const exit = quit;

const args = argv.slice(2);
if (args.length === 0) {
  console.log('usage: node tools/test.mjs <module.js> --search "titre" [--lang VOSTFR] [--ep 1] [-v]');
  exit(1);
}
const scriptPath = args[0];
const getArg = (flag, dflt = null) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : dflt;
};
const keyword = getArg('--search', 'one piece');
const wantLang = getArg('--lang', null);
const wantEp = parseInt(getArg('--ep', '1'), 10);
const paceMs = parseInt(getArg('--pace', '0'), 10);
const verbose = args.includes('-v') || args.includes('--verbose');

const OK = '\x1b[32m✓\x1b[0m';
const NO = '\x1b[31m✗\x1b[0m';
const WARN = '\x1b[33m!\x1b[0m';
let failures = 0;
const fail = (msg) => { failures++; console.log(`${NO} ${msg}`); };
const pass = (msg) => console.log(`${OK} ${msg}`);
const warn = (msg) => console.log(`${WARN} ${msg}`);

/** Une fonction de module DOIT retourner une string JSON parsable. */
function parseContract(raw, fnName) {
  if (typeof raw !== 'string') {
    fail(`${fnName} n'a pas retourné une string (${typeof raw}) — JSON.stringify() manquant`);
    return raw && typeof raw === 'object' ? raw : null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    // extractStreamUrl accepte une URL nue en retour (format "direct stream")
    if (fnName === 'extractStreamUrl' && raw.startsWith('http')) return raw;
    fail(`${fnName} a retourné une string non-JSON : ${raw.slice(0, 120)}`);
    return null;
  }
}

async function probeUrl(url, headers = {}) {
  const h = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0', ...headers };
  try {
    let r = await fetch(url, { method: 'GET', headers: { ...h, Range: 'bytes=0-2047' } });
    return { status: r.status, ok: r.status >= 200 && r.status < 400, type: r.headers.get('content-type') || '?' };
  } catch (e) {
    return { status: null, ok: false, type: null, error: e.message };
  }
}

const t0 = Date.now();
console.log(`\n\x1b[1mMODULE\x1b[0m ${scriptPath}`);
console.log(`\x1b[1mQUERY \x1b[0m "${keyword}"${wantLang ? `  lang=${wantLang}` : ''}\n`);

async function main() {
const { fns, stats, missing } = await loadModule(scriptPath, { verbose, paceMs });
if (missing.length) {
  fail(`fonctions manquantes : ${missing.join(', ')}`);
  exit(1);
}
pass('les 4 fonctions requises sont déclarées');

// ---------- 1. searchResults ----------
const searchRaw = await fns.searchResults(keyword);
const results = parseContract(searchRaw, 'searchResults');
if (!Array.isArray(results) || results.length === 0) {
  fail('searchResults : aucun résultat');
  exit(1);
}
const badResult = results.find((r) => !r.title || !r.href);
if (badResult) fail(`searchResults : entrée sans title/href → ${JSON.stringify(badResult).slice(0, 100)}`);
else if (results[0].title === 'Error') fail('searchResults a renvoyé la sentinelle "Error"');
else pass(`searchResults : ${results.length} résultats — "${results[0].title}"`);
if (!results[0].image) warn('searchResults : champ image vide (affichage dégradé)');

// Sélection : si --lang est demandé, on privilégie un résultat qui la mentionne.
let target = results[0];
if (wantLang) {
  const m = results.find((r) => `${r.title} ${r.href}`.toUpperCase().includes(wantLang.toUpperCase()));
  if (m) { target = m; pass(`langue ${wantLang} trouvée dans les résultats — "${m.title}"`); }
  else warn(`langue ${wantLang} non identifiable dans searchResults (peut être résolue plus tard)`);
}
console.log(`  → cible : ${target.href}`);

// ---------- 2. extractDetails ----------
const detailsRaw = await fns.extractDetails(target.href);
const details = parseContract(detailsRaw, 'extractDetails');
const d = Array.isArray(details) ? details[0] : details;
if (!d || !d.description) fail('extractDetails : description absente');
else if (/^error/i.test(d.description)) fail(`extractDetails : sentinelle d'erreur (${d.description})`);
else pass(`extractDetails : description ${d.description.length} car., airdate="${d.airdate ?? '?'}"`);

// ---------- 3. extractEpisodes ----------
const epsRaw = await fns.extractEpisodes(target.href);
const eps = parseContract(epsRaw, 'extractEpisodes');
if (!Array.isArray(eps) || eps.length === 0) {
  fail('extractEpisodes : liste vide');
  exit(1);
}
const strNum = eps.filter((e) => typeof e.number !== 'number');
if (strNum.length) fail(`extractEpisodes : ${strNum.length} épisode(s) avec number non-numérique — utiliser parseInt()`);
else pass(`extractEpisodes : ${eps.length} épisodes, number:Number OK`);
if (eps.some((e) => !e.href || e.href === 'Error')) fail('extractEpisodes : href manquant ou sentinelle');

const ep = eps.find((e) => e.number === wantEp) ?? eps[0];
console.log(`  → épisode ${ep.number} : ${ep.href}`);

// ---------- 4. extractStreamUrl ----------
const streamRaw = await fns.extractStreamUrl(ep.href);
const stream = parseContract(streamRaw, 'extractStreamUrl');
/** @type {{title:string,streamUrl:string,headers:object}[]} */
let streams = [];
let subtitle = null;

if (typeof stream === 'string') {
  streams = [{ title: 'direct', streamUrl: stream, headers: {} }];
} else if (stream && Array.isArray(stream.streams)) {
  // Format multi-serveurs : soit [{title,streamUrl}], soit ["url1","url2"] alterné
  streams = stream.streams.map((s, i) =>
    typeof s === 'string' ? { title: `server${i + 1}`, streamUrl: s, headers: {} } : s
  );
  subtitle = stream.subtitle ?? stream.subtitles ?? null;
} else if (stream && stream.streamUrl) {
  streams = [{ title: 'direct', streamUrl: stream.streamUrl, headers: stream.headers ?? {} }];
  subtitle = stream.subtitle ?? null;
}

if (streams.length === 0) fail('extractStreamUrl : aucun stream retourné');
else pass(`extractStreamUrl : ${streams.length} stream(s)${subtitle ? ' + sous-titres' : ''}`);

// Vérification langue sur les titres de serveurs (Anime-Sama étiquette VOSTFR/VF/VA)
if (wantLang && streams.length) {
  const labels = streams.map((s) => s.title || '').join(' | ');
  if (labels.toUpperCase().includes(wantLang.toUpperCase())) pass(`piste ${wantLang} présente parmi les serveurs [${labels}]`);
  else warn(`${wantLang} non étiquetée dans les serveurs [${labels}]`);
}

// Le vrai critère : le flux répond-il ?
let playable = 0;
const PROBE_MAX = 6;
const probed = streams.slice(0, PROBE_MAX);
if (streams.length > PROBE_MAX) console.log(`  (sondage limité aux ${PROBE_MAX} premiers serveurs sur ${streams.length})`);
for (const s of probed) {
  if (!s.streamUrl || !/^https?:/.test(s.streamUrl)) { fail(`stream invalide : ${JSON.stringify(s).slice(0, 80)}`); continue; }
  const p = await probeUrl(s.streamUrl, s.headers ?? {});
  if (p.ok) { playable++; pass(`  lecture OK [${p.status}] ${s.title} · ${p.type}`); }
  else fail(`  lecture KO [${p.status ?? p.error}] ${s.title} · ${s.streamUrl.slice(0, 70)}`);
}
if (subtitle) {
  const p = await probeUrl(typeof subtitle === 'string' ? subtitle : subtitle?.url ?? '');
  p.ok ? pass(`  sous-titres OK [${p.status}]`) : warn(`  sous-titres inaccessibles [${p.status ?? p.error}]`);
}

// ---------- Bilan ----------
console.log(`\n\x1b[1m── BILAN ──\x1b[0m`);
console.log(`requêtes réseau : ${stats.requests.length} (${stats.failedCount} échec, ${stats.blockedCount} télémétrie bloquée)`);
console.log(`streams jouables : ${playable}/${probed.length}${streams.length > probed.length ? ` (sur ${streams.length} annoncés)` : ''}`);
console.log(`durée : ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Un 403/429 côté source n'est PAS forcément un bug du module. Deux cas très
// différents : challenge de pose de cookie (résolu par retry) vs throttle réel.
const cookieChallenges = stats.requests.filter((r) => r.cookieChallenge);
const throttled = stats.requests.filter((r) => (r.status === 403 || r.status === 429) && !r.cookieChallenge);
if (cookieChallenges.length) {
  console.log(`\n\x1b[36mchallenge cookie\x1b[0m : ${cookieChallenges.length} réponse(s) 403 suivie(s) d'un retry avec cookie`);
  console.log(`   Comportement normal d'un backend Cloudflare — pas un défaut du module.`);
}
if (throttled.length) {
  console.log(`\n\x1b[33manti-bot / throttle\x1b[0m : ${throttled.length} réponse(s) 403/429 non résolue(s) —`);
  for (const r of throttled.slice(0, 3)) console.log(`   [${r.status}] ${r.url.slice(0, 90)}`);
  console.log(`   Cause probable : cadence trop élevée, pas un défaut du module.`);
  console.log(`   Réessayer avec \x1b[1m--pace 1500\x1b[0m, ou patienter ~1 min.`);
}
if (stats.blockedCount > 0) console.log(`\x1b[33mnote\x1b[0m : ce module contient de la télémétrie tierce (bloquée ici).`);
const multiArgLog = stats.logs.find((l) => l.startsWith('[WARN] console.log'));
if (multiArgLog) console.log(`\x1b[33mnote\x1b[0m : ${multiArgLog}`);

if (failures === 0 && playable > 0) {
  console.log(`\n\x1b[32m\x1b[1mCONFORME\x1b[0m — module exploitable\n`);
  exit(0);
}
console.log(`\n\x1b[31m\x1b[1m${failures} PROBLÈME(S)\x1b[0m${playable === 0 ? ' — aucun flux jouable' : ''}\n`);
exit(1);
}

main().catch((e) => {
  console.error('Erreur test:', e);
  process.exitCode = 1;
});
