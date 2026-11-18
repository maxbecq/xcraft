# Brainstorming — évolutions des mécaniques et des arbres des camps

Document de réflexion, **rien n'y est validé ni codé**. On y range les pistes d'évolution du gameplay et des arbres technologiques, camp par camp, pour les comparer avant de décider. Une piste retenue sort d'ici et part dans le document de conception de son camp (par exemple [`camp-dieux.md`](camp-dieux.md)), avec son plan de mise en œuvre.

Les chiffres sont des **ordres de grandeur pour fixer les idées** : les statistiques appartiennent à l'équilibreur.

## Comment ajouter une piste

Une piste par sous-section, dans la section de son camp, ou dans « Mécaniques communes » si elle touche tous les camps. Une piste suit ce gabarit :

- **Statut** : idée, à discuter, retenue (déplacée vers le doc du camp), écartée (on garde la raison).
- **Règle** : ce que fait la mécanique, en quelques lignes.
- **Ce qu'elle apporte** : en quoi elle distingue le camp des autres, son effet sur le rythme de jeu.
- **Coût** : ce qu'elle demande à la simulation (déterminisme, `hash()`), au rendu, à l'IA.
- **Questions ouvertes**.

## Vue d'ensemble : ce qui distingue chaque camp aujourd'hui

| | Occupation de la carte | Mobilité | Bonus de position |
|---|---|---|---|
| Humains | bâtiments posés n'importe où, Caserne volante | marche, transport | aura du Conseil |
| Isdaris | champs d'énergie autour des émetteurs (placement obligatoire) | Rappel à l'Obélisque, téléportations ponctuelles | aucun |
| Z | creep : disques fixes autour des bâtiments (placement obligatoire) | marche | réparation sur le creep |
| Dieux | rien de propre (voir les pistes ci-dessous) | les dieux sont lents ; Téléportation de Gaïa | aucun |

---

## Humains

*Aucune piste pour l'instant.*

## Isdaris

*Aucune piste pour l'instant.*

## Z

*Aucune piste pour l'instant.*

## Dieux

Constat de départ : les Dieux se distinguent par **qui produit** (les dieux font office de bâtiments), mais n'ont pas de façon propre **d'occuper la carte**. La notice leur donne une « faible mobilité » et une « expansion lente et coûteuse ». Esprit visuel des pistes : antique, art nouveau, fantasy (lianes, arches, marbre et or).

Maquette schématique des trois premières pistes : [`concepts-dieux/maquette-gameplay.png`](concepts-dieux/maquette-gameplay.png).

### Verdure vivante

- **Statut** : idée.
- **Règle** :
  - Les Branches d'Yggdrasill et la Porte d'Asgaard font pousser une végétation sacrée **case par case**, jusqu'à un rayon maximal (de l'ordre de 7 et 9 cases), à raison d'une couronne de cases toutes les 4 s environ.
  - Un dieu à l'arrêt fait pousser une petite tache autour de lui, qui se fane après son départ.
  - Sans source, la Verdure se fane depuis le bord.
  - Les dégâts de zone ennemis la brûlent ; elle repousse ensuite.
  - Ennemis au sol dessus : ralentis (de l'ordre de 20 %) et visibles (le camouflage reste réservé aux détecteurs). Bâtiments de Gaïa posés dessus : ils se matérialisent plus vite.
- **Ce qu'elle apporte** :
  - Un territoire qui **avance dans le temps** et sert à défendre et à voir. Le creep des Z est posé d'un coup, conditionne la construction et répare.
  - Elle accentue le profil du camp : lent à s'étendre, très solide chez lui.
  - Elle laisse une fenêtre de vulnérabilité lisible au début, avant qu'elle ait poussé. Réponse adverse naturelle : la brûler.
- **Coût** :
  - Simulation : une grille d'octets par joueur et une liste de cases de front, incluses dans `hash()`.
  - Rendu : un maillage par tuiles comme le creep, reconstruit par bandes quand la grille change.
  - IA : apprendre aux adversaires à la brûler.
- **Questions** : doit-elle révéler l'ennemi (forte), ou seulement le ralentir ?

### Arches de lierre

- **Statut** : idée.
- **Règle** :
  - Gaïa élève de petites arches (2×2), posées sur la Verdure, qui forment un réseau.
  - Un dieu à l'arrêt devant une arche la traverse, avec son escorte proche, après une canalisation de 3 s interrompue par les dégâts. Il ressort devant une autre arche.
  - Un temps de recharge par arche ; l'ennemi ne peut pas les emprunter.
- **Ce qu'elle apporte** :
  - Les dieux sont les casernes : un dieu lent loin du front, c'est une production perdue. L'arche **redéploie une caserne entière** sans rendre le camp mobile au combat.
  - Différence avec les Isdaris : c'est une infrastructure fixe, lente et destructible, pas un saut vers n'importe quel point.
  - Elle ouvre des menaces sur deux fronts, et donne à l'adversaire une cible prioritaire.
- **Coût** :
  - Simulation : quelques entités et un état de canalisation (réutiliser `place()`, comme la Téléportation de Gaïa).
  - IA : la partie la plus lourde, savoir quand faire passer un dieu.
- **Questions** : réservées aux dieux et à leur escorte, ou ouvertes à toute unité ?

### Sanctuaires

- **Statut** : idée.
- **Règle** :
  - Gaïa élève un cercle de colonnes. Un dieu à l'arrêt au centre invoque ses troupes plus vite (de l'ordre de 1,5 fois) et se soigne lentement.
  - Un seul dieu par Sanctuaire, et un nombre de Sanctuaires limité.
- **Ce qu'elle apporte** :
  - Un arbitrage permanent entre le dieu caserne, immobile au Sanctuaire, et le dieu combattant, au front.
  - Elle traite un défaut mesuré : l'IA Dieux garde 2 500 à 3 000 minerais à la 12e minute, faute de débit d'invocation.
  - Une lecture claire pour l'adversaire : un dieu au Sanctuaire signale une armée en préparation.
- **Coût** :
  - Simulation : un test de distance par dieu, négligeable.
  - IA : garer au repos le dieu le moins utile au front.
- **Questions** : bâtiment à part, ou quatrième forme de la Branche d'Yggdrasill ?

### Pistes écartées pour les Dieux

- **Bâtiments qui poussent**, comme mécanique à part :
  - les bâtiments de Gaïa se matérialisent déjà seuls, et ceux des Z se déplient seuls ;
  - gardé seulement comme bonus de la Verdure.
- **Arche qui produit**, avec des troupes qui sortent d'une arche lointaine : trop proche de la téléportation de production des Isdaris.
- **Verdure obligatoire pour construire** : trop proche du creep des Z.

---

## Mécaniques communes

*Aucune piste pour l'instant.*
