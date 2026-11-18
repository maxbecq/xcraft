# Propositions d'équilibrage — 18 novembre 2026

Pour l'équilibreur. Les trois corrections du point 3 sont **déjà appliquées au jeu**, à la demande du programmeur, pour que le jeu reste jouable en attendant votre avis. Vous pouvez revenir sur chacune : le point 6 donne les valeurs d'origine.

## 1. Point de départ : les stats du mod

Les Humains et les Isdaris reprennent maintenant les chiffres du mod SC2 dans sa dernière version (XC Mod 1.53). La « version Adrien » du 5 mars 2012 ne touche que le camp insectoïde, absent du jeu. Une partie des unités de base avaient gardé les chiffres du premier prototype ; elles ont été alignées sur le mod :

| Unité | Avant | Mod 1.53 (maintenant dans le jeu) |
|---|---|---|
| Auxiliaire | 6 dégâts, 18 s | 15 dégâts, 22 s |
| Archer | 10 dégâts / 1,2 s, 50 énergie, 24 s, logistique 2 | 21 dégâts / 1 s, 75 énergie, 29 s, logistique 1 |
| Créature | 70 PV, 7 dégâts / 0,7 s | 67 PV, 18 dégâts / 1 s (12 contre les machines) |
| Assassin | bouclier 70 | bouclier 210 |
| Serf | 75 PV, 12 s | 100 PV, 20 s |
| Robot moissonneur | bouclier 25, 12 s | bouclier 50, 20 s |
| Druide | 150 énergie, logistique 2 | 225 énergie, logistique 1 |
| Cadavre réanimé | 100 PV, 10 dégâts | 140 PV, 24 dégâts / 2,2 s |

Autres reprises du mod, plus petites : temps de formation (Soigneur, Phalangiste, Discobole, Espion, Voyageur), portées de vue et 1 point d'armure en moins pour le Légionnaire et l'Archer. Liste complète dans `BALANCE.md`. Les fiches de 2010 que vous avez renvoyées concordent presque partout avec le mod (comparaison détaillée : `docs/fiches-2010-comparaison.md`).

Les bonus selon la cible du mod (léger, blindé, massif, biologique) n'existent pas dans le jeu. Les dégâts retenus sont ceux contre l'infanterie, et seul un bonus ou malus contre les machines et les bâtiments est gardé.

## 2. Effet mesuré

IA contre IA, carte d'origine, 98 parties différentes par paire :

| Paire | Avant | Stats du mod |
|---|---|---|
| Humains – Isdaris | 63 – 34 | **88 – 10** |
| Z – Humains | 61 – 36 | **10 – 87** |
| Z – Isdaris | 56 – 42 | 43 – 54 |
| Dieux – Humains | 41 – 25 (32 nuls) | **0 – 91** |
| Dieux – Isdaris | 45 – 32 (21 nuls) | **14 – 71** |
| Dieux – Z | 24 – 51 (23 nuls) | 24 – 51 (inchangé) |

Les Humains écrasent tout le monde, surtout grâce à l'Auxiliaire : à 15 dégâts, il fait 2,5 fois plus de dégâts qu'avant pour le même prix. Z et les Dieux avaient été calqués sur l'ancien Auxiliaire à 6.

## 3. Corrections appliquées

Trois changements, mesurés ensemble, puis appliqués :

| Proposition | Valeur | Pourquoi |
|---|---|---|
| Auxiliaire : dégâts | 15 → **10** | L'unité de base la plus produite ; 12 laisse encore 78 – 20 contre les Isdaris |
| Archer : coût et temps | 75 → **50** énergie, 29 → **24** s | Les valeurs de votre fiche de 2010 (150 / 50, 30 s) ; les Isdaris manquent d'énergie pour leur unité de base |
| Z : arme de base (Drone de combat, Quadripode, Hexapode) | 6 → **7** | Z était calqué sur l'ancien Auxiliaire ; à 10, Z gagne 83 – 15 et 91 – 7 |

Résultat avec les trois :

| Paire | Victoires |
|---|---|
| Humains – Isdaris | **50 – 48** |
| Z – Humains | **56 – 41** (1 nul) |
| Z – Isdaris | **58 – 40** |

Le bruit est d'environ ±5 victoires : un écart de moins de 10 autour de 49 n'est pas significatif. Les trois paires sont dans la cible.

Variantes essayées, pour mémoire :
- Auxiliaire à 12 : Humains – Isdaris 78 – 20.
- Auxiliaire à 10, sans changer l'Archer : 66 – 32.
- Archer seul : 81 – 14.
- Z à 8 : 66 – 30 contre les Humains, 67 – 29 contre les Isdaris.
- Z à 15 : 72 – 26 et 98 – 0.

## 4. Les Dieux : à part

Avec les corrections appliquées, les Dieux perdent partout : 10 – 56 contre les Humains (32 nuls), 7 – 86 contre les Isdaris, 22 – 61 contre Z (15 nuls). Donner 30 % de dégâts en plus au Nain, au Minotaure et au Sphinx change peu : 16 – 39 (43 nuls) et 12 – 73.

Le problème ne semble pas venir des stats. Chaque dieu n'invoque qu'une unité à la fois : l'IA accumule des minerais sans pouvoir les dépenser, et les parties s'étirent jusqu'à la limite de 35 minutes. Avant de toucher aux chiffres, il faut trancher une règle : invocations simultanées, temps d'invocation plus court ou plus de dieux. C'est à vous de décider.

### Les trois règles possibles, mesurées

Chaque règle a été essayée seule, sans rien changer d'autre. Rien n'est dans le jeu. Mesures sur la carte d'origine et sur Le Col, 98 parties par paire. Les cases donnent les victoires des Dieux, puis celles de l'adversaire, puis les parties nulles (limite de 35 minutes), puis la durée moyenne d'une partie.

| Règle | Carte | Dieux – Humains | Dieux – Isdaris | Dieux – Z |
|---|---|---|---|---|
| Actuelle : une unité à la fois, 3 dieux | Origine | 10 – 56, 32 nuls, 27 min | 7 – 86, 5 nuls, 17 min | 22 – 61, 15 nuls, 25 min |
| | Le Col | 47 – 31, 20 nuls, 29 min | 7 – 85, 6 nuls, 20 min | 41 – 37, 20 nuls, 27 min |
| A. Jusqu'à 3 unités invoquées ensemble par dieu | Origine | **98 – 0**, 9 min | **97 – 1**, 8 min | **98 – 0**, 7 min |
| | Le Col | **92 – 5**, 1 nul, 12 min | **91 – 7**, 10 min | **98 – 0**, 8 min |
| B. Invocation 40 % plus rapide | Origine | 17 – 46, 35 nuls, 28 min | 5 – 77, 16 nuls, 20 min | 26 – 53, 19 nuls, 24 min |
| | Le Col | 67 – 19, 12 nuls, 25 min | 3 – 90, 5 nuls, 21 min | 69 – 21, 8 nuls, 21 min |
| C. Un dieu de plus : un second Thor dès la 2e minute | Origine | 20 – 33, 45 nuls, 28 min | 16 – 56, 26 nuls, 24 min | 29 – 35, 34 nuls, 27 min |
| | Le Col | 47 – 31, 20 nuls, 28 min | 18 – 68, 12 nuls, 26 min | 57 – 27, 14 nuls, 22 min |

Lecture :
- **A** triple la production des dieux. C'est beaucoup trop : les Dieux gagnent presque tout en moins de 12 minutes. Une borne de 2 unités ou des invocations plus chères seraient à mesurer si cette règle vous plaît.
- **B** aide surtout sur Le Col. Contre les Isdaris, elle ne change rien sur les deux cartes.
- **C** est la plus douce : elle resserre les écarts contre Humains et Z, mais les parties nulles restent nombreuses sur la carte d'origine.
- Aucune règle seule ne corrige le match contre les Isdaris, sauf A, qui va trop loin.

Méthode : variantes codées dans une copie jetable du jeu, sur le commit c5ade6f. A : quand l'invocation en tête de file se termine, un dieu fait sortir avec elle jusqu'à 2 autres unités de même type déjà en file, et l'IA garde jusqu'à 4 unités en file au lieu de 2. B : le temps d'invocation des unités de Thor, Seth et Apollon passe à 60 %. C : Thor n'est plus unique, et l'IA invoque un second Thor à partir de la 2e minute.

## 5. Questions

1. Gardez-vous les trois corrections du point 3, ou préférez-vous d'autres valeurs ?
2. Faut-il reproduire les bonus selon la cible du mod (léger, blindé, massif, biologique) ? Cela demande du code, mais rendrait les chiffres du mod utilisables tels quels.
3. Pour les Dieux : quelle règle d'invocation ?

## 6. Revenir en arrière

Tout est dans `src/balance.json`. Pour annuler une correction, remettre la valeur du mod :

| Unité | Champ | Valeur du mod | Valeur appliquée |
|---|---|---|---|
| `auxiliaire` | `attack.damage` | 15 | 10 |
| `archer` | `cost.energy` | 75 | 50 |
| `archer` | `buildTime` | 29 | 24 |
| `dronecombat`, `quadripode`, `hexapode` | `attack.damage` | 6 | 7 |

Pour revenir aux chiffres du prototype d'avant le mod, la liste est dans `BALANCE.md` (« Reprises du mod SC2 »). Toute modification passe par une pull request ; le bot rejoue alors les 98 parties par paire et commente le résultat.
