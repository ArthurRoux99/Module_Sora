# Débloquer Re:ANIME et Miruro (sources VOSTFR prioritaires)

Les deux sites verrouillent leurs FLUX derrière une auth (compte ou proxy signé).
ShiroX n'a pas de webview de login → le module ne peut pas s'authentifier seul.
Deux voies, toutes deux nécessitent UNE action de ta part (compte/token/déploiement).

## Re:ANIME — voie token (prête, il manque ton token)

Le front appelle ses flux avec `Authorization: Bearer <token>` (token stocké en
localStorage par le store connecté). Le module `modules/ReAnime/reanime.js` a un
slot `REANIME_TOKEN` (variable en tête de fichier) + fallback localStorage.

### Récupérer ton token depuis Chrome (connecté sur reanime.to)
1. Connecte-toi sur https://reanime.to dans Chrome.
2. F12 → Network → recharge la page → cherche une requête vers
   `/api/v1/user/ws-ticket` (ou `/api/v1/anime/.../episode/1`).
3. Dans l'onglet Headers → Request Headers → copie la valeur de
   `Authorization: Bearer eyJhbGci...` (tout le texte après `Bearer `).
4. Colle-le dans `modules/ReAnime/reanime.js` :
   `const REANIME_TOKEN = 'eyJhbGci...';` (remplace `''`).
5. ⚠️ Ne committe PAS ce token (il expire à la déconnexion). Tu le remets à
   `''` avant tout `git push`, ou tu gardes ta copie locale non suivie.

Résultat attendu : `extractStreamUrl` envoie le Bearer → l'API renvoie les
sources M3U8 → flux lisibles dans ShiroX.

## Miruro — voie auto-hébergement (open-source)

`miruro.to` utilise un proxy de flux signé (`/api/secure/pipe` → 410) et un
challenge Cloudflare sur la home. Mais le backend est **open-source MIT** :
`github.com/Shineii86/MiruroAPI` (46 endpoints, 12 providers M3U8, alimenté par
AniList + providers Miruro).

L'instance publique `miruroapi.vercel.app` est **pausée** (le README le dit).
Solution : **héberge ta propre instance** (Vercel/Render gratuit, 1 click deploy
depuis le repo). Ton instance expose `/api/v1/sources?provider=&animeId=&episode=&category=`
qui renvoie les M3U8 publics (pas de 401/410).

Le module Miruro appellera alors TON instance au lieu de miruro.to.

### TODO module Miruro (à écrire une fois l'instance prête)
- searchResults / extractDetails / extractEpisodes : via AniList GraphQL (public)
  ou via ton instance MiruroAPI (`/api/v1/search`, `/api/v1/info/:id`,
  `/api/v1/episodes/:id`).
- extractStreamUrl : `GET <TON_INSTANCE>/api/v1/sources?provider=zoro&animeId=<id>&episode=<n>&category=sub`
  → parse les `sources[].url` (M3U8).

##État
- Re:Anime : module catalogue OK (search/details/episodes validés) + slot token prêt.
  Flux débloqués dès que tu colles ton token. ✓ chemin technique validé.
- Miruro : backend open-source identifié, endpoint `/sources` confirmé dans le
  code. Il reste (a) ton déploiement d'instance et (b) l'écriture du module.
