/**
 * Diagnostic AnimeX : "je trouve les animes mais pas les épisodes".
 *
 * On teste extractEpisodes sur plusieurs formes d'URL (relative telle que
 * searchResults la retourne, puis préfixée comme l'app peut le faire) et sur
 * plusieurs animés, pour isoler si le problème est la forme de l'URL ou le
 * contenu (ex. animé sans anilistId).
 */
import { RuntimeStats, createSandbox } from './runtime.mjs';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const script = process.argv[2] ?? 'modules/Animex/animex.js';
const queries = process.argv.slice(3).length ? process.argv.slice(3) : ['frieren', 'one piece', 'dandadan'];

const stats = new RuntimeStats();
const sb = createSandbox({ stats, paceMs: 700 });
new vm.Script(await readFile(script, 'utf-8')).runInContext(vm.createContext(sb));

for (const q of queries) {
  console.log(`\n\x1b[1m══ recherche "${q}"\x1b[0m`);
  let results;
  try { results = JSON.parse(await sb.searchResults(q)); }
  catch (e) { console.log(`  searchResults a levé : ${e.message}`); continue; }
  if (!Array.isArray(results) || !results.length || results[0].title === 'Error') {
    console.log('  searchResults : aucun résultat exploitable'); continue;
  }
  const r = results[0];
  console.log(`  résultat : "${r.title}"`);
  console.log(`  href brut : ${JSON.stringify(r.href)}`);

  // Formes d'URL plausibles selon la façon dont l'app manipule le href.
  const variants = [
    ['tel quel (relatif)', r.href],
    ['préfixé baseUrl', 'https://animex.one/' + r.href.replace(/^\//, '')],
    ['préfixé sans slash', 'https://animex.one' + (r.href.startsWith('/') ? r.href : '/' + r.href)],
  ];

  for (const [label, u] of variants) {
    let eps = null, err = null;
    try { eps = JSON.parse(await sb.extractEpisodes(u)); }
    catch (e) { err = e.message; }
    const n = Array.isArray(eps) ? eps.length : 0;
    const bad = Array.isArray(eps) && eps.some((e) => e.href === 'Error' || typeof e.number !== 'number');
    const mark = n > 0 && !bad ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`   ${mark} ${label.padEnd(22)} -> ${n} épisode(s)${bad ? ' (format invalide)' : ''}${err ? ' EXC:' + err : ''}`);
    if (n > 0) console.log(`      ex: ${JSON.stringify(eps[0])}`);
  }
}
console.log(`\nrequêtes: ${stats.requests.length}, échecs: ${stats.failedCount}`);
const codes = {};
for (const rq of stats.requests) codes[rq.status ?? 'ERR'] = (codes[rq.status ?? 'ERR'] || 0) + 1;
console.log('codes HTTP: ' + JSON.stringify(codes));
