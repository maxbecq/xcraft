# Fiche Z de 2010 et « Données générales » de 2008

Analyse du 18 novembre 2026 de deux documents renvoyés par l'équilibreur.

**`Z.doc` est désormais la référence du camp Z**, pour ses chiffres comme pour son fonctionnement (décision du programmeur, 18 novembre). Les cinq unités Z de la section 2 sont **appliquées au jeu** avec des dégâts ajustés ; l'équilibreur peut revenir dessus. Le fonctionnement modulaire décrit en section 2 bis reste à implémenter.

## Les documents

| Fichier | Rangé dans | Date réelle (métadonnées Word) | Version concernée |
|---|---|---|---|
| `Z.doc` | `Old_Project/Version mod starcraft2/Fiches préparatoires 2010 (équilibreur)/` | créé le 6 septembre 2010, dernier enregistrement le 9 septembre 2010 | fiches préparatoires du mod SC2, même série que `Humains.doc` et `Isdaris.doc` |
| `XC.doc` | `Old_Project/Version développement/Données générales 2008 (équilibreur)/` | créé le 23 janvier 2008, dernier enregistrement le 1er mars 2008 | version Warcraft 3 (« Version développement », `Xcraftus.w3o`) |

- **`Z.doc`** a été ouvert 19 minutes après le dernier enregistrement d'`Isdaris.doc` (6 septembre 2010, 13 h 36). Il emploie les mêmes rubriques et les mêmes classes de cible : biologique léger (BL), biologique en armure (BA), mécanique (M), mécanique massif (MM), héroïque (H), structure (S). Le « gaz » y désigne l'énergie du jeu.
- **`XC.doc`** décrit les quatre camps de la version Warcraft 3 : types de dégâts et d'armure, mana, distances en unités Warcraft 3. Il précède la notice de référence 1.2-1 (octobre à décembre 2009).

Les deux sont **antérieurs au mod 1.53** (2012). Le mod 1.53 n'a pourtant **aucune unité Z** : son camp insectoïde est organique. `Z.doc` est donc la **seule référence chiffrée** du camp Z, dont toutes les valeurs du jeu ont été jusqu'ici calquées par le programmeur sur les autres camps (voir `BALANCE.md`).

## 1. Fiche Z de 2010 et jeu actuel

Correspondance des noms : Sonde = `drone`, Sonde de combat = `dronecombat`, Quadrupode T1 = `quadripode`, Hexapode T1 = `hexapode`, Coléoptère T1 = `coleoptere`. Comme pour les fiches Humains et Isdaris, les dégâts retenus sont ceux contre le biologique léger (BL), c'est-à-dire contre l'infanterie. Les socles reçoivent leur arme de base (Mitrailleuse) au niveau de leur socle : niveau 1 pour Quadrupode T1 et Coléoptère T1, niveau 2 pour Hexapode T1.

### Unités

| Unité | Coût min/én (2010 → jeu) | Temps | PV | Armure | Vitesse | Logistique | Dégâts (BL) / cadence / portée |
|---|---|---|---|---|---|---|---|
| Sonde (`drone`) | 100/0 → **75/0** | 20 → **12** | 75 → **90** | 0 | 2,4 | 1 | 5 / **2 → 1,5** / 0,1 |
| Sonde de combat (`dronecombat`) | 115/0 → **100/0** | 20 → **18** | 75 → **73** | 0 | 2,4 → **2,6** | 1 | 14 → **7** / 1 / 4 |
| Quadrupode T1 (`quadripode`) | 160/0 → **125/25** | 30 → **22** | 140 → **120** | 0 | 2,5 → **3,2** | 1 → **2** | 14 → **7** / 1 / 4 |
| Hexapode T1 (`hexapode`) | 325/50 → **200/75** | 45 → **30** | 290 → **240** | 1 → **2** | 2,2 → **2,3** | 2 | 17 → **7** / 1 / 4 |
| Coléoptère T1 (`coleoptere`) | 200/150 → **175/100** | 36 → **30** | 185 → **160** | 0 | 2,5 → **3** | 1 → **2** | 14 → **6** / 1 / 4 |

Le jeu a des socles moins chers, plus rapides à produire et à déplacer, mais deux fois moins forts : leurs dégâts avaient été calqués sur l'ancien Auxiliaire à 6.

### Bâtiments

| Bâtiment | Coût (2010 → jeu) | Temps | PV | Armure | Logistique fournie |
|---|---|---|---|---|---|
| Intelligence Centrale | 800 → **1000** | 120 → **80** | 3000 → **3600** | 6 → **3** | 10 |
| Assimilateur | 100 → **500** | 30 | 1800 → **900** | 1 | 0 → **utilise 3** |
| Pod | 300 → **150** | 40 → **25** | 1500 → **700** | 2 → **1** | 15 → **10** |
| Plate-forme (annexe du Pod en 2010) | 200 → **300** | 40 → **45** | 800 → **2200** | 1 | – |
| Centre d'armement | 250/0 → **350/100** | 50 | 2000 → **2400** | 4 → **2** | – |
| Tourelle (annexe du Pod en 2010) | 125 → **175** | 25 | 450 | 1 | – |

Les écarts des bâtiments suivent la même logique que pour les deux autres camps entre 2010 et le mod : bâtiment principal en 80 s au lieu de 120 s, armure divisée par deux, bâtiment d'énergie bien plus cher. Ils ne sont pas proposés au changement.

### Armes (kits)

| Arme | 2010 : coût, dégâts BL niveau 1, cadence, portée | Jeu |
|---|---|---|
| Mitrailleuse (arme de base) | gratuite, 14, 1 s, 4 (air et sol) | arme de base des socles : 7, 1 s, 4 |
| Laser (2010) / Mitrailleuse lourde (jeu) | 70/0, 20, 1 s, 5 | `lourde` : 50/25, 11, 1 s, 5 |
| Lance-flammes | 50/60, 24 (31 contre M), 1,5 s, 0,1, touche aussi l'unité derrière | `flammes` : 75/50, 10, 0,8 s, 1,2, zone 1,2 |
| Lance-roquettes | 70/20, 9 (37 contre M, 56 contre MM), 2 s, 4 à 7 selon le niveau | `roquettes` : 100/75, 22 (+18 contre machines), 2 s, 7 |

### Recherches présentes dans les deux

| Recherche | 2010 | Jeu |
|---|---|---|
| Attaque (proximité et distance en 2010, une seule ligne dans le jeu) | +10 % par niveau ; proximité 150/150, 250/250, 350/350 ; distance 300/300, 425/425, 550/550 ; 80, 90, 100 s | `zattaque1-3` : 200/200, 300/300, 400/400 ; 80, 90, 100 s |
| Blindage des socles | +1 par niveau ; 400/400, 550/550, 700/700 ; 80, 90, 100 s | `zblindage1-3` : 200/200, 300/300, 400/400 ; 80, 90, 100 s |
| Lance-flammes | 100/50, 30 s | 150/150, 50 s |
| Lance-roquettes | 125/25, 30 s | 150/150, 50 s |

### Ce que la fiche apporte et que le jeu n'a pas

- **Socles à niveaux** (T1 à T3) qui évoluent sur le champ de bataille, pour un coût réduit et en quelques secondes. Quadrupode T2 : 85 minerais, 8 s, 180 PV.
- **Socles absents** : Octopode (grand, 860 PV, logistique 4), Barge (transport aérien de 8 puis 12 de logistique), Mastodonte (grand volant, 785 PV).
- **Armes absentes** : Déchiqueteur (corps à corps, 48 BL), Jet sonique (dégâts en ligne), Arc électrique (3 cibles), Réparateur (nanites, 10 PV/s), Accumulateur (énergie pour Gel électronique, Vacarme, Cône de protection, Gravité alourdie), Canon X-04 (artillerie de zone, portée 7 à 12).
- **Bâtiments absents** : Intelligence Suprême (évolution du bâtiment principal, production accélérée), Pod supérieur, Centre de socles, Centre de recherche, Centre d'optimisation, Centre K.
- **Kits de soutien** vendus par le Centre K n'importe où sur le terrain : Détection, Invisibilité, Auto-réparateur, Balise offensive. Le Centre K tire aussi le Canon IEM, qui prend le contrôle d'une machine ennemie pendant 50 s.
- **Espion** : sonde volante de soutien (balise de révélation, impulsion magnétique, invisibilité temporaire, détection).
- **Creep** : 1 PV/s de réparation (le jeu en rend 2). En 2010, la Sonde répare aussi bâtiments et machines à 4 PV/s, contre ressources.
- **Tourelle et Assimilateur à arme adaptable** : on choisit leur arme comme celle d'un socle.

## 2. Mesures : la fiche Z de 2010 dans le jeu

Variantes testées dans une copie jetable du jeu (commit c5ade6f), sans rien changer d'autre. IA contre IA, carte d'origine, 98 parties par paire. Seules les cinq unités du tableau ci-dessus changent ; bâtiments, kits et recherches restent ceux du jeu.

| Variante | Z – Humains | Z – Isdaris | Durée moyenne |
|---|---|---|---|
| Jeu actuel | 53 – 45 | 53 – 44 (1 nul) | 18 min |
| Fiche 2010 entière (dégâts BL : 14, 14, 17, 14) | **51 – 44** (3 nuls) | **73 – 24** (1 nul) | 21 et 13 min |
| Fiche 2010, dégâts à 13, 13, 16, 13 | 46 – 52 | 76 – 22 | 19 et 16 min |
| **Fiche 2010, dégâts à 12, 12, 15, 12** | **52 – 42** (4 nuls) | **50 – 46** (2 nuls) | 20 et 17 min |
| Fiche 2010, dégâts réduits comme l'Auxiliaire (×2/3 : 9, 9, 11, 9) | 25 – 73 | 10 – 86 (2 nuls) | 17 et 15 min |
| Fiche 2010 sans ses dégâts (7, 7, 7, 6 du jeu) | 6 – 92 | 0 – 98 | 12 et 10 min |

Les dégâts sont donnés dans l'ordre Sonde de combat, Quadrupode, Hexapode, Coléoptère. Le bruit est d'environ ±5 victoires.

Lecture :
- Les coûts, temps et PV de 2010 rendent les socles plus chers. Sans les dégâts de 2010 qui vont avec, Z s'effondre.
- Avec la fiche entière, Z reste dans la cible contre les Humains mais domine les Isdaris.
- **Proposition** : la fiche de 2010 pour les cinq unités, avec des dégâts à 12 (Sonde de combat, Quadrupode, Coléoptère) et 15 (Hexapode). Les deux paires sont alors dans la cible. C'est la même démarche que pour l'Auxiliaire, ramené de 15 à 10. Le passage de 12 à 13 bascule le match contre les Isdaris (76 – 22) ; l'écart contre les Humains à 13 (46 – 52) reste dans le bruit.
- Valeurs **appliquées** dans `src/balance.json` le 18 novembre (accord du programmeur) :

| Unité | `hp` | `armor` | `speed` | `supply` | `cost` | `buildTime` | `attack.damage` | `attack.cooldown` |
|---|---|---|---|---|---|---|---|---|
| `drone` | 75 | 0 | 2,4 | 1 | 100/0 | 20 | 5 | 2 |
| `dronecombat` | 75 | 0 | 2,4 | 1 | 115/0 | 20 | **12** | 1 |
| `quadripode` | 140 | 0 | 2,5 | 1 | 160/0 | 30 | **12** | 1 |
| `hexapode` | 290 | 1 | 2,2 | 2 | 325/50 | 45 | **15** | 1 |
| `coleoptere` | 185 | 0 | 2,5 | 1 | 200/150 | 36 | **12** | 1 |

Non mesuré : les autres cartes, et les kits, recherches et bâtiments de 2010.

Pour revenir en arrière, remettre les anciennes valeurs du jeu :

| Unité | `hp` | `armor` | `speed` | `supply` | `cost` | `buildTime` | `attack.damage` | `attack.cooldown` |
|---|---|---|---|---|---|---|---|---|
| `drone` | 90 | 0 | 2,4 | 1 | 75/0 | 12 | 5 | 1,5 |
| `dronecombat` | 73 | 0 | 2,6 | 1 | 100/0 | 18 | 7 | 1 |
| `quadripode` | 120 | 0 | 3,2 | 2 | 125/25 | 22 | 7 | 1 |
| `hexapode` | 240 | 2 | 2,3 | 2 | 200/75 | 30 | 7 | 1 |
| `coleoptere` | 160 | 0 | 3 | 2 | 175/100 | 30 | 6 | 1 |

## 2 bis. Le fonctionnement modulaire des Z selon `Z.doc`

En 2010, une unité Z de combat est **un socle plus une arme** :
- Le **socle** donne le corps : PV, armure, vitesse, logistique, terrestre ou volant. Les socles se recherchent au Centre de socles et se construisent à la Plate-forme, une annexe du Pod.
- L'**arme** donne l'attaque : dégâts par classe de cible, cadence, portée, vision. Chaque socle part avec la **Mitrailleuse**, gratuite. Les autres armes se recherchent au Centre d'armement. L'arme se choisit **à la construction du socle** et coûte en plus du socle. Ce choix est **définitif**.
- La **puissance de l'arme suit le niveau du socle**. Elle a 4 niveaux (N1 à N4) : Quadrupode T1 porte une arme N1, T2 N2, T3 N3 ; Hexapode T1 commence en N2 ; Octopode et Mastodonte montent jusqu'à N4. Par exemple, la Mitrailleuse fait 14, 17, 19, puis 22 contre le biologique léger.
- Un socle **évolue sur le champ de bataille** vers le niveau suivant (T1 vers T2, puis T3), en quelques secondes et pour un coût réduit. Il gagne des PV, de la vitesse et un niveau d'arme. La recherche Optimisation perfectionnée accélère ces évolutions de 50 %.
- Les **kits de soutien** sont autre chose que les armes. Le Centre K les vend et les pose n'importe où sur le terrain : Détection, Invisibilité, Auto-réparateur, Balise offensive. Ils s'ajoutent à l'arme sans la remplacer.
- L'**arme adaptable** vaut aussi pour la Tourelle et l'Assimilateur : on leur achète une arme comme pour un socle.
- La **Sonde** se transforme en bâtiment et ne revient pas. Le **creep** répare 1 PV/s les unités et bâtiments posés dessus.

Dans le jeu aujourd'hui :
- Les socles sortent de la Plate-forme avec une mitrailleuse légère. On leur monte ensuite un **kit d'arme** qui la remplace : Mitrailleuse lourde, Lance-flammes ou Lance-roquettes. Le kit est payé à chaque socle.
- Le kit se monte **à tout moment**, partout, s'il existe une Plate-forme. Le socle reste immobile 2 s pendant le montage, et le kit **peut être changé** plus tard.
- Les dégâts ne dépendent pas du socle, il n'y a pas de niveaux, et pas de Centre K ni de kits de soutien.

Écarts à résorber pour suivre `Z.doc`, du plus simple au plus lourd :
1. Arme choisie à la construction, sans changement ensuite. L'ordre `equip` serait remplacé par un choix dans la file de la Plate-forme.
2. Dégâts des armes par niveau, liés au niveau du socle, avec les valeurs de 2010 converties comme pour les unités (dégâts contre le biologique léger, ajustés par la mesure).
3. Évolution des socles T1 → T2 → T3 sur le terrain.
4. Centre K et kits de soutien, puis Canon IEM.
5. Armes et socles absents : Laser, Déchiqueteur, Jet sonique, Arc électrique, Réparateur, Accumulateur, Canon X-04 ; Octopode, Barge, Mastodonte ; Espion, Intelligence Suprême, Pod supérieur.

Chaque étape change le jeu et demande donc l'accord du programmeur. Chacune devra aussi être mesurée, comme les stats.

## 2 ter. Bâtiments et armes de `Z.doc` dans le jeu : mesures

La session camp Z a repris `Z.doc` par étapes : commits locaux sur la branche `claude/z-2010`, non poussés. Décision du programmeur : attendre l'équilibreur, sans compensation entre-temps.

| Étape | Z – Humains | Z – Isdaris | Z – Dieux |
|---|---|---|---|
| Unités de `Z.doc` seules | 52 – 42 | 50 – 46 | non mesuré |
| + arme choisie à la construction et coûts des armes de `Z.doc` (b06d049) | 48 – 43 (7 nuls) | 58 – 39 | non mesuré |
| + bâtiments, annexes, recherches et prérequis de `Z.doc` (7b776b3) | 19 – 78 | 20 – 78 | 50 – 16 (32 nuls) |

Durée moyenne de la dernière ligne : 15 min contre Humains et Isdaris, 26 min contre Dieux. 98 parties par paire.

Ce que change la dernière étape :
- Intelligence centrale : 800 minerais, 120 s, 3000 PV, armure 6.
- Pod : 300 au lieu de 150. Plate-forme (200) et Tourelle deviennent des annexes du Pod, ce qui demande un Pod de plus.
- Assimilateur : 100 au lieu de 500, sans coût de logistique.
- Les socles se débloquent par recherche au Centre de socles (250) :
  - Quadripode : 100, en 25 s ;
  - Hexapode : 300/200, après le Centre de recherche ;
  - Coléoptère : 100/100, après l'Intelligence suprême.
- Creep : il ne vient plus que de l'IC, de l'Intelligence suprême et du Pod supérieur, et répare 1 PV/s au lieu de 2.
- Plus aucune détection Z avant le Centre K.
- Les recherches coûtent plus cher (Blindage des socles 400/400 à 700/700).

Essais rapides, 18 parties par paire, Z – Humains puis Z – Isdaris :

| Essai | Z – Humains | Z – Isdaris |
|---|---|---|
| Creep d'avant | 7 – 11 | 4 – 13 |
| Quadripode sans recherche | 1 – 16 | 7 – 11 |
| Attaque de proximité réservée au Lance-flammes | 3 – 14 | 3 – 15 |

Aucune cause n'explique seule le recul : c'est la somme des coûts d'entrée qui retarde la première armée. Dans une partie suivie contre les Humains :
- à 6 min, Z a 8 unités contre 13 pour les Humains ;
- Z perd sa première vague vers 7 min ;
- Z manque de minerai (0 à 300) pendant que son énergie monte jusqu'à 840.

Pistes pour l'équilibreur, non appliquées :
- coûts et temps des bâtiments Z, rajustés comme ceux des autres camps entre 2010 et le mod ;
- coût d'entrée des socles ;
- réparation du creep ;
- une détection Z avant le Centre K.

## 3. « Données générales » de 2008 : ce qu'elles apportent

Document de la version Warcraft 3, antérieur à la notice de référence. Ses chiffres ne sont pas transposables tels quels : dégâts typés (normal, perçant, énergie, magie, explosif, siège) contre six types d'armure, mana, distances Warcraft 3 (vision 750 à 1250). Ils ne servent pas à régler `balance.json`. Le document apporte surtout des intentions de conception.

### Règles générales

- **Matrice dégâts × armure**. Exemples : le siège fait 175 % contre les bâtiments et 25 % contre l'infanterie ; le perçant fait 125 % contre l'infanterie et 25 % contre les véhicules. Le jeu n'a qu'une armure plate, plus un bonus contre les machines.
- **Régénération** : 0,5 PV/s pour les organiques, 0,25 pour les Isdaris, 0,75 pour leur bouclier.
- **Réparation** : machines 4 PV/s, bâtiments 8 PV/s. Chaque réparateur supplémentaire ajoute du débit. Le coût d'une réparation est proportionnel au coût de l'unité.
- **Récolte** : 20 minerais toutes les 6 s par ouvrier, soit le débit du jeu actuel.

### Les Dieux en 2008 : la piste la plus utile

La question ouverte posée à l'équilibreur porte sur la règle d'invocation (section 4 de `propositions-equilibrage-2026-11-18.md`). Le document de 2008 y répond en partie :
- **9 dieux sur 3 rangs**, un par mythologie et par rang. Rang 1 : Odin, Apollon, Seth. Rang 2 : Thor, Athéna, Isis. Rang 3 : Loki, Osiris, Zeus. Le jeu n'en a que 3 : Thor (rang 2 en 2008), Seth et Apollon. Un rang s'ouvre avec deux dieux du rang précédent.
- **Plusieurs dieux invoquent la même unité de base** de leur mythologie : le Nain par Odin, Thor et Loki ; le Minotaure par Apollon, Athéna et Zeus ; le Sphinx par Seth, Isis et Osiris. Chaque dieu a en plus une unité propre : Corbeau et Drake, Élémentaire, Prêtresse, Walkyrie, Immortel, Titan. Ce lien est déduit de l'ordre des lignes du tableau.
- **Dieux à 5 niveaux achetés**, avec PV, armure, dégâts et sorts qui montent. Une règle donne directement une réponse à la question de l'invocation : « les temps de construction de base des unités et bâtiments sont divisés par le niveau actuel de la divinité les créant ». C'est la variante B (invocation plus rapide), mais progressive et payée.
- **Réinvocation** : « une divinité tuée peut être immédiatement réinvoquée à son prix d'origine », mais au niveau 1. Le jeu impose un deuil.
- **Offrandes** (recherche) : « les dieux cessent de compter dans la population ».
- **Sorts ultimes** : ils se chargent en 300 s au Temple primordial quand les trois dieux d'une mythologie sont présents. Jörmungand pour les Scandinaves, Colère d'Héphaïstos pour les Grecs, Créature du Jugement pour les Égyptiens.
- Autres éléments absents du jeu : Artefacterie (bonus achetés pour les dieux), Élémentaires qui fusionnent en Golem, Fontaine de soins, et des bâtiments de Gaïa qui se construisent seuls.

Le document ne dit nulle part qu'un dieu n'invoque qu'une unité à la fois.

### Les trois autres camps en 2008

- **Z** :
  - les socles ont 5 niveaux, avec évolution sur le terrain dans un cocon ;
  - socles absents du jeu : Droïde, Insectoïde, Frelon, Octopode, Barge, Mastodonte ;
  - Surcharge, une machine suicide qui fait des dégâts de siège ;
  - Gardien, une défense ;
  - Centre de kits ;
  - chaque bâtiment consomme une sonde, comme dans le jeu.
- **Humains** :
  - unités absentes du jeu : Hoplite, Raider, Prêtre, Théologue, Bipode, Machine volante, Zombie ;
  - Académie militaire, qui produit deux unités pour le double du prix ;
  - Forteresse : 6 serfs abrités dans le Conseil ;
  - chaque serf ajouté accélère une construction.
- **Isdaris** :
  - cercles d'énergie, jusqu'à 5 constructions en parallèle ;
  - bouclier plasma de l'Obélisque, invulnérable 20 s ;
  - Porte spatiale et Canon à plasma, un tir de 1200 dégâts guidé par l'Espion ;
  - Réflecteur, une aura d'invisibilité ;
  - aucune réparation possible.

Ces éléments sont des pistes pour plus tard, à discuter avec l'équilibreur. Aucun n'est prévu dans le jeu pour l'instant.

## 4. Questions pour l'équilibreur

1. Les unités Z reprennent maintenant la fiche de 2010, avec des dégâts ramenés à 12 (15 pour l'Hexapode). Ces valeurs vous conviennent-elles ?
2. Les socles doivent-ils pouvoir monter de niveau (T1 à T3) sur le terrain, comme en 2010 ?
3. Pour les Dieux : la règle de 2008 (temps d'invocation divisé par le niveau du dieu, niveaux achetés) vous convient-elle comme réponse à la question de l'invocation ?
4. Les bâtiments Z suivent maintenant aussi `Z.doc` (commit 7b776b3) : bâtiments, annexes, recherches et prérequis. Avec eux, Z recule nettement : 19 – 78 contre les Humains et 20 – 78 contre les Isdaris, contre 48 – 43 et 58 – 39 juste avant. Les causes s'additionnent :
   - le Pod coûte 300 ;
   - la Plate-forme et la Tourelle sont des annexes du Pod ;
   - il faut le Centre de socles et une recherche avant le premier Quadrupode ;
   - le creep ne répare plus que 1 PV/s.

   Entre 2010 et le mod, les bâtiments des Humains et des Isdaris avaient été rajustés : bâtiment principal plus rapide, armure divisée par deux, bâtiment d'énergie plus cher. Le programmeur vous laisse faire de même pour Z. Quelles valeurs proposez-vous pour les bâtiments Z ?
