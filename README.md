# Roomplanner

Éditeur de plans de pièce en 2D avec vue 3D, dont un rendu réaliste de la lumière.

## Lancer

Ouvrir `index.html` via un serveur statique (`python3 -m http.server`) : les modules ES et `design-tokens.json` ne se chargent pas depuis `file://`. L'app est publiée sur GitHub Pages. Aucune installation ni build.

## Fonctions

- **Plan** : murs avec cotes, colonnes, portes (qui s'ouvrent), fenêtres, meubles, lumières ; aimant, rotation à la poignée, mesure, zoom et déplacement de la vue, annulation / rétablissement.
- **3D, mode Éditeur** : vue en coupe rapide et lisible, objets déplaçables à la souris.
- **3D, mode Réaliste** : soleil selon l'heure, ciel par les fenêtres, ombres douces, lampes et spots physiques, occlusion ambiante, sols texturés, ambiances Jour / Soirée / Nuit, image PNG.
- **Données** : sauvegarde automatique dans le navigateur ; export et import JSON (menu Fichier et Réglages).

## Design system

Les tokens (`design-tokens.json`), `mobile.css`, `js/app-update.js` et les conventions (`.claude/conventions.md`) viennent de [supershivas/design-system](https://github.com/supershivas/design-system) via `scripts/sync-design-system.sh`, lancé au début de chaque session Claude Code.
