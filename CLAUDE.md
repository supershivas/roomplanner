@.claude/conventions.md

# Roomplanner

## Description

Éditeur de plans de pièce en 2D (murs, colonnes, portes, fenêtres, meubles, lumières) avec visualisation 3D, dont un **rendu réaliste** (lumière du jour selon l'heure, ombres douces, lampes et spots physiques, ciel par les fenêtres, occlusion ambiante, export PNG).

- Catégorie : **secondaire** (socle seulement ; les fonctionnalités avancées ne se développent que sur demande).
- Cible : **mobile et bureau** (mise en page empilée sous 900 px ; l'édition fine reste plus confortable sur ordinateur).
- Production : https://supershivas.github.io/roomplanner/ (GitHub Pages, à confirmer).

## Stack

Vanilla JS statique en modules ES, sans build ni dépendance npm. three.js 0.170 et ses extensions (`OrbitControls`, `RoomEnvironment`, `RectAreaLightUniformsLib`, `RoundedBoxGeometry`, `EffectComposer`, `GTAOPass`…) sont copiés dans `vendor/` (importmap dans `index.html`, aucun CDN pour le code). Polices Inter / Playfair Display / DM Mono et icônes Tabler (webfont) viennent des CDN, comme dans les autres apps. Données : `localStorage` (`roomplanner:plan`, `roomplanner:render`), exportables en JSON dans les Réglages ; pas de Supabase.

## Structure

- `index.html`, `css/roomplanner.css` : page unique (en-tête, menus, vues Plan / 3D, panneau latéral, dialogues natifs `<dialog>`).
- `js/model.js` : constantes, géométrie pure (murs en onglet, ouvertures, porte), validation et export JSON (schéma 6, import des schémas 4 et 5).
- `js/store.js` : état, sélection, historique d'annulation, sauvegarde locale. `js/actions.js` : opérations sur le plan.
- `js/plan2d.js` : plan SVG (cotes, aimant, rotation, mesure, zoom / déplacement). `js/panel.js` : panneau latéral.
- `js/view3d.js` : scène three.js, modes Éditeur et Réaliste. `js/textures3d.js` : textures procédurales (parquet, carrelage, béton, veinage).
- `js/main.js` : branchement, menus, clavier. `js/tokens.js` : applique `design-tokens.json` aux variables CSS.
- `version.json`, `CHANGELOG.md`. `design-tokens.json`, `mobile.css`, `js/app-update.js` : synchronisés depuis le design system (ne pas éditer).
- `exemples/plan-exemple.json` : plan d'exemple (menu Fichier).

## Exceptions aux conventions

- La palette de contenu (20 couleurs des murs, objets et lumières) et le « papier » du plan (`--stage-bg`, `--plan-*`, `--measure` dans `css/roomplanner.css`) sont propres aux plans, hors tokens. En-têtes, menus, panneau, dialogues et toasts gardent les tokens.
- Thème sombre unique pour l'interface (app secondaire) : pas de bascule clair / sombre.
- Données en local seulement (app secondaire) : l'export JSON des Réglages permet de tout récupérer.

## Pièges connus

- Unités : 1 unité = 1 cm partout (plan, 3D). Les intensités des lumières physiques en dépendent : `LIGHT_K` (`view3d.js`) convertit l'intensité 0–10 de l'interface en candela pour que la loi en 1/d² donne un éclairage lisible à cette échelle.
- Les ombres de la 3D ne sont recalculées que quand la scène change (`shadowMap.autoUpdate = false`) et le sont avec **tous** les murs : un mur masqué par la caméra (vue en coupe) continue de bloquer la lumière.
- Les portes et fenêtres se rattachent à un mur par proximité (`wallMatch`) ; leur rotation suit celle du mur. Le sens et le battant de la porte sont calculés une seule fois (`doorSwing`) pour le 2D et la 3D.
- Le plafond (3D réaliste) est invisible à l'écran mais bloque la lumière : il suit la même logique que les murs masqués (visible seulement pendant le calcul des ombres). La lumière du ciel n'arrive que par les `RectAreaLight` des fenêtres et portes-fenêtres, sinon elle fuirait par le haut.
- Verrouillage : `locked` sur objets, colonnes et lumières, `roomLocked` pour les murs. Tout nouveau chemin de modification doit passer par `store.isLocked` / `actions.blocked`.
- La barre d'espace déplace la vue du plan (glisser) ; elle est ignorée quand un champ ou un bouton a le focus.
- Les modales sont des `<dialog>` : `app-update.js` les considère comme une saisie en cours et diffère le rechargement. Le plan est de toute façon enregistré 400 ms après chaque modification.
- Les anciens fichiers (schéma 4) avaient une couleur par mur (`wallColors`) : seule `wallColor` est lue.
