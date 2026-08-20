// ── anidap.lol (fork AllAnime) ───────────────────────────────────────────────
// API REST publique : https://anidap.lol/api/anime/...  (catalogue OK, testé)
// Endpoints (lus dans le bundle du frontend) :
//   search    GET  /api/anime/search?q=<kw>&provider=<p>
//   info      GET  /api/anime/<slug>            (slug = id interne, ex: frieren-...-faato)
//   episodes  GET  /api/anime/<slug>/episodes?refresh=<bool>
//   servers   GET  /api/anime/servers?id=<slug>&ep=<n>
//   sources   GET  /api/anime/sources?id=<slug>&ep=<n>&host=<h>&type=sub
// ⚠️ FLUX : /sources retourne une chaîne CHIFFRÉE (AES-GCM, clé dérivée PBKDF2
//    côté client). Le catalogue marche ; le déchiffrement du flux est à implémenter
//    (voir note en bas). extractStreamUrl renvoie [] proprement pour l'instant.
const AD_BASE = 'https://anidap.lol/api/anime';
const AD_REF = 'https://anidap.lol/';
const AD_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

async function adFetch(path) {
  try {
    const r = await fetchv2(AD_BASE + path, {
      'User-Agent': AD_UA,
      'Referer': AD_REF,
      'Accept': 'application/json',
    }, 'GET');
    if (!r || r.status !== 200) {
      console.log('anidap ' + r?.status + ' on ' + path);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.log('anidap fetch error: ' + e.message);
    return null;
  }
}

// map anilistId -> slug interne (info retourne l'id slug)
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
  } catch (e) {
    console.log('anidap search error: ' + e.message);
    return JSON.stringify([]);
  }
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
  } catch (e) {
    console.log('anidap details error: ' + e.message);
    return JSON.stringify({ description: '', aliases: [], airdate: '' });
  }
}

async function extractEpisodes(url) {
  try {
    const anilistId = url.split('/').pop();
    const slug = await slugFromAnilist(anilistId);
    if (!slug) return JSON.stringify([]);
    // episodes endpoint peut 500 (rate-limit) ; on génère 1..episodeCount depuis info
    const info = await adFetch('/' + slug);
    const count = info?.data?.episodeCount || 0;
    const out = [];
    for (let i = 1; i <= count; i++) {
      out.push({
        href: `https://anidap.lol/watch/${slug}/${i}`,
        number: Number(i),
        title: `Episode ${i}`,
      });
    }
    return JSON.stringify(out);
  } catch (e) {
    console.log('anidap episodes error: ' + e.message);
    return JSON.stringify([]);
  }
}

async function extractStreamUrl(url) {
  try {
    const parts = url.split('/');
    // https://anidap.lol/watch/<slug>/<ep>
    const slug = parts[parts.length - 2];
    const ep = parts[parts.length - 1] || '1';
    const d = await adFetch(`/sources?id=${encodeURIComponent(slug)}&ep=${ep}&host=1&type=sub`);
    // d.data = chaîne chiffrée AES-GCM (déchiffrement client requis)
    if (!d || !d.success || !d.data) {
      console.log('anidap stream: flux chiffré AES-GCM non déchiffré (à implémenter)');
      return JSON.stringify({ streams: [] });
    }
    // TODO: déchiffrer d.data (PBKDF2 + AES-GCM côté client) -> extraire le m3u8
    return JSON.stringify({ streams: [] });
  } catch (e) {
    console.log('anidap stream error: ' + e.message);
    return JSON.stringify({ streams: [] });
  }
}
