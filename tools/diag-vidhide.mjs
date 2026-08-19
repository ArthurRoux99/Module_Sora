/**
 * Diagnostic de l'étiquette "Vidhide" d'Anime-Sama.
 *
 * Constat initial : aucun embed Vidhide réel. Le module étiquette "Vidhide"
 * toute page contenant un packer (détecteur universel, ligne ~449). Les vrais
 * hôtes sont ansembed.net / smoothpre.com / sendvid.com.
 *
 * But : pour CHAQUE embed, voir si une URL média valide (DNS résolvable) est
 * extractible, afin de décider réparation vs retrait.
 */
import { RuntimeStats, createSandbox } from './runtime.mjs';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import dns from 'node:dns/promises';

const stats = new RuntimeStats();
const sandbox = createSandbox({ stats, verbose: false });
const ctx = vm.createContext(sandbox);
new vm.Script(await readFile('reference/anime-sama.js', 'utf-8')).runInContext(ctx);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const epUrl = 'https://anime-sama.to/catalogue/frieren/saison1/vostfr/episodes.js?episode_index=0';

const res = await sandbox.fetchv2(epUrl, { Referer: 'https://anime-sama.to/' }, 'GET');
const js = await res.text();
const all = [...new Set([...js.matchAll(/https?:\/\/[^\s'",\]]+/g)].map((m) => m[0]))];
// On garde le 1er lien de chaque hôte (les episodes.js listent 1 embed par hébergeur)
const byHost = new Map();
for (const u of all) {
  try { const h = new URL(u).host; if (!byHost.has(h)) byHost.set(h, u); } catch {}
}

function unpack(html) {
  let out = html;
  const blocks = html.match(/eval\(function\(p,a,c,k,e,d\).*?\.split\('\|'\)\)\)/gs) || [];
  for (const blk of blocks) {
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

async function dnsOk(h) { try { await dns.lookup(h); return true; } catch { return false; } }

console.log(`embeds listés pour Frieren S1 VOSTFR ep1 : ${byHost.size}\n`);

for (const [host, url] of byHost) {
  console.log(`══ ${host}`);
  console.log(`   ${url.slice(0, 100)}`);
  let html = '';
  let status = null;
  try {
    const r = await sandbox.fetchv2(url, { Referer: 'https://anime-sama.to/', 'User-Agent': UA }, 'GET');
    status = r.status;
    html = await r.text();
  } catch (e) {
    console.log(`   fetch KO : ${e.message}\n`);
    continue;
  }
  const packedCount = (html.match(/eval\(function\(p,a,c,k,e,d\)/g) || []).length;
  console.log(`   status=${status} taille=${html.length} packers=${packedCount}`);

  const full = unpack(html);
  const media = [...new Set([...full.matchAll(/https?:\/\/[^"'\s\\<>]+\.(?:m3u8|mp4)[^"'\s\\<>]*/gi)].map((m) => m[0]))];

  // Ce que l'extracteur du module produit sur cette page
  const got = sandbox.vidhideExtractor ? sandbox.vidhideExtractor(html) : null;
  if (got) {
    let h = '?'; try { h = new URL(got).host; } catch {}
    const ok = await dnsOk(h);
    console.log(`   extracteur -> ${got.slice(0, 95)}`);
    console.log(`   extracteur DNS(${h}) : ${ok ? 'OK' : 'ECHEC'}`);
  } else {
    console.log(`   extracteur -> null`);
  }

  if (media.length === 0) {
    console.log(`   URLs média dans la page : aucune (hostname calculé côté client ?)\n`);
    continue;
  }
  console.log(`   URLs média dans la page : ${media.length}`);
  for (const m of media.slice(0, 5)) {
    let h = '?'; try { h = new URL(m).host; } catch { continue; }
    const ok = await dnsOk(h);
    // Une URL avec des virgules est un template multi-qualité non résolu
    const tmpl = /,[a-z0-9]*,/i.test(m) ? ' [TEMPLATE multi-qualité]' : '';
    console.log(`     [DNS ${ok ? 'OK ' : 'KO '}] ${m.slice(0, 105)}${tmpl}`);
  }
  console.log('');
}
