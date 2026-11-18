# Équilibre des camps selon la carte — 17 novembre 2026

Pour le programmeur et l'équilibreur. Mesures IA contre IA. Aucune stat d'unité n'a été modifiée. Les retouches de carte proposées ont ensuite été mesurées (voir « Retouches mesurées », en fin de rapport) : une seule est adoptée, la passerelle de L'Anneau.

## Méthode

- `scripts/big.test.ts` sur `main` au commit `1a3ce5d` (Créature 70 PV, Drone de combat 100 minerais / 18 s / 73 PV). Variable `BIG_MAP` pour la carte ; le script compte désormais aussi les victoires par position de départ (`sides` dans `BIG_OUT`).
- Pour chaque carte et chaque paire de camps : 98 parties (handicaps de récolte 88 à 112 des deux côtés, chaque camp joue les deux départs). 1470 parties en tout.
- p0 part en haut à gauche, p1 en bas à droite. Carrefour se joue à 2 dans deux coins opposés.
- Bruit : sur 98 parties, un écart de ±5 victoires autour de 49 n'est pas significatif ; sur les ~290 parties d'une carte, un écart de ±9 entre les deux départs ne l'est pas non plus.
- Commande : `BIG=1 BIG_MAP=le-col BIG_MATCH=z-humains BIG_OUT=out.json npx vitest run scripts/big.test.ts --silent=false`.

## Victoires par camp

| Carte | Humains – Isdaris | Z – Humains | Z – Isdaris | Durée moyenne |
|---|---|---|---|---|
| Origine (référence) | 52 – 46 | 49 – 49 | 52 – 46 | 13 à 15 min |
| Le Col | 43 – 55 | **63 – 31** (4 nuls) | **34 – 64** | 14 à 19 min |
| Les Ponts | **68 – 30** | 51 – 33 (**14 nuls**) | 39 – 59 | 12 à 17 min |
| Carrefour | 58 – 40 | 54 – 44 | **62 – 30** (6 nuls) | 15 à 21 min |
| L'Anneau | 55 – 43 | **79 – 19** | **60 – 28** (10 nuls) | 16 à 17 min |

En gras : hors de la cible de 49 ± 5. Les stats ont été réglées sur Origine ; aucune nouvelle carte n'est équilibrée pour les trois paires.

## Victoires par départ

| Carte | p0 (haut gauche) | p1 (bas droite) | Écart | Significatif ? |
|---|---|---|---|---|
| Origine | 158 | 136 | +22 pour p0 | non (1,3 σ) |
| Le Col | 163 | 127 | +36 pour p0 | à la limite (2,1 σ) |
| Les Ponts | 149 | 131 | +18 pour p0 | non ; mais Z – Humains 54 – 30 pour p0 |
| Carrefour | 133 | 155 | +22 pour p1 | non (1,3 σ) |
| **L'Anneau** | **113** | **171** | **+58 pour p1** | **oui (3,4 σ)** |

Les cartes sont parfaitement symétriques : relief, gouffres, rampes, ressources et QG se correspondent tuile pour tuile par la rotation de 180° (vérifié par un script). L'avantage d'un départ vient donc du comportement des unités, pas du terrain.

## Constats et hypothèses

### L'Anneau : p1 avantagé, Z écrase les Humains

- **Les armées ne se croisent pas.** En suivant 6 parties, l'armée de p0 passe surtout par la route nord-est du gouffre (601 relevés contre 290), celle de p1 surtout par la route sud-ouest (1183 contre 192). Chacune prend la route « symétrique » de l'autre : les premières vagues (vers 4 à 8 min) se manquent et frappent chacune la base adverse.
- Vérifié ensuite (6 parties suivies sur L'Anneau, 6 sur Origine) : l'IA rappelle déjà sa vague quand sa base est attaquée par plus fort que ses défenseurs (`src/ai/ai.ts`, « Outnumbered at home ») et ce rappel se déclenche bien ; ces attaques croisées ne coûtent que peu de bâtiments. À la fin des parties, l'armée du perdant n'est jamais au loin : elle a été détruite avant, et le gagnant rase une base vide. Ce n'est donc pas une course aux bases qui décide ; l'avantage de p1 reste inexpliqué (petites asymétries du programme : ordre de traitement des unités, départage des chemins de même longueur).
- Z gagne 79 – 19 contre les Humains : Z se répare sur son creep et défend mieux sa base pendant que l'armée adverse est partie ; à vérifier.
- **Retouche proposée** : un pont étroit au centre du gouffre (forme `fill` au centre, invariante par rotation), pour que les deux armées aient un chemin commun plus court ; ou des routes de longueurs différentes. À mesurer avant de l'adopter.

### Le Col : Z fort contre les Humains, faible contre les Isdaris ; léger avantage p0

- Z – Humains dure 19 min (4 nuls) : la naturelle sur plateau n'a qu'une rampe de 3 tuiles, que l'Auxiliaire (portée 4) tient mal face à la masse des Drones de combat qui se réparent sur le creep. Hypothèse.
- Z perd 34 – 64 contre les Isdaris : les Isdaris font ici beaucoup de Druides (1564 contre les Humains, 590 contre Z, contre 324 sur Origine). L'IA isdaris dépense mieux son énergie quand la naturelle est protégée. Hypothèse.
- Les armées se répartissent aussi entre les deux couloirs (p0 surtout au nord-est, p1 surtout au sud-ouest), comme sur L'Anneau mais moins nettement : origine probable de l'avantage p0.
- **Retouche proposée** : rampe de la naturelle de 3 à 4 tuiles ; à mesurer.

### Les Ponts : les Humains écrasent les Isdaris ; beaucoup de nuls

- Humains – Isdaris 68 – 30 : l'armée isdaris est surtout faite de Créatures, au corps à corps (3510). Sur un pont étroit, une masse au corps à corps arrive en file et fond sous les Auxiliaires à distance. Hypothèse.
- Z – Humains : 14 nuls sur 98 (partie arrêtée à 35 min). Deux armées à distance s'usent aux ponts sans percer.
- **Retouche proposée** : élargir le pont étroit, ou l'ouvrir aux deux joueurs ; à mesurer.

### Carrefour : parties longues, Z avantagé contre les Isdaris

- Carte plus grande (111 tuiles), parties de 15 à 21 min, 6 nuls en Z – Isdaris.
- Z – Isdaris 62 – 30 : les longues distances laissent le temps à Z de rentrer se réparer sur son creep entre deux vagues. Hypothèse.
- Pas d'avantage de départ significatif.

## Propositions

Aucune n'est appliquée. Retouches de carte, à mesurer chacune avant adoption :
1. L'Anneau : pont central, pour que les armées se rencontrent.
2. Le Col : rampe de la naturelle à 4 tuiles.
3. Les Ponts : pont étroit élargi.

Côté IA : la proposition de rappeler la vague quand la base est attaquée par une autre route est sans objet, l'IA le fait déjà (voir L'Anneau ci-dessus).

Côté équilibreur : les stats réglées sur Origine ne tiennent pas sur les autres cartes. Faut-il équilibrer sur une seule carte de référence, ou sur la moyenne des cartes ?

## Retouches mesurées

Mesures faites dans un checkout propre de `main` au commit `4368d6d`. Le code de simulation et d'IA y est identique à celui de `1a3ce5d` : les parties y sont donc les mêmes, partie pour partie, et les chiffres « avant » ci-dessus restent valables. Chaque variante a été jouée sur 98 parties par paire, comme la référence.

Règle d'adoption : une retouche est gardée seulement si elle rapproche les trois paires de 49 ± 5, sans en éloigner aucune, et si elle réduit l'écart entre les deux départs. Les cartes restent symétriques par la rotation de 180°.

### L'Anneau : adoptée, une passerelle anti-diagonale

| Variante | Humains – Isdaris | Z – Humains | Z – Isdaris | p0 / p1 | Verdict |
|---|---|---|---|---|---|
| Avant | 55 – 43 | 79 – 19 | 60 – 28 (10 nuls) | 113 / 171 (+58 p1) | |
| v1 : pont diagonal étroit (de base à base, `band diag -1`, half 1) | 44 – 44 (10 nuls) | 79 – 19 | 77 – 21 | 121 / 163 | rejetée : Z – Isdaris empire |
| v2 : pont diagonal large (half 3) | 58 – 40 | 86 – 12 | 74 – 12 (12 nuls) | 120 / 162 | rejetée : tout empire |
| **v3 : passerelle anti-diagonale (`band diag 1 offset 95 half 1`)** | **52 – 46** | **67 – 29** (2 nuls) | **57 – 35** (6 nuls) | **121 / 165 (+44 p1)** | **adoptée** |
| v4 : passerelle anti-diagonale large (half 2) | 51 – 47 | 80 – 18 | 71 – 23 (4 nuls) | 133 / 157 | rejetée : Z – Humains et Z – Isdaris empirent |

- Mise à jour du 18 novembre 2026 : la passerelle est retirée à la demande de l'utilisateur, qui la trouvait absurde et laide. Le gouffre se contourne de nouveau par les deux routes, et seuls les volants le traversent. Mesure sur les stats du mod 1.53, méthode corrigée (98 parties distinctes par paire). Avec la passerelle : Humains – Isdaris 16 – 81, Z – Humains 80 – 17, Z – Isdaris 86 – 11, p0 / p1 161 / 130. Sans la passerelle : 12 – 86, 81 – 16, 83 – 14, p0 / p1 162 / 130. La passerelle ne change donc presque plus rien.
- La passerelle adoptée traverse le gouffre du coin haut droit au coin bas gauche. Elle relie les deux routes par le milieu, sans raccourcir le chemin d'une base à l'autre. Les armées qui partent chacune sur une route peuvent donc se rejoindre au centre.
- Les trois paires se rapprochent de 49, mais Z – Humains (67 – 29) reste hors de la cible. L'avantage de p1 baisse (+44 au lieu de +58), mais reste significatif.
- Un pont direct d'une base à l'autre (v1, v2) aggrave tout : la partie devient une course frontale, que Z gagne.
- « Des routes de longueurs différentes » est impossible : la rotation de 180° envoie la route nord-est sur la route sud-ouest, donc les deux routes ont toujours la même longueur.

### Le Col : aucune retouche adoptée

La rampe de sortie de la naturelle fait en réalité 2 tuiles, pas 3.

| Variante | Humains – Isdaris | Z – Humains | Z – Isdaris | p0 / p1 | Verdict |
|---|---|---|---|---|---|
| Avant (rampe de 2) | 43 – 55 | 63 – 31 (4 nuls) | 34 – 64 | 163 / 127 (+36 p0) | |
| v1 : rampe de 4 | 45 – 53 | 71 – 27 | 51 – 47 | 148 / 146 (+2) | rejetée : Z – Humains empire de 8 |
| v2 : rampe de 3 | 59 – 39 | 73 – 24 (1 nul) | 45 – 50 (3 nuls) | 141 / 149 | rejetée : Humains – Isdaris et Z – Humains empirent |

La rampe de 4 est la plus proche d'une bonne retouche : l'écart entre départs disparaît, et Z – Isdaris revient de 34 – 64 à 51 – 47. Mais Z – Humains passe de 63 – 31 à 71 – 27. À reconsidérer si les Humains sont renforcés contre Z, ou si l'on accepte cette perte.

### Les Ponts : aucune retouche adoptée

| Variante | Humains – Isdaris | Z – Humains | Z – Isdaris | p0 / p1 | Verdict |
|---|---|---|---|---|---|
| Avant | 68 – 30 | 51 – 33 (14 nuls) | 39 – 59 | 149 / 131 | |
| v1 : ponts étroits élargis (half 2 à 4) | 68 – 30 | 51 – 33 (14 nuls) | 39 – 59 | 149 / 131 | sans effet : parties identiques |
| v2 : pont central élargi (half 3 à 5) | 74 – 24 | 40 – 54 (4 nuls) | 53 – 45 | 164 / 126 | rejetée : Humains – Isdaris et l'écart entre départs empirent |
| v3 : ponts étroits rapprochés du centre (offset 62 à 50, half 3) | 68 – 30 | 55 – 33 (10 nuls) | 39 – 59 | 153 / 131 | rejetée : Humains – Isdaris inchangé |

- Élargir les ponts étroits ne change aucune partie : les armées de l'IA ne les empruntent jamais. Tout se joue au pont central.
- Humains – Isdaris ne bouge qu'en élargissant le pont central, et alors dans le mauvais sens. Les parties durent 12 min : elles se décident par les premières vagues, avant toute expansion. La cause est plutôt la composition de l'armée isdaris (Créatures au corps à corps) que la carte.
- « Ouvrir l'île aux deux joueurs » n'a pas été testé : l'île n'est presque jamais prise (parties trop courtes).

### Carrefour : aucune retouche proposée

Six parties Z – Isdaris ont été suivies minute par minute. L'Isdaris garde une seule base jusqu'à 21 à 24 min et une armée de 8 à 9 unités, alors qu'il accumule 700 à 1300 d'énergie et 500 à 800 de minerai. Il perd ses armées vers 12 min.

Ce n'est pas le terrain qui le bride : il ne dépense pas ce qu'il récolte. C'est un problème de production de l'IA isdaris, plus visible sur cette grande carte, où les parties durent longtemps. Aucune retouche de carte n'est donc proposée. À examiner côté IA : pourquoi l'IA isdaris n'entraîne pas d'unités alors qu'elle a les ressources.

## Carrefour redessiné (17 novembre au soir)

Le commit `2bdfb49` a redessiné Carrefour : chaque coin est maintenant symétrique aussi par rapport à sa diagonale, avec deux rampes à la base principale, deux sorties et deux puits à la naturelle. Le but était l'équité entre coins voisins dans les parties à 4. Les chiffres de Carrefour plus haut sont ceux de l'ancienne carte.

Mesures à 2 dans deux coins opposés, comme plus haut, 98 parties par paire. `2bdfb49` mesure la nouvelle carte seule. `c3a60a9` ajoute le maintien de position, la patrouille et l'arrivée répartie des groupes ; c'est l'état actuel de `main`.

| Version | Humains – Isdaris | Z – Humains | Z – Isdaris | p0 / p1 | Durée moyenne |
|---|---|---|---|---|---|
| Ancienne carte (`1a3ce5d`) | 58 – 40 | 54 – 44 | **62 – 30** (6 nuls) | 133 / 155 (+22 p1, 1,3 σ) | 15 à 21 min |
| Nouvelle carte (`2bdfb49`) | 55 – 37 (6 nuls) | **77 – 19** (2 nuls) | **61 – 37** | **116 / 170 (+54 p1, 3,2 σ)** | 16 à 21 min |
| Nouvelle carte (`c3a60a9`) | 46 – 46 (6 nuls) | **80 – 16** (2 nuls) | **67 – 31** | **106 / 180 (+74 p1, 4,4 σ)** | 18 à 21 min |

- Z – Humains sort nettement de la cible : 54 – 44 avant, 77 – 19 puis 80 – 16.
- Le départ en bas à droite (p1) gagne beaucoup plus souvent : +54 avec la nouvelle carte, +74 avec les nouveaux ordres. C'est très significatif, alors que l'ancienne carte n'avait pas d'écart significatif. Dans chaque paire, p1 l'emporte : Humains – Isdaris 33 / 59, Z – Humains 41 / 55, Z – Isdaris 32 / 66 (mesure `c3a60a9`).
- Les coins sont symétriques par construction (vérifié par `src/maps.test.ts`). L'avantage de p1 vient donc du comportement des unités, comme sur L'Anneau, mais il est ici plus fort. La cause n'a pas été cherchée.
- En 1 contre 1, la nouvelle carte de Carrefour est moins équilibrée que l'ancienne. À voir avec le programmeur : garder le dessin pour les parties à 4, ou chercher d'où vient l'avantage de p1.


## Méthode corrigée (18 novembre)

> **Avertissement.** Les chiffres plus haut viennent de l'ancienne méthode. Elle annonçait 98 parties par paire, mais n'en jouait que 32 différentes (voir `docs/rapport-equilibrage-2026-11-17.md`, « Limite de la méthode »). Les écarts y paraissaient environ 1,7 fois plus significatifs qu'ils ne l'étaient. La règle « ±5 » de la section Méthode ne vaut donc pas pour eux.

`scripts/big.test.ts` joue maintenant 98 parties toutes différentes par paire : décalage de démarrage de chaque IA de 0 à 3 s, croisé avec des handicaps de 90, 100 et 110 %. Mesures sur la simulation de `771ef76` (worktree à `11722a1`, qui ne change que l'outil et la note du rapport de PR). Les 1 176 parties de cette série sont toutes distinctes (98 sur 98 pour chaque paire). Bruit : environ ±5 victoires (1 σ) sur 98 parties ; un écart de moins de 10 victoires autour de 49 est dans le bruit.

### Victoires par camp

| Carte | Humains – Isdaris | Z – Humains | Z – Isdaris | Durée moyenne |
|---|---|---|---|---|
| Origine (rappel) | **63 – 34** (1 nul) | **61 – 36** (1 nul) | 56 – 42 | — |
| Le Col | 46 – 52 | **59 – 37** (2 nuls) | 55 – 43 | 16 à 20 min |
| Les Ponts | **65 – 32** (1 nul) | 36 – 58 (4 nuls) | **62 – 35** (1 nul) | 14 à 17 min |
| Carrefour | 57 – 40 (1 nul) | **72 – 25** (1 nul) | **67 – 30** (1 nul) | 19 à 23 min |
| L'Anneau | 54 – 43 (1 nul) | **91 – 7** | **74 – 24** | 15 à 17 min |

En gras : au moins 10 victoires au-delà de 49.

- **Z** domine partout sauf aux Ponts. L'écart est énorme sur L'Anneau (91 – 7 contre les Humains, 74 – 24 contre les Isdaris) et sur Carrefour.
- **Les Ponts** renversent Z – Humains : les Humains y gagnent 58 – 36, à la limite du significatif. Les Humains y écrasent aussi les Isdaris (65 – 32), comme avec l'ancienne méthode.
- **Le Col** est la carte la plus proche de l'équilibre entre camps : seul Z – Humains sort de la cible, de justesse. Les Isdaris y battent les Humains (52 – 46, dans le bruit), seule carte où ils ne perdent pas cette paire.
- **Les nuls** ont presque disparu (14 nuls aux Ponts et 10 sur L'Anneau avec l'ancienne méthode, 6 et 1 ici).

### Victoires par départ

| Carte | p0 (haut gauche) | p1 (bas droite) | Écart | Significatif ? |
|---|---|---|---|---|
| Origine (rappel) | 127 | 165 | +38 pour p1 | oui (2,2 σ) |
| **Le Col** | **105** | **187** | **+82 pour p1** | **oui (4,8 σ)** |
| **Les Ponts** | **114** | **174** | **+60 pour p1** | **oui (3,5 σ)** |
| **Carrefour** | **118** | **173** | **+55 pour p1** | **oui (3,2 σ)** |
| L'Anneau | 137 | 156 | +19 pour p1 | non (1,1 σ) |

Détail p0 / p1 par paire (Humains – Isdaris, Z – Humains, Z – Isdaris) : Le Col 33 / 65, 34 / 62, 38 / 60 ; Les Ponts 37 / 60, 35 / 59, 42 / 55 ; Carrefour 50 / 47, 35 / 62, 33 / 64 ; L'Anneau 48 / 49, 50 / 48, 39 / 59.

- **Le départ en bas à droite (p1) est avantagé sur toutes les cartes**, et nettement sur Le Col, Les Ponts et Carrefour. Avec l'ancienne méthode, Le Col et Les Ponts semblaient favoriser p0 : c'était un effet du petit nombre de parties distinctes.
- **L'Anneau** n'a plus d'avantage de départ significatif. La passerelle anti-diagonale adoptée le 17 novembre semble avoir corrigé le +58 de p1.
- Les cartes sont symétriques par rotation (vérifié par `src/maps.test.ts`). Un avantage de p1 présent sur quatre cartes sur cinq, dans presque toutes les paires, pointe vers le comportement des unités ou de l'IA plutôt que vers le dessin des cartes. La cause n'a pas été cherchée.
