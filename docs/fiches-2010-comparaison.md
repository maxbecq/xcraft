# Fiches de stats de 2010 et jeu actuel

Comparaison du 18 novembre 2026. Aucune stat n'a été modifiée : l'équilibreur décide.

## Les documents

- **Notice de référence** : `Old_Project/notice 1.2-1 - RÉFÉRENCE.doc`. L'ancienne version est `Old_Project/notice 1.2 - ancienne version.doc`. Les deux ne diffèrent que par trois mots : « caverne » devient « caserne » (Croissance économique), « raiders » devient « assassins » (Autel isdaris), et « améliorés » devient « améliorées » (Boost génétique). Les notices décrivent les camps, mais ne donnent aucun chiffre.
- **Fiches de 2010**, renvoyées par l'équilibreur : `Old_Project/Version mod starcraft2/Fiches préparatoires 2010 (équilibreur)/Humains.doc` (septembre 2010) et `Isdaris.doc` (août-septembre 2010). Elles ont été rédigées après la notice (novembre 2009) et avant le mod SC2 (2012). Elles donnent, pour chaque bâtiment, unité, capacité et recherche, les coûts, temps, points de vie, boucliers, armures, dégâts, cadences, portées, vitesses et la logistique. Ni Z ni les Dieux n'y figurent.
- **Jeu actuel** : `src/balance.json`. Ses valeurs viennent du mod SC2 (XC Mod 1.53) quand il les donne. Les seules retouches propres au jeu sont celles listées dans `BALANCE.md` (Créature 70 PV, Drone de combat).

## Ce qui a évolué depuis 2010

Le jeu actuel reprend la plupart des chiffres de 2010 : coûts, PV, boucliers, cadences, portées et vitesses sont presque tous identiques. Les écarts :

1. **Dégâts selon la cible.** En 2010, chaque arme avait plusieurs valeurs selon le type de cible : biologique léger (BL), biologique en armure (BA), mécanique (M), mécanique massif (MM), structure (S) et héroïque (H). Le jeu actuel n'a qu'une valeur, parfois très en dessous de celles de 2010.
   - Auxiliaire : 15 / 11 / 8 / 4 en 2010, 6 aujourd'hui.
   - Archer : 29 / 22 / 15 en 2010, 10 aujourd'hui.
   - Créature : 18 / 12 / 6 / 3 en 2010, 7 aujourd'hui (mais elle frappe plus vite : 0,7 s au lieu de 1 s).
   - Le seul bonus de cible qui reste dans le jeu est `vsMechanical`, contre les bâtiments.
2. **Bâtiments plus rapides et moins blindés.** Le bâtiment principal se construit en 80 s au lieu de 120 s : Conseil des Échevins et Obélisque. La Caserne prend 45 s au lieu de 60 s, l'Orbe de commandement 60 s au lieu de 85 s. L'armure des bâtiments est environ divisée par deux : de 6 à 3 pour le bâtiment principal, de 4 à 2 pour la Forge et la Métallurgie, de 2 à 1 pour les autres.
3. **Bâtiments d'énergie.** La Mine et le Récepteur coûtent 600 minerais au lieu de 200, et prennent 4 de logistique (0 en 2010).
4. **Unités formées plus vite.** Le Serf et le Robot moissonneur se forment en 12 s au lieu de 20 s. L'Auxiliaire passe de 22 à 18 s, l'Archer de 30 à 24 s, le Chasseur Discobole de 45 à 22,5 s.
5. **Annexes isdaris.** En 2010, c'étaient des bâtiments accolés : 600 à 800 PV, autant de bouclier, 20 à 40 s de construction. Aujourd'hui, ce sont des extensions sans PV, plus longues à obtenir (50 à 90 s) et souvent plus chères en énergie.
6. **Autres changements notables.**
   - Assassin : 70 de bouclier au lieu de 210.
   - Baliste plasma : portée 8 au lieu de 5.
   - Trône d'Altar Sargon : 700 / 900 au lieu de 400 / 600.
   - Pylône sanglant : 500 minerais au lieu de 350.
   - Bourdon : 200 / 200 (le coût du Dirigeable de 2010) au lieu de 260 / 175, portée 3 au lieu de 4.
   - Archer, Druide et Assassin : 2 de logistique au lieu de 1.
   - Cadavre réanimé : 100 PV au lieu de 140.
   - Ankylosaure : 1 d'armure au lieu de 3.
7. **Absents du jeu actuel.**
   - Humains : Dirigeable (transport), Mine chimique (posée par une unité), Guilde alchimistique.
   - Isdaris : Drone protecteur, Détecteur et Générateur de bouclier (annexes).

### Noms : correspondances supposées

Les fiches de 2010 emploient d'anciens noms. Le rapprochement ci-dessous est une supposition, d'après la fonction et les chiffres :

| 2010 | Jeu actuel |
|---|---|
| Guilde métallurgique | Forge |
| Guilde des dresseurs-marchands | Marché |
| Machinerie | Métallurgie |
| Cuve à efférents | Réservoir de substances |
| Pegasus | Char Pégase |
| Ptérodactyle | Plésiosaure |
| Tyrannosaurus | Allosaure |
| Drone Moissonneur | Robot moissonneur |
| Guerrier sombre | Assassin |
| Porte-disque | Chasseur Discobole |
| Prisme | Espion |
| Nano-assembleur | Psycho-assembleur |
| Pylône | Pylône sanglant |
| Annexe portail | Miniportail |
| Assembleur annexe | Assembleur inférieur |
| Relais orbital | Relais de canon orbital |
| Porte spatial | Porte de déphasage |

### Capacités et recherches

Les fiches détaillent 22 capacités et 18 recherches humaines, 31 capacités et 24 recherches isdaris (coût en énergie, recharge, effet). Le rapprochement avec le jeu ne se fait que par le nom et l'effet. Il est donc à confirmer.

- **Retrouvées, parfois renommées** :
  - Humains : Vol (Caserne volante), Bunker (Fortin), Soins (Soigneur), Décollage, Chargement, Cocktail alchimistique, Acide anti-structure.
  - Recherches humaines : Pillage, Croissance économique, Cuirasse, Canons sciés, Scie d'assaut, Char lourd, Scarabée amélioré (Scarabée d'assaut).
  - Améliorations humaines : Attaque corps à corps, Attaque distance, Armure infanterie, Blindage véhicules et Peau épaisse (niveaux 1 à 3 de la Forge).
  - Probablement renommées : Attaque empoisonnée et Empoisonnement (Lames empoisonnées), Animation de cadavre (Réanimation), Tir de catapulte et Catapulte dorsale (Trébuchet intégré).
  - Isdaris : Enfouissement, Déphasage, Téléportation courte et rapide, Manteau négatif, Sphère de renvoi, Boost génétique, Omniscience, Module déphasant, Silence ionique (Silence des ions), Transfert groupé (Téléportation de groupe), Redéploiement et Retour (Rappel), DM amélioré (Robots améliorés).
  - Améliorations isdaris : Bouclier psychique, Attaque et Blindage du portail et de l'assembleur, Cercle énergétique (niveaux de l'Orbe de commandement, du Portail et du Psycho-assembleur).
  - Probablement renommées : Choc psychique (Choc mental), Couloir énergétique (Couloir temporel), Duplication et Hallucination (Double énergétique), Concentration énergétique (Concentrateur énergétique), Disque tournoyant (Feu circulaire), Tir de canon plasma (Canon plasma lourd).
- **Sans équivalent évident** :
  - Humains : Présence des Échevins, Production industrielle, Peau d'acier, Surcharge, Ferveur alchimistique, Gaz euphorisant, Explosion suicidaire, Minage, Dégâts de zone en mourant, Festin, Vente de ressources, Entrepôts, Détection alchimistique, Scientisme.
  - Isdaris : Transfert de bâtiment, Zone de transfert, Recharge de bouclier, Œil de plasma, Danse du soldat, Attaque de singularité, Dislocation plasmique, Ciblage, Bouclier protecteur, Course, Noyau d'énergie.

Le détail de chaque capacité (énergie, recharge, effet) se lit dans les fiches.

## Tableaux

En gras : valeur de 2010 → valeur actuelle quand elles diffèrent. Temps en secondes « Normal » de SC2. Logistique : négatif = consommée, positif = fournie. Les extensions isdaris n'ont plus de PV ni d'armure (« – »).

#### Humains : bâtiments et extensions

| Fiche 2010 | Dans le jeu | Coût (min./én.) | Temps | PV | Bouclier | Armure | Vue | Logistique |
|---|---|---|---|---|---|---|---|---|
| Conseil des Echevins | `conseil` | 1000/0 | **120 → 80** | 4000 | – | **6 → 3** | 13 | 10 |
| Grand Conseil | `grandconseil` | **500/0 → 400/300** | 60 | **4500 → 5000** | – | **6 → 3** | **14 → 13** | 10 |
| Mine | `mine` | **200/0 → 600/0** | 30 | 1000 | – | 1 | 5 | **0 → -4** |
| Grenier | `grenier` | 200/0 | **30 → 25** | 1000 | – | 1 | 7 | 10 |
| Caserne | `caserne` | 350/0 | **60 → 45** | 2600 | – | **3 → 1** | 10 | 0 |
| Fortin | `fortin` | 200/0 | **25 → 30** | 600 | – | **4 → 2** | 8 | 0 |
| Tour alchimistique | `tour` | 200/0 | 25 | 420 | – | 1 | 10 | 0 |
| Guilde des dresseurs-marchands | `marche` | 250/250 | **45 → 60** | 1400 | – | 1 | 10 | 0 |
| Guilde métallurgique | `forge` | 400/0 | 50 | 2800 | – | **4 → 2** | 10 | 0 |
| Guilde alchimistique | absent | 250/150 | 60 | 2200 | – | 2 | 10 | 0 |
| Alchimisterie | `alchimisterie` | 300/500 | 60 | 3200 | – | **2 → 1** | 11 | 0 |
| Creaturium | `creaturium` | 400/400 | 60 | 2500 | – | **2 → 1** | 10 | 0 |
| Machinerie | `metallurgie` | 500/300 | 60 | 3200 | – | **4 → 2** | 10 | 0 |

#### Humains : unités

| Fiche 2010 | Dans le jeu | Coût (min./én.) | Temps | PV | Bouclier | Armure | Dégâts 2010 (selon la cible) | Dégâts | Cadence | Portée | Vitesse | Vue | Logistique |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Serf | `serf` | 100/0 | **20 → 12** | 75 | 0 | 0 | 5 (BL, M), 3 (BA, H), 1 (MM, S) cible sol | 5 | 2 | 0.1 | 2.4 | 8 | -1 |
| Auxiliaire | `auxiliaire` | 100/0 | **22 → 18** | 80 | 0 | 0 | 15 (BL), 11 (BA, M), 8 (MM, H), 4 (S) cible sol/air | 6 | 1 | 4 | 2.4 | 8 | -1 |
| Légionnaire | `legionnaire` | 100/0 | 20 | 105 | 0 | **0 → 1** | 20 (BL), 15 (BA, M), 10 (MM, H, S) cible sol | 20 | 1 | 0.1 | 2.5 | 8 | -1 |
| Soigneur | `soigneur` | 125/100 | **30 → 25** | 80 | 0 | 0 | 12 (BL, BA), 9 (MM, M), 6 (S, H) cible sol/air | 12 | 1.25 | 5 | 2.5 | **8 → 9** | -1 |
| Phalangiste | `phalangiste` | 225/150 | **35 → 30** | 110 | 0 | 0 | 30 (M, MM), 23 (BL, S), 15 (BA, H) cible sol | 20 | 1.3 | 6 | 2.5 | **8 → 9** | -1 |
| Belluaire | `belluaire` | 200/175 | 35 | 175 | 0 | 1 | 30 (BA), 45 (BL), 15 (M, H), 4 (S, MM) cible sol | 35 | 1.75 | 0.1 | 2.7 | 8 | -1 |
| Alchimiste | `alchimiste` | 250/250 | 40 | 90 | 0 | 0 | 21 (M, BL, BA), 16 (S, M), 11 (H) cible sol | 20 | 2 | 6 | 2.5 | 9 | -1 |
| Cuve à efférents | `cuve` | 500/350 | 50 | 170 | 0 | 0 | 36 (M, BL, BA), 27 (MM, S), 18 (H) cible sol | 25 | 2.1 | 6 | **2 → 2.1** | 9 | -2 |
| Dirigeable | absent | 200/200 | 35 | 230 | 0 | 0 | | | | | | | 10 | -1 |
| Bourdon | `bourdon` | **260/175 → 200/200** | 35 | 230 | 0 | 0 | 25 (S), 50 (MM), 19 (M), 13 (H, BL), 6 (BA) cible sol/air | 20 | 1.5 | **4 → 3** | 2.9 | 10 | -1 |
| Scarabée | `scarabee` | **500/0 → 500/100** | 40 | 500 | 0 | 1 | – | – | – | – | **2.4 → 2.6** | 9 | -2 |
| Pegasus | `pegase` | 650/350 | 55 | 610 | 0 | 1 | 48 (MM), 72 (M, S), 24 (H, BA, BL) cible sol | 40 | 1.8 | 6 | 2.3 | 8 | -4 |
| Ptérodactyle | `plesiosaure` | 350/225 | 40 | 350 | 0 | 0 | 33 (BA), 50 (BL), 17 (M, H), 9 (MM, S) cible sol/air | 35 | 1.5 | **5 → 4** | **2.7 → 2.9** | 10 | **-1 → -2** |
| Ankylosaurus | `ankylosaure` | 575/390 | 50 | 580 | 0 | **3 → 1** | 44 (BL, S), 33 (BA, M), 22 (H, MM), cible sol | 30 | 1.5 | 0.1 | 2.2 | 8 | -2 |
| Tyrannosaurus | `allosaure` | 800/200 | 60 | 940 | 0 | **2 → 1** | 62 (BL, BA), 47 (M), 31 (H, MM, S) cible sol | 60 | 1.5 | 0.1 | 2.6 | 9 | -4 |
| Cadavre | `cadavre` | 0/0 | **– → 1** | **140 → 100** | 0 | **1 → 0** | 16 (BA, M), 24 (BL), 8 (H, MM, S) cible sol | 10 | **2.2 → 1.2** | 0.1 | **2 → 2.2** | **5 → 6** | 0 |
| Mine chimique | absent | 35/20 | 12 | 50 | 0 | 0 | | | | | | | 0 | 0 |

#### Isdaris : bâtiments et extensions

| Fiche 2010 | Dans le jeu | Coût (min./én.) | Temps | PV | Bouclier | Armure | Vue | Logistique |
|---|---|---|---|---|---|---|---|---|
| Obélisque | `obelisque` | 1000/0 | **120 → 80** | 2000 | 2000 | **6 → 3** | **15 → 13** | 15 |
| Récepteur | `recepteur` | **200/0 → 600/0** | 30 | 600 | 600 | 1 | 5 | **0 → -4** |
| Récepteur armé | `recepteurarme` | **200/0 → 600/0** | 30 | 700 | 700 | 1 | **5 → 7** | **0 → -4** |
| Réserve psy | `reservepsy` | 300/0 | **40 → 30** | 500 | 500 | **2 → 1** | 8 | 12 |
| Emetteur | `emetteur` | 150/0 | **25 → 20** | 300 | 300 | 1 | 10 | 0 |
| Pylône | `pylonesanglant` | **350/350 → 500/350** | **50 → 40** | 300 | 300 | 1 | 10 | 0 |
| Déflecteur | `deflecteur` | **250/450 → 300/300** | **50 → 30** | 300 | 300 | 1 | 10 | 0 |
| Portail | `portail` | 400/0 | **60 → 50** | 1600 | 1600 | **2 → 1** | 10 | 0 |
| Orbe plasma | `orbe` | 375/0 | 35 | 200 | 300 | 1 | 8 | 0 |
| Nano-assembleur | `nanoassembleur` | 400/200 | 75 | 1600 | 1600 | **2 → 1** | 10 | 0 |
| Orbe de commandement | `orbecommandement` | 400/400 | **85 → 60** | 1800 | 1800 | **2 → 1** | 10 | 0 |
| Trône d’Altar Sargon | `trone` | **400/600 → 700/900** | **85 → 90** | 1800 | 1800 | **2 → 1** | 10 | 0 |
| Annexe portail | `miniportail` | **250/0 → 200/200** | **30 → 60** | **800 → –** | **800 → –** | **1 → –** | **3 → –** | 0 |
| Cuve | `cuvegenetique` | **200/0 → 200/200** | **20 → 60** | **300 → –** | **300 → –** | **1 → –** | **3 → –** | 0 |
| Laboratoire | `laboratoire` | **200/200 → 150/150** | **30 → 50** | **800 → –** | **800 → –** | **1 → –** | **3 → –** | 0 |
| Assembleur annexe | `assembleur` | **250/0 → 150/150** | **30 → 50** | **800 → –** | **800 → –** | **1 → –** | **3 → –** | 0 |
| Balise | `balise` | **250/200 → 200/200** | **30 → 60** | **800 → –** | **800 → –** | **1 → –** | **3 → –** | 0 |
| Totem | `totem` | **200/250 → 250/250** | **30 → 70** | **800 → –** | **800 → –** | **1 → –** | **3 → –** | 0 |
| Détecteur | absent | 200/200 | 35 | 600 | 600 | 1 | 3 | 0 |
| Pyramide | `pyramide` | **200/200 → 250/250** | **35 → 70** | **600 → –** | **600 → –** | **1 → –** | **3 → –** | 0 |
| Autel | `autel` | **200/200 → 250/250** | **35 → 70** | **600 → –** | **600 → –** | **1 → –** | **3 → –** | 0 |
| Relais orbital | `relais` | **400/200 → 400/400** | **40 → 90** | **600 → –** | **600 → –** | **1 → –** | **3 → –** | 0 |
| Porte spatial | `porte` | **200/400 → 400/400** | **40 → 90** | **600 → –** | **600 → –** | **1 → –** | **3 → –** | 0 |
| Générateur de bouclier | absent | 300/300 | 40 | 600 | 600 | 1 | 3 | 0 |

#### Isdaris : unités

| Fiche 2010 | Dans le jeu | Coût (min./én.) | Temps | PV | Bouclier | Armure | Dégâts 2010 (selon la cible) | Dégâts | Cadence | Portée | Vitesse | Vue | Logistique |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Drone Moissonneur (DM) | `moissonneur` | 100/0 | **20 → 12** | 50 | 25 | 0 | 5 (BL), 3 (BA, M, H), 1 (MM, S) cible sol | 5 | **2 → 1.5** | 0.1 | 2.4 | 8 | -1 |
| Créature | `creature` | 70/0 | **15 → 14** | **67 → 70** | 0 | 0 | 18 (BL), 12 (BA), 6 (M, H), 3 (MM, S) cible sol | 7 | **1 → 0.7** | 0.1 | **2.75 → 2.9** | **5 → 6** | -1 |
| Archer | `archer` | 150/50 | **30 → 24** | 70 | 70 | **0 → 1** | 29 (M, MM, BA), 22 (BL, S), 15 (H) cible sol/air | 10 | **1 → 1.2** | 5 | 2.4 | **8 → 9** | **-1 → -2** |
| Druide | `druide` | **200/225 → 200/150** | 35 | 70 | 140 | 0 | 18 (M, MM, BA, BL, S), 9 (H) cible sol | 18 | 1.75 | **5 → 6** | 2.5 | **9 → 10** | **-1 → -2** |
| Guerrier sombre | `assassin` | 400/400 | 50 | 70 | **210 → 70** | 0 | 74 (M, BL), 56 (BA, MM)  37 (H, S) cible sol | 75 | 1.25 | 0.1 | 2.6 | 8 | **-1 → -2** |
| Drone protecteur | absent | 100/100 | 30 | 50 | 25 | 0 | | | | | | | 8 | -1 |
| Porte-disque | `discobole` | 500/250 | **45 → 22.5** | 200 | 250 | 0 | 40 (M, BA) 30 (MM, BL), 20 (S, H) cible sol/air | 40 | 1.5 | 6 | 2.6 | 9 | -2 |
| Baliste de plasma | `baliste` | 400/350 | **45 → 44** | 200 | 250 | 1 | 33 (BA, BL) 50 (M), 66(MM, S), 17 (H) cible sol | 45 | 2.5 | **5 → 8** | **2.4 → 2.2** | 9 | -2 |
| Prisme | `espion` | 200/200 | **40 → 30** | 160 | 160 | 0 | – | – | – | – | 2.5 | 9 | -1 |
| Chimère | `chimere` | 500/350 | **45 → 44** | 150 | 250 | 0 | 24 (M, MM, BA) 18 (BL, S), 12 (H) cible sol/air | 21 | 1 | 5 | 3 | 9 | -2 |
| Dragon | `dragon` | 500/350 | **45 → 44** | 150 | 250 | 0 | 55 (M, MM, S) 41 (BA, BL), 28 (H) cible air | 55 | 1.75 | 7 | 3 | 9 | -2 |
| Voyageur | `voyageur` | 300/600 | 50 | 250 | 250 | 0 | – | – | – | – | 2.5 | 10 | -2 |
| Behemoth | `behemoth` | 1100/600 | **80 → 79** | 500 | 500 | 2 | 99 (M, MM, S), 74 (BA, BL), 50 (H) cible sol/air | 75 | 1.8 | 7 | **2.3 → 2** | 10 | -5 |
