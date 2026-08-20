// ── kazora.cc ───────────────────────────────────────────────────────────────
// API REST publique : https://kazora.cc/api/  (catalogue OK, testé live)
//   search    GET /api/search?keyword=<kw>&page=1
//   info      GET /api/anime?id=<id>            (id = "mal:63816")
//   episodes  GET /api/episodes/mal/<id>
//   watch     GET /api/watch?id=mal%3A<id>&ep=<n>&type=sub&server=soft
// ⚠️ FLUX : /watch retourne embed:null/playlist:null (player externe ou crypto
//    côté client). extractStreamUrl renvoie [] proprement en attendant reverse.
const KZ_BASE = 'https://kazora.cc/api';
const KZ_REF = 'https://kazora.cc/';
const KZ_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

async function kzFetch(path) {
  try {
    const r = await fetchv2(KZ_BASE + path, {
      'User-Agent': KZ_UA,
      'Referer': KZ_REF,
      'Accept': 'application/json',
    }, 'GET');
    if (!r || r.status !== 200) {
      console.log('kazora ' + r?.status + ' on ' + path);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.log('kazora fetch error: ' + e.message);
    return null;
  }
}

async function searchResults(keyword) {
  try {
    const d = await kzFetch('/search?keyword=' + encodeURIComponent(keyword) + '&page=1');
    const items = d?.results?.data || [];
    const results = items.map((it) => ({
      title: it.title || it.japanese_title || 'Inconnu',
      image: it.poster || it.cover || '',
      href: `https://kazora.cc/anime/${it.id}`,
    }));
    return JSON.stringify(results);
  } catch (e) {
    console.log('kazora search error: ' + e.message);
    return JSON.stringify([]);
  }
}

async function extractDetails(url) {
  try {
    const id = url.split('/').pop();
    const d = await kzFetch('/anime?id=' + encodeURIComponent(id));
    const w = d?.results;
    if (!w) return JSON.stringify({ description: '', aliases: [], airdate: '' });
    return JSON.stringify({
      description: w.description || w.synopsis || '',
      aliases: [w.japanese_title, w.title].filter(Boolean),
      airdate: w.seasonYear ? `Aired: ${w.seasonYear}` : '',
    });
  } catch (e) {
    console.log('kazora details error: ' + e.message);
    return JSON.stringify({ description: '', aliases: [], airdate: '' });
  }
}

async function extractEpisodes(url) {
  try {
    const id = url.split('/').pop();
    const d = await kzFetch('/episodes/' + encodeURIComponent(id));
    const eps = d?.results?.episodes || [];
    const out = eps.map((ep) => ({
      href: `https://kazora.cc/watch/${id}?ep=${ep.number}&type=sub&server=soft`,
      number: Number(ep.number),
      title: ep.title || `Episode ${ep.number}`,
    }));
    return JSON.stringify(out.length ? out : []);
  } catch (e) {
    console.log('kazora episodes error: ' + e.message);
    return JSON.stringify([]);
  }
}

async function extractStreamUrl(url) {
  try {
    const u = new URL(url);
    const id = u.pathname.split('/').pop(); // mal:63816 ou 63816
    const ep = u.searchParams.get('ep') || '1';
    const type = u.searchParams.get('type') || 'sub';
    const d = await kzFetch(`/watch?id=${encodeURIComponent(id)}&ep=${ep}&type=${type}&server=soft`);
    const r = d?.results;
    if (!r || (!r.embed && !r.playlist)) {
      console.log('kazora stream: flux non exposé (player externe/crypto) — à reverse');
      return JSON.stringify({ streams: [] });
    }
    const streams = [];
    if (r.embed) streams.push({ title: 'kazora · embed', streamUrl: r.embed, subtitle: '' });
    if (r.playlist) streams.push({ title: 'kazora · playlist', streamUrl: r.playlist, subtitle: '' });
    return JSON.stringify({ streams });
  } catch (e) {
    console.log('kazora stream error: ' + e.message);
    return JSON.stringify({ streams: [] });
  }
}
