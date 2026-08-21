# Module_Sora

Modules Sora / ShiroX pour sites de streaming d'anime, avec un harness de test local
qui simule le runtime de l'app (pas besoin de relancer ShiroX à chaque itération).

## Installation dans ShiroX / Sora

Ajouter un module par URL de manifest. Après mise à jour, incrémenter `version`
dans le manifest (l'app cache agressivement les scripts).

### Modules livrés

| Module | Flux | Manifest (URL d'installation) |
|--------|------|-------------------------------|
| **Anidap** (VOSTFR, flux cracké) | ✅ M3U8 + sous-titres | `https://raw.githubusercontent.com/ArthurRoux99/Module_Sora/main/modules/Anidap/anidap.json` |
| **Anime-Sama VOSTFR** | ✅ 4/6 jouables | `https://raw.githubusercontent.com/ArthurRoux99/Module_Sora/main/modules/Anime-Sama-VOSTFR/anime-sama-vostfr.json` |
| **Animex** (anglais, SUB) | ✅ 6/6 jouables | `https://raw.githubusercontent.com/ArthurRoux99/Module_Sora/main/modules/Animex/animex.json` |
| **Miruro** (via instance user) | ⚠️ flux si `MIRURO_API_BASE` rempli | `https://raw.githubusercontent.com/ArthurRoux99/Module_Sora/main/modules/Miruro/miruro.json` |
| **Mkissa** (AllAnime, catalogue) | ⚠️ catalogue seul (token `x-aa-boot` ofusqué) | `https://raw.githubusercontent.com/ArthurRoux99/Module_Sora/main/modules/Mkissa/mkissa.json` |
| **Kazora** (catalogue) | ⚠️ catalogue seul (embed externe) | `https://raw.githubusercontent.com/ArthurRoux99/Module_Sora/main/modules/Kazora/kazora.json` |
| **Re:ANIME** (catalogue) | ❌ mur flux (WASM/AES flixcloud) | `https://raw.githubusercontent.com/ArthurRoux99/Module_Sora/main/modules/ReAnime/reanime.json` |

> **Anidap** est le module à flux réel complet (reverse du chiffrement AES-GCM+XOR
> repro en JS pur). **Mkissa/Kazora/Re:ANIME** ont un flux bloqué par design
> (token ofusqué / embed externe / WASM) — leur catalogue fonctionne.

### Déploiement Miruro (flux réel)

Le module Miruro pointe vers ton instance (var `MIRURO_API_BASE` dans
`modules/Miruro/miruro.js`). Déployer `Shineii86/MiruroAPI` sur Vercel, renseigner
les clés provider + un proxy anti-Cloudflare (`SCRAPER_API_KEY` ou
`FLARESOLVERR_URL`), puis coller l'URL dans `MIRURO_API_BASE`. Guide :
`MIRURO_DEPLOY.md`.



## Modifications par rapport aux modules amont

### Anime-Sama (fork de MXFia19)
- **Correctif du détecteur d'embeds** : l'original exigeait `/vidhide/` ou un
  packer avant de tenter l'extraction, ce qui faisait **ignorer `ansembed.net`**
  alors que sa page sert un m3u8 1080p répondant 200. Mesure : 4 → 6 serveurs,
  2/4 → 4/6 jouables, flux VOSTFR jouables **1 → 2**.
- **Étiquetage par domaine réel** : `smoothpre.com` était annoncé « Vidhide ».
- **Télémétrie tierce neutralisée** : l'original POSTait chaque recherche et
  chaque lecture vers un Supabase appartenant à l'auteur amont (4 requêtes par
  exécution). `sendSupabaseLog` est un no-op ; aucune donnée ne quitte l'appareil.
- **Tri VOSTFR en tête** — aucun flux retiré, VF et VA restent disponibles.

### Animex (fork de ibro)
- **Tri SUB avant DUB.** Note : Animex est une source anglaise, il n'existe
  aucune piste VOSTFR côté serveur (les soft-subs sont anglais).

## Harness de test

```bash
# Chaîne complète + sonde réelle des flux
node tools/test.mjs modules/Animex/animex.js --search "frieren"
node tools/test.mjs modules/Anime-Sama-VOSTFR/anime-sama-vostfr.js --search "frieren" --lang VOSTFR

# Manifests : schéma, énumérations, %s, URLs distantes
node tools/validate-manifest.mjs modules/**/*.json
```

Options : `--lang VOSTFR`, `--ep N`, `--pace <ms>` (espace les requêtes), `-v`.

Le runner valide le contrat de la doc (string JSON, `number` numérique, champs
requis) puis **sonde réellement chaque flux** : une URL retournée mais qui
répond 403 est un module cassé, pas un succès.

### `tools/runtime.mjs` — notes de fidélité

- `fetchv2(url, headers, method, body, redirect, encoding)`, `fetch`, et un
  `console.log` **mono-argument** (l'app ne supporte qu'un seul argument).
- **Cookie jar + retry sur challenge 403.** `pp.animex.one` (Cloudflare) répond
  403 `bot_detected` au premier appel *uniquement pour poser* `_amx_id`, puis 200
  avec le cookie. Vérifié : `appel1=403 + Set-Cookie`, `appel2=200`. Un
  navigateur — donc l'app — enchaîne naturellement. Sans jar, Animex retournait
  **0 stream** au lieu de 11 : c'était un défaut du harness, pas du module.
- **`Referer`/`Origin` ne sont PAS injectés automatiquement**, volontairement.
  Un module qui les oublie doit échouer ici comme il échouerait dans l'app,
  sinon le harness masque le bug au lieu de le révéler.
- La télémétrie tierce est bloquée par défaut et signalée dans le bilan.

## Structure

```
modules/<Source>/     module .js + manifest .json
reference/            modules amont intacts (comparaison)
tools/runtime.mjs     shim du runtime Sora/ShiroX
tools/test.mjs        runner de conformité
tools/validate-manifest.mjs
tools/diag-vidhide.mjs  diagnostic par embed (DNS, packer, extraction)
```

## Contrat des modules (doc Sora)

```js
async function searchResults(keyword)   // -> JSON.stringify([{title, image, href}])
async function extractDetails(url)      // -> JSON.stringify({description, aliases, airdate})
async function extractEpisodes(url)     // -> JSON.stringify([{href, number: Number}])
async function extractStreamUrl(url)    // -> JSON.stringify({streams:[{title,streamUrl,headers}], subtitle})
```

Pièges : tout doit être `JSON.stringify`é ; `number` est un **Number** ;
`console.log` n'accepte qu'un argument (concaténer avec `+`) ; `searchBaseUrl`
doit contenir `%s` ; `asyncJS: true` obligatoire.
