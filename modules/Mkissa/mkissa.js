// ── mkissa.to (fork AllAnime) ────────────────────────────────────────────────
// API GraphQL publique : https://api.mkissa.net/api  (catalogue OK, testé live)
// ⚠️ FLUX : AllAnime protège les sources par un token crypto WebCrypto évolutif
// (header x-aa-boot généré côté client via /client-crypto/v1/bootstrap).
// Le catalogue (search/details/episodes) fonctionne SANS token. Le flux
// (extractStreamUrl) nécessite la reproduction du token — voir note en bas.
const MK_API = 'https://api.mkissa.net/api';
const MK_REFERER = 'https://mkissa.to/';

async function mkGraphql(query, variables) {
  try {
    const r = await fetchv2(MK_API, {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      'Referer': MK_REFERER,
      'Origin': 'https://mkissa.to',
    }, 'POST', JSON.stringify({ query, variables }));
    if (!r || r.status !== 200) {
      console.log('mkissa API ' + r?.status);
      return null;
    }
    const j = await r.json();
    if (j.errors) {
      console.log('mkissa GQL err: ' + j.errors[0]?.message);
      return null;
    }
    return j.data;
  } catch (e) {
    console.log('mkissa fetch error: ' + e.message);
    return null;
  }
}

async function searchResults(keyword) {
  try {
    const q = 'query($s:WorkSearch,$p:Int,$z:Int){works(search:$s,page:$p,size:$z){edges{_id name englishName nativeName thumbnail}}}';
    const d = await mkGraphql(q, { s: { query: keyword }, p: 1, z: 20 });
    const edges = d?.works?.edges || [];
    const results = edges.map((e) => ({
      title: e.englishName || e.name || e.nativeName || 'Inconnu',
      image: e.thumbnail || '',
      href: `https://mkissa.to/anime/${e._id}`,
    }));
    return JSON.stringify(results);
  } catch (e) {
    console.log('mkissa search error: ' + e.message);
    return JSON.stringify([]);
  }
}

async function extractDetails(url) {
  try {
    const id = url.split('/').pop();
    const q = 'query($id:String!){work(_id:$id){name englishName nativeName description releaseYear}}';
    const d = await mkGraphql(q, { id });
    const w = d?.work;
    if (!w) return JSON.stringify({ description: '', aliases: [], airdate: '' });
    return JSON.stringify({
      description: w.description || '',
      aliases: [w.nativeName, w.englishName].filter(Boolean),
      airdate: w.releaseYear ? `Released: ${w.releaseYear}` : '',
    });
  } catch (e) {
    console.log('mkissa details error: ' + e.message);
    return JSON.stringify({ description: '', aliases: [], airdate: '' });
  }
}

async function extractEpisodes(url) {
  try {
    const id = url.split('/').pop();
    // episodeInfos nécessite episodeNumStart/End ; on prend 1..2000
    const q = 'query($id:String!,$s:Float!,$e:Float!){episodeInfos(showId:$id,episodeNumStart:$s,episodeNumEnd:$e){_id episodeIdNum vidInforssub vidInforsdub}}';
    const d = await mkGraphql(q, { id, s: 1, e: 2000 });
    const infos = d?.episodeInfos || [];
    const out = infos.map((ep) => ({
      href: `https://mkissa.to/anime/${id}/episode-${ep.episodeIdNum}?tt=sub`,
      number: Number(ep.episodeIdNum),
      title: `Episode ${ep.episodeIdNum}`,
    }));
    return JSON.stringify(out.length ? out : []);
  } catch (e) {
    console.log('mkissa episodes error: ' + e.message);
    return JSON.stringify([]);
  }
}

async function extractStreamUrl(url) {
  try {
    const parts = url.split('/');
    const id = parts[parts.length - 3] || parts[parts.length - 2];
    const epSlug = parts[parts.length - 1] || '';
    const epNum = (epSlug.match(/episode-(\d+)/) || [])[1] || '1';
    const q = 'query($showId:String!,$ep:String!,$tt:VaildTranslationTypeEnumType!){episode(showId:$showId,episodeString:$ep,translationType:$tt){episodeString sourceUrls videoUrlProcessed}}';
    const d = await mkGraphql(q, { showId: id, ep: epNum, tt: 'sub' });
    // Si AA_CRYPTO_MISSING -> pas de flux sans token (anti-scraping AllAnime)
    const ep = d?.episode;
    if (!ep) {
      console.log('mkissa stream: AA_CRYPTO_MISSING — token crypto AllAnime requis (non implémenté)');
      return JSON.stringify({ streams: [] });
    }
    const streams = [];
    const push = (title, u) => { if (u) streams.push({ title, streamUrl: u, subtitle: '' }); };
    if (ep.videoUrlProcessed) push('mkissa · processed', ep.videoUrlProcessed);
    if (Array.isArray(ep.sourceUrls)) for (const s of ep.sourceUrls) push('mkissa · source', s.url || s);
    return JSON.stringify({ streams });
  } catch (e) {
    console.log('mkissa stream error: ' + e.message);
    return JSON.stringify({ streams: [] });
  }
}
