# Déclencheurs dans les cartes : étude de faisabilité

24 novembre 2026. Étude écrite avec le prototype d'éditeur de cartes (`editor.html`, `src/editor/`). Rien de la simulation n'a été modifié ; les changements nécessaires sont listés en fin de document.

## En bref

- **Faisable**, à une condition : les déclencheurs sont **une partie de la simulation**, évalués dans `World.step` comme le reste, et ne lisent que l'état simulé. Ils ne lisent ni le rendu, ni l'horloge, ni le hasard du navigateur.
- **Recommandation : (a) une table déclarative en JSON dans le fichier de carte**, avec un petit langage d'expressions pour les conditions et les nombres. Elle est déterministe par construction et sûre pour une carte importée. Elle coûte peu (aucune dépendance) et l'éditeur peut l'écrire avec des formulaires. Elle couvre une campagne et un tower défense.
- **Lua est à écarter pour l'instant.** Il est possible mais cher : il faut un bac à sable, un budget d'instructions, et l'ordre de `pairs` dépend d'une graine de hachage aléatoire en Lua 5.4. Il ajoute 150 à 300 Ko et rend l'éditeur graphique impossible. On pourra l'ajouter plus tard derrière la même interface d'actions si la table ne suffit plus.
- Premier palier utile en **3 à 4 jours** de travail : réglages des joueurs, unités placées, limites techno, minuterie, zones, morts, messages, apparitions, victoire/défaite. Un tower défense jouable demande environ **2 jours de plus**.

## 1. La contrainte : le lockstep déterministe

Le jeu fait tourner la même simulation sur chaque machine (`src/sim`, 20 ticks par seconde, `TICK_RATE` dans `fixed.ts`). Les machines n'échangent que les **ordres** des joueurs (`Command` dans `world.ts`). Un replay n'est que la liste de ces ordres, rejouée sur la carte. Toutes les quelques secondes, une **empreinte** de l'état (`fingerprint.ts`) vérifie que les deux parties en réseau n'ont pas divergé.

Le code prend déjà grand soin du déterminisme. Positions en virgule fixe (`FP`), aucun `Math.random`, et même un sinus maison dans `maps.ts`, car `Math.sin` peut arrondir autrement selon le navigateur.

Ce qu'un déclencheur doit donc respecter :

| Règle | Pourquoi | Conséquence |
|---|---|---|
| Évalué dans `World.step`, à un moment fixe du tick | Chaque machine doit voir le même état au même moment | Un point d'appel : après les ordres et la pensée des unités, avant `judge()` |
| Ne lit que l'état simulé | Le rendu, la caméra et la sélection diffèrent d'une machine à l'autre | Pas de « quand la caméra voit… », pas de « quand le joueur clique… » hors ordres |
| Nombres entiers ou virgule fixe | Les flottants sont sûrs pour + − × ÷ en IEEE, pas pour `Math.sin`, `Math.pow`, `toFixed` | Le langage d'expressions ne connaît que des entiers |
| Hasard par un générateur à graine, dans l'état | `Math.random` diffère partout | Un `rng` de la simulation, compté dans l'empreinte |
| Ordre d'évaluation fixe | Deux déclencheurs qui se répondent doivent agir dans le même ordre partout | Ordre du fichier ; pas d'itération sur des clés d'objet sans tri |
| État des déclencheurs dans l'empreinte | Une variable divergente doit être vue | Variables, compteurs et déclencheurs « déjà tirés » entrent dans `fingerprint` |
| Le fichier de carte fait partie de la partie | Une carte importée doit être la même chez les deux joueurs et dans le replay | Hachage du fichier échangé avant la partie ; le replay garde le fichier (ou son hachage et la carte du jeu) |
| Coût borné | Un déclencheur lent ralentit la partie des deux côtés ; une boucle infinie la gèle | Budget d'évaluations par tick ; pas de boucle libre |

Bonne nouvelle : la simulation a déjà la plupart des points d'appui. Elle a les morts du tick (`world.deaths`) et les messages aux joueurs (`world.events`, `say`). Elle a aussi `spawn`, les ressources des joueurs (`players[i].minerals`, `energy`) et la victoire (`winner`, `judge`). Les prérequis passent par un point unique, `World.lacks`, utile pour les limites techno.

## 2. Ce qu'un système de déclencheurs doit savoir faire

Inventaire tiré des besoins d'une campagne et d'un tower défense.

**Entrées (quand)**

- Événements : unité tuée (par type, propriétaire, tueur), bâtiment terminé, bâtiment détruit, recherche finie, unité produite.
- Minutage : au tick N, toutes les N secondes, N secondes après un autre déclencheur.
- Zones : une unité (d'un joueur, d'un type) entre dans une zone, en sort, ou y est en nombre ≥ N.
- Seuils : minerai ou énergie d'un joueur ≥ N, nombre d'unités ou de bâtiments d'un type ≥ N.
- Variables de la carte : compteur ≥ N (vagues, objectifs).

**Conditions (si)** : les mêmes mesures, combinées par `et`, `ou`, `non`.

**Actions (alors)**

- Faire apparaître des unités (type, nombre, propriétaire, zone), avec un ordre (attaquer-déplacer vers un point, patrouiller).
- Afficher un message (à un joueur, à tous), un objectif.
- Donner ou retirer des ressources.
- Débloquer ou interdire une technologie.
- Changer le propriétaire d'unités, retirer des unités.
- Victoire ou défaite d'un joueur ou d'une équipe ; couper la victoire par défaut (« plus de bâtiment »).
- Variables : poser, ajouter ; activer ou désactiver un autre déclencheur.
- Tower défense : vagues (liste de groupes et délais), chemin des vagues, vies perdues quand une unité atteint la sortie.

## 3. Les trois voies

### (a) Table déclarative en JSON dans le fichier de carte

Chaque déclencheur est un objet : quand, si, alors. Le moteur est écrit en TypeScript dans `src/sim`, avec un `switch` par sorte d'entrée et d'action.

```json
{
  "regions": { "sortie": [60, 30, 4, 4], "nid": [10, 50, 6, 6] },
  "vars": { "vague": 0, "vies": 20 },
  "triggers": [
    { "id": "debut", "when": { "time": 0 }, "do": [
      { "message": "Tenez 10 vagues.", "to": "all" },
      { "set": "vague", "value": 1 }
    ]},
    { "id": "vague", "when": { "every": 45 }, "if": "vague <= 10", "do": [
      { "spawn": "auxiliaire", "count": "4 + vague * 2", "owner": 3, "in": "nid", "attack": "sortie" },
      { "add": "vague", "value": 1 }
    ]},
    { "id": "fuite", "when": { "enter": "sortie", "owner": 3 }, "do": [
      { "remove": "trigger.units" },
      { "add": "vies", "value": -1 }
    ]},
    { "id": "perdu", "when": { "check": "vies <= 0" }, "once": true, "do": [{ "defeat": 0 }] },
    { "id": "gagne", "when": { "check": "vague > 10 and units(3) == 0" }, "once": true, "do": [{ "victory": 0 }] }
  ]
}
```

Les chaînes comme `"4 + vague * 2"` sont des **expressions** d'un langage minuscule. Il connaît les entiers, + − × ÷ (division entière), les comparaisons, `and`, `or`, `not`, les variables de la carte, et quelques fonctions de lecture comme `units(joueur, type?)`, `minerals(joueur)` ou `time`. Il est lu une fois au chargement de la carte en un arbre. Il n'a ni boucle ni appel de fonction de l'auteur : chaque évaluation est bornée.

### (b) Un langage de script intégré : Lua

Deux machines Lua tournent dans un navigateur :

- **fengari** : Lua 5.3 réécrit en JavaScript. Les nombres sont des flottants JS et des entiers 32 bits émulés.
- **wasmoon** : le vrai Lua 5.4 en C, compilé en WebAssembly. Il charge un fichier `.wasm` de façon asynchrone.

L'auteur écrirait des fonctions `on_unit_killed(u)`, `on_tick(t)`, etc. Le jeu exposerait une API (`spawn`, `message`, `give`…).

### (c) Un sous-ensemble maison

Un petit langage de script à soi, avec variables, `si`, `pour` borné et fonctions : un mini-Lua écrit en TypeScript. En pratique, c'est la voie (a) avec des boucles et des fonctions en plus, donc un interprète complet à écrire et à maintenir.

### Comparaison

| | (a) Table JSON + expressions | (b) Lua (fengari / wasmoon) | (c) Langage maison |
|---|---|---|---|
| **Déterminisme** | Par construction : entiers, ordre du fichier, aucun accès hors état | À construire et à surveiller. Il faut retirer `math.random`, `os.time`, `os.clock`. Il faut trier l'ordre de `pairs` ou l'interdire : en Lua 5.4, la graine de hachage des chaînes est aléatoire par défaut (`luai_makeseed`), donc l'ordre de `pairs` peut différer d'une machine à l'autre. Les flottants sont sûrs pour + − × ÷ mais pas pour `math.sin` et `math.exp`, qui viennent de la bibliothèque C ou de `Math.*`. Les deux machines n'ont pas le même comportement : il faudrait n'en garder qu'une. | Sûr si on le conçoit ainsi, comme (a) |
| **Sécurité (carte importée)** | Pas de code exécuté. Seules les actions prévues existent ; la validation à l'import est simple : un schéma et des bornes de taille. | C'est un vrai langage : il faut un bac à sable (sans `io`, `os`, `debug`, `load`, `require`, `package`, `string.rep` géant…). Il faut aussi un budget d'instructions (`debug.sethook`) et une limite de mémoire. Une erreur de bac à sable devient une faille ou un gel de la partie adverse. | Moyen : on contrôle tout, mais chaque fonction ajoutée est une surface |
| **Performance** | Excellente : quelques comparaisons par tick, un index par sorte d'événement | wasmoon : bonne, mais chaque passage JS ↔ Lua coûte (une unité exposée = des objets traduits). fengari : 10 à 50 fois plus lent que du JS (ordre de grandeur, à mesurer). Des scripts `on_tick` sur 200 unités se sentent sur mobile. | Bonne si interprète d'arbre simple |
| **Taille ajoutée** | Quelques Ko | fengari ≈ 200 à 300 Ko minifié ; wasmoon ≈ 150 à 250 Ko (wasm + colle JS). Ordres de grandeur, à mesurer avant de choisir. | Quelques dizaines de Ko |
| **Facilité pour un créateur** | Très bonne dans l'éditeur (formulaires, listes déroulantes, zones dessinées sur la carte) ; lisible à la main | Bonne pour un programmeur, mauvaise pour les autres ; l'éditeur ne peut qu'offrir une zone de texte | Moyenne : un langage de plus à apprendre, sans documentation ni communauté |
| **Puissance** | Suffisante pour campagne et tower défense ; les cas tordus demandent une nouvelle action en TS | Totale | Totale à terme |
| **Effort** | 3 à 4 jours pour le premier palier, puis par action | 2 à 3 jours pour l'intégration, plus le bac à sable, l'API, l'audit du déterminisme et les tests réseau : 1 à 2 semaines pour un résultat fiable | 1 à 2 semaines, puis maintenance continue |
| **Replays et réseau** | L'état tient en quelques variables : facile à mettre dans l'empreinte | L'état est le tas Lua entier ; l'empreinte ne peut en prendre qu'un résumé, donc une divergence peut passer inaperçue longtemps | Comme (a) |

## 4. Recommandation

**Voie (a)**, pour quatre raisons :

1. **Le déterminisme est gratuit.** Le moteur est du TypeScript de la simulation, soumis aux mêmes règles et aux mêmes tests (replay, empreinte) que le reste. Lua obligerait à prouver le déterminisme d'une machine qu'on ne contrôle pas.
2. **Les cartes importées sont sûres.** Une carte ne peut que décrire, pas exécuter. Le pire cas est une carte mal faite, pas une carte malveillante. C'est décisif dès que l'import de carte locale existe et qu'une carte circule entre joueurs.
3. **L'éditeur peut l'écrire.** Un onglet « Déclencheurs » avec des listes déroulantes et des zones tracées à la souris sur la vue du jeu est à portée. L'éditeur actuel a déjà les outils de pose. Avec Lua, il ne pourrait offrir qu'une zone de texte.
4. **Le besoin est connu et fini.** Une campagne et un tower défense utilisent un nombre limité d'entrées et d'actions. StarCraft (1998) a fait ses campagnes avec une table de ce genre : conditions et actions choisies dans des listes.

Lua reste une **porte ouverte** : si un jour les créateurs butent sur la table, on peut ajouter une action `script` qui appelle wasmoon derrière la même interface d'actions. Cela demanderait une graine de hachage fixée à la compilation et un budget d'instructions. Ce n'est pas utile pour la campagne et le tower défense visés.

## 5. Plan par étapes

Chaque étape se livre seule, avec ses tests (dont un replay qui rejoue la carte à l'identique).

**Étape 0 : le jeu lit le format 2** (prérequis, 1 jour). Voir la section 6. `MapFile2` est accepté à côté du format 1 : `toGameMap` existe déjà dans `src/editor/format2.ts` et ses tests montrent l'égalité tuile par tuile sur les 7 cartes. `createMatch` place les QG aux départs du fichier, donne minerai et énergie par joueur, pose les unités et bâtiments préexistants (neutres compris), et applique les limites techno dans `World.lacks`. Le fichier de carte (ou son hachage) entre dans le replay et dans la poignée de main réseau.

**Étape 1 : le moteur minimal** (1,5 jour). `triggers`, `vars` et `regions` dans le fichier. Le lecteur valide le schéma et compile les expressions en arbre. `World.runTriggers()` est appelé dans `step` juste avant `judge`. Entrées : `time`, `every`, `check`. Actions : `message`, `give`, `set`/`add`, `victory`/`defeat`, `enable`/`disable`, plus l'option `victory: "triggers"` qui coupe la victoire par défaut. Variables et indicateurs « tiré » dans l'empreinte. Budget : au plus N évaluations par tick ; au-delà, le déclencheur s'arrête, de façon déterministe.

**Étape 2 : événements et zones** (1 jour). `killed` part de `world.deaths`, qui existe déjà. `built`, `researched` et `trained` demandent un événement structuré là où la simulation dit aujourd'hui « Construction terminée » en texte. `enter`/`leave`/`inside` utilisent l'index spatial existant (`index()`), évalués tous les 4 ticks comme la vision. Actions : `spawn` (avec ordre `attack`/`move`/`patrol` passé comme un ordre interne), `remove`, `owner`, `allow`/`forbid` techno.

**Étape 3 : l'éditeur** (1 à 1,5 jour). Un onglet « Déclencheurs » : liste, formulaire par déclencheur, zones dessinées sur la vue, variables. Une validation en direct (expression invalide, zone inconnue).

**Étape 4 : tower défense** (2 jours). Une action `waves`, raccourci pour une liste de groupes et de délais. Un chemin des vagues (suite de points), des vies, un mode de carte « défense » où l'IA adverse est remplacée par les vagues, et une carte d'exemple.

**Étape 5 : campagne** (selon le contenu). Enchaînement de cartes, objectifs affichés dans le HUD, report de variables d'une carte à l'autre. Le reste relève du contenu plus que du moteur.

## 6. Changements nécessaires dans la simulation et le jeu

Le prototype ne touche ni `src/sim`, ni `balance.json`, ni les règles. Voici ce qu'il faudra changer pour que le jeu lise tout ce que l'éditeur écrit :

| Où | Changement | Pour |
|---|---|---|
| `src/maps.ts` | Accepter `format: 2` dans `MAPS` et dans l'import de carte locale (session map-design) ; `buildMap` appelle `toGameMap` pour un format 2 | Relief, rampes, gouffres, bases |
| `src/sim/setup.ts` (`createMatch`) | Pour un format 2 : départs par joueur (sans rotation), minerai et puits du fichier, `players[i].minerals/energy`, unités et bâtiments préexistants (`spawn`, neutres en `-1`), race imposée par la carte si elle en fixe une | Réglages des joueurs, unités placées |
| `src/sim/world.ts` (`Player`, `lacks`) | `forbid: Set<string>` par joueur ; `lacks` renvoie « Interdit sur cette carte. » ; le HUD et l'IA lisent déjà `lacks` | Limites techno |
| `src/sim/world.ts` (`step`, `judge`) | `runTriggers()` avant `judge` ; option de victoire par déclencheurs | Déclencheurs |
| `src/sim/fingerprint.ts` | Variables et état des déclencheurs | Réseau |
| `src/game/replay.ts`, `src/net.ts` | Le replay garde la carte importée ; hachage du fichier comparé avant la partie en réseau | Cartes importées en réseau et en replay |
| `src/ai/` | L'IA respecte `forbid` (elle passe déjà par `lacks` pour produire) ; une IA « vague » pour le tower défense | Campagne, défense |
| `src/render/decor.ts` | Objets de décor posés à la main en plus du décor semé | Décor de l'éditeur |

## 7. Ce que le jeu lit aujourd'hui du format 2

**Rien.** Le jeu ne lit que le format 1. L'éditeur exporte et importe le format 2, et ouvre aussi les cartes du jeu (format 1 converti). Dans l'éditeur, la vue est le rendu du jeu sur la structure de carte du jeu : terrain, falaises, rampes, gouffres, biome, minerai, puits, QG, ouvriers, unités et bâtiments placés, décor semé. Les réglages des joueurs (race, ressources), les unités placées, le décor posé à la main et les limites techno n'existent que dans le fichier jusqu'à l'étape 0.

## Sources et réserves

- Les tailles et performances de fengari et wasmoon sont des **ordres de grandeur** à mesurer avant tout choix. Je ne les ai pas mesurées ici.
- L'aléa de la graine de hachage en Lua 5.4 (`luai_makeseed`) concerne le Lua officiel en C, donc wasmoon. Le comportement exact de fengari sur ce point est **à vérifier**.
- Les estimations d'effort supposent un développeur qui connaît `src/sim`.
