# Fiche Z de 2010 et « Données générales » de 2008

Analyse du 18 novembre 2026 de deux documents renvoyés par l'équilibreur. Aucune stat du jeu n'a été modifiée : les valeurs proposées ici attendent l'accord du programmeur et l'avis de l'équilibreur.

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
- Valeurs proposées, à écrire dans `src/balance.json` si le programmeur l'accepte :

| Unité | `hp` | `armor` | `speed` | `supply` | `cost` | `buildTime` | `attack.damage` | `attack.cooldown` |
|---|---|---|---|---|---|---|---|---|
| `drone` | 75 | 0 | 2,4 | 1 | 100/0 | 20 | 5 | 2 |
| `dronecombat` | 75 | 0 | 2,4 | 1 | 115/0 | 20 | **12** | 1 |
| `quadripode` | 140 | 0 | 2,5 | 1 | 160/0 | 30 | **12** | 1 |
| `hexapode` | 290 | 1 | 2,2 | 2 | 325/50 | 45 | **15** | 1 |
| `coleoptere` | 185 | 0 | 2,5 | 1 | 200/150 | 36 | **12** | 1 |

Non mesuré : les autres cartes, et les kits, recherches et bâtiments de 2010.

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

1. Le camp Z doit-il reprendre les chiffres de la fiche de 2010 pour ses unités, avec les dégâts ajustés de la section 2 ?
2. Les socles doivent-ils pouvoir monter de niveau (T1 à T3) sur le terrain, comme en 2010 ?
3. Pour les Dieux : la règle de 2008 (temps d'invocation divisé par le niveau du dieu, niveaux achetés) vous convient-elle comme réponse à la question de l'invocation ?
