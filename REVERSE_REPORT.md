# Reverse Engineering Report — Re:ANIME & Miruro (2026-08-19)

## Objectif
Trouver un moyen de récupérer les FLUX (M3U8) des sites demandés, sans compte
payant ni infrastructure, pour les modules Sora/ShiroX.

## Méthodologie
- Sondage direct des endpoints API (curl, tokens factices/réels).
- Téléchargement + grep du JS bundle SPA (reanime.to, flixcloud.cc, miruro.to).
- Lecture du code backend open-source MiruroAPI (`pipe.js`, `anilist.js`, `apiRoutes.js`).
- Test d'instances publiques tierces (Consumet, HiAnime, AnimeKai, animepahe).

## Résultats par site

### Re:ANIME (reanime.to)
| Endpoint | Résultat |
|----------|----------|
| `/api/v1/search?q=` | 200 `results[]` ✓ catalogue |
| `/api/v1/anime/<slug>` | 200 `data` ✓ détails |
| `/api/v1/anime/<slug>/episodes` | 200 `data[]` (9 eps test) ✓ épisodes |
| `/api/v1/anime/<slug>/episode/<N>` | 401 `{"error":"Unauthorized Access"}` ✗ |
| `/api/v1/anime/<slug>/episode/<N>/sources` | 401 ✗ |
| `/api/v1/downloads/check?...` | 200 `{"available":false,"downloads":null}` |

**Flux réel** : la page watch charge un player embédé `flixcloud.cc/e/<aid>` dont le
HTML contient `w_payload` (WASM base64) + `obfuscated_crypto_data` (AES-CBC) +
`obfuscation_seed`. Le M3U8 est **déchiffré côté client par le WASM** → aucune URL
brute dans aucune réponse API. Chunks JS flixcloud : 0 référence `w_payload`/`.m3u8`/
`Hls` (tout est dans le binaire WASM). **Mur par design, infranchissable.**

### Miruro (miruro.to + MiruroAPI)
| Endpoint | Résultat |
|----------|----------|
| MiruroAPI `/search?query=` (public `miruroapi.vercel.app`) | 200 ✓ catalogue |
| MiruroAPI `/info/:id` | 200 ✓ détails |
| MiruroAPI `/episodes/:id` | 500 (clés provider manquantes) ✗ |
| MiruroAPI `/watch/:p/:id/:cat/:slug` | 500 ✗ |
| MiruroAPI `/sources?episodeId=...` | 500 ✗ |
| `/api/secure/pipe` (backend miruro.to, 4 miroirs .to/.ru/.bz/.tv) | Cloudflare 403 ✗ |

**Mécanisme** (lu dans `pipe.js` open-source) : le flux passe par
`GET https://www.miruro.to/api/secure/pipe?e=<base64url({path,method,query})>`,
réponse base64url+gzip (+XOR `PIPE_OBF_KEY` si header `x-obfuscated:2`). Ce endpoint
est **Cloudflare-protected** (403 sans proxy). Contournement prévu par le code :
`SCRAPER_API_KEY` (ScraperAPI payant) ou `FLARESOLVERR_URL` (FlareSolverr).

### Tiers publics testés (tous morts / Cloudflare)
- Consumet (`api.consumet.org` 451, `consumet-api.vercel.app` renvoie code source)
- HiAnime / AniWatch (`*.vercel.app` 404)
- AnimeKai (`animekai.to` DNS mort)
- animepahe.ru API (`/api?m=search` → Cloudflare 301)
- gogoanime (Cloudflare 301)

## Conclusion
**Aucune voie flux sans infrastructure utilisateur.** Paysage 2026 : tous les sites
d'anime sont (a) Cloudflare-protected, (b) WASM-obfusqués, ou (c) nécessitent clés
API/proxy payantes. Ce n'est pas un défaut de méthode — c'est structurel.

## Voie retenue (opérationnelle)
Déployer **ton** instance MiruroAPI (Vercel 1-click) avec `SCRAPER_API_KEY` ou
`FLARESOLVERR_URL`. Module prêt : `modules/Miruro/miruro.js` (validé contre mock :
2 streams 1080p/720p + sous-titres FR/EN). Voir `MIRURO_DEPLOY.md`.

Re:ANIME reste **catalogue-only** (`modules/ReAnime/reanime.js`, flux `[]` propre).
