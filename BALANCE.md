# Équilibrage

Tous les chiffres d'équilibrage du jeu sont dans [`src/balance.json`](src/balance.json). Le code n'en contient aucun : modifier ce fichier suffit.

## Proposer un changement

1. Sur GitHub, ouvrir `src/balance.json` et cliquer sur le crayon (« Edit this file »).
2. Changer les valeurs.
3. « Commit changes… », choisir « Create a new branch » et ouvrir la pull request.
4. Attendre le commentaire du bot (environ une demi-heure). Il joue 98 parties IA contre IA par paire de camps (Humains-Isdaris, Z-Humains, Z-Isdaris) avec les chiffres de `main` puis avec ceux de la PR, et compare les victoires, la durée des parties et les unités produites.
5. Si les tests échouent, le fichier est invalide : une virgule manquante, une valeur absente ou un nom d'unité mal écrit. Le message d'erreur nomme la ligne fautive.
6. Le programmeur relit et fusionne la PR.

Plusieurs changements d'un coup rendent le résultat difficile à lire : mieux vaut une idée par PR.

Les parties IA contre IA mesurent l'équilibre entre IA, pas entre joueurs. Elles se terminent vers 10 à 14 minutes : les unités de fin de partie (sauriens, Char Pégase, Chimère, Discobole) y apparaissent peu. Il faut aussi les essayer en jeu.

## Valeurs provisoires

Les unités ajoutées d'après la notice 1.2-1 reprennent les valeurs du mod SC2, adaptées au jeu par le programmeur ; elles attendent l'équilibrage : `metallurgie`, `bourdon` (le mod ne lui donnait pas d'arme), `pegase`, `alchimisterie`, `alchimiste`, `creaturium`, `plesiosaure`, `ankylosaure`, `allosaure`, `belluaire`. Le bonus du mod contre l'infanterie légère ou biologique n'existe pas encore dans le jeu : il est intégré aux dégâts de base, et `vsMechanical` ne joue que contre les bâtiments.

Le camp **Z** (les Machines) a pour référence la fiche de l'équilibreur de septembre 2010, `Old_Project/Version mod starcraft2/Fiches préparatoires 2010 (équilibreur)/Z.doc`, pour ses chiffres et son fonctionnement (comparaison : `docs/fiche-z-2010-et-donnees-2008.md`). Le mod SC2 n'a pas ce camp. Depuis le 18 novembre, `drone`, `dronecombat`, `quadripode`, `hexapode` et `coleoptere` reprennent cette fiche, avec des dégâts ramenés à 12 (15 pour l'Hexapode) : Z – Humains 52 – 42, Z – Isdaris 50 – 46. Le reste est encore calqué par le programmeur sur les deux autres camps, en attendant d'être aligné sur la fiche : `drone`, `dronecombat`, `quadripode`, `hexapode`, `coleoptere`, `intelligence`, `pod`, `assimilateur`, `plateforme`, `armement`, `tourelle`, `zattaque1` à `zattaque3`, `zblindage1` à `zblindage3`, `lanceflammes`, `lanceroquettes`, les armes (`weapons`), `rules.equipSeconds`, `rules.creepRepair`, `ai.army.z` et `ai.kits`.

Ajoutées la nuit du 16 au 17 novembre, d'après la notice 1.2-1, toutes provisoires (valeurs du mod quand il en a, sinon de l'auteur du code) :
- **Humains** : `marche`, `grandconseil`, `grandealchimisterie`, `cuve`, `cadavre`, `scarabee`, et les recherches (`vehicles1` à `3`, `skin1` à `3`, `canonsscies`, `cuirasse`, `scieassaut`, `lamesempoisonnees`, `chargenapalm`, `observation`, `croissance`, `pillage`, `entrainementgroupe`, `armeschimiques`, `cocktail`, `regenerant`, `acide`, `oeilpercant`, `dressageallosaures`, `trebuchet`, `charlourd`, `decollage`, `chargement`, `scarabeassaut`).
- **Isdaris** : `baliste`, `espion`, `dragon`, `voyageur`, `behemoth`, `orbecommandement`, `trone`, `deflecteur`, les extensions (`miniportail`, `cuvegenetique`, `laboratoire`, `assembleur`, `balise`, `totem`, `autel`, `pyramide`, `observatoire`, `relais`, `porte`) et les recherches (`portailatk1` à `3`, `portailarmor1` à `3`, `assembleuratk1` à `3`, `assembleurarmor1` à `3`, `bouclier1` à `3`, `cercle1` et `2`, `robots`, `enfouissement`, `deflagration`, `silence`, `teleportation`, `manteau`, `feucirculaire`, `couloir`, `chocmental`, `boostgenetique`, `teleportrapide`, `canonlourd`, `dephasage`, `renvoi`, `omniscience`).
- Toutes les nouvelles capacités dans `abilities`, et les effets des recherches dans `rules.upgrades`.

Ajoutées le 17 novembre, provisoires aussi :
- **Humains** : `casernevolante` (Caserne transformée, requiert le Marché), `casernevol` (la même en vol : `speed` règle sa vitesse), capacités `envol` et `atterrissage`.
- **Isdaris** : `concentrateur` (extension du Trône) et sa capacité `murenergie` : `radius` est la demi-longueur du mur en cases, `duration` sa durée.

Retouches provisoires du 17 novembre, d'après [le rapport d'équilibrage](docs/rapport-equilibrage-2026-11-17.md), à valider par l'équilibreur :
- `creature` : `hp` 67 → 70 (Humains – Isdaris passe de 67 – 31 à 52 – 46).
- `dronecombat` : `cost.minerals` 75 → 100, `buildTime` 15 → 18 (Z – Isdaris passe de 84 – 14 à 48 – 50 ; Z – Humains de 90 – 8 à 38 – 60, encore hors cible), puis `hp` 70 → 73 (Z – Humains 49 – 49, Z – Isdaris 52 – 46).

Réglages d'IA provisoires du 17 novembre (l'IA Isdaris passe enfin au Psycho-assembleur), à valider par l'équilibreur :
- `ai.tech.isdaris` : `{ barracks: 3, minerals: 900, energy: 400 }` → `{ minute: 12, barracks: 3 }`. L'énergie isdaris ne dépassait jamais 400 : le Psycho-assembleur et ses unités n'apparaissaient dans aucune partie.
- `ai.research.isdaris` : `feucirculaire` ajouté après `totem`.
- Mesure (`big.test.ts`, 98 parties par paire), à `minute` 12 : Humains – Isdaris 52 – 46 → 49 – 46 (3 nuls), Z – Isdaris 52 – 46 → 60 – 38 ; l'IA fait 9 Porte-disques et 3 Balistes (aucun avant). À `minute` 8, elle en fait bien plus (53 Porte-disques, 51 Balistes, 19 Chimères) mais les Isdaris perdent davantage (65 – 33, 71 – 27) : les unités du Psycho-assembleur coûtent cher pour leur force. À l'équilibreur de juger leur prix ; la minute pourra redescendre ensuite.

Le camp des **Dieux** (V1, rang 1, d'après la notice 1.2-1 et `docs/camp-dieux.md`) est entièrement provisoire, calqué par l'auteur du code sur les trois autres camps : `esprit`, `gaia`, `thor`, `apollon`, `seth`, `nain`, `minotaure`, `sphinx`, `asgaard`, `branche`, `protecteur`, `antre`, `puitsdivin`, `temple`, `dmelee1` à `dmelee3`, `dranged1` à `dranged3`, `darmor1` à `darmor3`, `celerite`, les capacités `teleportgaia`, `flechegaia`, `courroux`, `pluiedefeu`, `tempete`, `rules.upgrades.courroux`, `rules.upgrades.celerite`, `gaia.levels`, `thor.levels`, `apollon.levels`, `seth.levels`, `niveau`, `ai.godLevelMargin`, `ai.army.dieux`, `ai.research.dieux` et `ai.gods`. Ajustés pour que l'IA puisse jouer : Thor ne coûte pas d'énergie (sinon rien ne démarre avant le Puits) et la Porte d'Asgaard loge 14 (Gaïa compte pour 4 au départ). À surveiller : chaque dieu n'invoque qu'une unité à la fois, l'IA accumule du minerai.
- Première mesure (`big.test.ts`, QUICK : 18 parties par paire, IA normale) : Dieux – Humains 3 – 14 (1 nul), Dieux – Isdaris 8 – 10, Dieux – Z 9 – 3 (6 nuls) ; parties de 25 minutes en moyenne. L'IA fait surtout des Nains, quelques Sphinx, presque pas d'Apollon ni de Minotaures (énergie).
- Après l'IA « dépensière » (Gaïa enchaîne ses constructions, extension dès la minute 4 quand elle a plus de 800 minerais, Porte d'Asgaard au lieu d'Antre au-delà de 1600, jusqu'à 3 Branches de plus et 4 Yggdrasill protecteurs), 18 parties par paire : Dieux – Humains 5 – 4 (9 nuls), Dieux – Isdaris 9 – 4 (5 nuls), Dieux – Z 11 – 2 (5 nuls) ; 26 minutes en moyenne. Provisoire. Elle garde encore 2 500 à 3 000 minerais vers la minute 12 : chaque dieu n'invoque qu'une unité à la fois, c'est la vraie limite (temps d'invocation ou invocations simultanées, à trancher par l'équilibreur). Avec plus de tours (jusqu'à 10), la réserve tombait à 1 200 – 2 000 mais l'IA se retranchait : 17 nuls sur 18 contre les Humains.

IA facile plus facile, réglages provisoires du 17 novembre (le joueur se faisait battre) :
- `difficulty.easy` : 70 → 60 (minerai encaissé).
- `levels.easy` : `{ waveBonus: -3 }` → `plan` (10 ouvriers par base, casernes `[[8, 1], [10, 2]]`, vagues de 5 puis +1), `attackMinute` 11, `maxWave` 6, `expandMinute` 14.
- Mesure (`EASY=1 npx vitest run scripts/easy.test.ts`, IA facile contre IA normale, 4 camps × 4 camps × 2 côtés = 32 parties) : avant, 1 victoire sur 32, première attaque à 4,9 min, vagues de 7,0 unités ; après, 1 victoire sur 32, première attaque à 11,6 min (dans les 9 parties qui durent jusque-là), vagues de 5,9 unités.

Reprises du mod SC2 (XC Mod 1.53, la dernière version pour les Humains et les Isdaris), 18 novembre, à la demande de l'utilisateur. Ces unités avaient gardé les chiffres du premier prototype. Toutes les valeurs restent à valider par l'équilibreur (voir `docs/fiches-2010-comparaison.md`) :
- Humains : `serf` (100 PV, 20 s), `auxiliaire` (15 dégâts, 22 s), `legionnaire` (armure 0), `soigneur` et `phalangiste` (vue 8 ; 30 s et 35 s), `cadavre` (140 PV, vitesse 2, vue 5, 24 dégâts toutes les 2,2 s, −12 contre les machines).
- Isdaris : `moissonneur` (bouclier 50, 20 s, frappe toutes les 2 s), `archer` (21 dégâts par seconde, armure 0, vitesse 2,2, vue 8, logistique 1, 75 d'énergie, 29 s), `creature` (67 PV, vitesse 2,8, vue 5, 18 dégâts par seconde, −6 contre les machines), `druide` (vue 9, logistique 1, 225 d'énergie, 34 s), `assassin` (bouclier 210, 49 s), `obelisque` (vue 15), `orbe` et `recepteurarme` (21 dégâts), `discobole` (44 s), `espion` (39 s), `voyageur` (49 s).
- Les bonus du mod selon la cible (léger, blindé, massif, biologique) n'existent pas dans le jeu : les dégâts sont ceux contre l'infanterie, et `vsMechanical` corrige contre les machines et les bâtiments, comme pour les autres unités.
- La Créature revient à 67 PV : les 70 PV du 17 novembre (ci-dessus) sont remplacés.

Corrections d'équilibrage appliquées le 18 novembre, à la demande de l'utilisateur, en attendant l'avis de l'équilibreur. Le détail et les mesures sont dans `docs/propositions-equilibrage-2026-11-18.md`. Pour revenir aux valeurs du mod, remettre la colonne « Mod 1.53 » :

| Unité | Champ | Mod 1.53 | Appliqué | Pourquoi |
|---|---|---|---|---|
| Auxiliaire | `attack.damage` | 15 | 10 | Humains – Isdaris 88 – 10 avec 15 |
| Archer | `cost.energy` | 75 | 50 | valeur de la fiche de 2010 ; avec l'Auxiliaire à 10 : Humains – Isdaris 50 – 48 |
| Archer | `buildTime` | 29 | 24 | idem (fiche de 2010 : 30 s) |
| Drone de combat, Quadripode, Hexapode (Z) | `attack.damage` | 6 (calqué sur l'ancien Auxiliaire) | 7 | Z – Humains 56 – 41, Z – Isdaris 58 – 40 |

Champs ajoutés :
- `attack.splash` : rayon (cases) des dégâts de zone, moitié des dégâts autour de la cible.
- `lifetime` : durée de vie en secondes (Cadavre réanimé).
- `bunker` sur une unité : places à bord (Scarabée).
- `cloakAura` : rayon d'invisibilité autour d'un bâtiment (Déflecteur).
- Capacités : `range` (portée de lancement), `radius` (zone), `damage`, `max` (unités déplacées au plus), `energy` (coût).
- `rules.trade` : le Marché échange `give` d'une ressource contre `get` de l'autre.

## Unités et bâtiments (`units`)

| Champ | Sens |
|---|---|
| `hp` | points de vie |
| `shield` | bouclier psychique (Isdaris), absorbé avant les PV, se recharge hors combat |
| `armor` | retiré à chaque coup reçu |
| `speed` | cases par seconde |
| `accel` | inertie : accélération au départ et freinage à l'arrivée, en cases par seconde² (absent : pleine vitesse d'un coup) |
| `sight` | vision, en cases |
| `supply` | nourriture utilisée (unité) ou fournie (bâtiment ; négatif : en utilise) |
| `cost` | `minerals` et `energy` |
| `buildTime` | secondes de production (vitesse « Normal » de SC2 ; le jeu tourne en « Faster ») |
| `attack.damage` | dégâts par coup |
| `attack.range` | portée en cases au-delà du contact (corps à corps : 0.1) |
| `attack.cooldown` | secondes entre deux coups |
| `attack.vsMechanical` | bonus ou malus contre les cibles mécaniques et les bâtiments |
| `attack.air` / `attack.ground` | `false` : ne touche pas les volants / pas le sol |
| `heal` | PV rendus par seconde à un allié proche |
| `regen` | PV régénérés par seconde |
| `detector` | rayon de détection des invisibles, en cases |
| `levels` | Dieux : les 5 niveaux d'un dieu, achetés au dieu lui-même (règle de XC.doc 2008). `hp`, `armor`, `speed`, `damage` : valeur à chaque niveau, du 1 au 5. `cost`, `time` : prix et secondes des niveaux 2 à 5. Au niveau N, le dieu invoque ses unités, et Gaïa ses bâtiments, en `buildTime` / N. Un dieu tué revient au niveau 1 |
| `energyRate` | énergie produite par seconde |
| `power` | rayon du champ d'énergie Isdaris, en cases |
| `shieldAura` | rayon de recharge rapide des boucliers alliés |
| `bunker` | places dans le bunker |
| `amount` | minerai par champ |

`melee1` à `armor3` sont les améliorations de la Forge (coût et durée de chaque niveau).

## Armes du camp Z (`weapons`)

Les socles Z (Quadripode, Hexapode, Coléoptère) sortent de la Plate-forme avec la mitrailleuse légère de leur fiche `units` (`attack`). On leur monte ensuite un kit qui la remplace, payé à chaque socle : `attack` (mêmes champs que pour les unités) et `cost`. Le Lance-flammes et le Lance-roquettes se recherchent d'abord au Centre d'armement ; le Lance-flammes ne va pas sur le Coléoptère, et le Drone de combat ne prend aucun kit.

## Capacités (`abilities`)

`cooldown` (secondes avant réutilisation), `duration` (secondes d'effet ; pour Rappel, la canalisation), `energy` (énergie dépensée).

## Règles (`rules`)

| Champ | Sens |
|---|---|
| `start` | ressources et ouvriers de départ |
| `harvest` | minerai par voyage, secondes de minage par voyage |
| `observation.radius` | rayon révélé par l'Observation céleste |
| `rappel` | rayon de ramassage, unités rappelées au plus, secondes d'étourdissement à l'arrivée |
| `peauDeRoc` | portée et réduction de dégâts de Peau de roc |
| `stimulantHp` | PV coûtés par le Stimulant |
| `equipSeconds` | secondes pendant lesquelles un socle Z reste immobile quand on lui monte un kit |
| `creepRepair` | PV rendus chaque seconde aux unités Z au sol sur leur creep |
| `upgrades.courroux` | Courroux du marteau (Thor) : multiplicateur de son prochain coup au corps à corps |
| `upgrades.celerite` | Célérité naine : un Nain bondit vers l'ennemi à moins de `range` cases, vitesse ×`speed` pendant `seconds`, une fois toutes les `cooldown` secondes |

## IA (`ai`)

| Champ | Sens |
|---|---|
| `plan.serfs` | ouvriers visés par base |
| `plan.casernes` | `[ouvriers, casernes]` : casernes voulues une fois ce nombre d'ouvriers atteint |
| `plan.mineAfter` | casernes avant la première mine ou le premier récepteur |
| `plan.wave`, `plan.waveGrowth` | taille de la première vague d'attaque, puis ajout par vague |
| `maxWave` | taille maximale d'une vague |
| `plan.healerEvery` | une unité sur N est un Soigneur |
| `plan.legionShare` | part de Légionnaires parmi les unités de base des Humains (0 à 1) |
| `difficulty` | minerai encaissé par l'IA, en % (facile, normal, difficile) |
| `levels.easy.plan` | IA facile : son propre plan, qui remplace les champs de `plan` donnés (moins d'ouvriers et de casernes, petites vagues) ; elle forme une unité à la fois par bâtiment, ne fait ni recherches, ni capacités, ni repli, et ses Assassins ne vont pas chasser les ouvriers |
| `levels.easy.attackMinute` | IA facile : aucune vague d'attaque avant cette minute |
| `levels.easy.maxWave` | IA facile : unités au plus par vague, le reste garde la base |
| `levels.easy.expandMinute` | IA facile : minute à partir de laquelle elle s'étend |
| `levels.hard.expandMinute` | IA difficile : minute à partir de laquelle elle s'étend ; ses soldats concentrent aussi leurs tirs sur l'ennemi le plus entamé |
| `maxCloaked` | Assassins au plus en même temps |
| `antiAir` | une défense anti-air en plus par `per` volants ennemis vus, `max` au plus |
| `tech.humains` | Créaturium à partir de `minute` avec `barracks` casernes |
| `tech.isdaris` | Psycho-assembleur à partir de `minute` avec `barracks` portails |
| `army` | poids de chaque unité dans l'armée de l'IA |
| `kits` | poids de chaque kit d'arme que l'IA Z monte sur ses socles |
| `gods` | Dieux : `[dieu, minute]`, la Porte d'Asgaard invoque chaque dieu à partir de sa minute, dans l'ordre |
| `godLevelMargin` | Dieux : minerai gardé en plus du prix avant qu'un dieu inoccupé n'achète son niveau suivant |
| `research` | recherches de chaque camp, par ordre de priorité ; l'IA lance la première possible sur un bâtiment libre |
| `extra` | bâtiments tardifs de chaque camp : `[bâtiment, minute]`, un de chaque à partir de cette minute |
