# Consignes pour les assistants

- Lire le README et préserver le contenu des dépôts pédagogiques utilisés pour les tests.
- Ne pas imposer de longueur maximale aux lignes. Choisir les retours à la ligne selon la structure et la lisibilité.
- Conserver les données nominatives, évaluations et scans dans `exercices-prive`. Utiliser des copies fictives dans les tests.
- Les commandes de compilation appellent `scripts/build.py` du dépôt concerné, avec Nix en mode automatique si `flake.nix` existe.
- Vérifier, empaqueter et réinstaller l'extension uniquement si son code, ses snippets, ses ressources ou sa configuration ont été modifiés. Une modification limitée aux instructions IA, à la documentation ou aux dépôts pédagogiques ne nécessite pas ces opérations.
- Pour vérifier l'extension, lancer `nix develop . -c npm test`, puis les suites d'intégration concernées. Produire ensuite un VSIX avec `nix develop . -c npm run package`.
- Installer systématiquement le VSIX produit dans VS Code avec `code --install-extension releases/vscode-mpi-exercices-0.1.0.vsix --force` (adapter le nom du fichier à la version courante).
- Contrôler le diff, annoncer les vérifications réellement effectuées et faire un commit directement sur `main`.
