# Miruro — Déploiement de l'instance (voie flux unique qui marche)

## Pourquoi ce déploiement est requis
Le reverse engineering exhaustif (voir `REVERSE_REPORT.md`) a prouvé que **aucun
flux anime n'est accessible sans infrastructure** :
- Re:ANIME → player flixcloud WASM+AES (mur par design, jamais de M3U8 brut)
- Miruro `/api/secure/pipe` → Cloudflare 403 sur tous les miroirs
- Consumet / HiAnime / AnimeKai / animepahe publics → morts / 404 / Cloudflare

**Seule voie opérationnelle** : déployer **ton** instance MiruroAPI
(backend open-source MIT) configurée avec tes clés + un proxy anti-Cloudflare.
Le module `modules/Miruro/miruro.js` pointe dessus via `MIRURO_API_BASE`.

## Déploiement (Vercel 1-click, ~5 min)
1. Fork / ouvre https://github.com/Shineii86/MiruroAPI
2. "Deploy" sur Vercel (bouton sur le README) OU :
   ```bash
   git clone https://github.com/Shineii86/MiruroAPI
   cd MiruroAPI && vercel --prod
   ```
3. **Variables d'environnement** (lecture du code `pipe.js`) :
   - `PIPE_OBF_KEY` = `71951034f8fbcf53d89db52ceb3dc22c` (défaut du repo, peut être réglé)
   - `SCRAPER_API_KEY` = ta clé ScraperAPI (https://scraperapi.com) — OU —
   - `FLARESOLVERR_URL` = URL de ton instance FlareSolverr (contourne Cloudflare)
   → **au moins un des deux** (SCRAPER_API_KEY ou FLARESOLVERR_URL) est OBLIGATOIRE
      sinon `/episodes` et `/watch` renvoient 500 (c'est ce qui bloque l'instance
      publique `miruroapi.vercel.app`).
4. Redeploy après avoir setté les vars.

## Activer le module
Dans `modules/Miruro/miruro.js`, ligne ~11 :
```js
const MIRURO_API_BASE = 'https://TON-INSTANCE.vercel.app'; // <- colle ton URL
```
Puis (optionnel) push le `.json` :
```
https://raw.githubusercontent.com/ArthurRoux99/Module_Sora/main/modules/Miruro/miruro.json
```

## Test local (sans déployer)
Un mock local est disponible pour valider le parsing du module :
```bash
node tools/mock-miruro.mjs &          # serveur factice sur :8787
sed 's#const MIRURO_API_BASE = .*;#const MIRURO_API_BASE = "http://localhost:8787";#' \
    modules/Miruro/miruro.js > modules/Miruro/_mock.js
node tools/test.mjs modules/Miruro/_mock.js --search "frieren" --pace 200
rm -f modules/Miruro/_mock.js
```
Résultat attendu : search ✓, details ✓, episodes (N) ✓, extractStreamUrl 2 streams + sous-titres ✓.

## Notes
- Provider par défaut du module = `kiwi` (modifiable via `MIRURO_PROVIDER`).
- Sous-titres : FR + EN extraits de la réponse MiruroAPI (`subtitles[].url`).
- Le flux est du HLS (`streamType: HLS`, `.m3u8`) — lu nativement par Sora/ShiroX.
