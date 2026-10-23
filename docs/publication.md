# Publication et mises à jour

Le workflow [publish.yml](../.github/workflows/publish.yml), nommé **Publication GitHub**, teste et construit les deux extensions pour chaque tag stable `vX.Y.Z`, puis crée une release GitHub avec deux fichiers :

| Fichier | Extension |
| --- | --- |
| `vscode-mpi-exercices.vsix` | Exercices MPI, pour les enseignants |
| `vscode-mpi-tp.vsix` | TP MPI, pour les élèves |

Les fichiers ont des noms fixes dans chaque release. Les liens suivants récupèrent ceux de la dernière release stable :

- [Exercices MPI](https://github.com/mpi-informatique/vscode-mpi-exercices/releases/latest/download/vscode-mpi-exercices.vsix)
- [TP MPI](https://github.com/mpi-informatique/vscode-mpi-exercices/releases/latest/download/vscode-mpi-tp.vsix)

Les identifiants restent `qfortier.vscode-mpi-exercices` et `qfortier.vscode-mpi-tp`, pour mettre à jour les installations existantes. La publication utilise le `GITHUB_TOKEN` fourni au workflow, avec le droit `contents: write`.

## Préparer une release

Le tag correspond à la version de l’extension Exercices MPI à la racine du dépôt. TP MPI conserve sa propre version. Les versions des deux extensions doivent être stables et cohérentes avec leurs `package-lock.json`. Chaque release contient les deux VSIX, même lorsqu’une seule extension change.

Exécuter les tests et les suites d’intégration concernées, puis actualiser `CHANGELOG.md`. Si TP MPI a changé, incrémenter sa version et inclure les deux manifestes dans le commit des changements :

```sh
nix develop . -c npm --prefix tp version patch --no-git-tag-version
git add tp/package.json tp/package-lock.json CHANGELOG.md
git commit -m "Préparer la nouvelle version de TP MPI"
```

Depuis un dépôt propre sur `main`, préparer la version commune de diffusion :

```sh
nix develop . -c npm version patch
git push origin main --follow-tags
```

`npm version patch` actualise `package.json` et `package-lock.json` à la racine, crée le commit de version et un tag annoté. Utiliser `minor` ou `major` si nécessaire.

Pour une première release avec les versions actuelles, après commit des changements :

```sh
git tag -a v0.1.0 -m "Version 0.1.0"
git push origin main v0.1.0
```

Utiliser cette commande uniquement si le tag n’existe pas encore. Ne pas déplacer un tag déjà publié.

## Exécution du workflow

Suivre [Publication GitHub](https://github.com/mpi-informatique/vscode-mpi-exercices/actions/workflows/publish.yml). Le workflow contrôle la concordance du tag avec la version racine, les verrous des deux extensions et l’appartenance du commit à `main`. Il exécute les tests unitaires des deux extensions et l’intégration de TP MPI, puis construit et joint les deux VSIX à la release. Les nouvelles releases sont publiées une fois les deux fichiers téléversés.

Pour reprendre une publication interrompue, utiliser **Run workflow** avec le tag existant. Si la release existe déjà et que ses fichiers restent modifiables, les deux fichiers sont remplacés. Avec les releases immuables, publier un nouveau tag pour corriger une release déjà publiée. Les brouillons et préversions ne sont pas utilisés par les liens `latest`.

## Installation et mises à jour

En local, télécharger le VSIX voulu et utiliser **Extensions → … → Installer à partir d’un VSIX**, ou :

```sh
code --install-extension vscode-mpi-exercices.vsix --force
code --install-extension vscode-mpi-tp.vsix --force
```

Installer uniquement l’extension souhaitée. Pour une mise à jour locale, télécharger et réinstaller son nouveau VSIX.

Le script `.devcontainer/install-extension.sh` de `tp-environnement` vérifie la dernière release stable à chaque connexion. Il utilise une requête conditionnelle avec l’ETag pour éviter de télécharger un fichier inchangé et conserve un VSIX validé dans le cache utilisateur. En cas d’échec du téléchargement ou de l’installation de la nouvelle version, il réinstalle la copie en cache. Une première installation nécessite une release publiée contenant `vscode-mpi-tp.vsix` et un accès réseau à GitHub. Recharger la fenêtre VS Code après une mise à jour si nécessaire.
