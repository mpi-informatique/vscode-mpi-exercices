# Journal des versions

## 0.1.0

- Garder un seul préfixe par snippet et ajouter une variante `-titre` pour chaque bloc numéroté.

- Ajouter `!taille-pres` pour modifier la taille du texte uniquement en présentation, avec champs pour la taille et le contenu.

- Ajouter `!exemple` et `!attention` pour insérer les titres soulignés correspondants.

- Ajouter `!remarque` pour insérer une remarque en ligne avec titre souligné.

- Déclencher les suggestions de snippets avec `!` et ajouter les blocs `slides-only` et `article-only`.

- Ajouter les snippets Typst des cours et de la banque : solutions, théorèmes, exercices, questions et barèmes.

- Utiliser le logo MPI comme icône de l'extension.

- Automatiser la publication Marketplace et des VSIX GitHub à partir des tags stables.

- Créer l'extension Exercices MPI pour les dépôts `exercices` et `exercices-prive`.
- Remplacer Make par les scripts Python des dépôts, avec Nix automatique.
- Adapter la découverte, les modèles et les exports aux nouveaux chemins, dont les PDF des copies privées.
- Permettre la création d'exercices privés avec le vocabulaire de la bibliothèque publique verrouillée.
- Fournir les packages Typst de l'environnement Nix aux aperçus Tinymist.
- Regrouper les feuilles, sujets, copies et futurs supports dans la vue Documents.
- Conserver recherche, filtres, composition, aperçu vectoriel, synchronisation et lecteur PDF de secours.
