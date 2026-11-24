# Cartes

Chaque carte est un fichier JSON de ce dossier. Pour ajouter une carte, déposez un fichier ici : elle apparaît dans l'écran « Nouvelle partie » au prochain `npm run dev` ou `npm run build` (et donc au prochain déploiement). Aucune ligne de code n'est à modifier. Les tests (`npm test`, `src/maps.test.ts`) vérifient chaque fichier :

- chaque départ rejoint à pied les autres départs et chaque base ;
- chaque emplacement de base a la place pour un QG ;
- chaque ressource est sur un sol plat, à portée d'une base.

L'id `origine` est la carte d'origine : la carte par défaut, et celle des replays d'avant les fichiers de carte. Ne la modifiez pas, sinon ces replays ne rejouent plus pareil (un test la fige tuile par tuile).

## Le fichier

```json
{
  "format": 1,
  "id": "le-col",
  "name": "Le Col",
  "description": "Une phrase affichée sous les miniatures.",
  "size": 96,
  "players": [2],
  "symmetry": "rot180",
  "biome": "volcan",
  "terrain": [ … ],
  "bases": [ … ]
}
```

| Champ | Rôle |
|---|---|
| `format` | Toujours `1`. Un fichier d'un autre format est ignoré, avec un avertissement dans la console. |
| `id` | Identifiant unique ; il sert dans l'URL (`?map=le-col`) et dans les replays. |
| `size` | Côté de la carte en tuiles (la carte est carrée). Prenez une taille impaire si une base doit se trouver pile au centre d'une carte `rot90`. |
| `players` | Nombres de joueurs possibles, par exemple `[2]` ou `[2, 3, 4]`. Le menu n'ouvre pas plus de places que le plus grand. |
| `symmetry` | On ne décrit que la part du joueur 1, en haut à gauche ; le jeu la recopie par rotation pour les autres. `rot180` : deux parts (le joueur 2 en bas à droite). `rot90` : quatre parts, une par coin (à deux joueurs, ils sont dans les coins opposés et les deux autres coins restent des bases libres). `auto` : deux parts à deux joueurs, quatre au-delà. |
| `calm` | Facultatif : les points près desquels les bords irréguliers (`ragged`) restent droits. Par défaut, les deux bouts de chaque rampe. |
| `biome` | La planète de la carte, comme un tileset : le menu ne propose pas d'en changer. Planètes communes : `desert` (Désert), `lune` (Lune), `alien` (Monde étrange), `glace` (Glace), `volcan` (Volcan), `ville` (Ville futuriste). Planètes spéciales, réservées à la carte dessinée pour elles : `asteroides`, `villenuit`. Un lien ou un replay d'avant les planètes par carte (`?biome=`) garde la planète qu'il nomme, sauf une planète spéciale. |

Coordonnées : `[x, y]` en tuiles, x vers l'est (la droite), y vers le sud (le bas), `[0, 0]` en haut à gauche.

### `terrain`

Une liste de formes, peintes dans l'ordre : chaque forme recouvre les précédentes. Tout commence au niveau 0, sans gouffre. Les niveaux vont de 0 (bas) à 2 (haut plateau). Un plateau sans rampe est infranchissable à pied (mesa).

| Forme | Champs |
|---|---|
| `octagon` | `at` (centre), `half` (demi-côté), `cut` (coins coupés). `ragged` (facultatif, une graine numérique) : bord irrégulier. |
| `rect` | `from`, `to` : les coins, inclus. |
| `circle` | `at`, `r`. |
| `band` | Bande diagonale : les tuiles où `|x + y × diag − offset| ≤ half`. Avec `diag: 1`, la bande va du bas à gauche vers le haut à droite ; avec `diag: -1`, du haut à gauche vers le bas à droite. |
| `polygon` | `points` : un contour quelconque, `[[x, y], …]` ; il prend les tuiles dont le centre est à l'intérieur. Pour des côtes irrégulières (îlots, arches). |
| `ramp` | `at` : la tuile de la rampe qui touche le haut. `up` (`N`, `E`, `S` ou `W`) : de quel côté est le haut. `width` : la largeur. `level` : le niveau du bas. Une rampe fait toujours 4 tuiles de long. |

Chaque forme, sauf `ramp`, prend aussi l'un de ces champs :

- `level` : elle élève le sol à ce niveau ;
- `chasm: true` : elle creuse un gouffre, infranchissable à pied mais survolé par les unités volantes ;
- `chasm: true, block: true` : un gouffre dessiné comme un pâté d'immeubles (Ville de nuit). Pour le jeu, c'est un gouffre comme un autre ;
- `fill: true` : elle rebouche un gouffre (ponts, îles). Avec `arch: true` en plus, ce sol est dessiné comme une arche naturelle : mince au milieu, avec sa voûte au-dessus du vide (sur Astéroïdes). Pour le jeu, c'est un sol comme un autre.

`streets` (facultatif, au niveau de `terrain`) : les rues peintes au sol, `[{ "points": [[x, y], …], "width": 10 }]`, la ligne du milieu en tuiles (positions, pas des tuiles : `[0, 39]` est le bord gauche de la carte, au milieu de la tuile 38-39). Seulement pour l'œil ; recopiées par rotation comme le terrain. La carte Ville de nuit est écrite par `tools/maps/ville-nuit.py`.

`biome` (facultatif, l'id d'une planète, par exemple `ville`) : la forme n'existe que sur cette planète.

Le gouffre prend l'aspect de la planète : une crevasse dans le désert et sur la Lune, une faille sombre sur le Monde étrange, un glacier en creux sur la planète de glace, et le vide de la ville basse sur la Ville futuriste.

### `bases`

La liste des emplacements de base du joueur 1, dans l'ordre où l'IA s'étend. Une seule base a `"start": true` : c'est le départ.

| Champ | Rôle |
|---|---|
| `hq` | La tuile en haut à gauche du QG (5 × 5 tuiles). |
| `workers` | Facultatif : la tuile des premiers ouvriers. Par défaut, juste à droite du QG. |
| `minerals` | Les tuiles de minerai. Laissez 2 ou 3 tuiles entre le minerai et le QG. |
| `wells` | La tuile en haut à gauche de chaque puits d'énergie (3 × 3 tuiles). |

L'IA prend d'abord ses propres bases, dans l'ordre du fichier, puis les autres bases libres, les plus proches d'abord. Elle ne prend jamais une base plus proche du départ d'un adversaire que du sien. Une base posée au centre exact d'une carte `rot90` (de taille impaire) n'existe qu'une fois, partagée entre tous les joueurs.

### `seats` et `units` (facultatifs)

Pour un scénario ou une campagne. Les cartes du jeu n'en ont pas : sans ces champs, une partie se joue comme avant.

`seats` : une entrée par joueur, le joueur 1 d'abord (4 au plus). Chaque champ est facultatif.

| Champ | Rôle |
|---|---|
| `race` | `humains`, `z`, `isdaris` ou `dieux` : la race que ce joueur joue, quel que soit le choix du menu. |
| `minerals`, `energy` | Minerai et énergie de départ (0 à 100 000). Par défaut : ceux des règles. |
| `forbid` | Les unités, bâtiments et recherches interdits à ce joueur (ids du jeu, 300 au plus). Ils sont grisés dans l'interface avec « Interdit sur cette carte. », refusés par la simulation, et l'IA ne les demande pas. |

`units` : les unités et bâtiments présents au départ, 200 au plus. Ils sont donnés **pour toute la carte**, sans rotation : `{ "type": "caserne", "owner": 0, "at": [20, 14] }`. `owner` est un joueur (0 pour le joueur 1) ou `-1` pour un neutre ; les unités d'un joueur absent de la partie ne sont pas posées. `at` est la tuile d'une unité, ou la tuile en haut à gauche d'un bâtiment, qui est posé déjà construit. Les neutres restent passifs.

L'éditeur de cartes (`editor.html`, bouton « Exporter pour le jeu ») écrit ces champs.

## Importer une carte

Le bouton « Importer une carte », sous les cartes de l'écran « Nouvelle partie » (et du Bac à sable), lit un fichier `.json` de ce format sans passer par le dossier : par exemple une carte faite avec l'éditeur. Le fichier est une donnée venue de l'extérieur : le jeu le vérifie champ par champ (`src/mapcheck.ts`) et refuse, avec la raison, tout ce qui sort de ces bornes :

| Quoi | Borne |
|---|---|
| Fichier | 64 Ko au plus, du JSON |
| Champs | seulement ceux décrits ici, nulle part un champ inconnu |
| `id` | 1 à 32 lettres minuscules, chiffres ou tirets |
| `name`, `description` | 40 et 200 caractères au plus, sans `<`, `>`, `"` ni `&` |
| `size` | entier de 32 à 160 |
| `players` | 1 à 3 nombres de joueurs, de 2 à 4, sans doublon |
| `biome` | une planète connue (voir plus haut) |
| `terrain` | 300 formes au plus ; un `polygon` ou une rue, 256 points au plus ; chaque forme fait exactement une chose (`level` de 0 à 2, `chasm` ou `fill`) |
| `bases` | 1 à 16 bases, une seule de départ ; 32 minerais et 4 puits au plus par base |
| Coordonnées | toutes sur la carte : une tuile de 0 à `size - 1`, un QG de 0 à `size - 5`, un puits de 0 à `size - 3` ; les points (polygones, centres, rues) de 0 à `size` |

Le jeu vérifie ensuite qu'elle se joue, à chaque nombre de joueurs qu'elle propose : chaque départ a son QG, rejoint les autres départs et chaque base à pied ; chaque base libre a la place pour un QG ; chaque minerai et chaque puits est sur un sol plat, au-dessus d'aucun gouffre, sans chevaucher autre chose, à moins de 12 cases d'une base, et s'atteint à pied. Sinon la carte est refusée avec la raison (par exemple « À 2 joueurs : la base en (24, 24) n'est pas reliée aux départs. »).

Une carte acceptée prend l'id `import-<id>` (jamais celui d'une carte du jeu) et reste dans ce navigateur (20 au plus). Elle apparaît dans la liste, marquée « importée », et le bouton « Supprimer cette carte » l'efface quand elle est choisie.

- **Partie entre amis** : quand l'hôte choisit une carte importée, son fichier part vers l'invité avant la partie, qui le vérifie de la même façon et le garde. Si l'invité a déjà une autre carte du même id, la sienne reste telle quelle et celle de l'hôte est gardée à côté, sous l'id suivi de six lettres de son empreinte. Les cartes reçues d'amis sont gardées à part, les 5 dernières seulement (la plus ancienne est remplacée), et ne comptent pas dans les 20 imports du joueur ; un salon ne vérifie pas plus de 10 cartes différentes. Les deux comparent ensuite l'empreinte de la carte (son contenu, pas son id) ; si elles diffèrent, la partie ne démarre pas.
- **Replays** : le replay d'une partie sur une carte importée emporte la carte entière (`carte`), vérifiée de nouveau à la lecture. Il se rejoue donc dans un navigateur qui ne l'a jamais eue.
