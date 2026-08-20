// ── anidap.lol (fork AllAnime) ───────────────────────────────────────────────
// API REST publique : https://anidap.lol/api/anime/...  (catalogue OK, testé)
// Endpoints (lus dans le bundle du frontend) :
//   search    GET /api/anime/search?q=<kw>&provider=<p>
//   info      GET /api/anime/<slug>            (slug = id interne, ex: frieren-...-faato)
//   episodes  GET /api/anime/<slug>/episodes?refresh=<bool>
//   servers   GET /api/anime/servers?id=<slug>&ep=<n>
//   sources   GET /api/anime/sources?id=<slug>&ep=<n>&host=<h>&type=sub
// FLUX : /sources retourne une chaîne CHIFFRÉE (AES-GCM + XOR, clé dérivée
//   epi-based). Le déchiffrement (fallback du frontend) est reproduit ci-dessous
//   en pur JS (WebCrypto AES-GCM + XOR), validé contre l'API live.
const AD_BASE = 'https://anidap.lol/api/anime';
const AD_REF = 'https://anidap.lol/';
const AD_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

// ── crypto (reproduit depuis le bundle VideoPlayer de anidap) ──
const Me = [13,27,7,19,31,11,23,37,41,43,47,53,59,61,67,71,73,79,83,89,97,101,103,107,109,113,127,131,137,139,149,151];
const dn = (((e) => e*e*e)(6) + 47) * 60 * 1e3;
const kt = new Uint8Array(Array.from({ length: 32 }, ((e, t) => (t*17+53 ^ t*23+79 ^ t*31+124) & 255)));
const He = (e, t, n) => ((e^t) << 1 ^ (t^n) >> 1 ^ e+t+n) & 255;
const Rt = (e, t) => e[t % e.length] ^ e[(t*7+11) % e.length] ^ e[(t*13+17) % e.length];
function fr(e, t) {
  const n = new Uint8Array(e.length);
  for (let r = 0; r < e.length; r++) {
    const a = r % t.length, c = t[a], l = (c << r%8 | c >>> 8-r%8) & 255, i = r*7+13 & 255;
    n[r] = e[r] ^ l ^ i ^ t[(a+1) % t.length];
  }
  return n;
}
function mt(e) { for (; e.length % 4;) e += '='; return atob(e.replace(/-/g, '+').replace(/_/g, '/')); }

// Déchiffre la chaîne /sources (fallback du frontend, n = epoch - 1).
// Utilise crypto.subtle (WebCrypto) disponible dans le contexte Sora/Chromium.
async function decryptSources(data) {
  for (const offset of [0, -1, 1, -2, 2]) {
    try {
      const n = Math.floor(Date.now() / dn) - 1 + offset;
      const r = new Uint8Array(128);
      for (let m = 0; m < 128; m++) { const h = Me[m % Me.length]; r[m] = Rt(kt, m) ^ n + m*h & 255 ^ (m^h) & 255; }
      const a = new Uint8Array(64), c = new Uint8Array(32), l = new Uint8Array(16);
      for (let m = 0; m < 64; m++) { const h = r[m], y = r[m+64], b = He(h, y, n >>> m%16 & 255); a[m] = h ^ b; }
      for (let m = 0; m < 32; m++) { const h = a[m], y = a[m+32], b = Me[(m*3+7) % Me.length]; c[m] = (h ^ y ^ h + y + b & 255) & 255; }
      for (let m = 0; m < 16; m++) { const h = c[m], y = c[m+16], b = ((h << 3 | h >>> 5) ^ (y << 5 | y >>> 3)) & 255; l[m] = b ^ n >>> m*2 & 255; }
      const i = new Uint8Array(48);
      for (let m = 0; m < 48; m++) { const h = (m*7+11) % 32, y = (m*13+17) % 32, b = (m*19+23) % 32, S = He(c[h], c[y], c[b]); i[m] = (S ^ n >>> m%24 & 255 ^ Rt(kt, m*3)) & 255; }
      const d = new Uint8Array(32);
      for (let m = 0; m < 3; m++) for (let h = 0; h < 32; h++) { const y = m === 0 ? i[h] : d[h], b = i[(h*5+7) % 48], S = i[(h*11+13) % 48], w = He(y, b, S); d[h] = (w ^ i[(h+m*16) % 48]) & 255; }
      const p = await crypto.subtle.importKey('raw', d, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      const u = Uint8Array.from(mt(data), (m) => m.charCodeAt(0)), f = u.slice(0, 12), g = u.slice(12);
      const v = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: f }, p, g);
      const x = fr(new Uint8Array(v), l);
      const dec = new TextDecoder().decode(x);
      if (dec && dec.includes('http')) return dec;
    } catch (e) { /* try next offset */ }
  }
  return null;
}

async function adFetch(path) {
  try {
    const r = await fetchv2(AD_BASE + path, {
      'User-Agent': AD_UA,
      'Referer': AD_REF,
      'Accept': 'application/json',
    }, 'GET');
    if (!r || r.status !== 200) { console.log('anidap ' + r?.status + ' on ' + path); return null; }
    return await r.json();
  } catch (e) { console.log('anidap fetch error: ' + e.message); return null; }
}

async function slugFromAnilist(anilistId) {
  const d = await adFetch('/' + anilistId);
  return d?.data?.id || null;
}

async function searchResults(keyword) {
  try {
    const d = await adFetch('/search?q=' + encodeURIComponent(keyword));
    const items = d?.results || [];
    const results = items.map((it) => ({
      title: it.title?.english || it.title?.romaji || it.title?.userPreferred || 'Inconnu',
      image: it.image || '',
      href: `https://anidap.lol/info/${it.id}`,
    }));
    return JSON.stringify(results);
  } catch (e) { console.log('anidap search error: ' + e.message); return JSON.stringify([]); }
}

async function extractDetails(url) {
  try {
    const anilistId = url.split('/').pop();
    const d = await adFetch('/' + anilistId);
    const w = d?.data;
    if (!w) return JSON.stringify({ description: '', aliases: [], airdate: '' });
    return JSON.stringify({
      description: w.description || '',
      aliases: [w.titleRomaji, w.titleEnglish].filter(Boolean),
      airdate: w.seasonYear ? `Aired: ${w.seasonYear}` : '',
    });
  } catch (e) { console.log('anidap details error: ' + e.message); return JSON.stringify({ description: '', aliases: [], airdate: '' }); }
}

async function extractEpisodes(url) {
  try {
    const anilistId = url.split('/').pop();
    const slug = await slugFromAnilist(anilistId);
    if (!slug) return JSON.stringify([]);
    const info = await adFetch('/' + slug);
    const count = info?.data?.episodeCount || 0;
    const out = [];
    for (let i = 1; i <= count; i++) {
      out.push({ href: `https://anidap.lol/watch/${slug}/${i}`, number: Number(i), title: `Episode ${i}` });
    }
    return JSON.stringify(out);
  } catch (e) { console.log('anidap episodes error: ' + e.message); return JSON.stringify([]); }
}

async function extractStreamUrl(url) {
  try {
    const parts = url.split('/');
    const slug = parts[parts.length - 2];
    const ep = parts[parts.length - 1] || '1';
    const d = await adFetch(`/sources?id=${encodeURIComponent(slug)}&ep=${ep}&host=1&type=sub`);
    if (!d || !d.success || !d.data) { console.log('anidap stream: pas de données'); return JSON.stringify({ streams: [] }); }
    const json = await decryptSources(d.data);
    if (!json) { console.log('anidap stream: déchiffrement échoué'); return JSON.stringify({ streams: [] }); }
    const obj = JSON.parse(json);
    const streams = [];
    for (const s of (obj.sources || [])) {
      if (s.url) streams.push({ title: 'anidap · ' + (s.quality || 'auto'), streamUrl: s.url, subtitle: '' });
    }
    for (const sub of (obj.subtitles || [])) {
      if (sub.url) streams.push({ title: 'anidap · sub (' + (sub.label || sub.language || '?') + ')', streamUrl: sub.url, subtitle: '' });
    }
    return JSON.stringify({ streams });
  } catch (e) { console.log('anidap stream error: ' + e.message); return JSON.stringify({ streams: [] }); }
}
