# Phase 3 — Génération assistée par LLM (corpus + matcher + qwen3-coder)

Objectif : produire un module Sora/ShiroX pour **n'importe quel site** en
partant d'un module existant du même moteur, plutôt que d'écrire from scratch.

## Outils livrés

| outil | rôle |
|---|---|
| `tools/fetch-corpus.mjs` | aspire la Module Library (149/162 modules ok, 13 liens amont morts), indexe moteur / extracteurs / télémétrie / fonctions → `corpus/index.json` |
| `tools/match-engine.mjs` | sonde un site, déduit son moteur, recommande les modules du corpus au moteur le plus proche |
| `tools/gen-module.mjs` | sondage du site + choix modèle de référence + prompt qwen3-coder:30b (Ollama) + smoke test du contrat |
| `contract-snippet.txt` | contrat Sora (4 fonctions, JSON.stringify, fetchv2, console.log mono-arg, URLs absolues) réutilisable |

Moteurs détectés sur le corpus (149 modules) :
`rest-json 75`, `html-scrape 47`, `wp-dooplay 9`, `graphql 6`,
`unknown 9`, `episodes-js 1`, `wp-madara 1`, `aniwatch-api 1`.
Classification validée : 73/75 des `rest-json` sont de vraies API (2 faux
positifs), `anime-sama`→`episodes-js` et `animex`→`graphql` corrects.

## Fonctionnel — prouvé

- corpus indexé, matcher validé sur anime-sama (episodes-js), animex (graphql),
  french-anime (html-scrape, absent du corpus) ;
- générateur : le LLM **produit un module qui respecte le contrat** (4 fonctions
  déclarées, charge sans erreur, **0 télémétrie tierce** — vérifié sur chaque
  génération) ;
- structure du module bien organisée par le LLM (config d'extracteurs, mapping
  d'URLs d'embeds, tri) — il sait *architecturer* un module Sora.

## Limite réelle (non masquée)

Le LLM **n'extrait pas fiablement les sélecteurs HTML** du site cible : sur
deux générations consécutives il a réinventé `short-item` alors que
`short2-item` était dans la page. Correctif apporté : `gen-module` extrait
désormais automatiquement une **signature de carte de résultat** et la donne
comme contrainte explicite au prompt.

Surtout : **les sites modernes ne servent pas les résultats en HTML statique**.
Mesuré :
- `french-anime.com` (DataLife Engine) : recherche = page formulaire + JS,
  résultats injectés par AJAX (`Trouvé 2 réponses` mais 0 lien `/anime/` dans le HTML) ;
- `otakufr.co` : `window.location.replace('?ch=1&js=<blob>')` (challenge JS, comme Uqload) ;
- `voir-anime.to` (wp-manga) : `?s=x` ne renvoie rien, `?s=x&post_type=wp-manga`
  renvoie 13 liens mais la structure de carte n'est pas évidente à déduire.

Conséquence : le harness ne peut **pas valider** ces sites (pas de DOM statique
à scraper), et le LLM ne peut pas en déduire les sélecteurs sans exécuter du JS.
C'est une limite du *site*, pas du pipeline.

## Pour un nouveau site : workflow recommandé

```bash
# 1. quel moteur ? (répond en <5s, 100% local)
node tools/match-engine.mjs https://SITE/

# 2. génération (Ollama qwen3-coder:30b, ~30-60s)
node tools/gen-module.mjs https://SITE/ "Mon Site" [--model <slug corpus>]

# 3. validation (le harness sonde réellement)
node tools/test.mjs modules/<mon-site>/<mon-site>.js --search "frieren"
```

Si `searchResults` renvoie 0 (cas fréquent sur site AJAX) : le module généré est
une **base à corriger à la main** sur les sélecteurs, pas un livrable prêt à
l'emploi. C'est le seuil actuel de la génération automatique.

## Correction de bug connexe

`runtime.mjs` : `pace()` laissait un `setTimeout` pending au `process.exit()`
sous Windows → crash natif `UV_HANDLE_CLOSING`. Corrigé via `timer.unref()`.
