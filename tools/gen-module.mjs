/**
 * Génère un module Sora/ShiroX pour un site, en s'appuyant sur le corpus.
 *
 * Pipeline :
 *   1. Sonde le site (accueil + sitemap + page de contenu + endpoints).
 *   2. Déduit le moteur, choisit le meilleur modèle du corpus (sameEngine,
 *      max installs, 4 fonctions).
 *   3. Interroge qwen3-coder:30b (Ollama) avec : contrat Sora, HTML/JSON du
 *      site cible, et le code du modèle de référence comme example de style.
 *   4. Extrait le .js de la réponse, l'écrit dans modules/<Source>/.
 *
 * Usage :
 *   node tools/gen-module.mjs https://exemple.tv/ "Mon Site" [--model <slug corpus>] [--no-write]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { RuntimeStats, createSandbox } from './runtime.mjs';

const args = process.argv.slice(2);
const target = args[0];
if (!target) { console.error('usage: node tools/gen-module.mjs <url> "Nom Source" [--model slug] [--no-write]'); process.exit(1); }
const sourceName = args[1] || new URL(target).host.replace(/^www\./, '');
const noWrite = args.includes('--no-write');
const forcedModelIdx = args.indexOf('--model');
const forcedModel = forcedModelIdx > -1 ? args[forcedModelIdx + 1] : null;
const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'qwen3-coder:30b';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const origin = new URL(target).origin;

async function probe(u, opts = {}) {
  const jar = opts.jar || new Map();
  let url = u;
  for (let attempt = 0; attempt < 3; attempt++) {
    const cks = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let r, text;
    try {
      r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8', ...(cks ? { Cookie: cks } : {}), ...(opts.headers || {}) },
        method: opts.method || 'GET', body: opts.body,
        signal: AbortSignal.timeout(20000), redirect: 'follow',
      });
      if (r.headers.get('set-cookie')) {
        for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')])) {
          const [p] = c.split(';'); const i = p.indexOf('=');
          if (i > 0) jar.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
        }
      }
      text = await r.text();
    } catch (e) { return { status: null, text: '', error: e.message, jar }; }
    // Challenge JS type Uqload/otakufr : window.location.replace('...?ch=1&js=<blob>')
    const ch = text.match(/location\.replace\(\s*['"]([^'"]+)['"]\s*\)/);
    if (ch && /\?ch=1&js=/.test(ch[1]) && attempt < 2) {
      const base = new URL(url); const next = new URL(ch[1], base);
      url = next.href; continue; // le webview ShiroX exécute ce JS ; on enchaîne
    }
    return { status: r.status, text, ct: r.headers.get('content-type') || '', jar };
  }
  return { status: null, text: '', error: 'challenge JS non résolu après 3 tentatives', jar };
}

console.log(`\x1b[1mGénération de module\x1b[0m pour ${target}\n`);

// ---- 1. Sondage ----
const home = await probe(target);
console.log(`accueil: ${home.status} (${home.text.length}b)`);
let content = '';
const sm = await probe(origin + '/sitemap.xml');
const locs = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const contentUrl = locs.find((u) => /anime|serie|film|catalogue|watch|episode/i.test(u)) || locs[1];
if (contentUrl) {
  const p = await probe(contentUrl);
  content = p.text;
  console.log(`page contenu: ${contentUrl.slice(0, 70)} (${p.text.length}b)`);
}
const both = home.text + '\n' + content;

// Sondage ciblé : une vraie recherche + une vraie page d'épisodes, pour donner
// au LLM les SÉLECTEURS RÉELS (sinon il hallucine le DOM — constaté : qwen3-coder
// a réinventé "short-item" 2 fois alors que "short2-item" était dans la page).
// On EXTRAIT nous-mêmes une signature de carte de résultat et on la donne comme
// contrainte explicite : le LLM suit mieux une structure fournie qu'un HTML brut.
function extractCardSignature(html) {
  if (!html || html.length < 200) return '';
  // Cherche la 1re balise contenant à la fois un <a href> et un <img>, typique
  // d'une carte de résultat, et renvoie un extrait lisible (sélecteurs réels).
  const cards = [...html.matchAll(/<(div|li|article)[^>]*>\s*(?:<[^>]*>\s*)*?<a[^>]+href="([^"]+)"[^>]*>\s*<img[^>]+src="([^"]+)"[^>]*>/gi)];
  if (!cards.length) return '';
  const start = Math.max(0, cards[0].index - 60);
  return html.slice(start, cards[0].index + 320).replace(/\s+/g, ' ').trim();
}

let searchHtml = '';
const searchUrl = origin + '/index.php?do=search&subaction=search&story=' + encodeURIComponent('frieren');
const sr = await probe(searchUrl);
if (sr.status === 200 && sr.text.length > 800) searchHtml = sr.text.slice(0, 6000);
else searchHtml = (home.text + '\n' + content).slice(0, 6000); // repli
const searchSig = extractCardSignature(sr.status === 200 ? sr.text : content);

let episodeHtml = content ? content.slice(0, 6000) : '';
if (contentUrl && !/episode|saison|watch/i.test(contentUrl)) {
  const epCand = locs.find((u) => /saison|episode|watch|streaming/i.test(u));
  if (epCand) { const ep = await probe(epCand); if (ep.text.length > 800) episodeHtml = ep.text.slice(0, 6000); }
}

// ---- 2. Moteur + modele de reference ----
const index = JSON.parse(await readFile('corpus/index.json', 'utf-8'));
const host = new URL(target).host.replace(/^www\./, '');
let engine = null;
const exact = index.filter((e) => { try { return e.baseUrl && new URL(e.baseUrl).host.replace(/^www\./, '') === host; } catch { return false; } });
if (exact.length) engine = exact[0].engine;
else if (/episodes\.js|episode_index/i.test(both)) engine = 'episodes-js';
else if (/graphql/i.test(both)) engine = 'graphql';
else if (/dooplay|dtajax|player-option/i.test(both)) engine = 'wp-dooplay';
else if (/wp-manga|madara/i.test(both)) engine = 'wp-madara';
else if (/__NEXT_DATA__|__NUXT__/i.test(both)) engine = 'rest-json';
else engine = 'html-scrape';

const candidates = index.filter((e) => e.engine === engine && e.fnsPresent === 4);
candidates.sort((a, b) => b.installCount - a.installCount);
let model = forcedModel ? index.find((c) => c.slug === forcedModel && c.fnsPresent === 4) : candidates[0];
// Si --model force un moteur différent, ne pas bloquer sur le filtre de moteur :
if (forcedModel && !model) model = index.find((c) => c.slug === forcedModel);
if (!model) { console.error('Aucun modèle de référence pour le moteur', engine); process.exit(1); }
console.log(`moteur: ${engine}  | modèle de référence: ${model.sourceName} (${model.slug}.js, ${model.installCount} installs)`);

const refCode = existsSync(`corpus/${model.slug}.js`) ? await readFile(`corpus/${model.slug}.js`, 'utf-8') : '';

// ---- 3. Prompt ----
const CONTRACT = readFileSyncText('contract-snippet.txt');
const prompt = buildPrompt({ target, sourceName, engine, home, content, searchHtml, episodeHtml, refCode, model, CONTRACT });

console.log('\n\x1b[36mappel qwen3-coder:30b (Ollama)...\x1b[0m');
const llm = await ollamaGenerate(prompt, { model: MODEL, host: OLLAMA });
console.log(`réponse: ${llm.length} caractères`);

const code = extractJs(llm);
if (!code) { console.error('\x1b[31mAucun bloc .js extrait de la réponse LLM\x1b[0m'); console.log(llm.slice(0, 2000)); process.exit(1); }

// ---- 4. Ecriture + smoke test ----
const slug = sourceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dir = `modules/${slug}`;
await mkdir(dir, { recursive: true });
const jsPath = `${dir}/${slug}.js`;
if (noWrite) console.log(`\x1b[33m(--no-write) module NON écrit\x1b[0m : ${jsPath}`);
else await writeFile(jsPath, code, 'utf-8');
if (!noWrite) console.log(`module écrit: ${jsPath}`);

// Smoke test du contrat (4 fonctions + JSON.stringify)
const stats = new RuntimeStats();
const sb = createSandbox({ stats, allowTelemetry: false, paceMs: 400 });
let loadErr = null;
try { new vm.Script(code).runInContext(vm.createContext(sb)); }
catch (e) { loadErr = e.message; }
const need = ['searchResults', 'extractDetails', 'extractEpisodes', 'extractStreamUrl'];
const missing = need.filter((f) => typeof sb[f] !== 'function');
console.log(`\n\x1b[1msmoke test contrat\x1b[0m`);
console.log(`  chargement       : ${loadErr ? '\x1b[31mERREUR\x1b[0m ' + loadErr : '\x1b[32mOK\x1b[0m'}`);
console.log(`  4 fonctions      : ${missing.length ? '\x1b[31mmanquantes: ' + missing.join(',') : '\x1b[32mprésentes\x1b[0m'}`);
console.log(`  télémétrie tierce: ${/supabase|[^.]analytics|app_logs/i.test(code) ? '\x1b[31mdétectée (à neutraliser)\x1b[0m' : '\x1b[32maucune\x1b[0m'}`);
if (!loadErr && !missing.length) {
  console.log(`\nLancer ensuite: node tools/test.mjs ${jsPath} --search "frieren"`);
}

// ---------- helpers ----------
function readFileSyncText(p) {
  try { return readFileSync(p, 'utf-8'); } catch { return ''; }
}

async function ollamaGenerate(prompt, { model, host, temperature = 0.2 }) {
  const r = await fetch(`${host}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, options: { temperature, num_ctx: 32768 } }),
    signal: AbortSignal.timeout(300000),
  });
  if (!r.ok) throw new Error('Ollama ' + r.status + ' : ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  return j.response || '';
}

function extractJs(text) {
  const fenced = text.match(/```(?:js|javascript)?\s*\n([\s\S]*?)```/i);
  if (fenced) return fenced[1];
  // sinon, du premier "async function" jusqu'à la fin du dernier accolade équilibrée
  const start = text.indexOf('async function');
  if (start < 0) return '';
  return text.slice(start);
}

function buildPrompt({ target, sourceName, engine, home, content, searchHtml, episodeHtml, refCode, model, CONTRACT }) {
  // Extraits réels ciblés : on DONNE au LLM les vrais blocs HTML pour que les
  // sélecteurs soient lus, pas inventés. (1ère version passait 9Ko génériques
  // -> le LLM a halluciné short-item/full-story/episode-item, tous absents.)
  return `Tu es un expert en écriture de modules pour le lecteur vidéo Sora / ShiroX (extension navigateur de streaming d'anime).
Tu dois produire UN SEUL fichier JavaScript, complet et fonctionnel, pour le site ${target}.

=== CONTRAT OBLIGATOIRE (ne pas le violer sous peine d'échec dans l'app) ===
${CONTRACT || `Le module DOIT déclarer exactement ces 4 fonctions async, chacune retournant du JSON.stringify(...):
  async function searchResults(keyword)   -> string JSON: [{title, image, href}]
  async function extractDetails(url)       -> string JSON: {description, aliases, airdate}
  async function extractEpisodes(url)      -> string JSON: [{href, number:Number, title?}]
  async function extractStreamUrl(url)     -> string JSON: {streams:[{title, streamUrl, headers?,subtitle?}], subtitles?, Referer?}
RÈGLES STRICTES:
  - Tout retour de fonction DOIT etre JSON.stringify(...). Pas d'objet brut, pas de return d'URL seule.
  - 'number' des épisodes doit etre un Number (Number(i)), pas une string.
  - Utilise fetchv2(url, headers, method, body, redirect, encoding) pour les requêtes HTTP (disponible dans le scope).
  - console.log accepte UN SEUL argument: concatène avec '+' (ex: console.log("x=" + y)).
  - Les href/URL doivent etre ABSOLUS (https://...) — un href relatif fait échouer l'app.
  - Ne lance PAS d'exception non catchée: enveloppe le parsing dans try/catch et retourne un tableau/objet vide en cas d'erreur.`}

=== SITE CIBLE ===
URL de base: ${target}
Moteur détecté: ${engine}

--- HTML RÉEL de la page de RECHERCHE ("frieren") ---
Lis les vrais attributs/class des balises <a>, <img>, et la structure des résultats. N'invente PAS de sélecteurs.
\`\`\`html
${searchHtml}
\`\`\`

--- SÉLECTEUR DE CARTE DE RÉSULTAT EXTRAIT AUTOMATIQUEMENT (à réutiliser tel quel) ---
${searchSig || '(non détecté automatiquement — lis le HTML ci-dessus et déduis la structure)'}
\`\`\`

--- HTML RÉEL d'une page d'épisodes ---
Lis comment sont listés les épisodes (balise, attribut href, numéro).
\`\`\`html
${episodeHtml || '(non disponible)'}
\`\`\`

=== MODÈLE DE RÉFÉRENCE (même moteur ${engine}, source "${model.sourceName}") ===
Inspire-toi de sa STRUCTURE et de ses EXTRACTEURS d'hébergeurs, mais adapte les sélecteurs/regex au HTML RÉEL ci-dessus.
Ne copie PAS les URLs du modèle — elles sont pour un autre domaine.
\`\`\`javascript
${refCode.slice(0, 6000)}
\`\`\`

=== INSTRUCTIONS STRICTES ===
1. Écris le module complet pour ${sourceName} (langue: ${/french/i.test(model.language || '') ? 'français VOSTFR/VF' : model.language || 'à déduire du site'}).
2. Les sélecteurs/regex DOIVENT correspondre au HTML RÉEL fourni ci-dessus. Si une structure n'est pas visible dans l'extrait, dis-le plutôt que d'inventer.
3. Extrais les hébergeurs via leurs embeds réels (iframe/packer). N'enlève AUCUN flux trouvé.
4. Retourne UNIQUEMENT le code JavaScript dans un bloc \`\`\`js ... \`\`\`. Pas d'explication autour.`;
}
