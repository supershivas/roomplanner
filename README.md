# Planificateur de pièce — v1.0.0

Éditeur local de plans 2D et de visualisation 3D avec Three.js.

## Lancement

Ouvrir `index.html` dans un navigateur moderne. La connexion Internet est nécessaire pour charger Three.js depuis jsDelivr.

## Fonctionnalités de cette version

- Déplacement des objets et colonnes par glisser-déposer dans la vue 3D ; la vue 2D et les propriétés sont synchronisées immédiatement.
- Orbit de la caméra par glisser sur le fond de la scène, zoom à la molette.
- Éclairage combinant lumière ambiante, hémisphérique, lumière directionnelle avec ombres et plusieurs sources ponctuelles intérieures.
- Portes avec réglage d'ouverture 0–100 %, correspondant à 0–120°, sens d'ouverture vers l'intérieur ou l'extérieur, charnières à l'extrémité A ou B.
- Étagères 3D avec nombre de niveaux calculé en fonction de la hauteur.
- Changement de type sans remplacement des dimensions, de la hauteur, de l'élévation, de la position ou de la rotation.
- Import/export JSON ; l'export inclut la version de l'application et les propriétés d'ouverture des portes.

## Commandes

- Vue 3D : glisser un objet pour le déplacer.
- Vue 3D : glisser sur le fond pour tourner autour de la pièce.
- Vue 3D : molette pour zoomer.
- Vue 2D : double-cliquer sur un mur pour modifier sa longueur.
- Sélectionner une porte pour modifier son ouverture, son sens et son côté de gonds.

## Versions

- Version de l'application : `1.0.0` (format semver `MAJOR.MINOR.PATCH`).
- Version du schéma JSON : `4` (champ `version`), distincte de `appVersion`.
