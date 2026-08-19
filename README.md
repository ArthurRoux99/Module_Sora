# Module_Sora

Modules Sora / ShiroX pour sites de streaming d'anime, avec un harness de test local
qui simule le runtime de l'app (pas besoin de relancer ShiroX à chaque itération).

## Installation dans ShiroX / Sora

Ajouter un module par URL de manifest :

**Anime-Sama VOSTFR** (français, VOSTFR prioritaire)
```
https://raw.githubusercontent.com/ArthurRoux99/Module_Sora/main/modules/Anime-Sama-VOSTFR/anime-sama-vostfr.json
```
**Miruro** 
```
https://raw.githubusercontent.com/ArthurRoux99/Module_Sora/main/modules/miruro.json
```
**Animex** (anglais, SUB prioritaire, HLS 1080p)
```
https://raw.githubusercontent.com/ArthurRoux99/Module_Sora/main/modules/Animex/animex.json
```

> Après une mise à jour, incrémenter `version` dans le manifest : l'app met les
> scripts en cache de façon agressive.

## État mesuré (Frieren, épisode 1)

| | Anime-Sama VOSTFR | Animex |
|---|---|---|
| Architecture | scraping HTML → MP4/HLS | GraphQL → HLS |
| Serveurs annoncés | 6 | 11 |
| Flux jouables | 4/6 | 6/6 |
| Priorité langue | `[VOSTFR]` en tête | `SUB` en tête |
| Épisodes | 38 | 28 |

Les 2 échecs d'Anime-Sama sont **Smoothpre** : son hôte `acek-cdn.com` ne résout
pas en DNS (mort côté source). Les entrées sont conservées volontairement — elles
ne coûtent rien et peuvent revivre.

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
