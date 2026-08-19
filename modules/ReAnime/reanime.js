async function searchResults(keyword) {
    try {
        const response = await fetchv2(`https://reanime.to/api/v1/search?q=${encodeURIComponent(keyword)}`, {}, 'GET');
        const data = await response.json();
        const results = (data.results || []).map((item) => ({
            title: item.title?.english || item.title?.romaji || item.title?.native || 'Inconnu',
            image: item.cover_image?.large || item.cover_image?.medium || '',
            href: `https://reanime.to/anime/${item.anime_id}`,
        }));
        return JSON.stringify(results);
    } catch (error) {
        console.log('ReAnime search error: ' + error.message);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        const animeId = url.split('/').pop();
        const response = await fetchv2(`https://reanime.to/api/v1/anime/${animeId}`, {}, 'GET');
        const d = await response.json();
        const sd = d.start_date || {};
        const airdate = sd.year ? `${sd.year}-${String(sd.month || 1).padStart(2, '0')}-${String(sd.day || 1).padStart(2, '0')}` : '?';
        return JSON.stringify({
            description: d.description || '',
            aliases: [d.title?.native, d.title?.romaji].filter(Boolean),
            airdate: `Aired: ${airdate}`,
        });
    } catch (error) {
        console.log('ReAnime details error: ' + error.message);
        return JSON.stringify({ description: '', aliases: [], airdate: '' });
    }
}

async function extractEpisodes(url) {
    try {
        const animeId = url.split('/').pop();
        const response = await fetchv2(`https://reanime.to/api/v1/anime/${animeId}/episodes`, {}, 'GET');
        const data = await response.json();
        const eps = (data.data || []).map((ep) => ({
            // Re:ANIME est une SPA : l'épisode se charge via ?ep=N (le front lit le paramètre).
            href: `https://reanime.to/watch/${animeId}?ep=${ep.episode_number}`,
            number: Number(ep.episode_number),
            title: `Episode ${ep.episode_number}`,
        }));
        return JSON.stringify(eps);
    } catch (error) {
        console.log('ReAnime episodes error: ' + error.message);
        return JSON.stringify([]);
    }
}

// PONT AUTH BEST-EFFORT (option 2) :
// Si l'utilisateur est connecté dans le webview du lecteur, un Bearer token
// peut exister en localStorage. On tente de le récupérer ; sinon on rend []
// (pas de flux public sur Re:ANIME — voir PHASE3.md).
async function extractStreamUrl(url) {
    try {
        const animeId = url.split('/').pop().split('?')[0];
        const epNum = new URL(url).searchParams.get('ep') || '1';
        // Récupère le token depuis le localStorage (fourni par le webview si logué).
        let token = '';
        try { token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || ''; } catch {}
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await fetchv2(`https://reanime.to/api/v1/anime/${animeId}/episode/${epNum}`, headers, 'GET');
        if (response.status === 401) {
            console.log('ReAnime stream: 401 — compte requis (connectez-vous dans le lecteur)');
            return JSON.stringify({ streams: [] });
        }
        const data = await response.json();
        // data contient les sources/embeds ; on mappe ce qui existe.
        const streams = [];
        const push = (title, streamUrl, sub) => { if (streamUrl) streams.push({ title, streamUrl, subtitle: sub || '' }); };
        if (Array.isArray(data.sources)) for (const s of data.sources) push(s.quality || s.name || 'Source', s.url || s.file || s.src, '');
        if (Array.isArray(data.embeds)) for (const e of data.embeds) push(e.name || 'Embed', e.url, '');
        return JSON.stringify({ streams });
    } catch (error) {
        console.log('ReAnime stream error: ' + error.message);
        return JSON.stringify({ streams: [] });
    }
}
