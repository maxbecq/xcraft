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
| `biomes` | Facultatif : les planètes spéciales (Astéroïdes) que la carte accepte en plus des planètes communes. |
| `biomesOnly` | Facultatif : `true` pour n'accepter que les planètes de `biomes`. Le menu ne propose alors qu'elles, et toute autre planète retombe sur la première de la liste. |

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
| `minerals` | Les tuiles de minerai : 10 par base (l'équilibreur, 26/11 : 10 gisements de 2 500). Le QG (4 × 4, placé dans les 5 × 5 de `hq`) doit pouvoir se poser à au moins 2 cases libres de tout minerai : le jeu refuse de le poser plus près, et un test vérifie que chaque base garde cette place. |
| `wells` | La tuile en haut à gauche de chaque puits d'énergie (3 × 3 tuiles). |

L'IA prend d'abord ses propres bases, dans l'ordre du fichier, puis les autres bases libres, les plus proches d'abord. Elle ne prend jamais une base plus proche du départ d'un adversaire que du sien. Une base posée au centre exact d'une carte `rot90` (de taille impaire) n'existe qu'une fois, partagée entre tous les joueurs.
