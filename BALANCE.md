# Équilibrage

Tous les chiffres d'équilibrage du jeu sont dans [`src/balance.json`](src/balance.json). Le code n'en contient aucun : modifier ce fichier suffit.

## Proposer un changement

1. Sur GitHub, ouvrir `src/balance.json` et cliquer sur le crayon (« Edit this file »).
2. Changer les valeurs.
3. « Commit changes… », choisir « Create a new branch » et ouvrir la pull request.
4. Attendre le commentaire du bot (environ 10 minutes). Il joue 98 parties IA contre IA avec les chiffres de `main` puis avec ceux de la PR, et compare les victoires, la durée des parties et les unités produites.
5. Si les tests échouent, le fichier est invalide : une virgule manquante, une valeur absente ou un nom d'unité mal écrit. Le message d'erreur nomme la ligne fautive.
6. Le programmeur relit et fusionne la PR.

Plusieurs changements d'un coup rendent le résultat difficile à lire : mieux vaut une idée par PR.

Les parties IA contre IA mesurent l'équilibre entre IA, pas entre joueurs. Elles se terminent vers 10 à 14 minutes : les unités de fin de partie (sauriens, Char Pégase, Chimère, Discobole) y apparaissent peu. Il faut aussi les essayer en jeu.

## Valeurs provisoires

Les unités ajoutées d'après la notice 1.2-1 reprennent les valeurs du mod SC2, adaptées au jeu par le programmeur ; elles attendent l'équilibrage : `metallurgie`, `bourdon` (le mod ne lui donnait pas d'arme), `pegase`, `alchimisterie`, `alchimiste`, `creaturium`, `plesiosaure`, `ankylosaure`, `allosaure`, `belluaire`. Le bonus du mod contre l'infanterie légère ou biologique n'existe pas encore dans le jeu : il est intégré aux dégâts de base, et `vsMechanical` ne joue que contre les bâtiments.

Ajoutées la nuit du 16 au 17 novembre, d'après la notice 1.2-1, toutes provisoires (valeurs du mod quand il en a, sinon de l'auteur du code) :
- **Humains** : `marche`, `grandconseil`, `grandealchimisterie`, `cuve`, `cadavre`, `scarabee`, et les recherches (`vehicles1` à `3`, `skin1` à `3`, `canonsscies`, `cuirasse`, `scieassaut`, `lamesempoisonnees`, `chargenapalm`, `observation`, `croissance`, `pillage`, `entrainementgroupe`, `armeschimiques`, `cocktail`, `regenerant`, `acide`, `oeilpercant`, `dressageallosaures`, `trebuchet`, `charlourd`, `decollage`, `chargement`, `scarabeassaut`).
- **Isdaris** : `baliste`, `espion`, `dragon`, `voyageur`, `behemoth`, `orbecommandement`, `trone`, `deflecteur`, les extensions (`miniportail`, `cuvegenetique`, `laboratoire`, `assembleur`, `balise`, `totem`, `autel`, `pyramide`, `observatoire`, `relais`, `porte`) et les recherches (`portailatk1` à `3`, `portailarmor1` à `3`, `assembleuratk1` à `3`, `assembleurarmor1` à `3`, `bouclier1` à `3`, `cercle1` et `2`, `robots`, `enfouissement`, `deflagration`, `silence`, `teleportation`, `manteau`, `feucirculaire`, `couloir`, `chocmental`, `boostgenetique`, `teleportrapide`, `canonlourd`, `dephasage`, `renvoi`, `omniscience`).
- Toutes les nouvelles capacités dans `abilities`, et les effets des recherches dans `rules.upgrades`.

Ajoutées le 17 novembre, provisoires aussi :
- **Humains** : `casernevolante` (Caserne transformée, requiert le Marché), `casernevol` (la même en vol : `speed` règle sa vitesse), capacités `envol` et `atterrissage`.
- **Isdaris** : `concentrateur` (extension du Trône) et sa capacité `murenergie` : `radius` est la demi-longueur du mur en cases, `duration` sa durée.

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
| `energyRate` | énergie produite par seconde |
| `power` | rayon du champ d'énergie Isdaris, en cases |
| `shieldAura` | rayon de recharge rapide des boucliers alliés |
| `bunker` | places dans le bunker |
| `amount` | minerai par champ |

`melee1` à `armor3` sont les améliorations de la Forge (coût et durée de chaque niveau).

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
| `maxCloaked` | Assassins au plus en même temps |
| `antiAir` | une défense anti-air en plus par `per` volants ennemis vus, `max` au plus |
| `tech.humains` | Créaturium à partir de `minute` avec `barracks` casernes |
| `tech.isdaris` | Nano-assembleur avec `barracks` portails, plus de `minerals` minerai et `energy` énergie |
| `army` | poids de chaque unité dans l'armée de l'IA |
| `research` | recherches de chaque camp, par ordre de priorité ; l'IA lance la première possible sur un bâtiment libre |
| `extra` | bâtiments tardifs de chaque camp : `[bâtiment, minute]`, un de chaque à partir de cette minute |
