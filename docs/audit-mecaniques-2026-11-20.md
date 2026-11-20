# Audit des mécaniques des quatre camps — 20 novembre 2026

Version auditée : 0.9.66 (commit `480dadc`).

## But et méthode

Vérifier que chaque mécanique, unité, bâtiment, annexe, capacité et recherche des quatre camps décrits par les références existe dans le jeu et qu'un joueur peut l'atteindre : bâtiment constructible, unité formable, sort lançable depuis l'interface, prérequis satisfaisables.

Références, par ordre de priorité :

1. la notice 1.2-1 (`Old_Project/notice 1.2-1 - RÉFÉRENCE.doc`, 2009) ;
2. le mod StarCraft 2, XC Mod 1.53, dont les données extraites sont dans `Old_Project/Version mod starcraft2/Adrien Data/` ; les fiches de l'équilibreur de 2010 (`Humains.doc`, `Isdaris.doc`, `Z.doc`) ;
3. `docs/camp-dieux.md`, `docs/fiche-z-2010-et-donnees-2008.md`, `docs/fiches-2010-comparaison.md`, `BALANCE.md`. Pour les Dieux, `XC.doc` (2008) donne quelques chiffres.

Chaque élément reçoit un statut : **implémenté et fonctionnel**, **partiel**, **manquant** ou **implémenté autrement**. L'accessibilité a été vérifiée en lisant les chemins de code (données, règles de la simulation, interface, IA), pas en jouant. Les numéros de ligne renvoient à la version auditée.

Les écarts de chiffres entre le jeu et les sources sont signalés pour l'équilibreur, jamais corrigés ici.

## Synthèse

| Camp | État général | Manques principaux |
|---|---|---|
| Humains | Toutes les unités, tous les bâtiments et toutes les recherches de la notice ont un bouton. | Réparation par le Serf ; Explosion suicidaire et Gaz euphorisants de la Cuve ; Régénérant en zone ; mines chimiques du Pégase ; Festin de l'Allosaure ; l'IA ignore les véhicules. |
| Isdaris | Toutes les unités, tous les bâtiments, extensions et recherches de la notice existent et sont accessibles. | Danse du soldat ; déphasage des bâtiments (bouclier de plasma) ; délai du Canon orbital ; Double qui n'attaque pas ; partage des dégâts de la Sphère de renvoi ; Trône unique ; Redéploiement de l'Orbe ; second temps de la Porte de déphasage ; l'IA joue une partie du camp seulement. |
| Z | Suit `Z.doc` presque entièrement : 8 socles et leurs évolutions, 10 armes sur 4 niveaux, bâtiments, annexes, creep, réparation. | Gravité alourdie ; Sonde robuste du Drone de combat ; l'IA n'utilise pas l'Accumulateur ni plusieurs sorts ; l'énergie des unités de soutien est remplacée par des recharges. |
| Dieux | Presque tout est codé et testé : 10 dieux sur 3 rangs, 13 unités, 10 bâtiments, 11 recherches, Temple primordial, 5 niveaux de dieux. | Lumière ardente (Apollon) ; Jet de sable (Seth) ; réparation par l'Esprit ; bonus de Seth contre les blessés ; fin des fantômes à un plafond de dégâts ; Frigg ciblée comme unité terrestre. |

La phase 2 (section « Suivi de la phase 2 », en fin de document) dit ce qui a été comblé, avec le commit et le test, et ce qui ne l'a pas été, avec la raison.

## Humains

Audit en lecture seule du worktree `friendly-agnesi-a574dc` (commit 480dadc, version 0.9.66), le 20 novembre 2026.

Sources comparées, par ordre de priorité :
- **Notice** 2009 (`notice.txt`, l. 30-140 pour les Humains, l. 617 pour les forces et faiblesses ; l'arbre technologique des l. 700-760 n'a pas survécu à la conversion : seuls les titres restent).
- **Mod** XC Mod 1.53 (`UnitData.xml`, `AbilData.xml`, `EffectData.xml`, `BehaviorData.xml`, `GameStrings.txt`).
- **Fiche** 2010 (`fiche-Humains.txt`).
- Docs du dépôt (`docs/fiches-2010-comparaison.md`, `BALANCE.md`).

Conventions :
- « Notice l. N » renvoie à `notice.txt`.
- « Fiche » renvoie à `fiche-Humains.txt`.
- « Mod » renvoie à `Base.SC2Data/GameData/*.xml`.
- Les chiffres « jeu » viennent de `src/balance.json` (section `units`, `abilities` ou `rules.upgrades`).

Accessibilité dans le jeu :
- **HUD** : le joueur a un bouton. Les boutons sont génériques :
  - `src/game/hud-card.ts:119-127` (capacités, via `abilitiesFor`) ;
  - `src/game/hud-card.ts:192-248` (production, mutations, recherches) ;
  - `src/game/hud-card.ts:93` (construction).
  - Un élément déclaré dans `data.ts` a donc un bouton, et ses prérequis sont vérifiés par `lacks` / `needs`.
- **IA** : ce que joue `src/ai/ai.ts`.

Constat général sur l'IA. Elle ne joue qu'une partie du camp :
- Elle ne construit jamais de Métallurgie. Elle n'a donc ni Bourdon, ni Scarabée, ni Char Pégase.
- Ses recherches se limitent à `ai.research.humains` : `ranged`, `armor`, `melee` 1 à 3, `croissance`, `entrainementgroupe`, `oeilpercant`, `pillage`, `regenerant`, `armeschimiques`.
- Plusieurs capacités qu'elle sait lancer ne servent donc jamais : Charge de napalm, Explosif toxique, Observation céleste (recherche absente), Allosaure (dressage absent).

### Unités

| Élément | Statut | Référence | Code | Accessibilité |
|---|---|---|---|---|
| Serf | partiel | Notice l. 37 : récolte, construit et **répare** ; travail à plusieurs sur un chantier. Fiche : « chacun diminuant de 10 % le temps restant ». Mod : `rparation` (CEffectCreateHealer, coût 25 %) | `data.ts:420`. Construction à plusieurs : `world.ts:876-895`, un tick de progression par serf, donc un gain linéaire et non -10 % du reste. Réparation : `commands.ts:313` réservée au drone Z | Formable au Conseil. **Le Serf ne peut pas réparer.** La construction à plusieurs est implémentée autrement |
| Auxiliaire | implémenté et fonctionnel (capacité en plus) | Notice l. 40 : fusil chimique, base de l'armée. Fiche : 80 PV, 15/11/8/4, portée 4 | `data.ts:421`, stats `balance.json` (dégâts 10) ; capacité `stimulant` (`data.ts:276`, `abilities.ts:178-184`) | Caserne ; IA oui (`ai.ts:1038`). Le **Stimulant n'apparaît dans aucune référence** |
| Légionnaire-scieur | implémenté et fonctionnel (capacité en plus) | Notice l. 43 ; Fiche : 105 PV, 20/15/10 | `data.ts:422` ; capacité `charge` (`data.ts:278`) | Caserne ; IA oui. La **Charge n'apparaît dans aucune référence** (le mod a une « Charge féroce », mais pour le Kylosaurus) |
| Soigneur | implémenté et fonctionnel (soins autrement) | Notice l. 46 : soigne vite et lance Peau d'acier. Fiche : Soins 25 PV toutes les 2,5 s, portée 5 ; Peau d'acier +5 blindage 35 s, portée 4, 25 énergie ; requiert la Guilde alchimistique | `data.ts:423`, `heal: 9` PV/s (`combat.ts:248-280`), `peauderoc` (`abilities.ts:163-172`, -5 dégâts par coup, 35 s, portée 4, recharge 25 s) | Caserne, **sans prérequis** (la Fiche demande la Guilde alchimistique) ; IA oui (soins auto et Peau de roc, `ai.ts:673`) |
| Phalangiste | implémenté et fonctionnel | Notice l. 49 ; Fiche « Surcharge » : 150 dégâts ou 150 PV réparés, recharge 38 s. Mod « Substance réparatrice » : 150 PV, recharge 38 s, portée 6 | `data.ts:425` (requiert `forge`) ; `napalm` `abilities.ts:352-358` : 60 dégâts, immobilisé 4 s, allié réparé de 120 ; recherche `chargenapalm` | Caserne après une Forge ; IA forme oui (`ai.ts:1031`) ; IA lance **non** (recherche jamais lancée) |
| Belluaire | implémenté et fonctionnel | Notice l. 52 : poison, coup circulaire, camouflage. Fiche : poison 5 PV/s pendant 11 s ; « Harmonie ». Mod : Camouflage de guerre, recharge 45 s | `data.ts:478` (requiert `creaturium`) ; `coupcirculaire` et `camouflage` (`abilities.ts:88-97`) ; poison `combat.ts:449` (3 PV/s pendant 5 s) | Caserne après un Créaturium ; IA forme et lance (`ai.ts:887-890`) |
| Alchimiste | partiel | Notice l. 55 : détection, réanimation, explosif toxique, régénérant sur « ses troupes » (zone). Fiche : Cocktail 37 dégâts/s en zone 3 pendant 4 s ; Ferveur en zone 4 ; Animation 75 s | `data.ts:459` ; `detector: 9` ; `explosiftoxique`, `regenerant`, `reanimation` (`abilities.ts:340-351`) | Alchimisterie ; IA forme ; lance `regenerant` (`ai.ts:879`), **ni `reanimation` ni `explosiftoxique`** (cocktail jamais recherché). Le Régénérant ne vise **qu'une unité** (`near(...)[0]`), pas une zone |
| Cadavre réanimé | implémenté et fonctionnel | Notice l. 55 ; Fiche : 140 PV, 75 s | `data.ts:467` ; `lifetime: 30`, sort `duration: 30` | Par la Réanimation (joueur seulement) |
| Réservoir de substances (Cuve) | partiel | Notice l. 58 : explosifs de zone, gaz euphorisants, dissolution d'un bâtiment, explosion suicidaire. Fiche : Gaz euphorisant, Acide dissolvant 400 sur un bâtiment, Explosion suicidaire 356 en zone 6 | `data.ts:465` : attaque à `splash: 0.6` ; `acide` = bonus passif +30 (`combat.ts:389`) ; **aucune capacité active** | Grande Alchimisterie ; IA forme jusqu'à 3. **Manquent** : Gaz euphorisants, Explosion suicidaire. L'Acide dissolvant est implémenté autrement (bonus passif) |
| Bourdon | partiel | Notice l. 61 : dirigeable, détecteur, grenades anti-véhicule, transporte des troupes après amélioration, « voire hélitreuiller un véhicule » (l. 168). Fiche : Bourdon (attaque) et Dirigeable (transport + détection) séparés | `data.ts:453` ; `detector: 10` ; `chargement` = 4 places (`buildings.ts:147`) ; `boards` refuse les machines (`buildings.ts:155`) | Métallurgie ; **IA jamais**. Le transport d'un véhicule manque |
| Scarabée | partiel | Notice l. 64 : amphibie ; bunker pour auxiliaire, soigneur, phalangiste, alchimiste ; tourelle après amélioration. Fiche : 3 places ; passagers à -50 % de PV si détruit ; amélioré +0,1 vitesse | `data.ts:450`, `bunker: 4` ; tourelle `combat.ts:114` (15, portée 4) ; sortie sans perte de PV (`buildings.ts:283`) | Métallurgie ; **IA jamais**. Les passagers tirent (`shelter`) mais **ne lancent pas leurs sorts** (`commands.ts:37` exclut les unités à l'intérieur) ; pas d'eau sur les cartes |
| Char Pégase | partiel | Notice l. 67 : canon anti-véhicule et anti-bâtiment ; terre ou air, plus vite et plus de vue en l'air mais une cadence moindre ; **mines invisibles**. Fiche : en l'air, ne tire que sur l'air ; Minage, 5 mines en stock | `data.ts:455` ; `decollage` (`abilities.ts:81-87`) ; en l'air, tir anti-air seul (`combat.ts:118`) ; ni vitesse, ni vue, ni cadence modifiées | Métallurgie ; décollage après recherche ; **IA jamais** (le code tactique existe, `ai.ts:935`). **Mines absentes** |
| Mine chimique | manquant | Fiche : 35/20, 12 s, 50 PV, invisible, 160 dégâts en zone 2, déclenchée à 1. Mod : `Minechimiquedgts` 160 (rayon 1, puis 25 % à 1,25), charges 5, recharge 12 s, coût 35/20 | aucun | – |
| Plésiosaure | implémenté et fonctionnel | Notice l. 71 : baliste contre l'infanterie au sol, vulnérable à l'air. Fiche (Ptérodactyle) : cible sol **et air** | `data.ts:471`, `air: false` | Créaturium ; IA oui (bâtiment de tech) |
| Ankylosaure | partiel | Notice l. 74 : bâtiments, trébuchet aux « dégâts incendiaires durables ». Fiche : Tir de catapulte, recharge 21 s (effet vide). Mod : Charge féroce, recharge 21 s | `data.ts:473` ; trébuchet = portée 6 contre les bâtiments (`combat.ts:85`) ; pas de brûlure | Créaturium ; IA oui ; trébuchet jamais recherché par l'IA |
| Allosaure | partiel | Notice l. 77 : **dévore les cadavres organiques proches pour se soigner**. Mod « Festin » : tue une unité d'infanterie légère, rend 50 % de sa vie, recharge 60 s, portée 0,5. Fiche : texte de Festin recopié de Minage (erroné) | `data.ts:475` (requiert `dressageallosaures`) ; pas de Festin (celui de `combat.ts:175` sert à l'avatar de Jörmungand) | Créaturium après le dressage ; **IA jamais** (dressage absent de `ai.research`) |
| Dirigeable (Fiche/Mod) | implémenté autrement | Fiche : transport de 4, détecteur, 200/200. Mod : « Dirigeable d'appui » | fusionné dans le Bourdon (`data.ts:451-452`, commentaire) | – |

### Bâtiments

| Élément | Statut | Référence | Code | Accessibilité |
|---|---|---|---|---|
| Conseil des Échevins | implémenté et fonctionnel | Notice l. 82 : dépôt, serfs, léger bonus de dégâts à proximité. Fiche : +1 d'attaque dans un rayon de 13. Mod : rayon 10 (`PresenceSearchNew`) | `data.ts:426` ; aura +10 % dans un rayon de 8 (`combat.ts:12-13`, `combat.ts:394`) | Construction de départ ; actif pour tous |
| Grand Conseil | partiel | Notice l. 82 : unique, réduit les temps de production. Fiche : -25 %, prérequis Créaturium + Machinerie + Alchimisterie. Mod : « Conseil volant », unité unique, aura de production dans un rayon de 10 | `data.ts:428` (unique, requiert `forge`) ; -10 % (`buildings.ts:170`) | Mutation du Conseil ; IA oui (`ai.ts:415`). Les prérequis et le pourcentage diffèrent |
| Mine | implémenté et fonctionnel | Notice l. 85. Fiche : 200, logistique 0 | `data.ts:434` ; 600, -4, 2,5 énergie/s | Oui ; IA oui |
| Grenier | implémenté et fonctionnel | Notice l. 88 ; Fiche : +10, Entrepôts +2 | `data.ts:429` | Oui ; IA oui |
| Caserne | implémenté et fonctionnel | Notice l. 91 | `data.ts:430` | Oui ; IA oui |
| Caserne volante | implémenté autrement | Notice l. 91 : la Caserne « peut être améliorée ». Fiche : capacité Vol de base, vitesse 1,4. Mod : `Barraquementflying` | `data.ts:432-433` : mutation à 150/150 en 40 s, **requiert le Marché** ; `envol` / `atterrissage` (`abilities.ts:410`, `abilities.ts:214-227`) ; vitesse 1,2 | Joueur oui ; IA non, par choix (`ai.ts:409`) |
| Marché | implémenté et fonctionnel | Notice l. 94 : échange à un taux peu avantageux. Fiche : 1/3, minimum 100 (100 donne 33) | `data.ts:441` ; `rules.trade` 100 → 50 (`commands.ts:211`) ; boutons `hud-card.ts:233-237` | Joueur oui ; IA oui (`ai.ts:425-426`) |
| Fortin | partiel | Notice l. 97 : 4 auxiliaires, soigneurs, phalangistes ou alchimistes, qui tirent **ou utilisent leurs sorts**. Fiche : +1 portée ; passagers à -50 % de PV à la destruction. Mod `Bonus1porte` : active Soins, Gaz toxiques, Générer un cadavre | `data.ts:443`, `bunker: 4` ; tir +1 (`buildings.ts:268-280`) ; admet toute unité à distance (`buildings.ts:151-157`) | Joueur oui ; IA oui (`ai.ts:267`, `ai.ts:428`). **Pas de sorts depuis l'intérieur, pas de perte de 50 %** |
| Forge | implémenté et fonctionnel | Notice l. 100 : recherches militaires ; télescope après recherche | `data.ts:436-439` ; `observation` (50 énergie, rayon 8, 10 s) | Oui ; IA construit ; lance l'Observation sans l'avoir recherchée (`ai.ts:681`), donc refusée |
| Alchimisterie / Grande Alchimisterie | implémenté et fonctionnel | Notice l. 103 | `data.ts:457`, `data.ts:461-463` (mutation 250/250 en 45 s) | Oui ; IA oui (`extra` minute 11, mutation) |
| Tour alchimistique | partiel | Notice l. 106 : détecteur, anti-air, **dégâts de zone**. Fiche : portée 7, 40 contre les machines. Mod `Roquettedesoude` : 40, -10 contre les cibles biologiques | `data.ts:445` ; 40, portée 8, `ground: false`, `detector: 10` ; **pas de splash** | Oui ; IA oui |
| Créaturium | implémenté et fonctionnel | Notice l. 110 | `data.ts:469` (requiert `caserne` ; la Fiche demande le Marché) | Oui ; IA oui (bâtiment de tech) |
| Métallurgie | implémenté et fonctionnel | Notice l. 113 | `data.ts:447` (requiert `forge`) | Joueur oui ; **IA jamais** |
| Guilde alchimistique | manquant (fusionnée) | Fiche et Mod : requise par le Soigneur, l'Alchimisterie et la Tour ; porte Scientisme, Ferveur, Cocktail, Détection, Acide | ses rôles sont répartis entre la Forge et l'Alchimisterie | absente de la Notice |

### Capacités

| Capacité | Statut | Référence | Code | Accessibilité |
|---|---|---|---|---|
| Présence des Échevins | implémenté et fonctionnel | Notice l. 82 ; Fiche +1 attaque, rayon 13 | `combat.ts:394` | Passive |
| Planification (Grand Conseil) | partiel | Fiche : 25 % sur toutes les unités | `buildings.ts:170` (10 %) | Passive |
| Construction à plusieurs | implémenté autrement | Fiche : -10 % du reste par serf | `world.ts:883-886` (linéaire) | – |
| Réparation (Serf) | manquant | Notice l. 37 ; Fiche « réparation (H) » ; Mod `rparation` : 1 PV/s, 25 % du coût | réparation réservée au drone (`commands.ts:313`, `world.ts:846-860`) | – |
| Vol (Caserne) | implémenté autrement | voir Bâtiments | `abilities.ts:410`, `abilities.ts:214` | Joueur |
| Bunker (Fortin, Scarabée) | partiel | Fiche : 4 et 3 places, -50 % à la destruction ; Notice : sorts depuis l'intérieur | `buildings.ts:141-290` | Joueur et IA (Fortin) |
| Soins | implémenté autrement | Fiche : 25 PV, recharge 2,5 s ; Mod : 5 PV par point d'énergie | `heal: 9` PV/s automatique | Auto |
| Peau d'acier | implémenté et fonctionnel | Mod `Peauderoc` : -5 par coup, 35 s, portée 4 | `abilities.ts:163` | Joueur et IA |
| Surcharge / Charge de napalm | implémenté et fonctionnel (chiffres différents) | Fiche : 150, recharge 38 s | `abilities.ts:352` (60 dégâts + 4 s d'arrêt, réparation 120, recharge 20 s) | Joueur ; IA jamais (recherche) |
| Lames empoisonnées | implémenté et fonctionnel | Fiche : 5 PV/s pendant 11 s, non cumulable | `combat.ts:449`, `combat.ts:222` (3 PV/s pendant 5 s) | Après recherche ; IA jamais |
| Coup circulaire | implémenté et fonctionnel | Notice l. 52 | `abilities.ts:88` (30 dégâts, rayon 1,6, recharge 12 s) | Joueur et IA |
| Camouflage (Belluaire) | implémenté et fonctionnel | Mod : recharge 45 s | `abilities.ts:94` (8 s, recharge 30 s) | Joueur et IA |
| Cocktail / Explosif toxique | implémenté et fonctionnel (chiffres très différents) | Fiche : 37/s en zone 3, 4 s, portée 8, 125 énergie | `abilities.ts:340` (poison 3/s pendant 8 s, rayon 2,5) | Après recherche ; IA jamais |
| Ferveur / Régénérant | partiel | Notice : sur « ses troupes ». Fiche : zone 4, 20 % des dégâts pendant 15 s, -80 % de la vie maximale à la fin. Mod : 120 énergie, portée 7, mort à la fin | `abilities.ts:342-345` : **une seule cible**, invulnérable 6 s, puis 1 PV | Joueur et IA |
| Animation de cadavre | implémenté et fonctionnel | Fiche / Mod : 75 s, portée 9, 40 énergie | `abilities.ts:346` (30 s, portée 6) | Joueur ; IA jamais |
| Détection (Alchimiste) | implémenté et fonctionnel | Notice : innée ; Fiche : recherche « Détection alchimistique » | `detector: 9` | Innée |
| Gaz euphorisants | manquant | Mod : +25 % de vitesse de déplacement et d'attaque, 30 s, 120 énergie, portée 8. Fiche : zone 4, 30 s, portée 9 | – | – |
| Acide dissolvant | implémenté autrement | Fiche : 400 sur un bâtiment, portée 5, 100 énergie. Mod : 100 énergie, portée 5 | bonus passif `acideBonus` 30 (`combat.ts:389`) | Après recherche |
| Explosion suicidaire | manquant | Mod `Cuveexplosiondgts` : 356 en rayon 4, +15 contre les cibles légères. Fiche : 356 en zone 6 | – | – |
| Chargement (Bourdon) | partiel | Fiche : 4 de logistique ; Notice : « voire hélitreuiller un véhicule » | `buildings.ts:147` | Après recherche ; IA jamais |
| Décollage (Pégase) | partiel | Notice : en l'air, plus vite et plus de vue, cadence moindre ; Fiche : 3 s de transformation, recharge 5 s, air seul | `abilities.ts:81` (1,5 s) | Après recherche ; IA jamais |
| Minage (Pégase) | manquant | Fiche / Mod : voir Mine chimique | – | – |
| Trébuchet / Tir de catapulte | partiel | Notice : « dégâts incendiaires durables » | `combat.ts:85` (portée seule) | Après recherche |
| Festin (Allosaure) | manquant | Mod : soigne de 50 % de la vie de la victime, recharge 60 s ; Notice : cadavres proches | – | – |
| Observation céleste | implémenté et fonctionnel | Notice l. 100 | `commands.ts:278-283` | Joueur ; IA tente sans la recherche |
| Échange de ressources | implémenté et fonctionnel | Fiche : 1/3 | `commands.ts:211` | Joueur et IA |
| Stimulant, Charge | en plus des références | aucune | `abilities.ts:178-184` | Joueur et IA |

### Recherches

Toutes les recherches de la Notice (l. 117-155) existent et ont un bouton. Leurs coûts sont dans `balance.json`, leurs définitions dans `data.ts:478-504`.

| Recherche | Statut | Référence (Fiche quand elle existe) | Code de l'effet | IA |
|---|---|---|---|---|
| Croissance économique | implémenté et fonctionnel | Fiche : +5 PV ; jeu : +10 % | `combat.ts:198`, `buildings.ts:247` | oui |
| Pillage | implémenté et fonctionnel | Fiche : 10 % (Mod : le Légionnaire gagne des ressources en frappant) | `world.ts:523-527` | oui |
| Entraînement groupé | implémenté et fonctionnel | Notice seulement (jeu -25 %, Caserne) | `buildings.ts:167` | oui |
| Attaque càc / distance 1-3 | implémenté et fonctionnel | Fiche : +10 % par niveau, 250/350/450 | `combat.ts` (lignes `melee` / `ranged`) | oui |
| Armure infanterie 1-3 | implémenté et fonctionnel | Fiche : +1 | `combat.ts:49` | oui |
| Blindage véhicules 1-3 | implémenté et fonctionnel | Fiche : 200/300/400 ; jeu 150/225/300 | `combat.ts:49` | non |
| Peau épaisse 1-3 | implémenté et fonctionnel | Fiche : au Marché, 200/300/400 ; jeu à la Forge, 150/225/300 | `combat.ts:49` | non |
| Prérequis des niveaux 2 et 3 | ajout du jeu | aucune référence (`data.ts:416` : « the mod has none ») | `UPGRADE_REQUIRES` | – |
| Canons sciés | implémenté et fonctionnel | +1 portée | `combat.ts:87` | non |
| Cuirasse | implémenté et fonctionnel | +1 armure | `combat.ts:51` | non |
| Scie d'assaut | implémenté et fonctionnel | Fiche : +5 contre structures et mécanique massif ; jeu +15 contre les machines | `combat.ts:387` | non |
| Lames empoisonnées | implémenté et fonctionnel | voir Capacités | `combat.ts:449` | non |
| Charge de napalm | implémenté et fonctionnel | Notice | `data.ts:316` | non |
| Observation céleste | implémenté et fonctionnel | Notice | `data.ts:298` | non |
| Armes chimiques | partiel | Notice : zone pour l'Alchimiste **et la Cuve** | `combat.ts:451` (Alchimiste seul ; la Cuve a une zone d'office) | oui |
| Cocktail alchimistique | implémenté et fonctionnel | | `data.ts:310` | non |
| Régénérant chimique | implémenté et fonctionnel | | `data.ts:312` | oui |
| Acide anti-structure | implémenté autrement | Fiche : capacité active | `combat.ts:389` | non |
| Trébuchet intégré | partiel | pas de brûlure | `combat.ts:85` | non |
| Œil perçant | implémenté et fonctionnel | | `world.ts:492` | oui |
| Dressage d'allosaures | implémenté et fonctionnel | | `data.ts:475` (prérequis) | **non**, donc pas d'Allosaure pour l'IA |
| Chargement | partiel | pas de véhicule | `buildings.ts:147` | non |
| Décollage | implémenté et fonctionnel | | `abilities.ts:81` | non |
| Char lourd | implémenté et fonctionnel | Fiche : +10/+15/+5 selon la cible, +1 armure ; jeu +15, +2 armure | `combat.ts:52`, `combat.ts:388` | non |
| Scarabée d'assaut | partiel | Fiche : +0,1 vitesse en plus | `combat.ts:114` | non |
| Entrepôts (Fiche) | manquant | 300/150 en 50 s, +2 de logistique par Grenier | – | – |
| Scientisme (Fiche, Mod) | sans objet | +25 d'énergie (+50 pour la Cuve) ; le jeu n'a pas d'énergie par unité | – | – |
| Détection alchimistique (Fiche) | implémenté autrement | innée (Notice) | `detector: 9` | – |
| Stockage optimisé (Mod) | manquant | -20 % sur le prix des Entrepôts | – | – |

### Mécaniques

| Mécanique | Statut | Note |
|---|---|---|
| Échange de ressources | implémenté et fonctionnel | taux 100 → 50 (Fiche 100 → 33) |
| Énergie des lanceurs de sorts | implémenté autrement | Recharges à la place des points d'énergie de la Fiche et du Mod (Soigneur 25, Alchimiste et Cuve 200). La faiblesse « manque de vie des lanceurs de sort » (Notice l. 617) reste vraie par les PV |
| Réparation | manquant pour les Humains | Serf : voir plus haut. Le napalm répare les véhicules |
| Transport | partiel | Bourdon 4 fantassins ; Scarabée bunker ; pas de véhicule porté |
| Invisibilité et détection | implémenté et fonctionnel | Camouflage du Belluaire ; détecteurs : Tour, Bourdon, Alchimiste, Plésiosaure (recherche), Observation. Les mines invisibles manquent |
| Mutations | implémenté et fonctionnel | Grand Conseil, Grande Alchimisterie, Caserne volante |
| Auras | partiel | Échevins oui ; Gaz euphorisants manquant |
| Logistique | implémenté et fonctionnel | Conseil et Grenier +10 ; Mine -4 (Fiche 0) |
| Dégâts selon la cible (BL, BA, M, MM, S, H) | implémenté autrement | Une valeur et `vsMechanical` (déjà noté dans `fiches-2010-comparaison.md`) |
| Amphibie (Scarabée) | sans objet | pas d'eau sur les cartes |

### Manques à combler

1. **Réparation par le Serf.**
   - Référence : Notice l. 37 ; Fiche « réparation (H) » ; Mod `rparation` (1 PV/s, `DrainResourceCostFactor` 0,25).
   - Chiffres : le drone Z a déjà `rules.z.repairHp` 4 et `repairPercent` 25. On peut reprendre la même règle pour les bâtiments humains et les machines (`mechanical`).
   - Où : `commands.ts:313` (étendre la condition au `serf`), `world.ts:846` (ordre `repair` existant), IA `ai.ts:197`.
   - Difficulté : faible.
2. **Explosion suicidaire de la Cuve.**
   - Référence : Notice l. 58 ; Mod 356 dégâts en rayon 4, +15 contre les cibles légères ; Fiche 356 en zone 6. Les deux sont nets, seul le rayon diffère.
   - Où : nouvelle capacité `target: 'self'` dans `data.ts` (ABILITIES) et `abilities.ts:cast` ; la Cuve meurt.
   - Difficulté : faible.
3. **Gaz euphorisants (Cuve).**
   - Référence : Mod `Gazeuphorisants` (+25 % de vitesse de déplacement et d'attaque, 30 s, 120 énergie, portée 8) ; Fiche (zone 4, 30 s, portée 9). Le « cadence diminuée » de la Fiche veut dire « intervalle réduit ».
   - Où : `castAt` point ; réutiliser `boost` / `speed` du Stimulant (`abilities.ts:178`) ou `war`.
   - Difficulté : faible à moyenne.
4. **Festin de l'Allosaure.**
   - Référence : Notice l. 77 (cadavres organiques proches) ; Mod (dévore une unité d'infanterie légère vivante, alliée ou ennemie, rend 50 % de sa vie, recharge 60 s). Les deux divergent : voir Décisions.
   - Où : `abilities.ts` ; la liste `corpses` existe déjà (Réanimation, Jörmungand `combat.ts:175`).
   - Difficulté : faible.
5. **Mines chimiques du Char Pégase.**
   - Référence : Notice l. 67 ; Fiche (mine 35/20, 12 s, 50 PV, invisible, 160 en zone 2, déclenchée à 1, 5 en stock) ; Mod (charges 5, recharge 12 s, 160 en rayon 1 puis 25 % à 1,25, sans toucher les structures).
   - Où : nouvelle unité `minechimique` (`cloaked`, sans attaque, `lifetime` aucun) ; capacité de pose ; déclenchement dans la boucle de `world.ts` ; stock par unité, comme `charged` ou un nouveau compteur.
   - Difficulté : moyenne.
6. **Acide dissolvant en capacité active**, à la place du bonus passif.
   - Référence : Fiche 400 sur un bâtiment, portée 5, 100 énergie ; Mod 100 énergie, portée 5.
   - Où : `castAt` sur le bâtiment le plus proche, comme `gel` (`abilities.ts:202`).
   - Difficulté : faible. À trancher : voir Décisions.
7. **Régénérant / Ferveur en zone.**
   - Référence : Notice (« ses troupes ») ; Fiche zone 4 ; Mod Ferveur (mort à la fin).
   - Où : `abilities.ts:342`, remplacer `near(...)[0]` par la boucle sur `near(...)`.
   - Difficulté : faible.
8. **Fortin et Scarabée.**
   - Ce qui manque : sorts depuis l'intérieur (Notice l. 97 ; Mod `Bonus1porte`) ; -50 % de PV des passagers quand l'abri tombe (Fiche) ; 3 places pour le Scarabée (Fiche ; le jeu en a 4, voir Décisions).
   - Où : `commands.ts:37` (unités à l'intérieur exclues), `buildings.ts:283` (`leave`).
   - Difficulté : faible pour les PV, moyenne pour les sorts (sélection des passagers).
9. **Mode aérien du Pégase.**
   - Ce qui manque : plus de vitesse et de vue, une cadence moindre (Notice). Aucune valeur chiffrée dans la Fiche ni le Mod pour ces écarts (`Canonpgasearien` a les mêmes 72 dégâts que le canon au sol).
   - Où : `combat.ts:118` et la vitesse de base.
   - Difficulté : faible, mais **sans chiffres** : à faire fixer par l'équilibreur.
10. **Trébuchet incendiaire.**
    - Ce qui manque : des dégâts durables sur les bâtiments touchés (Notice l. 74). Pas de chiffre : la Fiche laisse l'effet vide.
    - Où : réutiliser `poison` sur les bâtiments (`combat.ts:222`).
    - Difficulté : faible, chiffres à fixer.
11. **Splash de la Tour alchimistique.**
    - Référence : Notice l. 106. Pas de rayon dans la Fiche ; le Mod `Roquettedesoude` n'a pas d'`AreaArray`.
    - Où : `splash` dans `balance.json`.
    - Difficulté : très faible, rayon à fixer.
12. **Entrepôts.**
    - Référence : Fiche, 300/150 en 50 s, +2 par Grenier. Absente de la Notice.
    - Où : recherche au Marché ; logistique dans le calcul de `supply`.
    - Difficulté : faible.
13. **Bourdon qui hélitreuille un véhicule.**
    - Référence : Notice l. 168, « voire ». Aucun chiffre.
    - Où : `boards` (`buildings.ts:151`).
    - Difficulté : faible, règle à fixer.
14. **IA.**
    - Ce qui manque :
      - pas de Métallurgie, donc ni véhicules ni recherches de véhicules ;
      - recherches jamais lancées : `chargenapalm`, `cocktail`, `dressageallosaures`, `observation`, `trebuchet`, `canonsscies`, `cuirasse`, `scieassaut`, `lamesempoisonnees`, `skin*`, `vehicles*` ;
      - Réanimation jamais lancée ;
      - l'Observation est tentée sans la recherche.
    - Où : `balance.json` `ai.research.humains` et `ai.extra.humains` ; un cas `reanimation` dans `ai.ts:~879`.
    - Difficulté : faible à moyenne, mais touche à l'équilibre : demande de la session principale requise.

### Décisions possibles

Les écarts de chiffres relèvent de l'équilibreur (balance owner). Je n'en propose pas de nouveaux, je signale seulement les contradictions.

| Sujet | Notice | Fiche 2010 | Mod 1.53 | Jeu | Recommandation |
|---|---|---|---|---|---|
| Bourdon et Dirigeable | une unité : détecteur, attaque, transport après recherche | deux unités : Bourdon (attaque) et Dirigeable (transport, détection) | Dirigeable d'appui seul, sans arme | une unité (Notice) | Garder la Notice (priorité 1) |
| Guilde alchimistique | absente | requise par le Soigneur, l'Alchimisterie et la Tour | présente | absente | Garder l'absence (Notice) ; décider si le Soigneur doit attendre un bâtiment (Forge ou Alchimisterie) |
| Placement des recherches (Peau épaisse, Lames, Trébuchet, Décollage…) | Forge, Créaturium, Métallurgie | Guilde des dresseurs-marchands, Guilde métallurgique | – | Notice | Garder |
| Grand Conseil | réduit la production, unique | 25 % ; prérequis Créaturium + Machinerie + Alchimisterie | Conseil volant (unité), rayon 10, +25 % | 10 % ; prérequis Forge | Prérequis et pourcentage à trancher ; la Fiche est la seule à donner des chiffres |
| Caserne volante | amélioration | capacité de base, vitesse 1,4 | `Barraquementflying` de base | mutation payante, Marché requis, vitesse 1,2 | Notice (amélioration) : garder, mais le prérequis du Marché n'a pas de source |
| Plésiosaure contre l'air | sol seul, vulnérable à l'air | sol et air | – | sol seul | Garder la Notice |
| Festin | cadavres proches | effet manquant (copié de Minage) | dévore une unité vivante | – | Notice (cadavres), avec la recharge de 60 s et les 50 % du Mod comme chiffres de départ |
| Acide anti-structure | « dissoudre un bâtiment » (capacité) | capacité, 400 dégâts | capacité, 100 énergie | bonus passif | Revenir à la capacité active (deux références d'accord) |
| Ferveur / Régénérant | zone, invincible puis mort presque sûre | zone 4, 20 % des dégâts, -80 % de la vie maximale | zone, mort | une cible, 1 PV | Zone (trois références d'accord) ; effet final à trancher entre 1 PV, -80 % et la mort |
| Places du Scarabée | 4 types d'unités nommés, sans nombre | 3 | – | 4 | Fiche (3), seule chiffrée |
| Stimulant (Auxiliaire), Charge (Légionnaire) | absents | absents | absents | présents | À confirmer par l'utilisateur : capacités inventées |
| Prérequis des niveaux 2 et 3 (2 Casernes, Tour) | absents | absents | absents | présents | À confirmer : ajout du jeu |
| Taux du Marché | « peu avantageux » | 1/3 | – | 1/2 | Chiffre pour l'équilibreur |
| Écarts de chiffres (poison 3/s pendant 5 s contre 5/s pendant 11 s ; Explosif 3/s contre 37/s ; Réanimation 30 s contre 75 s ; Napalm 60 contre 150 ; Mine 600 et -4 contre 200 et 0 ; Croissance +10 % contre +5 PV ; Char lourd ; Scie d'assaut ; coûts de Blindage et de Peau épaisse) | – | valeurs Fiche | valeurs Mod | valeurs jeu | Liste à transmettre à l'équilibreur, sans retouche de notre part |

Non vérifié : aucun test lancé ; l'accessibilité vient de la lecture du code (HUD générique, `lacks` / `needs`, IA). L'arbre technologique de la Notice (l. 700-760) est vide après conversion.

## Isdaris

Audit en lecture seule, worktree `friendly-agnesi-a574dc` (version 0.9.66). Sources : notice 2009 (`notice.txt`, lignes 170-309 pour le camp, 638-646 pour les points forts et faibles), fiche de 2010 (`fiche-Isdaris.txt`), mod SC2 XC 1.53 (`AbilData.xml`, `BehaviorData.xml`, `UnitData.xml`, `EffectData.xml`, `GameStrings.txt`), `docs/fiches-2010-comparaison.md` et `BALANCE.md`. Les lignes 750-780 de la notice (arbres technologiques) sont vides dans la conversion : ce sont des images.

Pour savoir si un élément est accessible, on a suivi les chemins du code.
- Le HUD est générique (`src/game/hud-card.ts`). Il affiche un bouton par capacité d'unité (l. 119-127), par capacité de bâtiment (l. 203-208), par transformation (`morphs`, l. 227) et par recherche (`researches`, l. 240).
- Les prérequis sont vérifiés côté simulation par `needs` et `lacks`.
- Le menu de construction vient de `FACTIONS.isdaris.buildable` (`src/data.ts`, vers la l. 945).

Tout élément déclaré dans `data.ts` avec un hôte est donc jouable par un humain. Les colonnes « IA » qui suivent viennent de la lecture de `src/ai/ai.ts` et de `balance.json > ai`.

Rappel : les chiffres d'équilibrage appartiennent à l'équilibreur. Ce rapport les signale sans proposer de les changer.

### Unités

| Unité (notice) | Clé | Statut | Référence | Code | Accessible ? | IA |
|---|---|---|---|---|---|---|
| Robot moissonneur | `moissonneur` | implémenté autrement | « incapable de construire ou réparer » ; une balise permet de matérialiser obélisque et récepteur (notice l. 177) | `src/data.ts:507`, matérialisation `src/sim/world.ts:804-843` | Oui, à l'Obélisque. Il ne répare rien : seul le drone Z répare (`src/sim/commands.ts:313`). En revanche, il matérialise **tous** les bâtiments, pas seulement l'Obélisque et le Récepteur. | Oui |
| Créature | `creature` | implémenté et fonctionnel | rapide, se régénère vite, s'enfouit (l. 180) | `src/data.ts:509`, `regen: 3` dans `balance.json`, enfouissement `src/sim/abilities.ts:67`, sortie du sol `src/sim/world.ts:737-747` | Oui (Portail) | L'IA la forme, mais n'utilise jamais l'Enfouissement (absent de `tactics`, `src/ai/ai.ts:855-900`) |
| Archer | `archer` | implémenté et fonctionnel | fusil à plasma et bouclier psychique (l. 183) | `src/data.ts:508` | Oui (Portail) | Oui |
| Assassin | `assassin` | partiel | invisible, épée, grand bouclier, Choc mental, **danse du soldat** (l. 186) | `src/data.ts:512` (`cloaked`, `requires: { autel: 1 }`) | Oui, après l'Autel | **Non** : l'IA ne recherche jamais l'Autel (`ai.research.isdaris`, `EXTENSIONS` à `src/ai/ai.ts:63`), donc son poids de 1 dans `ai.army` ne sert à rien |
| Druide | `druide` | partiel | double énergétique, déflagration, silence ; « la plus vaste réserve d'énergie psychique » (l. 189) | `src/data.ts:510` ; capacités `src/sim/abilities.ts:233-245` | Oui, après le Laboratoire | Oui. L'IA lance Double, Déflagration et Silence (`src/ai/ai.ts:870-886`). |
| Porte-disques (Chasseur Discobole) | `discobole` | partiel | disques « redoutablement efficaces au sol ou en l'air » ; courte téléportation ; lévite au-dessus de l'eau (l. 192) | `src/data.ts:546` ; dans `balance.json`, `attack.air: false` | Oui (Assembleur inférieur) | Oui. L'IA le téléporte quand il est blessé (`src/ai/ai.ts:893`). |
| Baliste plasma | `baliste` | implémenté et fonctionnel | Feu circulaire, puis canon à très longue portée après recherche (l. 195) | `src/data.ts:548` ; Feu circulaire `src/sim/abilities.ts:70` ; portée `src/sim/combat.ts:86` | Oui (Assembleur inférieur, recherches Totem et Autel) | Oui : Feu circulaire si au moins 3 ennemis. Canon lourd jamais recherché. |
| Espion | `espion` | implémenté et fonctionnel | éclaireur volant sans arme, détecteur, couloir entre deux Espions, visée du canon orbital (l. 198) | `src/data.ts:550` (`detector: 9`) ; couloir `src/sim/abilities.ts:76-80` ; visée `src/sim/commands.ts:285-289` | Oui (Balise ; Couloir au Totem) | **Non** : l'IA ne forme que des unités armées (`src/ai/ai.ts:444`) |
| Chimère | `chimere` | implémenté et fonctionnel | chasseur air et sol, téléportation (l. 201) | `src/data.ts:559` | Oui (Balise) | Oui |
| Dragon | `dragon` | implémenté et fonctionnel | air contre air seulement, longue portée, téléportation (l. 204) | `src/data.ts:552` (`ground: false`, `requires: { balise, pyramide }`) | Oui, après Balise et Pyramide (testé : `isdaris-tree.test.ts:18`) | **Non** : la Pyramide n'est jamais recherchée par l'IA |
| Voyageur | `voyageur` | implémenté et fonctionnel | détection, recharge des boucliers, Manteau, téléportation de groupe, Sphère de renvoi (l. 207) | `src/data.ts:554` (`detector: 10`, `shieldAura: 5`) ; capacités `src/sim/abilities.ts:72, 331-339` | Oui (Totem) | **Non** : pas d'arme, donc jamais formé |
| Béhémoth | `behemoth` | implémenté et fonctionnel | forteresse volante, bouclier de bâtiment, déphasage (l. 210) | `src/data.ts:556` (`requires: { balise, trone }`) ; Déphasage `src/sim/abilities.ts:74`, invulnérable `src/sim/combat.ts:206`, sans attaque `src/sim/combat.ts:351` | Oui (Balise et Trône) | **Non** : l'IA ne construit jamais le Trône (`ai.extra.isdaris` ne contient que `orbecommandement`) |
| Drone protecteur (fiche et mod seulement) | absent | manquant | fiche : 100/100, 50 PV, 25 de bouclier, zone de 4, −1 dégât par coup ; mod `Protecteur` : 100/100, 50/50, comportement `Bouclierdeprotection` (dégâts ×0,9, hors sorts et zones) | — | — | — |

### Bâtiments et extensions

| Élément (notice) | Clé | Statut | Référence | Code | Accessible ? | IA |
|---|---|---|---|---|---|---|
| Obélisque | `obelisque` | partiel | dépôt, robots, relais du faisceau de **construction** ; peut construire un autre obélisque ; matérialisable dans la vue d'un robot ; **bouclier de plasma, invulnérable un temps** (l. 215) | `src/data.ts:513` (`power: 9`, `dropoff`, `warp`, capacité `rappel` empruntée au Prisme du mod) | Oui | Oui. Le Rappel est utilisé (`src/ai/ai.ts:696`). |
| Récepteur, et sa tour intégrée (Récepteur armé) | `recepteur`, `recepteurarme` | partiel | sur un puits ; matérialisable dans la vue d'un robot, « cela augmentera son coût » ; tour « pour une somme relativement modique » (l. 218) | `src/data.ts:525-527`. La transformation coûte le prix plein du Récepteur armé (600 minerais). Aucun surcoût hors du champ d'énergie. | Oui | Oui. La transformation en Récepteur armé arrive après la minute 6 (`src/ai/ai.ts:404-415`). |
| Émetteur | `emetteur` | implémenté et fonctionnel | élargit la zone de construction (l. 221) | `src/data.ts:514` (`power: 7`) ; il doit rejoindre le réseau (`src/sim/buildings.ts:22-24`) | Oui (testé : `isdaris.test.ts:40`) | Oui |
| Déflecteur | `deflecteur` | implémenté et fonctionnel | aura qui rend invisibles l'infanterie et les véhicules alliés (l. 221) | `src/data.ts:516` (`cloakAura: 6`) ; voile `src/sim/world.ts:474-485` | Oui, en transformant un Émetteur, après l'Orbe de commandement | Rarement : `morph` choisit le Pylône en premier (`src/ai/ai.ts:405`) |
| Pylône (Pylône sanglant) | `pylonesanglant` | implémenté et fonctionnel | défense plasma à très longue portée (l. 221) | `src/data.ts:519`. Le commentaire (« Orbe de commandement absent ») est périmé : `requires` vise bien l'Orbe. | Oui (testé : `defenses.test.ts:20`) | Oui |
| Réserve psy | `reservepsy` | implémenté et fonctionnel | logistique ; recharge vite les boucliers des unités proches (l. 224) | `src/data.ts:520` (`supply: 12`, `shieldAura: 5`) ; recharge `src/sim/combat.ts:222-246` (×4 près d'une aura) | Oui | Oui |
| Portail | `portail` | partiel | infanterie, 3 extensions, **bouclier de plasma, invulnérable un temps** (l. 228) | `src/data.ts:521-524` | Oui | Oui |
| Miniportail | `miniportail` | implémenté autrement | notice : « bâtiment de production secondaire » ; fiche : l'annexe forme les mêmes unités | `src/data.ts:561` ; +25 % de vitesse au Portail (`src/sim/buildings.ts:168`) | Oui | Oui (recherché) |
| Cuve génétique | `cuvegenetique` | implémenté et fonctionnel | créatures supplémentaires ; fiche : duplication | `src/sim/buildings.ts:255-258` (une seconde Créature) | Oui (testé : `isdaris-tree.test.ts:28`) | **Non**, absente de la liste de recherche de l'IA |
| Laboratoire | `laboratoire` | implémenté et fonctionnel | Druides et recherches d'infanterie | `src/data.ts:563` | Oui | Oui |
| Orbe plasma | `orbe` | partiel | défense « capable de se déplacer lentement », détection (l. 236) | `src/data.ts:529` (bâtiment fixe, `detector: 8`) | Oui | Oui |
| Psycho-assembleur | `nanoassembleur` | partiel | véhicules, 3 extensions, **bouclier de plasma** (l. 239) | `src/data.ts:531-534` | Oui | Oui (minute 12, 3 Portails) |
| Assembleur inférieur / Balise / Totem | `assembleur`, `balise`, `totem` | implémenté et fonctionnel | véhicules terrestres, aériens ; Voyageurs et recherches (l. 241-243) | `src/data.ts:569-571` | Oui | Assembleur et Balise oui (`EXTENSIONS`) ; le Totem par `ai.research` |
| Orbe de commandement | `orbecommandement` | implémenté et fonctionnel | meilleurs guerriers et véhicules, boucliers, 3 extensions (l. 246) | `src/data.ts:536-539` | Oui | Construite à la minute 12 (`ai.extra`), mais seules ses recherches `bouclier1-3` sont faites |
| Autel / Pyramide / Observatoire | `autel`, `pyramide`, `observatoire` | implémenté et fonctionnel | l. 247-249 | `src/data.ts:578-580` ; capacité `observatoire` `src/sim/commands.ts:284` | Oui | **Non** pour les trois |
| Trône d'Altar Sargon | `trone` | partiel | requis pour les Béhémoths ; 3 extensions ; « peut également devenir invincible pendant un court laps de temps » (l. 254) ; fiche : bâtiment unique | `src/data.ts:541-544` (pas de `unique`) | Oui | **Non**, jamais construit |
| Relais de canon orbital | `relais`, capacité `canonorbital` | partiel | frappe n'importe quel point, visé d'abord par un Espion (l. 255) | `src/sim/commands.ts:285-289` (l'Espion doit voir la cible). L'effet est **instantané** : ni délai ni alerte. | Oui (testé : `isdaris-tree.test.ts:68`) | Non |
| Porte de déphasage | `porte`, capacité `portedephasage` | partiel | déphase un groupe n'importe où, **puis peut le téléporter** n'importe où (l. 256) | `src/sim/commands.ts:292` : le déphasage seul | Oui | Non |
| Concentrateur énergétique | `concentrateur`, capacité `murenergie` | implémenté et fonctionnel | mur infranchissable n'importe où (l. 257) | `src/sim/abilities.ts:384` ; `src/sim/commands.ts:291` | Oui (testé : `notice-extras.test.ts:26`) | Non |
| Détecteur, Générateur de bouclier (fiche) | absents | manquant (fiche seulement) | l'Œil de plasma du Détecteur correspond à l'Observatoire ; le Générateur donne « Bouclier énergétique » (mod : `Bouclierdesurface`) | — | — | — |

### Capacités

| Capacité | Lanceur | Statut | Référence | Code | Écart |
|---|---|---|---|---|---|
| Enfouissement | Créature | implémenté et fonctionnel | notice l. 180 et 263 | `src/sim/abilities.ts:67`, `src/sim/world.ts:737` | — |
| Choc mental | Assassin | implémenté et fonctionnel | notice l. 186 et 277 ; mod 5 s, recharge 35, portée 5 ; fiche 10 s, 40, 5, bâtiments compris | `src/sim/abilities.ts:229-232` (`held` sur une unité) | Aucun effet sur les bâtiments (fiche seulement) |
| Danse du soldat | Assassin | **manquant** | notice l. 186 : « éviter, de façon permanente, une importante partie des attaques » ; fiche : esquive 33 % ; mod `Dansedusoldat` : dégâts ×0,67 contre les tirs à distance | aucune trace dans `src/` | Absent |
| Double énergétique | Druide | partiel | notice l. 189 : « double énergétique parfait » ; fiche « Hallucination » : ne peut pas attaquer, mêmes PV, 75 s, 60 d'énergie ; mod `Hallucinationdruidique` : 60 d'énergie | `src/sim/abilities.ts:233-237` : copie complète qui **attaque**, 30 s | La copie se bat |
| Déflagration | Druide | implémenté et fonctionnel | notice l. 189 et 264 | `src/sim/abilities.ts:238-243` | — |
| Silence des ions | Druide | implémenté et fonctionnel | notice l. 189 et 265 ; fiche : ennemis seulement ; mod : drain d'énergie | `src/sim/abilities.ts:244`, contrôle `silenced` l. 59, 193 et `commands.ts:278` | Bloque aussi les alliés : suit la notice (« toute capacité ») |
| Téléportation courte | Porte-disques, Chimère, Dragon | implémenté et fonctionnel | notice l. 192, 201, 204 ; mod `Tlportationcourte` : recharge 26 | `src/sim/abilities.ts:329`, Téléportation rapide l. 361 | Aucune recherche requise (la fiche en demande une) |
| Feu circulaire | Baliste | implémenté et fonctionnel | notice l. 195 et 272 | `src/sim/abilities.ts:70` | — |
| Canon plasma lourd | Baliste (passif) | implémenté et fonctionnel | notice l. 195 et 289 ; fiche : « Dislocation plasmique » active, 155 dégâts, portée 16, recharge 55 | `src/sim/combat.ts:86` (+6 de portée) | Lecture « tir à volonté » de la notice |
| Couloir temporel | Espion | implémenté et fonctionnel | notice l. 198 et 273 ; fiche : 100 d'énergie, zone 5, 8 de logistique au plus | `src/sim/abilities.ts:76-80` (`max: 8` unités, terrestres seulement) | Plafond en unités, pas en logistique |
| Visée laser | Espion | implémenté et fonctionnel | notice l. 198 | `src/sim/commands.ts:288` | — |
| Ciblage (fiche et mod) | Prisme / Espion | manquant (hors notice) | fiche : 75 d'énergie, portée 6, +10 % de dégâts reçus pendant 20 s ; mod `Ciblage` identique | — | Absent |
| Recharge des boucliers | Voyageur, Réserve psy | implémenté autrement | notice l. 207 et 224 ; mod : capacité automatique, 10 d'énergie, portée 3 | aura passive (`shieldAura`), `src/sim/combat.ts:228` | Aura passive au lieu d'un sort automatique |
| Manteau | Voyageur | partiel (chiffres) | notice l. 207 : « pendant une longue période » ; fiche et mod : 75 s, 75 d'énergie, zone 4 | `src/sim/abilities.ts:72` (`camo`, 20 s) | Dure 20 s au lieu de 75 (à l'équilibreur) |
| Téléportation de groupe | Voyageur | implémenté et fonctionnel | notice l. 207 et 270 ; fiche « Retour » : 100 d'énergie, zone 3, recharge 25 | `src/sim/abilities.ts:331-335` | — |
| Sphère de renvoi | Voyageur | partiel | notice l. 207 et 291 ; fiche : la moitié est renvoyée et l'autre subie, 40 s, plafond 300 ; mod : `ModifyFraction 0.5`, 40 s, 150 d'énergie, recharge 75 | `src/sim/abilities.ts:336-339` ; `src/sim/combat.ts:446` (30 % renvoyés, dégâts subis en entier, 15 s) | L'unité protégée subit tout ; pas de plafond |
| Module déphasant | Béhémoth | implémenté et fonctionnel | notice l. 210 et 290 ; fiche et mod : 10 s, recharge 90 | `src/sim/abilities.ts:74` (6 s, recharge 40) | Chiffres à l'équilibreur |
| Bouclier de plasma (invulnérabilité temporaire) | bâtiments majeurs, Trône | **manquant** | notice l. 215 (« comme chaque bâtiment majeur isdaris »), l. 228, 239, 254 ; fiche « Déphasage » de l'Obélisque : un bâtiment allié invulnérable, sans production ni attaque, 20 s, recharge 90 ; mod `dphasagemassif` sur l'Obélisque : 10 s, recharge 90, portée illimitée, bloque attaque, recherche et production | — | Absent |
| Observatoire (Œil de plasma) | Orbe de commandement | implémenté et fonctionnel | notice l. 249 ; fiche : zone 8, 9 s, recharge 29, détecte ; mod : recharge 26 | `src/sim/commands.ts:284` ; balayage avec détection `src/sim/world.ts:490` | — |
| Canon orbital | Trône | partiel | notice l. 255 ; fiche : 599 dégâts, alerte puis frappe à 5 s, recharge 300 ; mod `Tirdeplasma` : 600 dégâts, rayon 1,5, 300 d'énergie, 6 s d'incantation | `src/sim/commands.ts:285-289` (300 dégâts, rayon 2,5, instantané) | Ni délai ni alerte à l'adversaire |
| Porte de déphasage | Trône | partiel | notice l. 256 ; fiche « Transfert groupé » : zone 6, recharge 300 ; mod `Transfertgroup` : 300 d'énergie | `src/sim/commands.ts:292` | Pas de seconde étape (la téléportation) |
| Mur d'énergie | Trône | implémenté et fonctionnel | notice l. 257 ; fiche et mod : Druide, 75 d'énergie, zone 3, 15 s | `src/sim/abilities.ts:384` | Lanceur différent selon la source |
| Redéploiement / mobilité de l'Orbe | Orbe plasma | **manquant** | notice l. 236 : « capable de se déplacer lentement » ; fiche « Redéploiement » : 50 minerais, recharge 35, réapparaît 35 s plus tard dans un champ, sans tirer pendant le transfert ; mod `redploiement` : recharge 36, comportement de 35 s | — | Absent |
| Bouclier énergétique / de surface (fiche et mod) | Trône | manquant (hors notice) | fiche : zone 10, régénération ×5 pendant 25 s, recharge 300 ; mod `Bouclierdesurface` : 300 d'énergie, rayon 10, 25 s, +2,5 bouclier/s | — | Absent |
| Rappel | Obélisque | ajout du jeu | vient du Prisme du mod (`Rappel`, 100 d'énergie, 8 unités) ; absent de la notice | `src/sim/abilities.ts:8-49` | Ajout cohérent, utilisé par l'IA |

### Recherches

Toutes les recherches de la notice existent. Elles sont toutes exposées par le HUD sur leur bâtiment hôte, avec l'extension comme prérequis (`src/data.ts:561-593`).

| Recherche (notice) | Clé | Hôte / prérequis | Effet en jeu | Statut | IA |
|---|---|---|---|---|---|
| Attaque portail ×3 | `portailatk1-3` | Portail / Laboratoire | +10 % par niveau (`src/sim/combat.ts:19`) | implémenté et fonctionnel | Oui |
| Blindage portail ×3 | `portailarmor1-3` | Portail / Laboratoire | +1 d'armure (`src/sim/combat.ts:47`) | implémenté et fonctionnel | Oui |
| Enfouissement | `enfouissement` | Portail / Laboratoire | débloque la capacité | implémenté et fonctionnel | Recherchée, jamais utilisée |
| Déflagration | `deflagration` | Portail / Laboratoire | débloque la capacité | implémenté et fonctionnel | Oui |
| Silence des ions | `silence` | Portail / Laboratoire | débloque la capacité | implémenté et fonctionnel | Non recherchée : la capacité n'est jamais lancée par l'IA (`ai.ts:865` saute les capacités non recherchées) |
| Attaque assembleur ×3 | `assembleuratk1-3` | Psycho-assembleur / Totem | +10 % pour les machines | implémenté et fonctionnel | Niveau 1 seulement |
| Blindage assembleur ×3 | `assembleurarmor1-3` | Psycho-assembleur / Totem | +1 d'armure | implémenté et fonctionnel | Niveau 1 seulement |
| Téléportation (Voyageur) | `teleportation` | Psycho-assembleur / Totem | `teleportgroupe` | implémenté et fonctionnel | Non |
| Manteau | `manteau` | Psycho-assembleur / Totem | débloque la capacité | implémenté et fonctionnel | Non |
| Feu circulaire | `feucirculaire` | Psycho-assembleur / Totem | débloque la capacité | implémenté et fonctionnel | Oui |
| Couloir temporel | `couloir` | Psycho-assembleur / Totem | débloque la capacité | implémenté et fonctionnel | Non |
| Bouclier psychique ×3 | `bouclier1-3` | Orbe de commandement | +1 bouclier/s en recharge (`src/sim/combat.ts:228`) | implémenté et fonctionnel (fiche : +1 d'armure de bouclier, 2 niveaux) | Oui |
| Robots améliorés | `robots` | Orbe de commandement | +1 attaque, +1 armure (fiche : +2) | implémenté et fonctionnel | Non |
| Cercle d'énergie ×2 | `cercle1-2` | Orbe de commandement | +25 % de bouclier pour les 5 bâtiments majeurs (`src/sim/combat.ts:28`) | implémenté et fonctionnel (fiche : +500 aux Obélisques et transferts plus rapides) | Non |
| Choc mental | `chocmental` | Orbe / Pyramide | débloque la capacité | implémenté et fonctionnel | Non |
| Boost génétique | `boostgenetique` | Orbe / Pyramide | +20 % de PV, de vitesse et de cadence (`src/sim/combat.ts:37, 355`) | implémenté et fonctionnel | Non |
| Téléportation rapide | `teleportrapide` | Orbe / Autel | recharge −50 % | implémenté et fonctionnel | Non |
| Canon plasma lourd | `canonlourd` | Orbe / Autel | +6 de portée | implémenté et fonctionnel | Non |
| Module déphasant | `dephasage` | Orbe / Autel | débloque la capacité | implémenté et fonctionnel | Non |
| Sphère de renvoi | `renvoi` | Orbe / Autel | débloque la capacité | implémenté et fonctionnel | Non |
| Omniscience | `omniscience` | Orbe / Autel | +6 de vue pour l'Espion (`src/sim/world.ts:458` ; fiche : +2) | implémenté et fonctionnel | Non |
| Course, Vitesse créature, Noyau d'énergie, Hallucination, Attaque de singularité, Disque tournoyant (fiche) | absentes | — | — | manquant (fiche seulement) | — |

### Mécaniques

| Mécanique | Statut | Référence | Code | Remarque |
|---|---|---|---|---|
| Champ d'énergie (Obélisque, Émetteur) | implémenté et fonctionnel | notice l. 215 et 221 ; mod `fournisseurdnergie` rayon 10 ; fiche zone 15 | `src/sim/buildings.ts:22-24, 76-85` ; `power` 9 et 7 | Testé (`isdaris.test.ts:24, 40`) |
| Matérialisation orbitale | implémenté autrement | notice l. 177 et 215 : l'Obélisque construit les bâtiments, le robot sert de balise pour l'Obélisque et le Récepteur ; mod : `Oblisqueisdaristransfert` (l'Obélisque bâtit tout, avec une recharge par bâtiment : 60, 15, 20, 12,5, 30 s…), `Droneconstruction` (le robot ne bâtit que l'Obélisque) ; fiche : surcoût de 33 % pour un bâtiment posé par un robot | `src/sim/world.ts:804-843` (le robot doit être à 6 cases au plus, `WARP_RANGE`, `world.ts:277`, alors que la notice parle de son champ de vision, 8 cases) | Le robot pose tout ; l'Obélisque ne pose rien ; pas de surcoût ; pas de recharge entre deux transferts |
| Transfert d'unités dans le champ (fiche, mod `TransfertPortail*` / `CAbilWarpTrain`) | manquant (hors notice) | fiche « Transfert d'unité » ; mod `Transfertisdarisencours` | — | Les unités sortent du bâtiment |
| Bouclier psychique | implémenté et fonctionnel | notice l. 183 et 638-646 | `src/sim/combat.ts:203-231` (le bouclier absorbe d'abord, se recharge 7 s après le dernier coup) | Testé (`isdaris.test.ts:66`) |
| Dissimulation | implémenté et fonctionnel | Assassin, Déflecteur, Manteau, Enfouissement | `src/sim/abilities.ts:444` (`hidden`) | — |
| Détection | implémenté et fonctionnel | Orbe plasma, Espion, Voyageur, Observatoire | `src/sim/world.ts:486-495` | — |
| Pas de réparation | implémenté et fonctionnel | notice l. 177 ; fiche « réparation impossible » | `src/sim/commands.ts:313` (seuls les drones Z réparent) | — |
| Coût en énergie des unités (point faible) | implémenté et fonctionnel | notice l. 646 | `balance.json` | — |
| Énergie propre aux lanceurs de sorts | implémenté autrement | fiche et mod : énergie par unité (Druide 150, Prisme 150, Voyageur 200) | le jeu remplace l'énergie par des recharges (`AbilityDef.cooldown`) ; les capacités de bâtiment puisent dans la réserve du joueur | Choix commun aux camps |
| Lévitation au-dessus de l'eau | sans objet | notice l. 192 | la grille n'a pas d'eau | — |

### Manques à combler

1. **Danse du soldat (Assassin).**
   - Référence : notice l. 186 ; fiche « Danse du soldat », esquive 33 % ; mod `BehaviorData.xml:369`, `DamageResponse ModifyFraction="0.67"` hors sorts, corps à corps et zones (donc contre les tirs à distance).
   - Chiffres disponibles : 0,67 (mod) ou 33 % (fiche). La simulation ne tire pas au hasard : la réduction du mod est la forme qui convient.
   - Où : `hurt` ou `hit` dans `src/sim/combat.ts` (vers les l. 203 et 440), avec un champ dans `UnitDef` ou une règle dans `balance.json`.
   - Difficulté : faible.
2. **Bouclier de plasma, invulnérabilité temporaire des bâtiments majeurs (et du Trône).**
   - Référence : notice l. 215, 228, 239, 254 ; fiche « Déphasage » de l'Obélisque (20 s, recharge 90) ; mod `dphasagemassif` sur l'Obélisque (10 s, recharge 90, portée illimitée, bloque attaque, recherche et production).
   - La notice ne précise pas le lanceur. La fiche et le mod concordent : un sort de l'Obélisque sur n'importe quel bâtiment allié.
   - Où : une capacité de bâtiment dans `src/sim/commands.ts:271-296`. On peut réutiliser `phased`, que `hurt` ignore déjà (`combat.ts:206`), et l'étendre aux bâtiments : pas d'attaque (`combat.ts:351`), production gelée (`world.ts:723`).
   - Difficulté : faible à moyenne.
3. **Orbe plasma mobile (Redéploiement).**
   - Référence : notice l. 236 ; fiche : 50 minerais, recharge 35, transfert de 35 s pendant lequel l'orbe est vulnérable et ne tire pas ; mod `redploiement` (recharge 36) et `Redploiementencourtdetransfert` (35 s).
   - La notice dit « se déplacer lentement ». La fiche et le mod en font une téléportation lente dans le champ d'énergie.
   - Où : une capacité de bâtiment pointée, sur le modèle de `atterrissage` et `transmute` (`src/sim/abilities.ts:212`), avec une vérification `canPlace`.
   - Difficulté : moyenne.
4. **Seconde étape de la Porte de déphasage (téléporter le groupe déphasé).**
   - Référence : notice l. 256 ; fiche « Transfert groupé » (zone 6, recharge 300) ; mod `Transfertgroup` (300 d'énergie).
   - Où : `src/sim/commands.ts:292`. Il faut garder la liste des unités déphasées, puis ajouter un second ordre pointé qui les place avec `place`, à la façon de `teleportgroupe` (`abilities.ts:331`).
   - Difficulté : moyenne, car il faut un état et un bouton de second temps.
5. **Délai et alerte du Canon orbital.**
   - Référence : fiche (frappe 5 s après le lancement, joueurs prévenus) ; mod (`CastIntroTime` 6 s).
   - Où : une file de frappes différées dans `World`, comme `recalls`, et un `say` à l'adversaire.
   - Difficulté : faible à moyenne.
6. **Double énergétique qui n'attaque pas.**
   - Référence : fiche « Hallucination » (pas d'attaque, mêmes PV, 75 s) ; mod `Hallucinationdruidique` (illusion).
   - La notice est ambiguë (« double énergétique parfait »).
   - Où : `src/sim/abilities.ts:233-237`, en marquant la copie (par exemple `phased`-like sans invulnérabilité, ou un drapeau `illusion` lu dans `combat.ts:351`).
   - Difficulté : faible.
7. **Sphère de renvoi : partage des dégâts et plafond.**
   - Référence : fiche (moitié renvoyée, moitié subie, 40 s ou 300 points renvoyés) ; mod (`ModifyFraction 0.5`, 40 s).
   - Où : `src/sim/combat.ts:446`, avec un compteur sur l'entité. Les chiffres restent à l'équilibreur.
   - Difficulté : faible.
8. **Matérialisation à la manière de la notice.**
   - Le constat : l'Obélisque devrait poser les bâtiments, avec une recharge ; le robot ne poserait que l'Obélisque et le Récepteur, avec un surcoût.
   - Référence : notice l. 177, 215, 218 ; fiche « Transfert de bâtiment » (recharge = 50 % du temps de construction, ¼ avec Cercle) et « Transfert de bâtiment DM » (+33 %) ; mod `Oblisqueisdaristransfert` (recharges par bâtiment) et `Droneconstruction`.
   - Où : `src/sim/world.ts:804-843`, `FACTIONS.isdaris`, HUD de construction, IA (`src/ai/ai.ts`, poses de bâtiments).
   - Difficulté : élevée, car le modèle de construction de l'IA et du HUD change.
9. **L'IA ne joue pas une grande partie du camp.**
   - Ce qu'elle ne fait jamais : rechercher l'Autel, la Pyramide, l'Observatoire, Cercle, Robots, Cuve génétique, Silence, Manteau, Couloir et la Téléportation du Voyageur ; former Assassin, Dragon, Voyageur, Espion, Béhémoth ; construire le Trône ; utiliser l'Enfouissement, le Couloir, la Téléportation de groupe, l'Observatoire et les sorts du Trône.
   - Référence : `balance.json > ai.research.isdaris`, `ai.extra.isdaris`, `src/ai/ai.ts:63, 444, 855-900`.
   - Difficulté : moyenne. Ce sont des réglages de l'IA, donc à faire avec la session d'équilibrage, sans mesure sans demande.
10. **Trône unique.**
    - Référence : fiche (« Bâtiment unique ») ; la notice dit seulement « cinquième et dernier bâtiment majeur ».
    - Où : `unique: true` dans `src/data.ts:541`.
    - Difficulté : très faible.
11. **Éléments de la fiche et du mod absents de la notice.** Drone protecteur, Ciblage (Espion), Bouclier énergétique (Trône), Transfert d'unités dans le champ, recherches Course, Vitesse créature, Noyau d'énergie, Attaque de singularité.
    - Les chiffres sont complets dans la fiche, et dans le mod pour Protecteur, Ciblage et Bouclier de surface.
    - Ce ne sont pas des manques au regard de la notice. À n'ajouter que sur décision.

### Décisions possibles

1. **Prérequis de l'Assassin et du Dragon.**
   - La notice (l. 247-248) dit que l'Autel donne les Assassins et la Pyramide les Dragons.
   - La fiche dit l'inverse : Guerrier sombre « Portail annexe, Pyramide », Dragon « Balise, Autel ».
   - La notice se contredit elle-même : la présentation de l'Orbe (l. 247) dit que l'Autel donne les recherches d'infanterie, mais la liste des améliorations (l. 282-291) met les recherches d'infanterie sous la Pyramide et celles des véhicules sous l'Autel.
   - Le code suit la notice. Recommandation : la garder.
2. **Qui lance le mur d'énergie ?** La notice le donne au Trône (Concentrateur). La fiche et le mod le donnent au Druide (« Concentration énergétique », 75 d'énergie, zone 3, 15 s, portée 6) ; la fiche donne au Trône un Générateur de bouclier à la place. Le code suit la notice. Recommandation : garder la notice.
3. **Combien d'extensions par bâtiment majeur ?** La notice en permet 3. La fiche en permet 2 sur 3, et l'auteur la présente comme un « gros changement ». Le code en permet 3. Recommandation : garder 3.
4. **Miniportail.** La notice parle d'un bâtiment de production secondaire ; la fiche en fait une annexe qui forme les mêmes unités. Le jeu donne +25 % de vitesse. Recommandation : soit une seconde file de production, plus fidèle, soit garder l'accélération, plus simple. À trancher.
5. **Matérialisation par l'Obélisque ou par le robot** (manque 8). Recommandation : garder le robot comme poseur, pour l'ergonomie, mais ajouter le surcoût hors du champ si la fidélité compte. À trancher.
6. **Porte-disques contre les volants.** La notice et la fiche disent « sol/air ». Le mod ne pose pas de filtre, donc il touche probablement les deux. `balance.json` a `attack.air: false`. C'est une question de stats pour l'équilibreur : la signaler, ne pas y toucher.
7. **Chiffres qui divergent des sources** (à transmettre à l'équilibreur, sans y toucher) :

   | Élément | Jeu | Fiche | Mod |
   |---|---|---|---|
   | Manteau | 20 s | 75 s | 75 s |
   | Module déphasant | 6 s, recharge 40 | 10 s, recharge 90 | 10 s, recharge 90 |
   | Canon orbital | 300 dégâts, recharge 90, 200 d'énergie | 599 dégâts, recharge 300 | 600 dégâts, 300 d'énergie |
   | Sphère de renvoi | 30 %, 15 s | 50 %, 40 s | 50 %, 40 s |
   | Choc mental | 4 s | 10 s | 5 s |
   | Bouclier du Robot moissonneur | 50 | 25 | 25 (`UnitData.xml`, contrairement à ce qu'affirme `BALANCE.md` l. 61) |
   | Transformation en Récepteur armé | 600 minerais (le notice dit « somme relativement modique ») | 200 | — |
   | Omniscience | +6 | +2 | — |
   | Robots améliorés | +1 | +2 | — |
   | Bouclier psychique | +1/s de recharge, 3 niveaux | +1 d'armure de bouclier, 2 niveaux | — |

8. **Téléportation courte sans recherche.** La fiche exige « Téléportation isdaris » au Totem. Dans la notice, la Téléportation du Totem est celle du Voyageur. Le code suit la notice. Recommandation : garder.

Commentaire périmé à corriger hors de cet audit : `src/data.ts:517-518` dit que l'Orbe de commandement n'existe pas encore ; elle existe et sert bien de prérequis.

## Z

Audit fait sur le worktree `friendly-agnesi-a574dc` (HEAD 480dadc, version 0.9.66), en lecture seule. Le camp Z suit déjà `Z.doc` (fiche de 2010) presque entièrement : la branche `claude/z-2010` est fusionnée, il ne lui manque que le modèle 3D de l'Octopode (commit 8b78987, non fusionné, purement visuel).

Références :
- « notice » : notice 2009 convertie (`notice.txt`), camp Z lignes 465 à 584, arbre technologique lignes 1228 à 1300 ;
- « fiche » : `fiche-Z.txt` (Z.doc, 2010), numéros de ligne du fichier texte ;
- code : chemins relatifs au worktree.

Correspondance des noms : le jeu suit la notice pour l'ouvrier (Drone) et le Drone de combat, et la fiche pour l'éclaireur (Espion). Dans la fiche, « Sonde » désigne l'ouvrier ; dans la notice, c'est l'éclaireur. Le Centre de socles de la fiche est l'« Usine » de la notice ; le Centre de recherche de la fiche est son « Centre technique » ; le Centre K de la fiche est le « Centre de kits » de la notice.

Chaîne de prérequis vérifiée dans `src/data.ts` et dans `lacks()` :
- IC, puis Pod ;
- au Pod : Centre de socles, Centre d'armement, Centre de recherche (`requires: { pod: 1 }`) ;
- Intelligence suprême : morph de l'IC, demande le Centre d'armement et le Centre de recherche ;
- Centre d'optimisation : demande l'IS ;
- Centre K : demande le Centre d'optimisation.

Tout est satisfiable. Tous les bâtiments sont dans `FACTIONS.z.buildable` (`src/data.ts:962`). L'IA les construit tous : `ai.extra.z` dans `balance.json`, plus `zNext` (`src/ai/ai.ts:288`) pour l'IS, l'Optimisation et le Centre K.

### Unités

| Élément | Statut | Référence | Code | Accessibilité |
|---|---|---|---|---|
| Drone (ouvrier, absorbé par le bâtiment) | implémenté et fonctionnel | notice 469 ; fiche 599-625 (Sonde : 100, 20 s, 75 PV, 5 dégâts / 2 s) | `src/data.ts:600` ; `balance.json` `units.drone` ; absorption `src/sim/world.ts:836`, `src/sim/buildings.ts:176-190` | Formé à l'IC et à l'IS. Construit tout. L'IA s'en sert. Test `z.test.ts:21`. |
| Réparation par le drone (4 PV/s contre ressources) | implémenté et fonctionnel | fiche 1713-1720 ; notice 469 (bâtiments seulement) | `src/sim/world.ts:846-870` (`rules.z.repairHp` 4, `repairPercent` 25) | Clic droit sur un bâtiment ou une machine Z blessés. Le prix de 25 % est une proposition (la fiche dit seulement « contre ressources »). Test `z.test.ts:184`. |
| Drone de combat | implémenté et fonctionnel | notice 475 ; fiche 698-724 (115, 20 s, 75 PV, 14 dégâts, portée 4) | `src/data.ts:601` ; dégâts 12 (facteur 86 %, mesuré) | Plate-forme, sans recherche (notice : « recherché d'office »). Sans menu d'arme. Armée de l'IA (poids 2). |
| Quadripode T1 à T3 | implémenté et fonctionnel | notice 478 (« deux niveaux ») ; fiche 748-897 | `src/data.ts:602` ; `tiers` dans `balance.json` | Plate-forme après `rquadripode` (Centre de socles). Évolutions `rquadripode2` et `rquadripode3`. L'IA les fabrique et les fait évoluer (`ai.ts:477-485`). |
| Hexapode T1 et T2 | implémenté et fonctionnel | notice 481 ; fiche 898-997 | `src/data.ts:603` | `rhexapode` demande le Centre de recherche (fiche 1897). L'IA le fait. |
| Octopode T1 et T2 | implémenté et fonctionnel (modèle 3D non fusionné) | notice 484 ; fiche 998-1097 (675/375, 69 s, 860 PV, arme N3) | `src/data.ts:607` | `roctopode` demande l'IS et l'Optimisation (fiche 2002). L'IA le fait (poids 1). |
| Coléoptère T1 à T3 | implémenté et fonctionnel | notice 487 ; fiche 1098-1247 | `src/data.ts:604` (sans Canon X-04) | `rcoleoptere` demande l'IS. Arme N3 en T3 : la fiche écrit « Niveau 1 », faute de frappe tranchée par l'utilisateur. |
| Barge T1 et T2 (transport 8 puis 12 de logistique) | implémenté et fonctionnel | notice 490 ; fiche 1248-1347, 1753-1769 | `src/data.ts:609` ; `room()` et `boards()` `src/sim/buildings.ts:141-156` ; `load()` `:386` | Clic droit des unités sur la Barge, bouton « Débarquer » (`hud-card.ts:109-114`). L'IA l'emploie après 14 min (`ai.ts:526-556`). |
| Mastodonte T1 et T2 | implémenté et fonctionnel | notice 493 ; fiche 1348-1447 | `src/data.ts:608` | IS et Optimisation. Armée de l'IA (poids 1). |
| Espion (éclaireur volant, détecteur) | partiel | notice 472 ; fiche 648-674 (énergie 100, régénération 2/s) | `src/data.ts:611` ; `detector: 9` | Formé à l'IC après un Pod. **Énergie remplacée par des recharges** (`BALANCE.md:122`). L'IA en forme un après 8 min (`ai.ts:367`). |

### Bâtiments

| Élément | Statut | Référence | Code | Accessibilité |
|---|---|---|---|---|
| Intelligence centrale (dépôt, creep, drones et espions) | partiel | notice 540 (détection, Refuge) ; fiche 2-28 | `src/data.ts:612` ; `power: 10` | Bâtiment de départ. **Manquent la détection et le Refuge**, que la notice décrit et que la fiche ne reprend pas (voir les manques). |
| Intelligence suprême (morph, production 75 %) | implémenté et fonctionnel | notice 540 (« réduisant de moitié ») ; fiche 51-77, 1658-1665 (75 %) | `src/data.ts:614` ; `trainTime` `src/sim/buildings.ts:171-173` | Bouton « → Intelligence suprême » sur l'IC (`hud-card.ts:227`). L'IA la fait vers 6 min. Test `z.test.ts:66`. |
| Assimilateur | implémenté autrement | notice 543 (25 % dès la construction, 3 drones) ; fiche 101-127 | `src/data.ts:618` ; `energyRate: 2.5`, production passive `src/sim/buildings.ts:204` | L'énergie vient sans drones, comme pour les extracteurs des autres camps : la règle « 25 % puis 3 drones » de la notice n'existe pas. L'arme adaptable est faite (voir Armes). |
| Pod (logistique 15) | implémenté et fonctionnel | notice 546 (génère du creep) ; fiche 151-177 (pas de creep) | `src/data.ts:615` | Le Pod ne génère pas de creep, conformément à la fiche (voir les décisions). L'IA en construit. |
| Pod supérieur (morph, creep, logistique 20) | implémenté et fonctionnel | notice 583 (recherche à 4 niveaux) ; fiche 201-227, 2108-2115 (un seul niveau) | `src/data.ts:616` ; recherche `podsuperieur` `:664` | Morph après la recherche du Centre de recherche. L'IA en fait jusqu'à 3 après 8 min (`ai.ts:414`). |
| Plate-forme (annexe du Pod) | partiel | notice 546-548 (« jusqu'à 3 add-ons ») ; fiche 499-525 | `src/data.ts:619` (`addon: true`) ; `src/sim/commands.ts:156-169` | Bouton sur le Pod (`hud-card.ts:220`). **Une seule annexe par Pod** dans le jeu ; la notice en permet 3, la fiche ne dit rien. |
| Tourelle (annexe du Pod, arme adaptable) | implémenté autrement | notice 549 ; fiche 548-574 (aucune attaque propre) | `src/data.ts:620` ; `balance.json` `tourelle.attack` 15, N2 | Décision de l'utilisateur du 18/11 : mitrailleuse N2 gratuite, autre arme achetable, détection retirée. L'IA l'arme (`ai.ts:487-497`). |
| Centre de socles (« Usine ») | implémenté et fonctionnel | notice 554 ; fiche 251-277 | `src/data.ts:621-624` | L'IA le construit à la 2e minute. |
| Centre d'armement | implémenté et fonctionnel | notice 557 ; fiche 301-327 | `src/data.ts:625-628` | L'IA le construit à la 10e minute. |
| Centre de recherche (« Centre technique ») | implémenté et fonctionnel | notice 560, 574-584 ; fiche 350-376 | `src/data.ts:629-632` (forge Z) | L'IA le construit. |
| Centre d'optimisation | implémenté autrement | notice 570 (effet par sa seule présence, Canon IEM qui immobilise) ; fiche 398-424 (recherche) | `src/data.ts:633` ; `optimisationp` `:654` ; `commands.ts:245` | La fiche est suivie : recherche « Optimisation perfectionnée » (+50 %) et pas de canon. L'IA la recherche. |
| Centre K (« Centre de kits », unique) | implémenté et fonctionnel | notice 563-568 ; fiche 448-474, 1676-1683 | `src/data.ts:635-638` ; `centreK()` `src/sim/abilities.ts:459-480` | Capacités du bâtiment (`hud-card.ts:203-208`). L'IA s'en sert (`ai.ts:499-521`). Test `z.test.ts:142`. |
| Balise de vacarme (objet posé) | implémenté et fonctionnel | fiche 1819-1826 | `src/data.ts:674` ; `balance.json` `units.vacarme` 250 PV | Posée par l'Accumulateur. |

### Armes et socles

Mécanique générale : l'arme se choisit à la mise en file, une fois pour toutes (fiche 1667-1674). Code : `commands.ts:174-183`, sous-menu `hud-card.ts:172-191`. Les 4 niveaux d'arme suivent le niveau du socle : `weaponAt` `src/data.ts:852`, `ownWeapon` `src/sim/combat.ts:108-113`. Les dégâts sont multipliés par `rules.z.weaponDamage` 86 %. Tests `z.test.ts:341`, `:375`.

| Arme | Statut | Référence | Code | Accessibilité et IA |
|---|---|---|---|---|
| Mitrailleuse (légère) | implémenté et fonctionnel | notice 497 ; fiche 1449-1462 | `balance.json` `weapons.mitrailleuse` | Gratuite et par défaut. |
| Laser (fiche) = Mitrailleuse lourde (notice) | implémenté et fonctionnel | notice 500 ; fiche 1464-1477, recherche 1920-1926 | `weapons.laser` ; `src/data.ts:665` | Recherche sans prérequis. L'IA la prend (poids 2). |
| Laser concentré (très longue portée, cadence lente) | **manquant** | notice 515 seulement | – | Absent de la fiche, qui n'a qu'un « Laser » à portée 5 ; aucun chiffre. |
| Lance-flammes | implémenté autrement | notice 503 (« uniquement terrestre ») ; fiche 1479-1492, 1771-1778 (double attaque) | `weapons.flammes` (`splash` 1,2 au lieu de la ligne arrière) | Permis sur le Coléoptère (décision du 18/11). L'IA le prend. |
| Lance-roquettes | implémenté et fonctionnel | notice 506 ; fiche 1498-1511 | `weapons.roquettes` (`ranges` 4 à 7) | L'IA le prend (poids 2, en priorité contre l'air). |
| Déchiqueteur (= Tronçonneuse) | implémenté et fonctionnel | notice 509 (socles terrestres seulement) ; fiche 1513-1526 (tous, contre l'air sur un volant) | `weapons.dechiqueteur` `airIfFlying` | La fiche est suivie. L'IA le prend. |
| Réparateur | partiel | notice 512 (véhicules **et bâtiments**) ; fiche 1563-1573, 1801-1808 (énergie de N1 à N4, 5 énergie par tic) | `weapons.reparateur` heal 10, portée 3 ; `patient()` `src/sim/combat.ts:560-573` | Soigne seulement les unités mécaniques, sans réserve d'énergie. L'IA le prend (poids 1). |
| Arc électrique (3 cibles dans 135°) | implémenté et fonctionnel | notice 519 ; fiche 1548-1561, 1792-1799 | `weapons.arc` ; `src/sim/combat.ts:361-374` | Demande l'IS. L'IA le prend. |
| Jet sonique (dégâts en ligne, alliés compris) | implémenté et fonctionnel | notice 522 ; fiche 1528-1541, 1780-1787 | `weapons.jetsonique` ; `src/sim/combat.ts:425-437` | Demande l'IS. L'IA le prend. |
| Canon X-04 (zone 2, s'atteint lui-même au contact) | implémenté et fonctionnel | notice 525 ; fiche 1598-1611, 1854-1861 | `weapons.canonx04` ; `combat.ts:438` | Réservé aux socles terrestres. Demande l'IS et l'Optimisation. L'IA le prend. |
| Accumulateur | partiel | notice 531-537 (capacités selon la taille du socle) ; fiche 1575-1585 (énergie de N1 à N4, 4 capacités) | `weapons.accumulateur` ; `WEAPON_ABILITIES` `src/data.ts:885` | Constructible par le joueur. **Absent de `ai.kits`** : l'IA ne fabrique jamais d'Accumulateur. Gravité alourdie manque, l'énergie est remplacée par des recharges. |
| Désintégrateur (air vers sol, à activer, coupure après 10 s) | **manquant** | notice 528 seulement | – | Absent de la fiche ; aucun chiffre. |
| Arme adaptable de la Tourelle et de l'Assimilateur | implémenté et fonctionnel | notice 543, 549 ; fiche 1667-1674 | commande `arm` `src/sim/commands.ts:221-233` ; `hud-card.ts:210-218` | Niveau 2 (proposition). L'IA arme ses Tourelles, puis ses Assimilateurs après 10 min. |
| Évolution sur le terrain (T1, T2, T3) | implémenté et fonctionnel | notice 478-493 ; fiche, champs « Evolue en » | `evolve` `commands.ts:234-249` ; `evolved()` `combat.ts:72-81` ; bouton `hud-card.ts:129-137` | Touche E. L'IA fait évoluer les socles qui attendent à la base. Test `z.test.ts:84`. |

### Capacités

| Capacité | Statut | Référence | Code | Accessibilité et IA |
|---|---|---|---|---|
| Balise de révélation (Espion) | implémenté autrement | notice 580 (demande une recherche) ; fiche 1722-1729 (20 énergie, 1 s, 50 s, rayon 4) | `src/data.ts:283` ; `castAt` `abilities.ts:209-211` ; recharge 10 s | Sans recherche (fiche). **L'IA ne s'en sert pas** (absente de `tactics`). |
| Impulsion magnétique (Espion) | implémenté autrement | notice 472, 581 ; fiche 1731-1738 (60 énergie, 40 s, rayon 2, 5 s) | `abilities.ts:212-213` | Demande la recherche `impulsion`. Dans `CROWD` de l'IA (`ai.ts:68`), mais **`impulsion` manque dans `ai.research.z`** : l'IA ne peut donc jamais l'employer. |
| Invisibilité temporaire (Espion) | implémenté autrement | fiche 1744-1751 | `abilities.ts:65-66` | Recherche, demande l'IS. L'IA ne la recherche pas et ne s'en sert pas. |
| Gel électronique (= Brouillard magnétique) | implémenté autrement | notice 533 (environ 10 s) ; fiche 1810-1817 (55 énergie, 20 s, invulnérable) | `abilities.ts:201-205` ; recharge 28 s | Seulement par un socle Accumulateur. L'IA ne s'en sert pas. |
| Arc offensif | **manquant** | notice 534 seulement | – | Aucun chiffre. |
| Balise de vacarme | implémenté autrement | notice 535 (organiques ennemis, ralentis) ; fiche 1819-1826 (organiques des deux camps, 10 PV/s, ne peuvent plus attaquer) | `abilities.ts:206-208` ; effet `buildings.ts:124-132` | La fiche est suivie, avec une recharge de 65 s. L'IA la lance sur les groupes (`CROWD`), à condition d'avoir des Accumulateurs, ce qui n'arrive jamais. |
| Cône de protection | implémenté autrement | notice 536 (socles) ; fiche 1836-1843 (alliés, rayon 3, 60 s) | `abilities.ts:61-64` ; `combat.ts:254-258` | Recharge de 85 s. L'IA ne s'en sert pas. |
| Gravité alourdie | **manquant** | notice 537 ; fiche 1845-1852 et 1581 | – | Voir les manques. |
| Kits Détection, Invisibilité, Auto-réparateur, Balise offensive | implémenté et fonctionnel | notice 565-568 ; fiche 2131-2166 | `abilities.ts:473-480` ; `KIT` `src/data.ts:829` ; effets `world.ts:492`, `buildings.ts:134`, `combat.ts:90-105,403` | Clic sur un socle n'importe où. L'IA les pose. La Balise offensive suit la fiche (+5 % à tout le camp), pas la notice (bonus local). |
| Canon IEM | implémenté autrement | notice 570, 1300 (Centre d'optimisation, immobilise les machines d'une zone) ; fiche 1695-1702 (Centre K, prise de contrôle 50 s) | `abilities.ts:461-471` ; `unseize` `:482` | La fiche est suivie. Recherche à 300/300 en 60 s (proposition). L'IA s'en sert. |
| Production accélérée (IS) | implémenté et fonctionnel | fiche 1658-1665 | `buildings.ts:172` | Automatique. |
| Génération de creep et réparation 1 PV/s | implémenté et fonctionnel | fiche 1649-1656 | `powerNetwork` `buildings.ts:102-116` ; `repairOnCreep` `:119-138` | IC, IS et Pod supérieur. Test `z.test.ts:310`. |

### Recherches

Toutes les recherches de la fiche (lignes 1881 à 2124) existent, avec les coûts, durées et prérequis de la fiche (`balance.json` > `units`). Elles sont visibles dans la carte de leur bâtiment (`hud-card.ts:240-249`).

| Recherche | Statut | Référence | Code | L'IA la fait ? |
|---|---|---|---|---|
| Socles : `rquadripode` 1-3, `rhexapode` 1-2, `rcoleoptere` 1-3, `roctopode` 1-2, `rmastodonte` 1-2, `rbarge` 1-2 | implémenté et fonctionnel | fiche 1882-1918, 1997-2013 | `src/data.ts:640-653` | Oui, sauf `rbarge2`. |
| Armes : laser, lanceflammes, lanceroquettes, rdechiqueteur, rjetsonique, rarc, rreparateur, raccumulateur, rcanonx04 | implémenté et fonctionnel | fiche 1920-1995 | `src/data.ts:665-675` | Oui, **sauf `raccumulateur`**. |
| Attaque de proximité et Attaque à distance (+10 % par niveau) | implémenté autrement | notice 575-576 (physique et énergétique) ; fiche 2015-2039 | `upgrades('zproxi')` et `upgrades('zdist')` `:655-656` ; `attackLine` `combat.ts:21` ; +1 par tranche de 10 dégâts `combat.ts:391` | Oui. Le bonus ne s'applique qu'aux unités, pas à la Tourelle ni à l'Assimilateur armés. |
| Blindage des socles | implémenté autrement | notice 577-578 (terrestre et aérien séparés) ; fiche 2041-2049 (une ligne) | `:657` ; `armorBonus` `combat.ts:49` | Oui. |
| Blindage de titane (+2, un niveau) | implémenté et fonctionnel | notice 579 (3 niveaux) ; fiche 2051-2058 | `:658` | Oui. |
| Sonde robuste (+25 PV) | partiel | fiche 2060-2067, plus fiche 721 (le Drone de combat l'utilise aussi) | `:660` ; seulement `type === 'drone'` (`combat.ts:198`, `world.ts:354`, `buildings.ts:246`) | Oui. Le Drone de combat n'en profite pas. |
| Impulsion magnétique, Invisibilité temporaire, Mega-Espion | implémenté et fonctionnel | fiche 2069-2097 | `:661-663` | **Non** (absentes de `ai.research.z`). |
| Déploiement rapide (+20 %) | implémenté et fonctionnel | notice 582 ; fiche 2099-2106 | `:659` ; `buildTicks` `buildings.ts:88-91` | **Non**. |
| Pod supérieur | implémenté et fonctionnel | notice 583 (4 niveaux) ; fiche 2108-2115 | `:664` | Oui. |
| Optimisation perfectionnée | implémenté et fonctionnel | fiche 2117-2124 | `:654` | Oui. |
| Canon IEM | implémenté (proposition faute de chiffre) | fiche 1699 (prérequis sans coût) | `:639` | Oui. |
| Armes suprêmes | implémenté autrement | notice 584 | remplacée par les prérequis IS et Optimisation de la fiche | – |
| Balise de révélation (recherche) | implémenté autrement | notice 580 | capacité donnée d'office (fiche 1726 : sans prérequis) | – |

### Mécaniques

| Mécanique | Statut | Référence | Code |
|---|---|---|---|
| Drone absorbé, bâtiment qui s'assemble seul | implémenté et fonctionnel | notice 469 ; fiche 1704-1711 | `BuildingDef.absorbs` ; `world.ts:836` ; `operate` `buildings.ts:176` |
| Creep : bâtiments Z constructibles seulement sur le creep (sauf l'IC et les générateurs) | **implémenté autrement (règle absente)** | notice 546 | aucun bâtiment Z n'a `needsPower` ; test `z.test.ts:21` « anywhere (no creep needed) » |
| Refuge : des drones s'abritent dans l'IC | **manquant** | notice 540, 1233, 1290 | – |
| Détection par l'IC | **manquant** | notice 540, 1232 | `balance.json` `intelligence` sans `detector` |
| Annexes : jusqu'à 3 par Pod, de deux types | partiel (une seule) | notice 546 | `commands.ts:156-158` ; `hud-card.ts:219-225` |
| Énergie de l'Espion, du Réparateur et de l'Accumulateur (réserve par niveau, coût par capacité) | implémenté autrement (recharges) | fiche 657-658, 1568, 1580, 1724-1847 | `BALANCE.md:122-124` |
| Capacités de l'Accumulateur selon la taille du socle | manquant | notice 531 ; fiche 1580 (100 à 250 d'énergie : N1 ne peut pas payer Cône 170 ni Gravité 205) | – |
| Classes de cible (BL, BA, M, MM, H, S) | implémenté autrement | toute la fiche | 2 classes : `damage` et `vsMechanical` (bâtiments comptés comme machines) |
| Prise de contrôle (IEM), fin à la mort du Centre K | implémenté et fonctionnel | fiche 1701 | `world.ts:425` |
| IA : contrôle léger | en place | – | `ai.ts` `machines()` 475, `barge()` 526 ; `tactics()` 844 n'a aucun cas pour `gel`, `cone`, `balisez`, `invistemp` |

### Manques à combler

1. **Gravité alourdie** (capacité de l'Accumulateur).
   - Références : notice 537 ; fiche 1845-1852 ; la liste de la fiche 1581 la range dans l'Accumulateur, mais sa ligne « Unité référence » 1846 dit « Centre K ».
   - Chiffres de la fiche : 205 énergie, recharge 15 s ; ennemis dans un rayon de 18 autour du lanceur ; vitesse −50 % ; temps entre deux attaques +25 % ; aura, l'effet cesse hors de la zone. La notice parle d'un « temps de rechargement immense ».
   - Où : `ABILITIES` (`src/data.ts:288-290`), `WEAPON_ABILITIES` (`:885`), `cast()` (`src/sim/abilities.ts:61`) sur le modèle de `cone`. Le ralentissement passe par `baseSpeed` et la cadence par `combat.ts:349`. Ajouter l'entrée à `balance.json` et une recharge longue faute d'énergie (par exemple 120 s, à proposer). Mettre à jour le texte de `raccumulateur`.
   - Difficulté : moyenne (aura persistante comme le Cône, deux effets).
2. **IA et Accumulateur** : l'IA n'en fabrique jamais, faute d'entrée dans `ai.kits` et de `raccumulateur` dans `ai.research.z`. Elle ne lance pas non plus `gel`, `cone`, `balisez`, `invistemp`, ni `impulsion` (recherche absente de sa liste).
   - Chiffres : aucun (réglages de l'IA).
   - Où : `balance.json` `ai.kits` et `ai.research.z` ; `tactics()` (`src/ai/ai.ts:844`), avec un cas par capacité, sur le modèle de `voile` ou `renvoi`.
   - Difficulté : faible à moyenne. Demande une mesure, donc la session équilibrage.
3. **Sonde robuste pour le Drone de combat**.
   - Référence : fiche 721 (le Drone de combat l'utilise) et fiche 2066.
   - Chiffre : +25 PV.
   - Où : trois tests `type === 'drone'` (`src/sim/combat.ts:198`, `src/sim/world.ts:354`, `src/sim/buildings.ts:246`).
   - Difficulté : faible. C'est un changement de stats : à signaler à l'équilibreur.
4. **Énergie des unités de soutien** (Espion, Réparateur, Accumulateur) à la place des recharges.
   - Chiffres de la fiche :
     - Espion : 100 d'énergie, +2/s ; Balise de révélation 20, Impulsion 60, Invisibilité 40 ;
     - Réparateur et Accumulateur : réserve de 100, 150, 200 ou 250 selon le niveau N1 à N4 ;
     - Nanites 5 par seconde de soin ; Gel 55 ; Vacarme 130 ; Cône 170 ; Gravité 205.
   - Où : un champ `energy` par entité. Les Isdaris ou les dieux ont peut-être déjà un mécanisme de mana à réutiliser (à vérifier). Coûts dans `castAt` et `cast`.
   - Difficulté : élevée (nouvelle ressource par unité, interface, IA). La fiche est sans ambiguïté.
5. **Détection par l'IC**.
   - Référence : notice 540 et 1232 ; la fiche ne la donne pas.
   - Chiffre : aucun. Proposer la vision de l'IC (13).
   - Où : `balance.json` `intelligence.detector` et `supreme.detector`.
   - Difficulté : très faible. Demande une décision (voir plus bas).
6. **Refuge**.
   - Référence : notice 540, 1233, 1290 ; absent de la fiche.
   - Chiffre : « plusieurs drones », sans nombre.
   - Où : `bunker` existe déjà (Fortin). Ajouter `bunker` à l'IC et à l'IS et autoriser les ouvriers dans `boards()` (`src/sim/buildings.ts:151`).
   - Difficulté : faible à moyenne. Demande une décision et un chiffre.
7. **Plusieurs annexes par Pod**.
   - Référence : notice 546, « jusqu'à 3 add-ons » ; la fiche ne fixe pas de nombre.
   - Où : `commands.ts:157` et `hud-card.ts:222` (test `a.host === b.id`) ; `addonSpot` (`buildings.ts:60-71`) offre déjà 4 côtés.
   - Difficulté : faible. Change l'économie de Z : à mesurer.
8. **Armes de la notice absentes de la fiche** : Laser concentré (notice 515), Désintégrateur (notice 528), Arc offensif (notice 534).
   - Chiffres : aucun.
   - Où : `WEAPONS` (`src/data.ts:873`) et `balance.json` `weapons`. Le Désintégrateur demande une arme à activer et désactiver, avec coupure et recharge.
   - Difficulté : moyenne pour chacune, et il faudrait inventer les chiffres. La règle de l'utilisateur (« `Z.doc` fait foi, rien qui n'y figure ») les exclut. Ne pas faire sans son accord.
9. **Réparateur sur les bâtiments**.
   - Référence : notice 512 (« véhicules et bâtiments ») ; la fiche dit « unité mécanique ».
   - Où : `patient()` (`src/sim/combat.ts:560-573`).
   - Difficulté : faible. Demande une décision.
10. **Bonus d'attaque Z pour la Tourelle et l'Assimilateur armés**.
    - Référence : fiche 1461 et suivantes (« Aml utilisées » portées par l'arme, pas par le socle).
    - Où : `combat.ts:391`, qui exige `e.def.kind === 'unit'`.
    - Difficulté : très faible. Ambigu ; c'est une question d'équilibrage.

### Décisions possibles

1. **Creep obligatoire pour construire.** La notice (546) l'exige pour tous les bâtiments sauf l'IC et les générateurs, et fait générer du creep au Pod. La fiche ne fait générer du creep qu'à l'IC, à l'IS et au Pod supérieur, et ne dit rien du placement. Le jeu suit la fiche et laisse construire partout. *Recommandation* : garder le jeu. Avec le creep de la fiche, l'obligation empêcherait toute expansion avant le Pod supérieur, et le mesurage de `7b776b3` montre déjà que Z peine à démarrer.
2. **Canon IEM.** La notice (570, 1300) le place au Centre d'optimisation : il immobilise les machines et bâtiments d'une zone, sans dégâts. La fiche (1695-1702) le place au Centre K : il prend le contrôle d'une machine 50 s. *Recommandation* : garder la fiche, déjà implémentée et testée.
3. **Centre d'optimisation.** Selon la notice, sa seule présence divise par deux les temps d'évolution. Selon la fiche, c'est la recherche Optimisation perfectionnée (+50 % de vitesse). *Recommandation* : fiche (en place).
4. **Gravité alourdie : Accumulateur ou Centre K ?** La fiche se contredit : liste de l'Accumulateur en 1581, « Unité référence : Centre K » en 1846. La notice dit Accumulateur. *Recommandation* : Accumulateur, avec le rayon 18 et les effets de la fiche, et une recharge longue comme dans la notice.
5. **Détection de l'IC** : notice oui, fiche non. Aujourd'hui Z ne détecte que par l'Espion (après un Pod) et le kit Détection. *Recommandation* : ne pas l'ajouter. L'Espion arrive tôt et l'utilisateur a déjà retiré la détection de la Tourelle par souci de fidélité à la fiche.
6. **Refuge et 3 annexes par Pod** : notice seulement. *Recommandation* : demander à l'utilisateur. Les annexes multiples sont cohérentes avec la fiche, qui ne fixe pas de nombre. Le Refuge est sans chiffre.
7. **Laser concentré, Désintégrateur, Arc offensif** : notice seulement, aucun chiffre, et la fiche les a remplacés par d'autres armes (Laser, Déchiqueteur, Canon X-04). *Recommandation* : ne pas les faire, selon la règle « `Z.doc` fait foi ».
8. **Écarts de détail où le jeu suit la fiche contre la notice** :
   - production de l'IS : 75 % du temps selon la fiche, la moitié selon la notice ;
   - Pod supérieur : 1 niveau selon la fiche, 4 selon la notice ;
   - Blindage de titane : 1 niveau contre 3 ;
   - attaque et blindage : proximité et distance, blindage unique (fiche) contre physique et énergétique, terrestre et aérien (notice) ;
   - Balise de révélation sans recherche ;
   - Balise offensive : +5 % pour tout le camp au lieu d'un bonus local ;
   - Vacarme qui touche aussi les alliés organiques ;
   - Cône qui protège tous les alliés et pas seulement les socles.

   *Recommandation* : aucune action, la fiche prime.
9. **Énergie remplacée par des recharges** (Espion, Réparateur, Accumulateur) : simplification du programmeur, notée dans `BALANCE.md:122-124`. Elle fait perdre la règle de la notice et de la fiche : un Accumulateur N1 (100 d'énergie) ne peut lancer ni le Cône ni la Gravité. *Recommandation* : la garder pour l'instant. Si l'énergie est réintroduite, le faire pour les trois en un seul lot (manque 4).

Non vérifié : le comportement en partie réelle (rien n'a été lancé, ni tests ni jeu) ; le rendu visuel ; la fusion de l'Octopode 3D ; l'existence d'un mécanisme de mana réutilisable chez les autres camps.

## Dieux

Audit en lecture seule du worktree `friendly-agnesi-a574dc` (commit 480dadc, version 0.9.66).

Sources : notice 2009 convertie (`notice.txt`, lignes 300-431, points forts et faibles l. 640-655 ; les pages d'arbre technologique l. 778 et 807 sont des images, vides dans le texte), `docs/camp-dieux.md`, `BALANCE.md` l. 42-52, note `plan-dieux-2008.md`. XC.doc 2008 a été converti pour vérifier les chiffres manquants (`scratchpad/xc.txt`). Le mod SC2 ne contient aucun dieu (`GameStrings.txt` : seul « thor modèle », sans rapport).

Vue d'ensemble : les trois rangs, les 10 divinités, les 13 unités, les 10 bâtiments, les 11 recherches, l'Artefacterie, les sorts ultimes et les niveaux des dieux sont codés, testés (`src/sim/dieux.test.ts`, 24 tests) et accessibles depuis le HUD. Les manques portent sur deux sorts de la notice jamais codés, quelques effets secondaires, et des écarts de règles.

Chemin d'accès vérifié dans le code :
- Invocation des dieux : bouton de la Porte d'Asgaard (`src/game/hud-card.ts:186-190`) → `lacks()` (`src/sim/world.ts:676-693`). `requiresAny` compte les dieux vivants : « 2 sur 3 » = vivants en même temps.
- Troupes invoquées par un dieu : `src/game/hud-card.ts:138-143`. Le dieu n'invoque qu'à l'arrêt (`src/sim/world.ts:723`).
- Sorts : un bouton par capacité (`src/game/hud-card.ts:120-128`) → `cast`/`castAt` (`src/sim/abilities.ts:55-366`). Un sort ultime affiche « Se charge au Temple primordial : N % ».
- Bâtiments : le menu de Gaïa, seule bâtisseuse (`src/data.ts:966-971`, `src/game/hud-card.ts:88-96`). Les morphs, la capacité Déraciner et les recherches passent par la carte du bâtiment (`src/game/hud-card.ts:203-250`).
- Niveaux et artefacts : sur la carte du dieu (`src/game/hud-card.ts:145-161`).

### Divinités

| Élément | Statut | Référence notice | Code | Accessibilité, IA |
|---|---|---|---|---|
| Gaïa : sans attaque, presque invulnérable | implémenté et fonctionnel | « entièrement dénuée de capacité d'attaque », l. 358 | `src/balance.json:229` (3000 PV, armure 6, pas d'`attack`), `src/data.ts:682` | Offerte au départ. Revient seule à la Porte après 45 s (`src/sim/world.ts:529`, `:564-581`, choix de `camp-dieux.md` §5 q4). |
| Gaïa : construit les bâtiments, invoque les Esprits | implémenté autrement | construit Porte, Antre, Puits, Branche, Temple primordial, l. 358 | `src/data.ts:682`, `:969` | Elle construit aussi le Temple de vénération, la Fontaine et l'Artefacterie. Selon la notice, ces trois-là reviennent à Thor, Osiris et Frigg (voir Bâtiments). |
| Gaïa : Téléportation vers un bâtiment allié | implémenté et fonctionnel | « se téléporter auprès d'un bâtiment allié », l. 358 | `src/sim/abilities.ts:325-328`, `src/balance.json` abilities.teleportgaia | Bouton T. L'IA ne s'en sert pas. |
| Gaïa : Flèche magique | implémenté et fonctionnel | « une flèche magique sur une unité ennemie », l. 358 | `src/sim/abilities.ts:315-320` | Bouton F. L'IA ne s'en sert pas. |
| Thor : mêlée lente, le moins cher | implémenté et fonctionnel | « le dieu le moins coûteux », l. 361 | `src/balance.json:230` (400 minerais, aucune énergie) | Invoqué à la Porte. L'IA le prend à 0 min (`ai.gods`). |
| Thor : Courroux du marteau, onde de choc une fois évolué | implémenté et fonctionnel | « lorsque Thor évolue … onde de choc », l. 361 | `src/sim/abilities.ts:96`, `src/sim/combat.ts:412-422` (rayon par niveau) | L'IA s'en sert au contact (`src/ai/ai.ts:927`). |
| Thor : invoque les Nains | implémenté et fonctionnel | l. 361 | `src/data.ts:683` | — |
| Thor : construit l'Autel | implémenté autrement | « peut construire un autel », l. 361 et 408 | `src/data.ts:745-748` : Temple de vénération bâti par Gaïa, `requires: { thor: 1 }` | Voir les décisions. |
| Apollon : Pluie de feu | implémenté et fonctionnel | « pluie de météores enflammées », l. 364 | `src/sim/abilities.ts:321-324`, niveaux dans balance | L'IA la lance sur 3 ennemis groupés ou plus (`src/ai/ai.ts:68`). |
| Apollon : Lumière ardente / Aveuglement | **manquant** | « lumière ardente … réduisant drastiquement leurs vitesses de déplacement et d'attaque », l. 364 | aucun (absent de `ABILITIES` et de `balance.json`) | Listé dans `camp-dieux.md` §3.1 comme « Aveuglement », jamais codé. |
| Apollon : invoque les Minotaures | implémenté et fonctionnel | l. 364 | `src/data.ts:684` | — |
| Seth : rapide, cruel avec les plus faibles | partiel | « inflige beaucoup de dégâts aux soldats ennemis les plus faibles », l. 368 | `src/balance.json:232` (vitesse 2,5) ; aucun bonus dans `src/sim/combat.ts` `hit()` | `camp-dieux.md` §4.1 prévoit un « bonus contre les unités blessées ». Non codé. |
| Seth : Tempête de sable | implémenté et fonctionnel | « unités d'attaque à distance ne peuvent plus se servir de leurs armes », l. 368 | `src/sim/abilities.ts:313-314`, `src/sim/combat.ts:353` | Utilisée par l'IA (CROWD). |
| Seth : Jet de sable (véhicules) | **manquant** | « une bonne poignée de sable dans leurs mécanismes », l. 368 | aucun | Listé dans `camp-dieux.md` §3.1, jamais codé. |
| Seth : invoque les Sphinx | implémenté et fonctionnel | l. 368 | `src/data.ts:685` | — |
| Odin : Foudre (dégâts et étourdissement) | implémenté et fonctionnel | « un puissant éclair qui … l'étourdira et l'immobilisera », l. 371 | `src/sim/abilities.ts:307-312` | IA : sur l'ennemi le plus solide (`src/ai/ai.ts:874`). |
| Odin : aura de commandement | implémenté et fonctionnel | « les troupes guerroient avec plus de férocité », l. 371 | `src/sim/combat.ts:395-401`, `rules.upgrades.auraguerre` (XC.doc) | Passive. |
| Odin : invoque Nains, Corbeaux, Drakes | implémenté et fonctionnel | l. 371 | `src/data.ts:688` | Rang 2 : 2 dieux de rang 1 vivants. |
| Athéna : Cri de guerre | implémenté et fonctionnel | « diatribes guerrières … augmentant temporairement », l. 374 | `src/sim/abilities.ts:98-102`, `src/sim/combat.ts:406` | Utilisé par l'IA. |
| Athéna : Chouette | implémenté et fonctionnel | « révéler quelques instants une zone », l. 374 | `src/sim/abilities.ts:274-275` | Bouton O. L'IA ne s'en sert pas. |
| Athéna : aura de protection | implémenté et fonctionnel | « subissent en permanence légèrement moins de dégâts », l. 374 | `src/sim/combat.ts:58` et suivantes, `rules.upgrades.auraprotection` | Passive. |
| Athéna : invoque Minotaures, Élémentaires | implémenté et fonctionnel | l. 374 | `src/data.ts:689` | Choix de `camp-dieux.md` §5 q2. |
| Isis : attaque symbolique, endurante | implémenté et fonctionnel | « dégâts purement symboliques », l. 377 | `src/balance.json:202` (10 dégâts, 2400 PV) | — |
| Isis : Soins divins | implémenté et fonctionnel | « soigner des groupes entiers », l. 377 | `src/sim/abilities.ts:103-109` | Utilisé par l'IA. |
| Isis : Résurrection | implémenté et fonctionnel | « les ramener à la vie en très peu de temps », l. 377 | `src/sim/abilities.ts:153-163` (cadavres de moins de 20 s, pas les dieux) | Utilisée par l'IA. |
| Isis : invoque Sphinx, Prêtresses | implémenté et fonctionnel | l. 377 | `src/data.ts:690` | — |
| Frigg : Soumission | implémenté et fonctionnel | « prendre temporairement le contrôle d'une unité ennemie », l. 380 | `src/sim/abilities.ts:298-304` | Utilisée par l'IA. |
| Frigg : Voile (invisibilité de groupe) | implémenté et fonctionnel | « invisible pendant un long laps de temps », l. 380 | `src/sim/abilities.ts:110-111` | Utilisé par l'IA. |
| Frigg : ignore le terrain, mais ciblée comme unité terrestre | partiel | « bien qu'elle soit ciblée comme unité terrestre, Frigg ignore les pénalités de terrain », l. 380 | `src/data.ts:708` `flying: true` | Elle franchit bien falaises et eau. En revanche, `flies()` (`src/sim/world.ts:34`) en fait une cible aérienne : la mêlée et les armes sans tir aérien ne peuvent pas l'attaquer (`src/data.ts:41-43`). C'est le contraire de la notice. |
| Frigg : invoque Nains, Walkyries ; construit l'Artefacterie | implémenté autrement | l. 380 | `src/data.ts:708`, `:742` (Artefacterie bâtie par Gaïa, `requires: { frigg: 1 }`) | — |
| Osiris : mêlée lente et dévastatrice | implémenté et fonctionnel | l. 383 | `src/balance.json:209` | — |
| Osiris : « torrents de pourriture et de peste » sur les organiques | partiel / ambigu | « fait pleuvoir de véritables torrents de pourriture et de peste », l. 383 | aucun effet propre | Ce peut être une image de son attaque ou un sort. XC.doc donne un sort d'Osiris, « Putréfaction ». |
| Osiris : aura putride | implémenté et fonctionnel | « épais nuage … contaminant les unités », l. 383 | `src/sim/combat.ts:157-161` (organiques au sol, par niveau) | Passive. |
| Osiris : Nuée nauséabonde | implémenté et fonctionnel | « essaim … lui rendent une partie de l'énergie vitale », l. 383 | `src/sim/abilities.ts:151`, `src/sim/combat.ts:162-172` | Utilisée par l'IA. |
| Osiris : invoque Sphinx, Immortels ; construit la Fontaine | implémenté autrement | l. 383 | `src/data.ts:710`, `:736` (Fontaine bâtie par Gaïa, `requires: { osiris: 1 }`) | — |
| Hadès : forte attaque à distance | implémenté et fonctionnel | l. 386 | `src/balance.json:208` (60 dégâts, portée 7) | — |
| Hadès : Rayon de mort | implémenté et fonctionnel | « frapper l'ensemble des unités ennemies présentes dans son champ de vision », l. 386 | `src/sim/abilities.ts:112-119` | Utilisé par l'IA. |
| Hadès : Voyage souterrain | implémenté et fonctionnel | « équivalent d'une téléportation », l. 386 | `src/sim/abilities.ts:305-306` (portée 30) | L'IA ne s'en sert pas. |
| Hadès : Armée des enfers | partiel | « ne disparaîtront qu'après avoir infligé un certain nombre de dégâts chacune », l. 386 | `src/sim/abilities.ts:120-124`, `src/data.ts:718` (3 à 8 Fantômes invulnérables, 20 s) | Seule la durée met fin aux Fantômes, pas un plafond de dégâts infligés. Ce sont des fantômes génériques, pas des « fantômes … de diverses unités ». Utilisée par l'IA. |
| Hadès : invoque Minotaures, Titans | implémenté et fonctionnel | `camp-dieux.md` §3.1 (la notice ne liste pas les unités d'Hadès) | `src/data.ts:709` | — |
| Détection (chaque dieu) | implémenté et fonctionnel | point fort « Détection des unités camouflées », l. 649 | `detector: 10` pour les 10 dieux (`src/balance.json`), `src/sim/world.ts:486-495` | — |
| Niveaux des dieux (5) | implémenté (XC.doc 2008, pas la notice) | allusions seulement : « lorsque Thor évolue », « à des niveaux élevés », l. 361, 364 | `src/data.ts:104`, `src/sim/combat.ts:139-149`, `src/balance.json` `levels` | Bouton « Niveau N » sur le dieu. L'IA achète les niveaux, sauf ceux de Gaïa (`src/ai/ai.ts:591-600`). |

### Unités

| Unité | Statut | Référence notice | Code | Accessibilité, IA |
|---|---|---|---|---|
| Esprit : récolte | implémenté et fonctionnel | l. 314 | `src/data.ts:681`, `src/balance.json:199` | Invoqué par Gaïa. |
| Esprit : réparation des bâtiments | **manquant** | « assure la récolte des ressources et la réparation des bâtiments », l. 314 | `src/sim/commands.ts:313` : seul le Drone Z répare | Un clic droit d'un Esprit sur un bâtiment abîmé ne fait rien. |
| Nain | implémenté et fonctionnel | l. 317 | `src/balance.json:226` | Invoqué par Thor, Odin, Frigg. Base de l'armée de l'IA. |
| Nain : bond (Célérité naine) | implémenté et fonctionnel | « bondir soudainement dans sa direction », l. 317, 425 | `src/sim/world.ts:728-737` | Automatique après la recherche. L'IA fait la recherche. |
| Minotaure : Transe enragée | implémenté et fonctionnel | « états de transe enragée », l. 320 | `src/sim/abilities.ts:144-146` | Utilisée par l'IA (SIMPLE). |
| Minotaure : Coup puissant | implémenté autrement | « une chance d'infliger des dégâts doubles », l. 426 | `src/sim/combat.ts:409` (un coup sur 4, tirage fixe, sans hasard) | Recherchée par l'IA. |
| Sphinx : boules de feu à moyenne portée, rapide, blindé | implémenté et fonctionnel | l. 323 | `src/balance.json:228` (portée 5, armure 3, vitesse 2,7), `mechanical: true` | — |
| Sphinx : peau de pierre / statue | implémenté et fonctionnel | l. 323, 427 | `src/sim/abilities.ts:147-150`, `src/sim/combat.ts:134`, `:173` | Exige Peau de roc. L'IA ne fait jamais cette recherche (`src/balance.json` `ai.research.dieux`) : elle ne s'en sert donc pas. |
| Corbeau : éclaireur volant, détecteur, invisible | implémenté et fonctionnel | l. 326 | `src/data.ts:692` (`cloaked`), `src/balance.json:203` (`detector: 8`) | L'IA en invoque (1 dans `ai.army.dieux`). |
| Drake : volant lent, endurant, attaque de zone | implémenté et fonctionnel | l. 329 | `src/balance.json:204` (`splash` 1,5) | — |
| Drake : transport dans sa gueule | implémenté et fonctionnel | l. 329, 429 | `src/sim/buildings.ts:142-143` (place 4 après Drake géant), embarquement `src/sim/commands.ts:318` | Clic droit d'une unité au sol sur le Drake, bouton Débarquer. L'IA ne fait pas la recherche et ne transporte pas. |
| Drake : ne fuit jamais | manquant (ambigu) | « un drake préfèrera mourir plutôt que fuir », l. 329 | aucun | Probablement un trait de caractère, sans règle à coder. |
| Élémentaire : forme de base chétive et 4 formes | implémenté autrement | une forme de base « faible et chétive » plus quatre formes, l. 332 | `src/data.ts:697-703` : la forme invoquée est déjà la forme de feu, il n'existe pas de forme de base | Mutation par les boutons J/Y/K/Q. L'IA ne change pas de forme. |
| Élémentaire d'eau : tir glacé qui ralentit, touche le sol et l'air | implémenté et fonctionnel | l. 333 | `src/sim/combat.ts:438-442`, `rules.upgrades.glace` | — |
| Élémentaire d'eau : lévitation par-dessus les obstacles | **manquant** | « se déplace en lévitation et peut survoler un grand nombre d'obstacles », l. 333 | aucun (commit 7e52a28 : « pas fait ») | — |
| Élémentaire de feu : souffle, tire en l'air | partiel | « véritable souffle destructeur de feu », l. 334 | `src/balance.json:205` (`air: true`, pas de `splash`) | Il tire bien en l'air, mais sans dégâts de zone. `camp-dieux.md` §4.2 proposait une zone de 0,8. |
| Élémentaire de terre : très lent, très résistant, lames contre l'infanterie | partiel | « découperont l'infanterie ennemie », l. 335 | `src/balance.json:220` | Il est lent et résistant, mais n'a aucun bonus contre l'infanterie. |
| Élémentaire d'air : vole, très rapide, air seulement | implémenté et fonctionnel | l. 336 | `src/balance.json:221` (`ground: false`) | — |
| Golem : fusion de 2 Élémentaires | implémenté et fonctionnel | l. 332, 339 | `src/sim/abilities.ts:130-143` (15 s, XC.doc) | Bouton U. L'IA ne fait pas de fusion, donc jamais de Golem. |
| Golem : portée énorme, gros dégâts aux bâtiments, imprécis sur cible mobile | partiel | « peu efficace contre les unités en mouvement », l. 339 | `src/balance.json:222` (portée 11, `vsMechanical` 70) | Aucune imprécision. Le bonus `vsMechanical` vaut aussi contre les machines, pas seulement les bâtiments (`src/sim/combat.ts:385`). |
| Prêtresse : soin, sans attaque | implémenté et fonctionnel | l. 342 | `src/balance.json:206` (`heal: 8`) | — |
| Prêtresse : Dispell (Dissipation) | implémenté et fonctionnel | l. 342 | `src/sim/abilities.ts:276-297` | Utilisée par l'IA. Sur un allié, elle retire l'immobilisation et le poison, mais pas le ralentissement glacé ni la Soumission. |
| Walkyrie : volante, épée projetée | implémenté et fonctionnel | l. 345 | `src/balance.json:210` | — |
| Walkyrie : disparaît un court instant | implémenté et fonctionnel | « disparaître … pendant un court instant », l. 345 | `src/data.ts:712` (`camouflage`, 8 s), `src/sim/abilities.ts:94` | Utilisée par l'IA quand la Walkyrie est blessée. |
| Immortel : mêlée très lente, nuage toxique contre les organiques | implémenté et fonctionnel | l. 348 | `src/balance.json:212`, `src/sim/combat.ts:157-161` | — |
| Titan : foudre à longue portée, rase les bâtiments | implémenté et fonctionnel | l. 351 | `src/balance.json:211` (portée 6, `vsMechanical` 30) | — |
| Titan : Armure zodiacale | implémenté et fonctionnel | l. 351, 431 | `src/sim/combat.ts:32-34`, `:56` | Bouton au Temple. L'IA ne fait pas la recherche. |
| Avatar de Jörmungand | partiel | « indestructible et immense », « par grappes de plusieurs dizaines », se nourrit des cadavres, l. 354 | `src/data.ts:740`, `src/balance.json:217` (1500 PV, `splash` 1,5, 60 s), festin `src/sim/combat.ts:174-181` | Il est destructible (1500 PV) et sa zone est modeste. Le « retour au Walhalla » correspond de fait à la recharge de 300 s. |

### Bâtiments

| Bâtiment | Statut | Référence notice | Code | Accessibilité, IA |
|---|---|---|---|---|
| Porte d'Asgaard : invoque les dieux, dépôt, plusieurs possibles, chère | implémenté et fonctionnel | l. 390 | `src/data.ts:725`, `src/balance.json:233` (1200 minerais) | Menu de Gaïa. L'IA en bâtit une seconde au-delà de 1600 minerais. |
| Porte : transforme le minerai en « énergie éthérée » | implémenté autrement | l. 390 | Ni nouvelle ressource ni conversion. L'énergie vient du Puits (`camp-dieux.md` §5 q13). | — |
| Antre : dépôt et un peu de population | implémenté et fonctionnel | l. 393 | `src/data.ts:743`, `src/balance.json:236` (+4) | Avant-poste de l'IA. |
| Puits : énergie sur un gisement | implémenté et fonctionnel | l. 396 | `src/data.ts:744`, `src/sim/buildings.ts:11-15`, `:204` | — |
| Branche d'Yggdrasill : population et attaque de mêlée | implémenté et fonctionnel | l. 399 | `src/data.ts:727`, `src/balance.json:234` | Bâtie par l'IA. |
| Yggdrasill protecteur (2 dieux de rang 1) | implémenté et fonctionnel | « lorsque le camp a invoqué deux divinités de premier rang », l. 399 | `src/data.ts:728` (`requiresAny` : vivants) | Morph sur la Branche. L'IA le fait. |
| Yggdrasill furieux (Hadès) | implémenté et fonctionnel | l. 399 | `src/data.ts:730`, `src/balance.json:214` | Morph. L'IA le fait (`src/ai/ai.ts:402-421`). |
| Déracinement | implémenté et fonctionnel | l. 399 | `src/sim/abilities.ts:503`, `:259-273`, `src/data.ts:732-734` | Recherche au Temple. L'IA ne s'en sert pas. |
| Temple primordial : unique, bâti par Gaïa à tout moment, sorts ultimes | implémenté et fonctionnel | l. 402 | `src/data.ts:738`, `src/sim/world.ts:538-562` (charge seulement si les 3 dieux sont vivants ; la progression est gardée) | Jauges dans le panneau (`src/game/hud-panel.ts:64-66`). L'IA le bâtit vers la minute 17. |
| Autel / Temple de vénération : toutes les recherches | implémenté autrement | l. 408 (« Autel, construit par Thor ») et l. 421 | `src/data.ts:745-748` (nom « Temple de vénération », bâti par Gaïa, exige Thor) | Choix de `camp-dieux.md` §5 q1 pour le nom. |
| Fontaine d'eau du Nil : régénère les organiques proches | implémenté et fonctionnel | l. 411 | `src/sim/combat.ts:183-185` | Exige Osiris. L'IA la bâtit vers la minute 16. |
| Artefacterie : 4 améliorations, 4 au plus par dieu, cumulables | implémenté et fonctionnel | l. 414-418 | `src/data.ts:742`, `:762-765`, `src/sim/combat.ts:54`, `:133`, `:357`, `:410` | Boutons sur la carte du dieu. L'IA achète Force, Résistance, Force, Vitesse. |

### Sorts / Capacités

Les sorts des dieux sont listés plus haut. Restent les sorts ultimes et les règles communes :

| Élément | Statut | Référence | Code | Accessibilité, IA |
|---|---|---|---|---|
| Appel de Jörmungand (scandinave) | implémenté et fonctionnel | l. 403 | `src/sim/abilities.ts:246-248` | Bouton U sur Thor, Odin ou Frigg une fois chargé. L'IA le lance sur au moins 2 ennemis. |
| Tempête de Zeus (grec), alliés compris, plus fort sur les unités puissantes | implémenté et fonctionnel | l. 404 | `src/sim/abilities.ts:249-255` (30 % des PV max) | L'IA évite ses propres troupes. |
| Flamboiement d'Amon-Râ (égyptien), machines plus brièvement | partiel | « aveuglées et immobilisées », l. 405 | `src/sim/abilities.ts:256-258` (immobilisées 15 s, machines 5 s) | Les cibles sont immobilisées, mais pas aveuglées (leur vue est intacte). `max: 6` est déclaré dans balance mais jamais lu. |
| Charge du sort ultime arrêtée si un dieu meurt, puis reprise | implémenté et fonctionnel | l. 402 | `src/sim/world.ts:551-555` | — |
| Recharge commune aux sorts d'un même dieu | implémenté autrement | — (choix sans la notice, `BALANCE.md` l. 50) | `e.abilityCd` | — |
| Mana | absent (choix assumé) | XC.doc seulement | — | `plan-dieux-2008.md` §0.3 : la recharge suffit. |

### Recherches

| Recherche | Statut | Notice | Code | IA |
|---|---|---|---|---|
| Attaque corps à corps 1-3 | implémenté et fonctionnel | l. 422 | `src/data.ts:749` | oui |
| Attaque à distance 1-3 | implémenté et fonctionnel | l. 423 | `src/data.ts:750` | oui |
| Amélioration armure 1-3 | implémenté et fonctionnel | l. 424 | `src/data.ts:751`, `src/sim/combat.ts:49` | oui |
| Célérité naine | implémenté et fonctionnel | l. 425 | `src/data.ts:752` | oui |
| Coup puissant | implémenté autrement (1 coup sur 4, sans hasard) | l. 426 | `src/data.ts:754` | oui |
| Peau de roc | implémenté et fonctionnel | l. 427 | `src/data.ts:755` | non |
| Prescience d'Yggdrasill | implémenté et fonctionnel | l. 428 | `src/data.ts:756`, `src/sim/world.ts:492` | non |
| Drake géant | implémenté et fonctionnel | l. 429 | `src/data.ts:757` | non |
| Offrandes | implémenté et fonctionnel | l. 430 | `src/sim/world.ts:625-626` | oui |
| Armure zodiacale | implémenté et fonctionnel | l. 431 | `src/data.ts:759` | non |
| Déracinement (« amélioré à l'autel ») | implémenté et fonctionnel | l. 399 | `src/data.ts:758` | non |

L'IA renonce à Peau de roc, Prescience, Drake géant, Armure zodiacale et Déracinement par choix mesuré (commit 5630033 : ces recherches prenaient l'énergie de l'armée).

### Mécaniques

| Mécanique | Statut | Référence | Code |
|---|---|---|---|
| Les dieux font office de casernes (invocation à leurs pieds, à l'arrêt) | implémenté et fonctionnel | `camp-dieux.md` §2.1 | `src/sim/world.ts:723`, point de ralliement `src/game/hud-card.ts:150` |
| Rangs, « 2 sur 3 » vivants | implémenté et fonctionnel | images de l'arbre (l. 778), `camp-dieux.md` §2.2 | `requiresAny`, `src/sim/world.ts:679-682` |
| Dieux uniques, réinvocation immédiate au niveau 1 | implémenté et fonctionnel | l. 402 (« réinvoqués ») | `lacks()` : « Un seul par joueur. » ; deuil retiré (`BALANCE.md`) |
| Gaïa qui revient seule | implémenté et fonctionnel | `camp-dieux.md` §5 q4 | `respawn: 45` |
| Organique ou mécanique | implémenté et fonctionnel | `camp-dieux.md` §5 q12 | seul le Sphinx est `mechanical`. Golem et Titan ne le sont pas, contrairement à la proposition q12 |
| Détection des camouflés | implémenté et fonctionnel | l. 649 | dieux, Corbeau, Yggdrasill avec Prescience |
| Ressource éthérée, foi, prière | absent (choix assumé) | l. 390 | `camp-dieux.md` §5 q13 |

### Manques à combler

1. **Lumière ardente (Apollon)**, aussi appelée « Aveuglement ».
   - Référence : notice l. 364, sans ambiguïté sur l'effet (déplacement et attaque réduits « drastiquement », infanterie ennemie, large zone).
   - Chiffres : XC.doc donne vitesse et cadence divisées par 2, zone de 100 à 233 (soit environ 1 à 2,3 cases), durée de 25 à 45 s par niveau, recharge 10 s. La notice dit « large zone » : une zone plus grande, autour de 3 cases, serait plus fidèle. À trancher.
   - Où : `ABILITIES` (`src/data.ts`), `balance.json` abilities, `castAt` (`src/sim/abilities.ts`). Il faut un état « ralenti » sur l'entité, du type de `chill` (`src/sim/combat.ts:134`), et un effet sur la cadence, du type d'`artagilite` (`:357`). Ajouter le sort à `CROWD` dans l'IA et un bouton sur Apollon.
   - Difficulté : faible à moyenne.
2. **Jet de sable (Seth)**.
   - Référence : notice l. 368. Les véhicules ne peuvent « quasiment » plus attaquer ni se déplacer.
   - Chiffres : aucun, ni dans la notice ni dans XC.doc. Valeur provisoire nécessaire, par exemple sur le modèle de la Charge de napalm : cible mécanique unique, `held` 4 à 6 s, recharge 20 s.
   - Où : `castAt`, sur le modèle de `napalm` (`src/sim/abilities.ts:352-357`).
   - Difficulté : faible.
3. **Réparation des bâtiments par l'Esprit**.
   - Référence : notice l. 314, sans ambiguïté.
   - Chiffres : XC.doc donne 8 PV/s, +2 par réparateur de plus, au coût « total/PV total ». La réparation Z existe déjà (`rules` `repairHp`/`repairPercent`).
   - Où : étendre la condition `e.type === 'drone'` de `src/sim/commands.ts:313` à l'Esprit, bâtiments seulement. L'ordre `repair` existe déjà (`src/sim/world.ts:846-870`).
   - Difficulté : faible.
4. **Seth plus cruel avec les faibles**.
   - Référence : notice l. 368. « Les plus faibles » est ambigu : peu de PV max, ou blessés ? `camp-dieux.md` §4.1 a choisi « unités blessées ».
   - Chiffres : aucun. Valeur provisoire, par exemple +50 % contre une cible sous 50 % de vie.
   - Où : `hit()`, `src/sim/combat.ts` vers la ligne 404.
   - Difficulté : faible.
5. **Frigg ciblée comme unité terrestre**.
   - Référence : notice l. 380, sans ambiguïté. Aujourd'hui, les unités de mêlée ne peuvent pas l'attaquer.
   - Chiffres : aucun nécessaire.
   - Où : séparer « se déplace sans tenir compte du terrain » de « est une cible aérienne ». Par exemple un drapeau `hover` sur `UnitDef` : `flies()` ou ses appels de ciblage (`reaches(a, flies(t))`, `src/sim/combat.ts:344`, `:372`, `:466`, `:546`) l'ignorent, la pathfinding le garde. Rendu et sélection à vérifier.
   - Difficulté : moyenne, car `flies()` est utilisé partout.
6. **Lévitation de l'Élémentaire d'eau**.
   - Référence : notice l. 333 : il « survole un grand nombre d'obstacles ».
   - Chiffres : aucun nécessaire.
   - Où : le même drapeau `hover` que pour Frigg.
   - Difficulté : faible une fois le point 5 fait.
7. **Armée des enfers : fin des fantômes après un plafond de dégâts infligés**.
   - Référence : notice l. 386.
   - Chiffres : aucun dans la notice. `camp-dieux.md` §5 q16 propose 300 dégâts ou 20 s.
   - Où : compteur sur l'entité, dans `hit()`.
   - Difficulté : faible.
8. **Effets secondaires des Élémentaires et du Golem**.
   - Contenu :
     - zone pour la forme de feu : 0,8 selon `camp-dieux.md` §4.2 ;
     - bonus de la forme de terre contre l'infanterie : non mécanique et non bête, valeur provisoire ;
     - imprécision du Golem contre une cible qui bouge, par exemple dégâts réduits si la cible a bougé depuis le départ du tir (valeur provisoire) ;
     - bonus du Golem réservé aux bâtiments.
   - Référence : notice l. 334, 335, 339.
   - Où : `src/balance.json` (`splash`) et `hit()`.
   - Difficulté : faible à moyenne.
9. **Amon-Râ aveugle**.
   - Référence : notice l. 405. Réduire la vue des cibles pendant l'effet. Lire ou retirer `max: 6`.
   - Où : `src/sim/abilities.ts:256-258`, `src/sim/vision.ts`.
   - Difficulté : moyenne, car la vision dépend des unités.
10. **Osiris, « torrents de pourriture »** (si on le traite comme un sort).
    - Chiffres : le sort « Putréfaction » de XC.doc : 10 à 20 dégâts par seconde sur les organiques, 11 à 15 s, zone de 200 à 333, ralentissement de 10 à 30.
    - Où : nouveau sort, sur le modèle de `explosiftoxique`.
    - Difficulté : faible. Demande d'abord une décision.
11. **Jormungand « indestructible »**.
    - Référence : notice l. 354. Pour l'instant 1500 PV.
    - Option : `invuln` comme les fantômes, ou beaucoup plus de PV. Chiffres : aucun.
    - Difficulté : triviale. Revient à l'équilibreur.
12. **IA**. Elle ne se sert pas de la Téléportation et de la Flèche de Gaïa, de la Chouette, du Voyage souterrain, de la Mutation et de la Fusion (donc jamais de Golem), du Déracinement, ni du transport par Drake. Hors périmètre de la notice. Difficulté moyenne pour chacun.

### Décisions possibles

1. **Qui bâtit l'Autel (Temple de vénération), la Fontaine et l'Artefacterie ?**
   - La notice (l. 361, 380, 383, 408) et `camp-dieux.md` §3.3 disent Thor, Osiris et Frigg.
   - Le code les fait bâtir par Gaïa, avec le dieu vivant pour prérequis.
   - Recommandation : garder le code, et corriger le tableau 3.3 de `camp-dieux.md` pour qu'il dise « exige Thor, Osiris, Frigg ». Faire bâtir des dieux-casernes compliquerait l'interface pour un gain faible.
2. **Frigg, cible terrestre ou aérienne ?**
   - La notice est explicite : cible terrestre.
   - Recommandation : suivre la notice (manque n°5).
3. **Panthéon de la notice ou de XC.doc 2008 ?**
   - `plan-dieux-2008.md` §0.1 propose le panthéon 2008 : Odin au rang 1, Thor au rang 2, Loki et Zeus au lieu de Frigg et Hadès.
   - Le jeu suit la notice, référence n°1.
   - Recommandation : garder la notice, et ne prendre à XC.doc que ses chiffres.
4. **Élémentaire : forme de base ou non ?**
   - La notice décrit une forme de base « chétive » plus quatre formes. XC.doc parle d'« élémentaires d'énergie », seuls à pouvoir fusionner.
   - Le code invoque directement la forme de feu, et toute forme peut fusionner.
   - Recommandation : garder le code (plus lisible), sauf si l'utilisateur tient à la forme de base.
5. **« Les plus faibles » pour Seth** : peu de PV max, ou blessés ? Recommandation : blessés, comme `camp-dieux.md` §4.1.
6. **Osiris, « torrents de pourriture et de peste »** : un simple texte d'ambiance, ou le sort Putréfaction de XC.doc ? Recommandation : texte d'ambiance. La notice ne nomme que l'aura et la Nuée comme capacités.
7. **Golem et Titan, organiques ou mécaniques ?**
   - `camp-dieux.md` §5 q12 proposait « mécaniques ». Le code ne marque que le Sphinx.
   - Conséquence : la Fontaine soigne le Golem et le Titan, et l'aura putride adverse les blesse.
   - Recommandation : suivre q12 (`mechanical: true`), après accord de l'équilibreur.
8. **Lumière ardente, taille de zone** : celle de XC.doc (environ 1 à 2,3 cases) ou une « large zone » comme dit la notice (environ 3 à 4 cases) ? Recommandation : la notice, puis faire valider le chiffre par l'équilibreur.

Toutes les statistiques des Dieux restent provisoires (`BALANCE.md` l. 42-52). Aucun chiffre ci-dessus ne doit être réglé sans l'équilibreur.

## Suivi de la phase 2

À compléter au fil des commits de comblement.

