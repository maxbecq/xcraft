# Rapport d'équilibrage — 17 novembre 2026

Pour l'équilibreur. Mesures faites par l'IA contre l'IA (98 parties par paire de camps, cible 49 – 49 ± 5).

## Récapitulatif : ce qui a été fait le 17 novembre

Tout est dans `main` et en ligne. Toutes les valeurs ci-dessous sont **provisoires** : le programmeur les a posées pour avancer, l'équilibreur garde la main et peut les changer ou les annuler. Elles sont aussi listées dans `BALANCE.md`, section « Valeurs provisoires ».

### 1. Stats d'unités changées (`src/balance.json` > `units`)

| Unité | Champ | Avant | Après | Pourquoi |
|---|---|---|---|---|
| Créature (Isdaris) | `hp` | 67 | 70 | Isdaris trop faibles contre les Humains |
| Drone de combat (Z) | `cost.minerals` | 75 | 100 | même arme que l'Auxiliaire, il coûtait 25 % de moins ; Z gagnait 90 – 8 et 84 – 14 |
| Drone de combat (Z) | `buildTime` | 15 | 18 | idem (même temps que l'Auxiliaire) |
| Drone de combat (Z) | `hp` | 70 | 73 | après les deux lignes ci-dessus, Z était trop faible contre les Humains (38 – 60) |

Aucune autre stat d'unité n'a été touchée.

### 2. Réglages de l'IA (`src/balance.json` > `ai`, et le code de l'IA)

Ce ne sont pas des stats d'unités, mais ils changent les résultats :
- L'IA garde une réserve pour ses recherches et utilise les capacités de combat.
- Les niveaux de difficulté jouent différemment (facile : petites vagues, pas de recherche ; difficile : s'étend plus tôt, concentre le tir). Les mesures se font au niveau normal.
- Z : un socle à la mitrailleuse lourde resté à la base passe au lance-flammes ou au lance-roquettes une fois recherchés (avant, l'IA ne montait jamais le lance-flammes). Victoires inchangées.
- Isdaris : l'IA construit enfin le Psycho-assembleur et ses unités (`ai.tech.isdaris` → `{ minute: 12, barracks: 3 }`, `feucirculaire` ajouté aux recherches). Détail dans `BALANCE.md`.

### 3. Cartes

Quatre nouvelles cartes (Le Col, Les Ponts, Carrefour, L'Anneau), mesurées dans [le rapport des cartes](rapport-cartes-2026-11-17.md). Seule retouche : une passerelle sur le gouffre de L'Anneau. Les autres cartes sont restées telles quelles.

### 4. Où on en est (carte d'origine)

| Paire | Au matin | Après les stats (§ 1) | Après l'IA Isdaris (§ 2) | Après la correction des constructions | Après le maintien de position et la patrouille (dernière mesure) |
|---|---|---|---|---|---|
| Humains – Isdaris | 67 – 31 | 52 – 46 | 49 – 46 (3 nuls) | 49 – 46 (3 nuls) | 53 – 45 |
| Z – Humains | 90 – 8 | 49 – 49 | 49 – 49 (non concerné) | 49 – 49 | 53 – 45 |
| Z – Isdaris | 84 – 14 | 52 – 46 | **60 – 38** | **64 – 34** | **66 – 32** |

Avant-dernière mesure : `main` au commit `b224f33`, 98 parties par paire. Elle vérifie l'effet de `9890e80` : l'IA ne construit plus en boucle là où ses ouvriers ne peuvent pas aller. Seul ce commit change les parties à deux joueurs depuis la mesure précédente. Sur Origine, les parties Humains – Isdaris et Z – Humains donnent les mêmes résultats ; Z – Isdaris passe de 60 – 38 à 64 – 34, un écart de 4 qui n'est pas significatif. La correction ne change donc pas l'équilibre sur cette carte. Durée moyenne : 14 à 15 min.

Victoires par départ (p0 en haut à gauche, p1 en bas à droite) : Humains – Isdaris 57 / 38, Z – Humains 44 / 54, Z – Isdaris 61 / 37. Au total 162 / 129, soit +33 pour p0 sur 291 parties (1,9 σ, à la limite du significatif ; la mesure du rapport des cartes donnait +22).

Dernière mesure : `main` au commit `c3a60a9`, 98 parties par paire. Ce commit ajoute le maintien de position et la patrouille, et un groupe en déplacement simple arrive réparti autour du point au lieu de s'y entasser. Les combats de l'IA changent un peu. Humains – Isdaris (53 – 45) et Z – Humains (53 – 45) restent dans la cible. Z – Isdaris passe à 66 – 32 : les Isdaris restent nettement en dessous, et c'est toujours le premier point à régler. Durée moyenne : 13 à 15 min.

Victoires par départ : Humains – Isdaris 58 / 40, Z – Humains 48 / 50, Z – Isdaris 67 / 31. Au total 173 / 121, soit +52 pour p0 sur 294 parties (3,0 σ) : l'avantage du départ en haut à gauche devient significatif. Il vient surtout de Z – Isdaris (67 / 31). Origine est symétrique : l'écart vient du comportement des unités.

L'IA Isdaris passe au Psycho-assembleur à la minute 12 : elle produit quelques unités avancées (9 Porte-disques, 3 Balistes sur 196 parties). Plus tôt (minute 8), elle en fait bien plus (53 Porte-disques, 51 Balistes, 19 Chimères) mais perd davantage (65 – 33 contre les Humains, 71 – 27 contre Z) : ces unités semblent trop chères pour leur force. C'est le premier point à régler ; Z – Isdaris reste en défaveur des Isdaris.

### 5. Questions pour l'équilibreur

1. Valides-tu la Créature à 70 PV et le Drone de combat à 100 minerais, 18 s, 73 PV ?
2. Les unités du Psycho-assembleur (Porte-disques, Baliste, Chimère) : faut-il baisser leur prix ou relever leur force ?
3. Le lance-flammes et le lance-roquettes Z arrivent trop tard pour compter (vers 17 à 20 min) : faut-il les rendre moins chers ou plus rapides à rechercher ?
4. Les stats réglées sur la carte d'origine ne tiennent pas sur les nouvelles cartes : équilibre-t-on sur une seule carte de référence ou sur la moyenne ?

Le détail des essais suit.

## Méthode

- `npm run balance:big` : 98 parties par paire de camps (handicaps de récolte de 88 à 112 des deux côtés, chaque camp joue des deux côtés de la carte). Cible : 49 victoires chacun, ±5.
- Code mesuré : `main` au commit `217e8cb` (IA avec réserve pour les recherches et capacités de combat).
- Le jeu est chaotique : deux réglages très proches peuvent donner ±10 victoires d'écart. Un écart de moins de 10 sur 98 parties n'est pas significatif.
- Les autres scripts : `factions.test.ts` est un petit échantillon Humains–Isdaris (doublon de `big`), `sweep.test.ts` compare des plans d'IA (pas des stats), `balance.test.ts` suit une partie Humains minute par minute. `big.test.ts` couvre déjà les paires avec Z.

## Situation actuelle

| Paire | Victoires | Durée moyenne |
|---|---|---|
| Humains – Isdaris | **67 – 31** | 12 min |
| Z – Humains | **90 – 8** | 16 min |
| Z – Isdaris | **84 – 14** | 13 min |

Ordre de force : Z ≫ Humains > Isdaris.

### Constats

1. **Z est moins cher que les autres pour la même chose.** Le Drone de combat a l'arme de l'Auxiliaire (6 dégâts, portée 4, 1 coup/s) pour 75 minerais et 15 s au lieu de 100 minerais et 18 s (70 PV au lieu de 80). L'IA Z en fait sa base : 7143 Drones de combat contre les Humains, 5407 contre les Isdaris. Le reste du camp est aussi environ 25 % moins cher (Drone 75 contre 100 pour le Serf, Pod 150 contre 200 pour le Grenier, Plate-forme 300 contre 350 pour la Caserne), et Z se répare sur le creep.
2. **Les Isdaris manquent d'énergie.** Leurs unités de base en consomment (Archer 50, Druide 150) alors que l'Auxiliaire et le Légionnaire humains n'en coûtent pas : toute l'énergie humaine va aux recherches (56 niveaux d'attaque à distance, 33 Croissance), les Isdaris s'arrêtent au Laboratoire (58) et n'atteignent jamais les améliorations du Portail.
3. **Unités presque jamais produites par l'IA** (sur 294 parties) : Plésiosaure (≤ 7), Phalangiste (0), Psycho-assembleur et ses unités (0), Druide contre Z (3), Hexapode (≤ 148), Coléoptère (≤ 60). C'est en partie le choix de l'IA (`ai.army`), pas forcément les stats.

## Essais (sur copie, 98 parties par paire)

### Isdaris (paire Humains – Isdaris, référence 67 – 31)

| Essai | Résultat | Commentaire |
|---|---|---|
| Archer : énergie 50 → 25 | 65 – 33 | +57 % d'Archers, presque aucun effet |
| Attaque/armure du Portail niveau 1 : 250/250 → 150/150 | 67 – 31 | aucun effet : l'IA n'y arrive jamais |
| Créature : PV 67 → 75 | 39 – 59 | trop fort |
| Créature : PV 67 → 72 | 44 – 54 | |
| Créature : PV 67 → 71 | 58 – 40 | |
| **Créature : PV 67 → 70** | **52 – 46** | dans la cible |

### Z (référence 90 – 8 contre Humains, 84 – 14 contre Isdaris)

| Essai | Z – Humains | Z – Isdaris |
|---|---|---|
| Drone de combat 100 minerais, 18 s | 38 – 60 | 50 – 48 |
| + Drone 100 minerais | 39 – 57 | 50 – 48 |
| + Pod 200, Plate-forme 350, Assimilateur 600 | 12 – 83 | 26 – 69 |

Avec la Créature à 70 PV :

| Drone de combat | Z – Humains | Z – Isdaris |
|---|---|---|
| 90 minerais, 16 s | 66 – 31 | 62 – 36 |
| 100 minerais, 15 s | 63 – 35 | 47 – 51 |
| 100 minerais, 16 s | 69 – 29 | 56 – 42 |
| 100 minerais, 17 s | 63 – 35 | 57 – 40 |
| 100 minerais, 17 s, `creepRepair` 2 → 1 | 60 – 38 | 60 – 34 |
| 100 minerais, 17,5 s | 56 – 42 | 63 – 35 |
| **100 minerais, 18 s** | **38 – 60** | **48 – 50** |

Le levier Z est le Drone de combat ; le prix du Drone ouvrier et des bâtiments compte peu ou trop. Contre les Humains, le résultat bascule entre 17,5 s et 18 s (probablement un seuil dans le rythme des vagues de l'IA).

## Proposition

Deux valeurs seulement, à marquer provisoires dans `BALANCE.md` :

| Stat | Actuel | Proposé | Raison |
|---|---|---|---|
| `creature.hp` | 67 | **70** | Isdaris trop faibles contre les Humains ; levier le plus net |
| `dronecombat.cost.minerals` | 75 | **100** | même prix que l'Auxiliaire, dont il a l'arme |
| `dronecombat.buildTime` | 15 | **18** | même temps que l'Auxiliaire |

Effet mesuré :

| Paire | Avant | Après |
|---|---|---|
| Humains – Isdaris | 67 – 31 | **52 – 46** |
| Z – Humains | 90 – 8 | **38 – 60** |
| Z – Isdaris | 84 – 14 | **48 – 50** |

Reste à régler : **Z devient un peu faible contre les Humains** (38 – 60, hors cible). L'alternative à 17,5 s donne 56 – 42 et 63 – 35 : meilleure contre les Humains, trop forte contre les Isdaris. Au total la version à 18 s est plus proche de l'équilibre (Z gagne 44 % de ses parties, contre 61 %). Pour relever Z face aux Humains seulement, une piste à essayer serait un des socles (Quadripode, Hexapode) ou les kits d'armes, que l'IA Z utilise peu.

## Questions pour l'équilibreur

- Valides-tu les deux changements (Créature 70 PV, Drone de combat au prix et au temps de l'Auxiliaire) ?
- Faut-il que le camp Z reste moins cher (identité « essaim de machines ») et perde autrement, par exemple moins de PV ?
- Quel essai veux-tu pour Z contre les Humains ?

## Suite : Z contre les Humains (après les retouches ci-dessus)

Point de départ : `main` avec Créature 70 PV et Drone de combat 100 minerais / 18 s, soit Z – Humains 38 – 60 et Z – Isdaris 48 – 50. Essais sur copie, 98 parties par paire :

| Essai | Z – Humains | Z – Isdaris |
|---|---|---|
| Quadripode : PV 120 → 140 | 43 – 55 | 57 – 40 |
| Drone de combat : armure 0 → 1 | 69 – 29 | 61 – 37 |
| Drone de combat : PV 70 → 80 | 67 – 31 | 58 – 40 |
| Hexapode : coût 200/75 → 175/50 | 40 – 58 | 52 – 46 |
| Kit lance-flammes : dégâts 10 → 12 | 38 – 60 | 48 – 50 |
| Drone de combat : PV 70 → 77 | 72 – 26 | 39 – 55 |
| Drone de combat : PV 70 → 75 | 68 – 30 | 55 – 43 |
| **Drone de combat : PV 70 → 73** | **49 – 49** | **52 – 46** |

Proposition : `dronecombat.hp` 70 → **73**. Humains – Isdaris n'est pas concerné (52 – 46).

Résultat complet avec les trois retouches : Humains – Isdaris 52 – 46, Z – Humains 49 – 49, Z – Isdaris 52 – 46.

À noter : changer les dégâts du lance-flammes ne change **aucune** partie (résultats identiques à la référence). Vérification faite, l'arme fonctionne (un Hexapode au lance-flammes tue un Légionnaire plus vite qu'à la mitrailleuse lourde) ; c'est l'IA Z qui ne la montait jamais :
- elle recherche le Lance-roquettes vers 17 min et le Lance-flammes vers 20 min, alors que les parties durent 14 min en moyenne ;
- à ce moment, presque tous ses socles portent déjà la mitrailleuse lourde, et un socle équipé ne changeait jamais de kit.

Correction côté IA (pas de stat) : un socle à la mitrailleuse lourde resté à la base est rééquipé d'un kit recherché. Mesure après correction : Humains – Isdaris 52 – 46, Z – Humains 49 – 49, Z – Isdaris 52 – 46, inchangés (les kits recherchés n'arrivent que dans les parties de plus de 17 min). Pour que le lance-flammes et le lance-roquettes pèsent dans l'équilibre, il faudrait qu'ils arrivent plus tôt : coût ou durée de `lanceflammes` / `lanceroquettes` (150/150, 50 s), ou le Centre d'armement, à l'appréciation de l'équilibreur.

## Mise à jour du 18 novembre

### Origine sur `4c1ced4`

Depuis la mesure précédente (`be29c11`), la simulation a changé : `goNear` vise la case juste devant un rectangle de tous les côtés, et la séparation des unités larges porte plus loin. Même méthode, 98 parties par paire (mais voir « Limite de la méthode » ci-dessous).

| Paire | `be29c11` | `4c1ced4` | p0 / p1 (`4c1ced4`) |
|---|---|---|---|
| Humains – Isdaris | 53 – 43 | 59 – 39 | 58 / 40 |
| Z – Humains | 52 – 44 | 52 – 46 | 49 / 49 |
| Z – Isdaris | **60 – 38** | 51 – 47 | 30 / 68 |

Au total, 137 victoires pour p0 et 157 pour p1. L'avantage de p0 mesuré sur `c3a60a9` (173 / 121) disparaît. Durée moyenne : 14 à 15 min.

> **Avertissement.** Tous les chiffres « sur 98 parties » de ce rapport et du rapport des cartes, jusqu'à cette section, viennent de l'ancienne méthode : seulement 32 parties différentes par paire. Leurs écarts paraissent environ 1,7 fois plus significatifs qu'ils ne le sont. Par exemple, un « 3 σ » vaut en réalité à peu près 1,8 σ, et un écart de 10 victoires sur 98 n'est pas significatif. La méthode corrigée et les nouveaux chiffres sont à la fin de cette section.

### Limite de la méthode : 98 parties, mais 32 parties différentes

Le handicap de récolte est appliqué à un voyage de 10 minerais, arrondi à l'entier inférieur (`idiv(carry × handicap, 100)` dans `src/sim/world.ts`). Les sept handicaps de `big.test.ts` (88 à 112) ne donnent donc que quatre récoltes réelles : 8, 9, 10 et 11 minerais par voyage. La simulation n'a aucun hasard : deux réglages qui tombent sur la même récolte jouent exactement la même partie.

Sur les 98 parties d'une paire, il n'y a donc que 16 parties différentes par ordre des camps, 32 en tout, chacune comptée de 1 à 9 fois. Vérification faite : avec les handicaps 89 à 113, les 98 parties de Z – Isdaris sont identiques une à une à celles de 88 à 112.

Conséquences :
- Les écarts de ce rapport et du rapport des cartes paraissent plus significatifs qu'ils ne le sont. Le « ±5 sur 98 » sous-estime le bruit, à peu près d'un facteur 1,7.
- Un réglage qui ne change qu'une des 32 parties peut déplacer jusqu'à 9 victoires.
- À corriger dans `big.test.ts` : choisir des handicaps qui donnent 7 récoltes différentes, ou faire varier autre chose (voir ci-dessous). Ce n'est pas fait.

### Z – Isdaris : l'avantage du départ p1

Sur `4c1ced4`, Z – Isdaris donnait 30 / 68 pour p1. Sur les 32 parties distinctes, cela fait 11 / 21 : environ 1,8 σ, pas significatif.

Pour avoir des parties vraiment différentes, j'ai rejoué la paire en décalant le démarrage de chaque IA de 0, 7 ou 13 ticks, avec des handicaps de 90, 100 et 110 (9, 10 et 11 minerais par voyage). Cela fait 162 parties, dont 145 différentes. Ce réglage n'a servi qu'à la mesure et n'est pas dans `main`.

| Départ de Z | Z gagne | Isdaris gagne |
|---|---|---|
| p0 (haut gauche) | 43 | 38 |
| p1 (bas droite) | 55 | 26 |
| Total | 98 | 64 |

- **Avantage de p1** : 93 victoires contre 69, soit +24 sur 162 parties (1,9 σ). La pente existe probablement, mais elle est bien plus faible que le 30 / 68 de la mesure normale.
- **Équilibre de la paire** : Z gagne 60 % des parties (98 – 64). Le 51 – 47 de la mesure normale venait surtout du petit nombre de parties distinctes. Z – Isdaris reste en faveur de Z, comme le 60 – 38 de `be29c11`.
- **Cause** : non cherchée. La pente est trop faible pour qu'on suive des parties une à une.

### Méthode corrigée et nouveaux chiffres

`scripts/big.test.ts` joue maintenant 98 parties différentes par paire. Pour chaque ordre des camps, l'outil croise 7 décalages de démarrage de chaque IA, de 0 à 3 s par pas de 0,5 s (l'IA réfléchit tous les 10 ticks), avec des handicaps de 90, 100 et 110 % (9, 10 ou 11 minerais par voyage) répartis sur cette grille. Les handicaps plus fins rejoueraient les mêmes parties ; 7 récoltes distinctes demanderaient des handicaps de 70 à 130 %, trop larges. L'outil compte les parties distinctes par une empreinte de l'état final (champ `distinct` de `BIG_OUT`, affiché en fin de sortie). Le jeu n'est pas modifié.

Avec cette méthode, le bruit sur 98 parties est d'environ ±5 victoires (1 σ). Un écart n'est significatif qu'au-delà d'environ ±10.

| Paire | `4c1ced4` | `771ef76` | p0 / p1 (`4c1ced4`) | p0 / p1 (`771ef76`) |
|---|---|---|---|---|
| Humains – Isdaris | **59 – 38** (1 nul) | **63 – 34** (1 nul) | 43 / 54 | 48 / 49 |
| Z – Humains | **60 – 36** (2 nuls) | **61 – 36** (1 nul) | 40 / 56 | 44 / 53 |
| Z – Isdaris | 51 – 42 (5 nuls) | 56 – 42 | 35 / 58 | 35 / 63 |
| Parties distinctes | 98, 98, 96 | 98, 98, 98 | | |

- **Ordre de force sur Origine** : Z > Humains > Isdaris. Z – Humains (60 – 36) et Humains – Isdaris (59 – 38, puis 63 – 34) sortent de la cible. Le 49 – 49 de Z – Humains mesuré les jours précédents venait du petit nombre de parties distinctes.
- **`771ef76`** (marge au pied des falaises `a179e39`, cible lâchée ignorée 10 s en attaque-déplacement `f1a84bd`) : +4 pour les Humains contre les Isdaris, +1 pour Z contre les Humains, +5 pour Z contre les Isdaris. Tout est dans le bruit : ces deux changements ne déplacent pas l'équilibre de façon mesurable.
- **Départs** : p1 (bas droite) gagne plus souvent. Au total 118 / 168 sur `4c1ced4` (+50 sur 286 parties, 3,0 σ) et 127 / 165 sur `771ef76` (+38 sur 292, 2,2 σ). L'avantage vient surtout de Z – Isdaris (35 / 58 et 35 / 63). Origine est symétrique ; la cause n'a pas été cherchée.


### Les Dieux sur Origine (`771ef76`, méthode corrigée)

98 parties par paire, toutes distinctes. L'outil arrête une partie à 35 minutes ; sans vainqueur, elle compte comme nulle. Stats des Dieux : celles de la V1, provisoires (voir `BALANCE.md`).

| Paire | Victoires | Nuls | p0 / p1 | Durée moyenne |
|---|---|---|---|---|
| Dieux – Humains | 41 – 25 | 32 | **50 / 16** | 27 min |
| Dieux – Isdaris | 45 – 32 | 21 | 41 / 36 | 26 min |
| Dieux – Z | 24 – 51 | 23 | 42 / 33 | 26 min |

- **Ordre de force** : Z bat nettement les Dieux (51 – 24). Les Dieux battent les Humains (41 – 25) et, moins nettement, les Isdaris (45 – 32).
- **Parties longues** : 26 à 27 minutes en moyenne, contre environ 15 entre les autres camps, et un quart des parties sans vainqueur à 35 minutes. Les mesures QUICK du 17 novembre (18 parties par paire) le montraient déjà.
- **Départ** : contrairement aux autres camps, p0 (haut gauche) gagne plus souvent : 133 / 85 sur les trois paires (+48 sur 218 parties décidées, 3,2 σ). L'écart vient surtout de Dieux – Humains (50 / 16, 4,2 σ). La cause n'a pas été cherchée.
