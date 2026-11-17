# Équilibre des camps selon la carte — 17 novembre 2026

Pour le programmeur et l'équilibreur. Mesures IA contre IA. Aucune stat d'unité ni aucune carte n'a été modifiée : les retouches de carte ci-dessous sont des propositions, non testées.

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

- **Les armées ne se croisent pas.** En suivant 6 parties, l'armée de p0 passe surtout par la route nord-est du gouffre (601 relevés contre 290), celle de p1 surtout par la route sud-ouest (1183 contre 192). Chacune prend la route « symétrique » de l'autre : elles se manquent et la partie devient une course à la destruction des bases.
- Dans une course de ce genre, de petites asymétries du programme (ordre de traitement des unités, départage des chemins de même longueur) décident ; ici elles favorisent p1. Hypothèse, non prouvée.
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

Côté IA (séparé des stats et des cartes) : quand l'armée adverse passe par une autre route et attaque la base, l'IA pourrait rappeler sa vague ; cela réduirait les courses à la destruction des bases sur L'Anneau et Le Col.

Côté équilibreur : les stats réglées sur Origine ne tiennent pas sur les autres cartes. Faut-il équilibrer sur une seule carte de référence, ou sur la moyenne des cartes ?
