# TP MPI

Extension VS Code utilisable en local et dans le Codespace de `tp-environnement`.

- **TP commencés** retrouve les travaux téléchargés dans le dossier `tp/` du workspace. Les fichiers personnels ne sont jamais remplacés lors d'une reprise.
- **TP du cours** suit la rubrique `- TP` de `cours/pages-typst.md`, avec son ordre et ses titres facultatifs.
- **Tous les TP** affiche les documents de type `tp` du catalogue d'`exercices/web`. La loupe (ou F2 dans le panneau) cherche par titre, chemin, chapitre, niveau ou langage, sans tenir compte des accents. Les TP commencés sont prioritaires. La recherche filtre aussi la section ; la gomme l'efface.

Cliquer sur un TP télécharge l'énoncé PDF, le squelette et les ressources, puis ouvre le squelette à gauche et l'énoncé à droite. Les ZIP sont conservés et extraits uniquement lorsque leur manifeste le demande. Un téléchargement interrompu ne crée pas un TP commencé.

Le lecteur PDF fournit pagination, texte sélectionnable, thème sombre, export et onglet de corrigé. Pour un TP du cours, le corrigé apparaît seulement avec `: cor` dans le menu. Hors du cours, le corrigé est disponible. La commande **MPI : ouvrir le code corrigé du TP** télécharge le code dans `.mpi/corrige/`, séparément du travail personnel. Si le menu du cours est inaccessible, l'affichage des corrigés est suspendu jusqu'à la prochaine actualisation. Les énoncés déjà téléchargés restent accessibles hors connexion.

Ces règles contrôlent l'interface et les téléchargements de l'extension. Un corrigé présent dans un dépôt public reste accessible sur GitHub.

## Installation

Télécharger [TP MPI — dernière release stable](https://github.com/mpi-informatique/vscode-mpi-exercices/releases/latest/download/vscode-mpi-tp.vsix), puis utiliser **Extensions → … → Installer à partir d’un VSIX**. Pour une mise à jour locale, télécharger à nouveau le fichier et le réinstaller. Le Codespace de `tp-environnement` vérifie automatiquement la dernière release à chaque connexion.

## Sources et ressources communes

Le catalogue est `https://mpi-informatique.github.io/exercices/banque/catalogue.json`. Le menu vient du fichier brut `cours/main/pages-typst.md`. Les adresses et le dossier de travail se configurent avec `mpiTp.siteUrl`, `mpiTp.courseMenuUrl` et `mpiTp.directory`.

Le moteur de recherche et le lecteur PDF (HTML, CSS, JavaScript et préparation des dépendances PDF.js) proviennent du package `exercices/shared`, également utilisé par `vscode-mpi-exercices`. L'extension ne compile pas de Typst et ne nécessite pas Nix chez l'élève.

## Développement

Cloner `mpi-informatique/exercices` à côté de `vscode-mpi-exercices`, puis depuis `vscode-mpi-exercices/` :

```sh
nix develop . -c sh -c 'cd tp && npm ci && npm test && npm run test:integration && npm run package'
code --install-extension tp/releases/vscode-mpi-tp-0.1.0.vsix --force
```

Avec Node 22 installé, les commandes `npm ci`, `npm test`, `npm run test:integration` et `npm run package` peuvent aussi être lancées directement depuis `tp/`. Le VSIX ne contient que TP MPI ; il ne dépend pas de l’installation d’Exercices MPI.

Les tests d'intégration démarrent un serveur local fictif et VS Code dans un profil temporaire. `VSCODE_EXECUTABLE_PATH` permet de réutiliser une installation de VS Code.

Dans Codespaces, le script `.devcontainer/install-extension.sh` de `tp-environnement` télécharge et installe le VSIX de la dernière release GitHub stable à chaque connexion. L’ETag permet de réutiliser un fichier inchangé. Le nouveau VSIX est validé par VS Code avant de remplacer la copie en cache ; si la mise à jour échoue, cette copie reste utilisable. Le conteneur utilise `curl` et la commande `code`, sans compilation de l’extension. Après une première installation ou une mise à jour, recharger la fenêtre si nécessaire.
