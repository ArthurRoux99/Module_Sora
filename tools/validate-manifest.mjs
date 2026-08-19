/**
 * Valide un manifest de module contre le schéma documenté (json-schema.html)
 * et vérifie que les URLs distantes déclarées répondent.
 *
 * Usage : node tools/validate-manifest.mjs modules/**\/*.json
 */
import { readFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';

const REQUIRED = ['sourceName', 'author', 'iconUrl', 'version', 'language', 'baseUrl',
  'streamType', 'quality', 'searchBaseUrl', 'scriptUrl', 'type'];
const ENUM = {
  streamType: ['HLS', 'MP4', 'HLS/MP4', 'MKV'],
  quality: ['360p', '480p', '720p', '1080p'],
  type: ['anime', 'movies', 'shows', 'novels', 'manga'],
};

const files = argv.slice(2);
if (!files.length) { console.log('usage: node tools/validate-manifest.mjs <manifest.json...>'); exit(1); }

let bad = 0;
for (const f of files) {
  console.log(`\n\x1b[1m${f}\x1b[0m`);
  let m;
  try { m = JSON.parse(await readFile(f, 'utf-8')); }
  catch (e) { console.log(`  \x1b[31m✗\x1b[0m JSON invalide : ${e.message}`); bad++; continue; }

  for (const k of REQUIRED) {
    if (m[k] === undefined || m[k] === '') { console.log(`  \x1b[31m✗\x1b[0m champ requis manquant : ${k}`); bad++; }
  }
  if (m.author && (!m.author.name || !m.author.icon)) {
    console.log(`  \x1b[31m✗\x1b[0m author.name et author.icon sont requis`); bad++;
  }
  for (const [k, vals] of Object.entries(ENUM)) {
    if (m[k] && !vals.includes(m[k])) console.log(`  \x1b[33m!\x1b[0m ${k}="${m[k]}" hors énumération [${vals.join(', ')}]`);
  }
  // searchBaseUrl doit contenir %s (placeholder de requête)
  if (m.searchBaseUrl && !m.searchBaseUrl.includes('%s')) {
    console.log(`  \x1b[31m✗\x1b[0m searchBaseUrl doit contenir %s`); bad++;
  }
  if (m.asyncJS !== true) console.log(`  \x1b[33m!\x1b[0m asyncJS devrait être true (non-async abandonné depuis Sora 2.0)`);
  if (m.softsub === true && m.streamType === 'MP4') {
    console.log(`  \x1b[33m!\x1b[0m softsub=true mais streamType=MP4 : subs probablement incrustés`);
  }

  // Les URLs distantes doivent répondre (scriptUrl surtout : Sora le fetch).
  for (const key of ['scriptUrl', 'iconUrl']) {
    if (!m[key]) continue;
    try {
      const r = await fetch(m[key], { method: 'GET', headers: { Range: 'bytes=0-1023' } });
      const ok = r.status >= 200 && r.status < 400;
      console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${key} [${r.status}]`);
      if (!ok) bad++;
    } catch (e) {
      console.log(`  \x1b[31m✗\x1b[0m ${key} injoignable : ${e.message}`);
      bad++;
    }
  }
  console.log(`  cibles : Sora=${!!m.supportsSora} ShiroX=${!!m.supportsShirox} Luna=${!!m.supportsLuna}`);
}
console.log(bad === 0 ? '\n\x1b[32mmanifests conformes\x1b[0m\n' : `\n\x1b[31m${bad} problème(s)\x1b[0m\n`);
exit(bad === 0 ? 0 : 1);
