# Exercices MPI

Extension VS Code pour [exercices](https://github.com/mpi-informatique/exercices) et `exercices-prive` : rechercher des exercices, composer des documents, afficher les énoncés et les corrigés, exporter leurs PDF.

## Installation

Après sa première publication, installer [Exercices MPI depuis le Marketplace](https://marketplace.visualstudio.com/items?itemName=qfortier.vscode-mpi-exercices) et activer **Auto Update** dans le menu de l'extension. Les nouvelles versions seront récupérées automatiquement.

Pour une installation manuelle, utiliser le VSIX des [versions GitHub](https://github.com/mpi-informatique/vscode-mpi-exercices/releases) ou de `releases/` avec **Extensions → … → Installer à partir d'un VSIX**. Une installation en VSIX désactive par défaut la mise à jour automatique : la réactiver après disponibilité sur le Marketplace.

Ouvrir ensuite le dépôt public ou privé, ou leur dossier parent : les dépôts enfants immédiats sont détectés automatiquement. Pour les consulter ensemble, ouvrir `exercices-prive/exercices.code-workspace`.

L'identifiant est `qfortier.vscode-mpi-exercices`, les réglages utilisent `mpiExercices.*`. Désactiver l'ancienne extension Enseignement Typst (`qfortier.vscode-enseignement`) dans cet espace de travail pour éviter les raccourcis en double. Les anciens réglages et raccourcis personnalisés doivent utiliser le préfixe `mpiExercices.*` ; `makePath` devient `pythonPath`.

Prérequis : VS Code ≥ 1.100 et Nix avec `nix-command` et `flakes`. Tinymist est recommandé pour l'aperçu à la frappe. Sans Nix, choisir le mode `direct` et fournir Python ≥ 3.11, Typst, les dépendances Typst et, pour le privé, `EXERCICES_SOURCE`.

## Utilisation

- **Fichier** : plan du document ouvert, questions, parties et composition cliquables. Le bouton **Voir le corrigé** dans son en-tête ouvre le corrigé de ce document, même lorsque le focus est dans un autre éditeur ou dans l’aperçu.
- **Exercices** : exercices réutilisables de la banque, avec recherche et filtres de métadonnées.
- **Documents** : TD, devoirs, concours, copies et types personnalisés, avec recherche et filtre par type.

Les contenus sont reconnus d'après leur code, indépendamment du dossier : export `ex` pour un exercice, `feuille.with(type: "…", ...)` pour un document. Les fonctions de mise en page personnalisées déclarant un `type` sont aussi reconnues. Les dossiers techniques et `build/` sont exclus.

Les exercices autonomes sont dans `chapitres/<chapitre>/exercices/`, les feuilles, cours et présentations dans `chapitres/<chapitre>/`, et les sujets de concours dans `devoirs/concours/`. Le privé ajoute `corrections/<annee>/ds/<devoir>/copies/`.

La recherche ouvre un fichier sans filtrer le panneau. Elle ignore les accents et la casse, et place en premier les fichiers ouverts puis les fichiers récemment consultés. Les filtres du panneau restent appliqués. Le catalogue public est régénéré automatiquement si les sources Typst ont changé sur disque, avec un regroupement des changements toutes les cinq secondes. Une erreur conserve le dernier catalogue valide.

**Créer un exercice** utilise le modèle du dépôt et le vocabulaire de sa bibliothèque. Dans le privé, ce vocabulaire vient de la révision publique verrouillée. **Créer un document** propose les modèles de `templates/`. Les destinations suggérées suivent la structure ci-dessus et restent modifiables.

Les TD et devoirs composés démarrent vides : sélectionner un document, puis ajouter ou glisser des exercices du même dépôt. Les flèches réordonnent les exercices et **×** retire leur import. Les compositions calculées restent modifiables dans la source. Les modifications sont enregistrées et annulables. Un import utilisé ailleurs et un barème personnalisé empêchent une réécriture ambiguë.

Glisser un fichier sur un dossier permet de le déplacer dans son dépôt : les références Typst littérales sont actualisées. Vérifier les chemins calculés et les références externes. La suppression passe par la corbeille et refuse un fichier encore référencé. Les déplacements entre dépôts restent manuels.

**Ouvrir les codes associés** est accessible depuis la barre de l'éditeur Typst, la palette de commandes et le menu contextuel des exercices et documents. Le bouton **Codes associés** apparaît aussi dans l'aperçu lorsqu'il y a du code. Un seul fichier s'ouvre directement ; plusieurs fichiers donnent un choix. La recherche suit les imports de la feuille et retrouve aussi les codes placés dans le dossier propre à chaque sujet. Elle tient compte des modifications Typst non enregistrées. Les codes s'ouvrent dans l'éditeur VS Code et l'aperçu reste ouvert. Dans un `.typ`, Ctrl/Cmd+clic sur un chemin littéral de code ouvre directement ce fichier, dans la banque publique comme dans la banque privée.

## Snippets Typst

Dans un fichier `.typ`, saisir un préfixe **sans `#`**, puis choisir le snippet **MPI — …** dans les suggestions (Ctrl+Espace pour les ouvrir). Tab passe au champ suivant ; Maj+Tab revient au précédent. La commande **Snippets: Insert Snippet** permet aussi de choisir un bloc et d’y insérer le texte sélectionné.

| Préfixes | Contenu inséré |
| --- | --- |
| `solution`, `sol` | `#solution[…]` |
| `theorem`, `thm`, `theoreme` | `#theorem[…]` |
| `definition`, `def` | `#definition[…]` |
| `proposition`, `prop` | `#proposition[…]` |
| `lemma`, `lem`, `lemme` | `#lemma[…]` |
| `corollary`, `cor`, `corollaire` | `#corollary[…]` |
| `property`, `propriete` | `#property[…]` |
| `remark`, `rem`, `remarque` | `#remark[…]` |
| `example`, `exemple` | `#example[…]` |
| `exercise`, `ex`, `exercice` | `#exercise[…]` pour un cours |
| `problem`, `probleme` | `#problem[…]` |
| `algorithm`, `algo`, `algorithme` | `#algorithm[…]` |
| `thmt`, `theorem-title` | Théorème avec titre et étiquette |
| `exsol`, `exercise-solution` | Exercice de cours suivi de sa solution |
| `solpause` | Solution avec `#pause` pour la présentation |
| `question`, `ques` | Question et solution dans `contenu: (…)` |
| `question-bareme`, `quesb` | Question avec choix des points et étiquette |
| `exercice-banque`, `exbank` | Fichier d’exercice réutilisable exportant `ex` |

Ces blocs utilisent les fonctions de la bibliothèque MPI, à importer dans le document comme dans les modèles de `templates/`. Les environnements encadrés viennent de `theoremes` ; `solution` vient de `/load.typ`. Les snippets de questions s’utilisent en mode code, dans le tuple `contenu`, et incluent leur virgule finale. Pour un nouvel exercice, **F4** conserve la création guidée avec les métadonnées du dépôt ; `exbank` fournit un squelette à adapter manuellement.

Pour développer directement un préfixe avec Tab, activer facultativement `"editor.tabCompletion": "onlySnippets"` dans les réglages VS Code.

## Raccourcis

Dans un éditeur Typst ou une liste du panneau, hors des champs de saisie :

| Touche | Seule | Avec Maj |
| --- | --- | --- |
| F2 | Chercher un exercice | Chercher un document |
| F3 | Filtrer les exercices | Filtrer les documents |
| F4 | Ajouter un exercice | Créer un document |
| F5 | Afficher l'énoncé | Exporter l'énoncé |
| F6 | Afficher le corrigé | Exporter le corrigé |

F5 et F6 fonctionnent aussi lorsque le lecteur PDF ou l’aperçu Tinymist a le focus, y compris dans le champ de numéro de page : ils sélectionnent la variante du document affiché.

Sur Mac, Fn peut être nécessaire. Échap ou **×** efface les filtres actifs du panneau. **Tout replier** et **Basculer dossiers / liste** sont dans **…**.

Pour un fichier utilisant `#show: cours-et-presentation.with(...)`, **F5** compile et affiche le cours, **F6** le cours corrigé. Les boutons de l'aperçu deviennent **Cours**, **Cours corrigé** et **Présentation**. **Maj+F5** et **Maj+F6** exportent le cours et son corrigé, et le bouton d'export de la présentation produit le PDF des diapositives. Ces fichiers sont nommés `cours-kleene.pdf`, `cours-kleene-cor.pdf` et `presentation-kleene.pdf` pour une source `cours-kleene.typ`.

## Compilation et aperçu

Les commandes appellent `python3 scripts/build.py` dans le dépôt concerné. En mode `auto`, un `flake.nix` déclenche `nix develop . -c python3 scripts/build.py …`. Just reste disponible dans les dépôts pour le terminal, mais l'extension n'en dépend pas.

Les exports et le lecteur PDF de secours utilisent l'action `c chemin.typ`, qui compile les deux variantes. Les PDF restent sous `build/<chemin-sans-extension>/` : une source `foo.typ` produit `foo.pdf` et `foo-cor.pdf`, y compris pour une copie privée. Un cours avec présentation conserve les noms `cours-<nom>.pdf`, `cours-<nom>-cor.pdf` et `presentation-<nom>.pdf`. Les scripts du privé actualisent les notes avant de compiler les copies.

Avec Tinymist, le rendu vectoriel suit les modifications sans enregistrer. Les boutons Énoncé et Corrigé réutilisent leurs sessions. L’environnement Nix est préparé en arrière-plan à l’ouverture du dépôt, puis réutilisé pour les nouveaux aperçus jusqu’à un changement des fichiers du dépôt ou des réglages. Après une courte pause sur un fichier Typst actif, ses variantes Tinymist sont aussi préparées en arrière-plan, sans ouvrir de lecteur ni afficher leurs diagnostics. F5/F6 récupèrent ces sessions ; les préparations inutilisées sont arrêtées au changement de fichier. Les moteurs d’aperçu chargent la source affichée et les modifications non enregistrées ; les fichiers ouverts par le catalogue ne déclenchent pas de compilations supplémentaires. **↔** active les sauts entre source et aperçu, **lune** inverse le thème. L'extension fournit à son moteur Tinymist les chemins de packages de l'environnement Nix : la révision utilisée dans le privé est celle de son `flake.lock`, sans installation utilisateur préalable. Les CSV `notes.csv` et `recapitulatif.csv` actualisent aussi l'aperçu d'une copie.

Sans Tinymist, un lecteur PDF se recharge à l'enregistrement, sans synchronisation source. Enregistrer les fichiers avant d'exporter. Une erreur de compilation apparaît dans Problems et dans la barre d'état, avec un lien vers le journal.

La barre d'outils indique la page actuellement la plus visible et le nombre total de pages, avec Tinymist comme dans le lecteur PDF de secours. Saisir un numéro puis appuyer sur Entrée pour rejoindre une page ; les boutons **‹** et **›** et les touches **←** et **→** passent à la page précédente ou suivante. L'indicateur suit le défilement, les recompilations et les changements de variante.

| Réglage | Rôle |
| --- | --- |
| `mpiExercices.execution` | `auto` par défaut, `nix` ou `direct`. |
| `mpiExercices.bankPath` | Racine du dépôt, si différente du dossier ouvert. |
| `mpiExercices.pythonPath` | Exécutable Python dans l'environnement choisi, `python3` par défaut. |
| `mpiExercices.nixPath` | Exécutable Nix. Les installations standard macOS sont détectées. |
| `mpiExercices.previewTheme` | `auto`, `light` ou `dark`. |

## Développement

Cloner aussi `mpi-informatique/exercices` dans le dossier voisin `../exercices`. Le package local `../exercices/shared` fournit les types, la validation du catalogue, les filtres et les noms de PDF communs avec le site web. Il est intégré au JavaScript du VSIX à la compilation ; les utilisateurs de l'extension n'ont rien à installer en plus. Les workflows CI fixent la révision publique utilisée pour construire l'extension.

```sh
nix develop .
npm ci
npm test
npm run test:integration
npm run package
```

`just check`, `just integration` et `just package` fournissent des raccourcis dans cet environnement. Le VSIX est produit dans `releases/` et exclu de Git. `flake.lock` et `package-lock.json` fixent les outils et les dépendances JavaScript. Avec direnv et nix-direnv, `direnv allow` active l'environnement.

Les tests unitaires couvrent la découverte, les métadonnées, les chemins, la composition et les commandes Python/Nix. Les tests d'intégration ouvrent un profil VS Code isolé, utilisent des documents et des copies fictifs, et ne lisent pas les données d'élèves.

Pour une seule suite : `npm run test:integration -- --suite=edition`. Suites : `decouverte`, `edition`, `apercu`, `demarrage`, `corrections`, `documents`. Les suites publiques utilisent le clone voisin `../exercices`. La suite `corrections` nécessite les outils de `../exercices-prive`, sans en copier les corrections. Les aperçus natifs nécessitent Tinymist installé.

Variables de test : `MPI_EXERCICES_ROOT` pour le dépôt ouvert, `MPI_PUBLIC_ROOT` pour les outils publics, `MPI_PRIVATE_ROOT` pour les outils privés, `VSCODE_EXECUTABLE` et `TINYMIST_PATH` pour choisir les installations. Consulter [l'organisation du code](scripts/README.md) pour comprendre les différents modules.

Le code reprend l'extension locale `vscode-exercices-mpi`. La licence reste `UNLICENSED`, comme dans le dépôt d'origine. Les licences des composants embarqués sont conservées dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Publication

Le workflow [Publication Marketplace](.github/workflows/publish.yml) teste et publie chaque tag stable `vX.Y.Z`. La configuration initiale du compte éditeur, de l'authentification et la préparation des versions sont décrites dans le [guide de publication](docs/publication.md).
