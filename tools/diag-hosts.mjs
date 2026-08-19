/**
 * Inventaire des hébergeurs Anime-Sama sur plusieurs animés.
 *
 * Motivation : le retour terrain mentionne Uqload / Lplayer / Minochinos, qui
 * n'apparaissaient pas du tout sur Frieren (Sibnet / Ansembed / Smoothpre).
 * Les embeds dépendent donc du titre. On échantillonne pour savoir quels
 * hébergeurs existent réellement et lesquels sont extraits ou ignorés.
 */
import { RuntimeStats, createSandbox } from './runtime.mjs';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const script = process.argv[2] ?? 'modules/Anime-Sama-VOSTFR/anime-sama-vostfr.js';
const titles = process.argv.slice(3).length ? process.argv.slice(3)
  : ['frieren', 'dandadan', 'one piece', 'solo leveling', 'kaiju no 8'];

const stats = new RuntimeStats();
const sb = createSandbox({ stats, paceMs: 350 });
new vm.Script(await readFile(script, 'utf-8')).runInContext(vm.createContext(sb));

const hostTotals = new Map();   // host -> {vu, extrait}
const serverTotals = new Map(); // libellé retourné -> count

for (const t of titles) {
  let res;
  try { res = JSON.parse(await sb.searchResults(t)); } catch { res = null; }
  if (!Array.isArray(res) || !res.length || res[0].title === 'Error') {
    console.log(`\n\x1b[1m══ ${t}\x1b[0m : introuvable`); continue;
  }
  const item = res[0];
  let eps;
  try { eps = JSON.parse(await sb.extractEpisodes(item.href)); } catch { eps = []; }
  if (!Array.isArray(eps) || !eps.length) {
    console.log(`\n\x1b[1m══ ${t}\x1b[0m : 0 épisode`); continue;
  }
  const ep = eps[0];

  // Hébergeurs réellement listés par le site pour cet épisode
  let listed = [];
  try {
    const r = await sb.fetchv2(ep.href, { Referer: 'https://anime-sama.to/' }, 'GET');
    const js = await r.text();
    listed = [...new Set([...js.matchAll(/https?:\/\/[^\s'",\]]+/g)]
      .map((m) => { try { return new URL(m[0]).host.replace(/^www\./, ''); } catch { return null; } })
      .filter(Boolean))];
  } catch {}

  // Ce que le module parvient à extraire
  let streams = [];
  try {
    const out = JSON.parse(await sb.extractStreamUrl(ep.href));
    streams = out.streams ?? [];
  } catch {}

  console.log(`\n\x1b[1m══ ${t}\x1b[0m — "${item.title}" (${eps.length} eps)`);
  console.log(`  hébergeurs listés  : ${listed.join(', ') || '(aucun)'}`);
  console.log(`  serveurs extraits  : ${streams.length ? streams.map((s) => s.title).join(' | ') : '(aucun)'}`);

  const extractedHosts = new Set(streams.map((s) => {
    try { return new URL(s.streamUrl).host; } catch { return ''; }
  }));
  for (const h of listed) {
    if (!hostTotals.has(h)) hostTotals.set(h, { vu: 0, extrait: 0 });
    hostTotals.get(h).vu++;
    // Heuristique : on teste TOUS les segments du host contre les libellés
    // (video.sibnet.ru -> ["video","sibnet"] ; "video" seul donnait un faux
    // "jamais extrait" alors que le libellé retourné est "Sibnet").
    const parts = h.toLowerCase().split('.').filter((p) => !['www', 'com', 'net', 'to', 'ru', 'org', 'tv'].includes(p));
    if (streams.some((s) => parts.some((p) => (s.title || '').toLowerCase().includes(p)))) hostTotals.get(h).extrait++;
  }
  for (const s of streams) {
    const lbl = (s.title || '').replace(/^\[[^\]]+\]\s*/, '');
    serverTotals.set(lbl, (serverTotals.get(lbl) || 0) + 1);
  }
}

console.log(`\n\x1b[1m── HÉBERGEURS (vu / extrait) ──\x1b[0m`);
for (const [h, v] of [...hostTotals].sort((a, b) => b[1].vu - a[1].vu)) {
  const mark = v.extrait === 0 ? '\x1b[31mJAMAIS EXTRAIT\x1b[0m' : (v.extrait < v.vu ? '\x1b[33mpartiel\x1b[0m' : '\x1b[32mok\x1b[0m');
  console.log(`  ${h.padEnd(26)} vu=${v.vu} extrait=${v.extrait}  ${mark}`);
}
console.log(`\n\x1b[1m── LIBELLÉS DE SERVEURS RETOURNÉS ──\x1b[0m`);
for (const [s, n] of [...serverTotals].sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(24)} x${n}`);
