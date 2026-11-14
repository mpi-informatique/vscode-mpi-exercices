# Exercices MPI

Extension VS Code pour [exercices](https://github.com/mpi-informatique/exercices) et `exercices-prive` : rechercher des exercices, composer des documents, afficher les énoncés et les corrigés, exporter leurs PDF.

Le dépôt contient aussi [TP MPI](tp/README.md), une extension indépendante pour les élèves, dans `tp/`. Les commandes ci-dessous concernent Exercices MPI ; TP MPI possède ses propres dépendances, tests et VSIX. Les deux extensions partagent les composants de `../exercices/shared`.

## Installation

Télécharger [Exercices MPI — dernière release stable](https://github.com/mpi-informatique/vscode-mpi-exercices/releases/latest/download/vscode-mpi-exercices.vsix), puis utiliser **Extensions → … → Installer à partir d’un VSIX**. Les [releases GitHub](https://github.com/mpi-informatique/vscode-mpi-exercices/releases) contiennent les deux extensions : `vscode-mpi-exercices.vsix` pour les enseignants et `vscode-mpi-tp.vsix` pour les élèves.

Pour une mise à jour locale, télécharger à nouveau le VSIX et le réinstaller. Dans le Codespace de `tp-environnement`, TP MPI est actualisée automatiquement à chaque connexion.

Ouvrir ensuite le dépôt public ou privé, ou leur dossier parent : les dépôts enfants immédiats sont détectés automatiquement. Pour les consulter ensemble, ouvrir `exercices-prive/exercices.code-workspace`.
Un dossier d'espace de travail indisponible ne bloque pas les autres banques ; son absence est signalée dans **Affichage → Sortie → Exercices MPI**.

L'identifiant est `qfortier.vscode-mpi-exercices`, les réglages utilisent `mpiExercices.*`. Désactiver l'ancienne extension Enseignement Typst (`qfortier.vscode-enseignement`) dans cet espace de travail pour éviter les raccourcis en double. Les anciens réglages et raccourcis personnalisés doivent utiliser le préfixe `mpiExercices.*` ; `makePath` devient `pythonPath`.

Prérequis : VS Code ≥ 1.100 et Nix avec `nix-command` et `flakes`. Tinymist est recommandé pour l'aperçu à la frappe. Sans Nix, choisir le mode `direct` et fournir Python ≥ 3.11, Typst, les dépendances Typst et, pour le privé, `EXERCICES_SOURCE`.

Le dépôt privé peut relier son package directement au clone public local. Dans ce mode, les modifications enregistrées de la bibliothèque publique (`load.typ` et `lib/`, hors `lib/tests/`) rafraîchissent automatiquement le moteur Tinymist et les aperçus MPI, dont les caches ne suivent pas toujours les liens symboliques. Les exercices, cours et feuilles se mettent à jour en direct sans redémarrer Tinymist, y compris lors de l'enregistrement automatique. Aucune copie de la bibliothèque n'est installée. Ouvrir les deux banques, ou leur dossier parent, pour surveiller le clone public.

## Utilisation

- **Fichier** : plan du document ouvert, questions, parties et composition cliquables. Le bouton **Voir le corrigé** dans son en-tête ouvre le corrigé de ce document, même lorsque le focus est dans un autre éditeur ou dans l’aperçu.
- **Exercices** : exercices réutilisables de la banque, avec recherche et filtres de métadonnées.
- **Documents** : TD, devoirs, concours, copies et types personnalisés, avec recherche et filtre par type.

Les contenus sont reconnus d'après leur code, indépendamment du dossier : export `ex` pour un exercice, `feuille.with(type: "…", ...)` pour un document, `cours.with(...)` pour un cours A4 et `cours-et-presentation.with(...)` pour un cours avec présentation. Les fonctions de mise en page personnalisées déclarant un `type` sont aussi reconnues. Les dossiers techniques et `build/` sont exclus.

Les exercices autonomes sont dans `chapitres/<chapitre>/exercices/`, les feuilles, cours et présentations dans `chapitres/<chapitre>/`, et les sujets de concours dans `devoirs/concours/`. Le privé ajoute `corrections/<annee>/ds/<devoir>/copies/`.

La recherche ouvre un fichier sans filtrer le panneau. Elle ignore les accents et la casse, et place en premier les fichiers ouverts puis les fichiers récemment consultés. Les filtres du panneau restent appliqués. Le catalogue public est régénéré automatiquement si les sources Typst ont changé sur disque, en regroupant les notifications. Une erreur conserve le dernier catalogue valide.

Pour diagnostiquer une régénération inattendue, ouvrir **Affichage → Sortie → Exercices MPI**. Les lignes `Catalogue` indiquent l’heure UTC, la banque, le type d’événement reçu et le chemin relatif du fichier déclencheur. Chaque demande de régénération précise sa cause (événements automatiques, commande manuelle, catalogue absent ou création d’exercice), puis sa fin ou son échec. Les notifications sans changement de contenu sont ignorées après comparaison d’empreintes SHA-256 ; elles ne déclenchent ni régénération ni redémarrage de Tinymist, et sont signalées par `ignoré (contenu identique)`.

**Créer un exercice** utilise le modèle du dépôt et le vocabulaire de sa bibliothèque. Dans le privé, ce vocabulaire vient de la révision publique verrouillée. **Créer un document** propose les modèles de `templates/`. Les destinations suggérées suivent la structure ci-dessus et restent modifiables.

Les TD et devoirs composés démarrent vides : sélectionner un document, puis ajouter ou glisser des exercices du même dépôt. Les flèches réordonnent les exercices et **×** retire leur import. Les compositions calculées restent modifiables dans la source. Les modifications sont enregistrées et annulables. Un import utilisé ailleurs et un barème personnalisé empêchent une réécriture ambiguë.

Glisser un fichier sur un dossier permet de le déplacer dans son dépôt : les références Typst littérales sont actualisées. Vérifier les chemins calculés et les références externes. La suppression passe par la corbeille et refuse un fichier encore référencé. Les déplacements entre dépôts restent manuels.

**Ouvrir les codes associés** est accessible depuis la barre de l'éditeur Typst, la palette de commandes et le menu contextuel des exercices et documents. Le bouton **Codes associés** apparaît aussi dans l'aperçu lorsqu'il y a du code. Un seul fichier s'ouvre directement ; plusieurs fichiers donnent un choix. La recherche suit les imports de la feuille et retrouve aussi les codes placés dans le dossier propre à chaque sujet. Elle tient compte des modifications Typst non enregistrées. Les codes s'ouvrent dans l'éditeur VS Code et l'aperçu reste ouvert. Dans un `.typ`, Ctrl/Cmd+clic sur un chemin littéral de code ouvre directement ce fichier, dans la banque publique comme dans la banque privée.

## Snippets Typst

Dans un fichier `.typ`, saisir **`²` pour ouvrir le menu local Snippets MPI** en haut de la fenêtre. Saisir le nom ou le préfixe pour filtrer, puis valider avec Entrée. Les choix sont déjà en mémoire et ne dépendent pas du serveur de langage. Échap ferme le menu en conservant le `²`. Chaque snippet possède un seul préfixe. Tab passe au champ suivant ; Maj+Tab revient au précédent. **Snippets: Insert Snippet** permet aussi d'insérer le texte sélectionné dans un bloc.

Les noms et préfixes des blocs sont en français, sans accents dans les préfixes. `²exemple` désigne le titre souligné en ligne et `²exemple-bloc` le bloc numéroté. Chaque bloc numéroté possède une variante avec titre, repérée par `-titre` :

| Bloc | Sans titre | Avec titre |
| --- | --- | --- |
| Théorème | `²theoreme` | `²theoreme-titre` |
| Définition | `²definition` | `²definition-titre` |
| Proposition | `²proposition` | `²proposition-titre` |
| Lemme | `²lemme` | `²lemme-titre` |
| Corollaire | `²corollaire` | `²corollaire-titre` |
| Propriété | `²propriete` | `²propriete-titre` |
| Exemple encadré | `²exemple-bloc` | `²exemple-bloc-titre` |
| Exercice de cours | `²exercice` | `²exercice-titre` |
| Problème | `²probleme` | `²probleme-titre` |
| Algorithme | `²algorithme` | `²algorithme-titre` |

Par exemple, `²exercice-titre` insère `#exercice(titre: [Titre])[…]`. Le titre affiché prend la forme **Exercice 2 : Monoïdes et taille**, avec numérotation automatique et un titre saisi dans le premier champ. Sans titre, seul **Exercice 2** est affiché. Ce rendu utilise la bibliothèque MPI mise à jour.

| Autre préfixe | Contenu inséré |
| --- | --- |
| `²sequent` | `#sequent(($A → B, A$, $B$))` : séquent lié au prouveur ; importer depuis le module `logique` de `/load.typ` |
| `²lien` | `#lien("…")[…]` avec autocomplétion des ressources publiques |
| `²telecharger` | `#telecharger("url")[…]` : fichier à télécharger avec un petit symbole ; importer depuis `/load.typ` |
| `²commentaire` | `#commentaire[…]` : commentaire visible en gris précédé de `//` ; importer depuis `theoremes` |
| `²substituer` | `substituer(φ, x, ψ)` en mode mathématique : $φ[x := ψ]$ ; importer `substituer` depuis `/load.typ` |
| `²solution` | Solution de cours |
| `²exsol` | Exercice de cours suivi de sa solution |
| `²solpause` | Solution avec `#pause` |
| `²remarque` | `#underline[Remarque] : ` |
| `²intuitivement` | `#underline[Intuitivement] : ` |
| `²exemple` | `#underline[Exemple] : ` |
| `²attention` | `#underline[Attention] : ` |
| `²colonnes-cours` | Deux colonnes dans le cours, contenus à la suite en présentation |
| `²formules-reparties` | Espaces égaux entre les formules et aux extrémités, avec l’option `empiler-presentation` |
| `²liste-cours` | Liste numérotée en colonnes de même largeur dans le cours, continue en présentation |
| `²taille-presentation` | `#taille-presentation(0.92em)[…]` |
| `²question` | `#question[Énoncé][Solution]` |
| `²question-bareme` | Question avec points et étiquette |
| `²partie` | `#partie("Titre")[…]`, avec numérotation automatique |
| `²donnees` | Extraction explicite des données d’une partie partagée |
| `²saut-page-cours` | `#saut-page-cours()` : saut de page uniquement dans le cours non corrigé |
| `²nouvelle-diapositive` | `#nouvelle-diapositive()` : conserve le titre, sans saut dans le cours |
| `²slides-only` | Contenu réservé aux diapositives |
| `²article-only` | Contenu réservé au cours A4 |
| `²exercice-banque` | Fichier d'exercice réutilisable exportant `ex` |

Dans `²lien`, choisir une ressource dans les suggestions (identifiant, titre et type), puis utiliser Tab pour saisir le texte du lien. Ctrl+Espace rouvre les suggestions dans les guillemets d’un appel à `lien`. Importer `lien` depuis `/load.typ`.

Ces blocs utilisent les fonctions de la bibliothèque MPI, à importer comme dans les modèles de `templates/`. Les environnements encadrés utilisent les fonctions françaises de `theoremes` et le paramètre `titre:` ; `solution`, `saut-page-cours`, `slides-only`, `article-only`, `nouvelle-diapositive`, `colonnes-cours`, `formules-reparties`, `liste-cours` et `taille-presentation` viennent de `/load.typ`. Les questions s’écrivent dans le corps d’un exercice ou d’une partie : `#question(bareme: 1)[Énoncé][Solution]`. Le second bloc est facultatif. `²partie` insère `#partie("Titre")[…]`, numérotée automatiquement ; `numero:` permet de conserver un repère explicite. Le style général se règle dans le modèle et les styles locaux dans l’énoncé ou la solution. **F4** conserve la création guidée avec les métadonnées du dépôt.

Pour développer directement un préfixe avec Tab, activer facultativement `"editor.tabCompletion": "onlySnippets"` dans les réglages VS Code.

Pour une copie, le bouton **Afficher le scan à côté** est disponible dans l’en-tête de **Fichier** et dans la barre de l’aperçu. Il ouvre le scan dans un volet voisin, avec sa propre pagination. Le PDF est retrouvé dans `tmp/`, `scans/` ou `sources/` du DS d’après le nom de la copie (accents, espaces, tirets et underscores sont équivalents), ou via un chemin PDF dans `donnees.source`. Les PDF préparés à partir des TIFF sont utilisables de la même façon. À défaut, choisir un PDF ; l’association est conservée dans cet espace de travail.

## Raccourcis

Pour une copie, l’en-tête **Fichier** propose aussi **Énoncé du sujet** (document indiqué dans `donnees.feuille`, dans les banques ouvertes) et **Énoncé de la copie** (version annotée de l’élève). Ces boutons gardent la copie comme document courant lorsque l’aperçu a le focus.

Dans un éditeur Typst ou une liste du panneau, hors des champs de saisie :

| Touche | Seule | Avec Maj |
| --- | --- | --- |
| F2 | Chercher un exercice | Chercher un document |
| F3 | Filtrer les exercices | Filtrer les documents |
| F4 | Ajouter un exercice | Créer un document |
| F5 | Afficher l'énoncé | Exporter l'énoncé |
| F6 | Afficher le corrigé | Exporter le corrigé |
| F7 | Afficher la présentation du cours | — |

F5, F6 et F7 fonctionnent aussi lorsque le lecteur PDF ou l’aperçu Tinymist a le focus, y compris dans le champ de numéro de page : ils sélectionnent la variante du document affiché.

Sur Mac, Fn peut être nécessaire. Échap ou **×** efface les filtres actifs du panneau. **Tout replier** et **Basculer dossiers / liste** sont dans **…**.

Pour un fichier utilisant `#show: cours-et-presentation.with(...)`, **F5** compile et affiche le cours, **F6** le cours corrigé et **F7** la présentation. Les boutons de l'aperçu deviennent **Cours**, **Cours corrigé** et **Présentation**. **Maj+F5** et **Maj+F6** exportent le cours et son corrigé, et le bouton d'export de la présentation produit le PDF des diapositives. Ces fichiers sont nommés `cours-kleene.pdf`, `cours-kleene-cor.pdf` et `presentation-kleene.pdf` pour une source `cours-kleene.typ`.

## Compilation et aperçu

Les commandes appellent `python3 scripts/build.py` dans le dépôt concerné. En mode `auto`, un `flake.nix` déclenche `nix develop . -c python3 scripts/build.py …`. Just reste disponible dans les dépôts pour le terminal, mais l'extension n'en dépend pas.

Les exports sans session Tinymist et le lecteur PDF de secours utilisent l'action `c chemin.typ`, qui compile les deux variantes. Les PDF restent sous `build/<chemin-sans-extension>/` : une source `foo.typ` produit `foo.pdf` et `foo-cor.pdf`, y compris pour une copie privée. Un cours avec présentation conserve les noms `cours-<nom>.pdf`, `cours-<nom>-cor.pdf` et `presentation-<nom>.pdf`. Les scripts du privé actualisent les notes avant de compiler les copies.

Avec Tinymist, le rendu vectoriel suit les modifications sans enregistrer. Les boutons Énoncé et Corrigé réutilisent leurs sessions. L’environnement Nix est préparé en arrière-plan à l’ouverture du dépôt, puis réutilisé pour les nouveaux aperçus jusqu’à un changement des fichiers du dépôt ou des réglages. Après une courte pause sur un fichier Typst actif, ses variantes Tinymist sont aussi préparées en arrière-plan, sans ouvrir de lecteur ni afficher leurs diagnostics. F5/F6 récupèrent ces sessions ; les préparations inutilisées sont arrêtées au changement de fichier. Les moteurs d’aperçu chargent la source affichée et les modifications non enregistrées ; les fichiers ouverts par le catalogue ne déclenchent pas de compilations supplémentaires. **↔** active les sauts entre source et aperçu, **lune** inverse le thème. L'extension fournit à son moteur Tinymist les chemins de packages de l'environnement Nix : la révision utilisée dans le privé est celle de son `flake.lock`, sans installation utilisateur préalable. Les CSV `notes.csv` et `recapitulatif.csv` actualisent aussi l'aperçu d'une copie.

Le bouton **Exporter le PDF** utilise la session Tinymist de la variante affichée et tient compte des modifications non enregistrées, y compris dans ses imports, sans enregistrer les sources. Une erreur de compilation empêche l'export d'un ancien rendu.

Sans Tinymist, un lecteur PDF se recharge à l'enregistrement, sans synchronisation source. Dans ce mode, enregistrer les fichiers avant d'exporter. Une erreur de compilation apparaît dans Problems et dans la barre d'état, avec un lien vers le journal.

La barre d'outils indique la page courante et le nombre total de pages, avec Tinymist comme dans le lecteur PDF de secours. Saisir un numéro puis appuyer sur Entrée pour rejoindre une page ; les boutons **‹** et **›** et les touches **←** et **→** passent à la page précédente ou suivante. Les touches **Début** et **Fin** rejoignent la première et la dernière page, hors des champs de saisie. Sur Mac, elles correspondent à **Fn+←** et **Fn+→**. La page choisie reste sélectionnée même si plusieurs slides sont visibles. Lors du défilement manuel, l'indicateur suit la page la plus visible ; il s'actualise aussi après les recompilations et les changements de variante.

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

Pour une seule suite : `npm run test:integration -- --suite=edition`. Suites : `snippets`, `decouverte`, `edition`, `apercu`, `demarrage`, `corrections`, `documents`. Les suites publiques utilisent le clone voisin `../exercices`. La suite `corrections` nécessite les outils de `../exercices-prive`, sans en copier les corrections. Les aperçus natifs nécessitent Tinymist installé.

Variables de test : `MPI_EXERCICES_ROOT` pour le dépôt ouvert, `MPI_PUBLIC_ROOT` pour les outils publics, `MPI_PRIVATE_ROOT` pour les outils privés, `VSCODE_EXECUTABLE` et `TINYMIST_PATH` pour choisir les installations. Consulter [l'organisation du code](scripts/README.md) pour comprendre les différents modules.

Le code reprend l'extension locale `vscode-exercices-mpi`. La licence reste `UNLICENSED`, comme dans le dépôt d'origine. Les licences des composants embarqués sont conservées dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Publication

Le workflow [Publication GitHub](.github/workflows/publish.yml) teste et construit les deux extensions pour chaque tag stable `vX.Y.Z`, puis joint leurs VSIX à une release GitHub. Les noms fixes des fichiers permettent aux conteneurs de récupérer la dernière release stable. La préparation des versions est décrite dans le [guide de publication](docs/publication.md).
