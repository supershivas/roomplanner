# Planificateur de pièce — v1.1.0

Éditeur local de plans 2D et de visualisation 3D avec Three.js.

## Nouveautés v1.1.0
- Palette limitée à 10 couleurs dans les propriétés des objets, colonnes et murs extérieurs. Les couleurs sont synchronisées entre aperçu 2D et rendu 3D. Les contours de colonnes reprennent la couleur des murs par défaut, mais leur couleur peut être personnalisée.
- Cadrage initial 3D plus proche de la pièce.
- Gestion de sources lumineuses personnalisées : spots, lumière ambiante et lampes ponctuelles ; ajout, sélection, couleur, intensité, activation, position, hauteur, portée et angle du spot.
- Sources et couleurs exportées/importées en JSON. Le schéma JSON est à la version 5.

## Lancement
Ouvrir `index.html` dans un navigateur moderne. Une connexion Internet est nécessaire pour charger Three.js depuis jsDelivr.

## Fonctionnalités conservées
Déplacement en 3D, zoom 2D/3D, portes ouvrantes, étagères adaptatives, colonnes, murs et ouvertures, import/export JSON.
