// ── Miruro (via MiruroAPI auto-hébergé) ────────────────────────────────────────
// Miruro.to verrouille ses flux derrière un proxy signé (410) + Cloudflare.
// Son backend open-source (Shineii86/MiruroAPI) expose en REVANCHE des M3U8
// publics via /sources et /watch. Pour utiliser ce module, DÉPLOIE TON INSTANCE
// MiruroAPI (1-click Vercel depuis le repo) et colle son URL ci-dessous.
// ⚠️ Ne committe jamais l'URL de ton instance si elle est privée.
const MIRURO_API_BASE = ''; // ex: 'https://mon-instance.vercel.app'

const MIRURO_PROVIDER = 'kiwi'; // provider par défaut (kiwi = AnimeKai/AnimePahe-like)

function miruroApi() {
  const base = (MIRURO_API_BASE || '').replace(/\/+$/, '');
  if (!base) {
    console.log('Miruro: MIRURO_API_BASE vide — déployez votre instance MiruroAPI et renseignez la variable');
  }
  return base;
}

async function mFetch(path, params) {
  const base = miruroApi();
  if (!base) return null;
  let url = base + path;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }
  try {
    const r = await fetchv2(url, { Accept: 'application/json' }, 'GET');
    if (!r || r.status !== 200) {
      console.log('Miruro API ' + r?.status + ' on ' + path);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.log('Miruro fetch error: ' + e.message);
    return null;
  }
}

// href interne (https factice, parsé dans extractStreamUrl) : encode anilistId + slug
function epHref(anilistId, slug) {
  return `https://miruro.local/watch/${anilistId}/${slug}`;
}

async function searchResults(keyword) {
  try {
    const data = await mFetch('/search', { query: keyword, per_page: 20 });
    const items = data?.results || [];
    const results = items.map((it) => ({
      title: it.title?.english || it.title?.romaji || it.title?.native || 'Inconnu',
      image: it.coverImage?.extraLarge || it.coverImage?.large || '',
      href: `https://miruro.local/anime/${it.id}`,
    }));
    return JSON.stringify(results);
  } catch (e) {
    console.log('Miruro search error: ' + e.message);
    return JSON.stringify([]);
  }
}

async function extractDetails(url) {
  try {
    const id = url.split('/').pop();
    const data = await mFetch('/info/' + id);
    const d = data || {};
    const sd = d.startDate || {};
    const airdate = sd.year ? `${sd.year}-${String(sd.month || 1).padStart(2, '0')}-${String(sd.day || 1).padStart(2, '0')}` : '?';
    return JSON.stringify({
      description: d.description || '',
      aliases: [d.title?.native, d.title?.romaji].filter(Boolean),
      airdate: `Aired: ${airdate}`,
    });
  } catch (e) {
    console.log('Miruro details error: ' + e.message);
    return JSON.stringify({ description: '', aliases: [], airdate: '' });
  }
}

async function extractEpisodes(url) {
  try {
    const id = url.split('/').pop();
    const data = await mFetch('/episodes/' + id, { provider: MIRURO_PROVIDER });
    const prov = data?.providers?.[MIRURO_PROVIDER];
    const eps = prov?.episodes?.sub || [];
    const out = eps.map((ep) => {
      // slug cible = `${prefix}-${number}` (tel que MiruroAPI le reconstruit)
      const prefix = (ep.id || '').includes(':') ? ep.id.split(':')[0] : (ep.id || '').split('/').pop();
      const slug = `${prefix}-${ep.number}`;
      return {
        href: epHref(id, slug),
        number: Number(ep.number),
        title: `Episode ${ep.number}`,
      };
    });
    return JSON.stringify(out);
  } catch (e) {
    console.log('Miruro episodes error: ' + e.message);
    return JSON.stringify([]);
  }
}

async function extractStreamUrl(url) {
  try {
    const parts = url.split('/'); // https://miruro.local/watch/<id>/<slug>
    const anilistId = parts[parts.length - 2];
    const slug = parts[parts.length - 1];
    const data = await mFetch(`/watch/${MIRURO_PROVIDER}/${anilistId}/sub/${slug}`);
    if (!data) return JSON.stringify({ streams: [] });
    const sources = data.sources || [];
    const subtitles = (data.subtitles || []).map((s) => ({
      url: s.url || s.file || '',
      language: s.language || s.label || 'en',
      format: s.format || 'vtt',
    }));
    const fr = subtitles.find((s) => /fr/i.test(s.language));
    const streams = sources
      .filter((s) => s.url)
      .map((s) => ({
        title: `${MIRURO_PROVIDER} · ${s.quality || s.label || 'source'}`,
        streamUrl: s.url,
        subtitle: fr ? fr.url : (subtitles[0]?.url || ''),
      }));
    return JSON.stringify({ streams, subtitles });
  } catch (e) {
    console.log('Miruro stream error: ' + e.message);
    return JSON.stringify({ streams: [] });
  }
}
