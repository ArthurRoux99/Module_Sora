/**
 * Sonde les hébergeurs Anime-Sama que le module n'extrait jamais.
 *
 * Constat mesuré : sur Dandadan, 6 hébergeurs sont listés mais 1 seul stream
 * sort. sendvid.com / oneupload.to / vk.com / vkvideo.ru ne sont jamais
 * extraits. Objectif : déterminer pour chacun si une URL média est atteignable
 * (donc réparable) ou non.
 *
 * oneupload.to est un clone de la famille Uqload -> pertinent car le retour
 * terrain signale "Uqload OK".
 */
import { RuntimeStats, createSandbox } from './runtime.mjs';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import dns from 'node:dns/promises';

const stats = new RuntimeStats();
const sb = createSandbox({ stats, paceMs: 300 });
new vm.Script(await readFile('modules/Anime-Sama-VOSTFR/anime-sama-vostfr.js', 'utf-8'))
  .runInContext(vm.createContext(sb));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const title = process.argv[2] ?? 'dandadan';

const res = JSON.parse(await sb.searchResults(title));
const eps = JSON.parse(await sb.extractEpisodes(res[0].href));
const epUrl = eps[0].href;
console.log(`animé : "${res[0].title}" — épisode : ${epUrl}\n`);

const r = await sb.fetchv2(epUrl, { Referer: 'https://anime-sama.to/' }, 'GET');
const js = await r.text();
const embeds = [...new Set([...js.matchAll(/https?:\/\/[^\s'",\]]+/g)].map((m) => m[0]))];

// 1 embed par hôte
const byHost = new Map();
for (const u of embeds) {
  try { const h = new URL(u).host.replace(/^www\./, ''); if (!byHost.has(h)) byHost.set(h, u); } catch {}
}

function unpack(html) {
  let out = html;
  for (const blk of html.match(/eval\(function\(p,a,c,k,e,d\).*?\.split\('\|'\)\)\)/gs) || []) {
    const am = blk.match(/}\s*\(\s*(['"])(.*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])(.*?)\5\.split\('\|'\)/s);
    if (!am) continue;
    let p = am[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
    const a = parseInt(am[3], 10); let c = parseInt(am[4], 10); const k = am[6].split('|');
    const e = (n) => (n < a ? '' : e(parseInt(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
    while (c--) if (k[c]) p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c]);
    out += '\n' + p;
  }
  return out;
}

for (const [host, url] of byHost) {
  console.log(`\x1b[1m══ ${host}\x1b[0m`);
  console.log(`   embed : ${url.slice(0, 95)}`);
  let html = '', status = null;
  try {
    const p = await sb.fetchv2(url, { Referer: 'https://anime-sama.to/', 'User-Agent': UA }, 'GET');
    status = p.status; html = await p.text();
  } catch (e) { console.log(`   fetch KO : ${e.message}\n`); continue; }

  const packers = (html.match(/eval\(function\(p,a,c,k,e,d\)/g) || []).length;
  console.log(`   status=${status} taille=${html.length} packers=${packers}`);

  const full = unpack(html);
  const media = [...new Set([...full.matchAll(/https?:\/\/[^"'\s\\<>]+\.(?:m3u8|mp4)[^"'\s\\<>]*/gi)].map((m) => m[0]))];
  // Uqload & clones exposent souvent `sources: ["https://.../video.mp4"]`
  const srcBlock = [...full.matchAll(/sources?\s*:\s*\[([^\]]{0,400})\]/gi)].map((m) => m[1]).join(' ');
  const inSources = [...new Set([...srcBlock.matchAll(/https?:\/\/[^"'\s,]+/gi)].map((m) => m[0]))];

  const cand = [...new Set([...media, ...inSources])];
  const got = sb.vidhideExtractor ? sb.vidhideExtractor(html) : null;
  console.log(`   extracteur actuel -> ${got ? got.slice(0, 88) : 'null'}`);

  if (!cand.length) { console.log(`   candidats média : aucun (URL calculée côté client)\n`); continue; }
  console.log(`   candidats média : ${cand.length}`);
  for (const u of cand.slice(0, 4)) {
    let h; try { h = new URL(u).host; } catch { continue; }
    let dnsOk = false; try { await dns.lookup(h); dnsOk = true; } catch {}
    let code = '—';
    if (dnsOk) {
      try {
        const pr = await fetch(u, { headers: { 'User-Agent': UA, Referer: `https://${host}/`, Range: 'bytes=0-1023' } });
        code = pr.status;
      } catch (e) { code = 'ERR'; }
    }
    const verdict = dnsOk && (code === 200 || code === 206) ? '\x1b[32mJOUABLE\x1b[0m' : '\x1b[31mKO\x1b[0m';
    console.log(`     ${verdict} [dns=${dnsOk ? 'ok' : 'KO'} http=${code}] ${u.slice(0, 92)}`);
  }
  console.log('');
}
