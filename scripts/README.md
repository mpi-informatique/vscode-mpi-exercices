# Organisation du code

`src/extension.ts` relie les commandes VS Code et les vues. Les autres modules séparent les fonctions principales :

| Modules | Rôle |
| --- | --- |
| `environment.ts`, `runner.ts` | Choisir Nix ou Python direct, fournir les packages aux aperçus et exécuter les commandes de compilation sans shell. |
| `documents.ts`, `core.ts`, `refresh.ts` | Reconnaître les sources, valider les métadonnées, calculer les chemins PDF et regrouper les actualisations. |
| `browser.ts`, `tree.ts`, `search.ts`, `search-order.ts` | Arborescences, filtres, recherche et historique. |
| `authoring.ts`, `typst.ts`, `sheet-model.ts`, `sheets.ts` | Créer les sources depuis les modèles et modifier les compositions littérales. |
| `files.ts`, `drag.ts`, `outline.ts` | Gérer les fichiers, le glisser-déposer et le plan du document. |
| `code-files.ts` | Retrouver les codes associés, les ouvrir et lier leurs chemins dans les sources Typst. |
| `preview.ts`, `tinymist.ts`, `preview-bridge.ts`, `copy-inputs.ts` | Afficher les variantes, synchroniser les positions et fournir les statistiques des copies. |
| `errors.ts` | Présenter les erreurs dans la barre d'état et Problems. |

`build.mjs` utilise esbuild pour produire `dist/extension.js`, les tests et les ressources du lecteur PDF. `integration.mjs` lance les suites dans un profil VS Code temporaire et nettoie ce profil à la fin. Les données fictives des tests restent dans des répertoires temporaires.

La logique de compilation pédagogique reste dans les dépôts de contenu : l'extension appelle leur `scripts/build.py`, sans recopier leurs règles.

`check-release.mjs vX.Y.Z` vérifie le tag d’Exercices MPI et la cohérence des manifestes et verrous des deux extensions. TP MPI conserve sa propre version stable. Le workflow de publication construit les deux VSIX, leur donne des noms fixes et les joint à une release GitHub.

L’extension élève [TP MPI](../tp/README.md) est indépendante dans `tp/`, avec ses propres modules `src/`, scripts, dépendances et tests. Le package partagé reste dans le dépôt voisin `exercices/shared`. Le workflow `tp.yml` vérifie TP MPI et produit son VSIX ; `check.yml` vérifie Exercices MPI et `publish.yml` publie les deux extensions ensemble.
