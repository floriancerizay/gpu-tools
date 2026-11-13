# GPU Tools

Application web statique d'outils de test pour le Géoportail de l'Urbanisme (GpU). Tout s'exécute dans le navigateur
(GitHub Pages) ; deux onglets :

- **Générateur** (`#/generator`) : génère un faux document conforme aux standards CNIG / GpU de
  [IGNF/validator-config-gpu](https://github.com/IGNF/validator-config-gpu), en archive ZIP. On saisit le nom du document ;
  le standard (et son millésime) est déduit du nom :

  | Type                     | Nom du document                                        | Exemple                        |
  | ------------------------ | ------------------------------------------------------ | ------------------------------ |
  | PLU, PLUi, POS, CC, PSMV | `<INSEE ou SIREN>_<famille>_<date>`                    | `25349_PLU_20240101`           |
  | SCoT                     | `<SIREN>_SCOT_<date>`                                  | `200040715_SCOT_20240101`      |
  | SUP (toutes catégories)  | `<SIREN gestionnaire>_<catégorie>_<territoire>_<date>` | `123456789_AC1_25349_20240101` |
  | Mise en compatibilité    | `<territoire>_<famille>_MEC<n>_<date>`                 | `25349_PLU_MEC1_20240101`      |

  Le territoire est une commune (INSEE), un EPCI ou SCoT (SIREN), un département, une région ou `FR`.

- **Correcteur** (`#/fix`) : ouvre une archive existante (ZIP d'un document, shapefile/.dbf ou CSV), affiche son arborescence avec les
  fichiers et dossiers mal nommés en rouge (selon le standard déduit du nom), et permet de :
  - changer la **date** (DATAPPRO) ou le **code territoire** (INSEE, SIREN) dans tout le document : nom du dossier, noms de fichiers,
    lignes des tables (.dbf et .csv) dont `IDURBA` est celui du document, colonnes de date et de code, fiche de métadonnées XML
    (`fileIdentifier`, dates de citation, URL GpU) ;
  - ajouter, renommer, déplacer, supprimer des fichiers et des dossiers ; le renommage d'un PDF met à jour ses références dans les tables.

  Les géométries (.shp, .shx, .prj, colonne WKT) et les PDF ne sont jamais modifiés ; quand le code change, un avertissement le rappelle.
  Inspiré de gpu-poc-editeur.

- **Allègement** (`#/shrink`) : remplace chaque PDF d'archives ZIP par un PDF d'une page
  (« Ce document a été remplacé pour des besoins de test ») et télécharge `<nom>-fake.zip`.

## Générateur : fonctionnement

**Sources des données**

- Modèles et règles : `validator-config-gpu` (`files.json`, `types/`, `codes/`), dépendance npm figée (v8.1.0).
- Commune : parcelles du WFS Géoplateforme (`CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle`).
- EPCI, SCoT, département, région, France : communes et contours via l'API GpU (`/api/grid/<code>/children`, `/api/grid/<insee>`) ; pour une région ou la France, seul le premier département est utilisé.
- SUP : une servitude, un acte, un gestionnaire, et un générateur et une assiette par géométrie, reliés par des identifiants cohérents (clés étrangères du standard).
- Métadonnées : gabarit ISO 19115 adapté de gpu-site.

**Formats**

- Tables : CSV UTF-8, géométrie en WKT dans la colonne `WKT`, WGS84 (`CRS:84`).
- Pièces écrites : PDF d'une page.
- Fiche de métadonnées : XML.

## Structure

```
index.html            shell unique (en-tête, onglets)
src/main.ts           routage par hash, chargement à la demande des outils
src/app.css, ui.ts    style et utilitaires partagés
src/tools/generator/  logique du générateur + view.ts
src/tools/shrink/     logique d'allègement + view.ts
tests/ scripts/ bin/  tests vitest, CLI de génération/validation, validator-cli.jar
```

## Développement

```bash
npm install          # installe aussi bin/validator-cli.jar (v4.6.3, vérifié par sha256)
npm run dev          # copie les modèles dans public/config puis lance Vite
npm test             # tests unitaires + conformité avec validator-cli (si java est disponible)
npm run format:check # formatage (Prettier)
npm run build        # site statique dans dist/ (BASE_PATH=/<dépôt>/ pour GitHub Pages)
```

Génération en ligne de commande et validation :

```bash
NODE_USE_ENV_PROXY=1 npm run generate -- 25349_PLU_20240101 cnig_PLU_2024 out [--all]
sh scripts/validate.sh out/25349_PLU_20240101 cnig_PLU_2024
```

Validation en masse de tous les modèles d'un type, avec des géométries factices (nécessite Java) :

```bash
npx tsx scripts/validate-all.ts '^cnig_SUP' [--optional] [--show]
npx tsx scripts/check-naming.ts      # le contrôle des noms du Correcteur accepte tous les documents générés
```

Le workflow [pages.yml](.github/workflows/pages.yml) construit, teste et déploie le site sur GitHub Pages.

## Déploiement

Le workflow [`pages.yml`](.github/workflows/pages.yml) vérifie le formatage, construit et teste l'application (Java requis pour les tests de conformité) puis publie `dist/` sur GitHub Pages à chaque push sur `main` (`BASE_PATH=/<dépôt>/`). Activer au préalable _Settings → Pages → Source : GitHub Actions_.

## Limites connues

- Les EPCI inconnus du GpU (réponse 404 de l'API grid) ne peuvent pas être générés.
- Volumétrie volontairement minimale (3 zones pour une commune, 12 communes maximum pour un EPCI).
- Les règlements graphiques SRU (XML) restent hors périmètre.
- Les SUP sont générées avec une seule servitude par document.

## Licence

AGPL-3.0-or-later (les modèles embarqués sont sous cette licence).
