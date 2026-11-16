# Xcraft — Roadmap vers une V1 web

## 1. Ce qu'on garde de l'existant

**Source de vérité gameplay : `Old_Project/notice 1.2.doc`**
- 4 camps : **Humains** (antique + alchimie), **Isdaris** (high-tech, boucliers psy, téléportation), **Dieux** (divinités qui invoquent les unités), **Z** (nid d'insectes métalliques, socles + armes modulaires, creep).
- 2 ressources : **minerai** et **énergie** (puits énergétique → Mine / Récepteur / Puits / Assimilateur).
- Logistique (supply) : Grenier / Réserve psy / Branche d'Yggdrasill / Pod.
- Améliorations à 3 niveaux (attaque mêlée, distance, armure) + capacités par unité.

**Mod SC2 (`Version mod starcraft2/`, XC Mod 1.53)** : Humains + Isdaris + camp insectoïde réellement jouables. Les stats (PV, dégâts, coûts, temps) sont dans les données du mod → à extraire pour équilibrer la V1 au lieu de partir de zéro.
**`Opening_humains.docx`** : 5 builds Humains détaillés → base directe du script de l'IA.

**Moteur C++/SFML (`Version développement/`)** : non réutilisé. Idées à reprendre : A* (`Game/AI/astar.cpp`), séparation commandes/objets (`Game/Commands`), éditeur d'objets data-driven.

**Leçons de Battledrones** (Simon Willison, oct. 2026) : TypeScript + Three.js, simulation déterministe séparée du rendu, site statique (PWA), modèles 3D faits en code au début, matchs IA-vs-IA automatisés pour équilibrer, multijoueur plus tard via un petit relais WebSocket.

## 1 bis. Direction artistique

Base commune : vue isométrique 3D façon SC1, low-poly lisible, couleur d'équipe sur les grandes surfaces.

- **Humains** : low tech et débrouillards, mélange de Mad Max et des Terrans. Tôle rouillée, plaques soudées, récup', bidons, tuyaux, fumées. L'alchimie de la notice devient de la chimie bricolée : fioles, réservoirs, flammes de napalm.
- **Isdaris** : science-fiction classique des années 1930 à 1950, design épuré et Art déco. Lignes courbes élégantes, chromes, grande place à la lumière et aux rayons.
- **Dieux** : entités magiques, mythologie et fantasy façon Warcraft III. Matériaux nobles, runes, auras, couleurs saturées.
- **Z** : robotique très sophistiquée et technologique. Insectes métalliques, carbone et néons, articulations précises, creep de câbles.

## 2. Périmètre V1 (très simple)

- **1 camp : Humains**, en miroir, contre **1 IA** scriptée.
- **1 carte** 2 joueurs, 2–3 niveaux de hauteur (falaises/rampes comme SC1).
- **Unités** : Serf, Auxiliaire (distance), Légionnaire-scieur (mêlée), Soigneur (soin auto).
- **Bâtiments** : Conseil des Échevins, Mine (énergie), Grenier (logistique), Caserne, Fortin (optionnel).
- **Mécaniques** : récolte, construction, file de production, supply, combat, attack-move, brouillard de guerre, victoire = destruction de tous les bâtiments adverses.
- **Hors V1** : autres camps, améliorations, capacités actives, aérien, multijoueur, éditeur, campagne, son élaboré.

## 3. Stack proposée

| Besoin | Choix | Pourquoi |
|---|---|---|
| Langage | **TypeScript** | typé, outillage web natif |
| Build/dev | **Vite** | zéro config, HMR |
| Rendu | **Three.js** (WebGL2) | mûr, prouvé par Battledrones |
| Caméra | `OrthographicCamera`, lacet 45°, tangage ~35° | rendu « iso SC1 » mais en vraie 3D |
| Simulation | TS pur, tick fixe 20 Hz, entiers / virgule fixe, RNG seedé | déterminisme → replays, tests, lockstep plus tard |
| Pathfinding | grille + A* (puis flow fields pour gros groupes) | simple, suffisant en V1 |
| HUD | HTML/CSS par-dessus le canvas (minimap en canvas 2D) | plus simple que de l'UI en WebGL |
| Données | fichiers TS/JSON (`units.ts`, `buildings.ts`) | équilibrage sans toucher au code |
| Tests | **Vitest** (sim headless, IA vs IA) | équilibrage automatisé |
| Assets 3D | **Blender 5.3 automatisé** en headless (`Blender -b -P script.py`, API `bpy`) : scripts Python qui construisent chaque modèle, puis export glTF (`.glb`) ou rendu de sprites | pipeline reproductible, regénérable à volonté |
| Déploiement | site statique (GitHub Pages ou Cloudflare Pages) | gratuit, aucun serveur |
| Multijoueur (post-V1) | lockstep sur relais WebSocket (Node/Bun) | la sim déterministe le permet |

Pas de moteur lourd (Unity/Godot) ni de librairie ECS : inutile pour la V1.

### Look « 3D isométrique SC1 amélioré »
- Caméra fixe (pas de rotation), orthographique, zoom limité.
- Terrain en tuiles avec niveaux de falaise, textures par biome.
- Modèles low-poly lisibles, silhouettes fortes, **couleur d'équipe** via masque.
- Ombres douces, occlusion ambiante (SSAO), léger contour (outline) pour la lisibilité, cercles de sélection, particules (tirs alchimiques, feu, fumée).
- Direction artistique Humains : antique/médiéval + tubes de liquide, flammes perpétuelles (cf. notice).

## 4. Jalons

État au 16/11/2026 : **M0 à M6 livrés**, V1 jouable en ligne (voir README).

Faits en plus pendant la nuit du 15 au 16/11 :
- IA en trois difficultés, IA contre IA en arrière-plan de l'écran titre.
- Passe visuelle vers StarCraft II : post-traitement, terrain texturé à falaises rocheuses, décors, membres animés, particules, console d'interface en tôle.
- Modèles Humains refaits dans la DA Mad Max / Terran.

V2 en cours (17/11/2026) : **Isdaris jouables** (boucliers, matérialisation, champ d'énergie, IA, modèles Art déco). Équilibre IA contre IA : 7-7 sur 14 parties. Gameplay V2 (17/11/2026) : Forge et améliorations (3 niveaux), capacités actives Humains (Stimulant, Charge, Peau de roc), Assassin invisible, détection (Tour alchimistique, Observation céleste de la Forge, Orbe plasma), Orbe plasma (défense) ; l'IA s'en sert. Équilibre IA contre IA : 7-7 sur 14 parties, sans nulle. Ensuite : prérequis des améliorations (niveau 2 : deux Casernes, niveau 3 : Tour alchimistique), Assassin affaibli (bouclier 210 → 70), **Rappel** de l'Obélisque (téléportation, valeurs du mod), l'IA ne lance plus l'Observation céleste qu'à l'endroit où un invisible non détecté vient de frapper et rappelle une vague qui perd loin de chez elle. Équilibre IA contre IA : 7-7 sur 14 parties. Reste : unités aériennes (la Tour alchimistique n'a pas encore son canon anti-air), modèles et icônes des nouveautés (placeholders).

Nov. 2026 : multijoueur en ligne à deux (WebRTC), parties de 2 à 4 joueurs avec équipes contre l'IA, premier palier de l'arbre du mod (Phalangiste ; Nano-assembleur et Chasseur Discobole). Arbre du mod restant (extrait de `XC Mod 1.53`) : Humains — Guildes alchimistique et des dresseurs-marchands, Belluaire, Alchimisterie (Alchimiste, Cuve à efférents), Machinerie (Toptère, Dirigeable d'appui, Transport scarabée, Pegasus), Creaturium (Rodactylus, Kylosaurus, Carnosaurus), Fortin ; Isdaris — Portail et Nano-assembleur améliorés (rouge, bleu, vert), Orbe de commandement (boucliers, capacités), Guerrier, Protecteur, Baliste, Prisme, Chimère, Dragon, Voyageur, Behemoth, Trône d'Altar Sargon. L'aérien demande d'abord le vol dans la simulation.

**M0 — Socle (½ j)** ✅
Vite + TS + Three.js + Vitest, déploiement auto sur Pages, `Old_Project/` exclu de git.
*Fini quand* : page vide déployée en ligne.

**M1 — Terrain & caméra** ✅
Carte en tuiles avec hauteurs, caméra iso, scroll bords d'écran / flèches, zoom borné, minimap.
*Fini quand* : on se balade sur la carte.

**M2 — Cœur de simulation** ✅
Boucle à tick fixe + interpolation de rendu, entités, sélection (clic, rectangle, Maj, groupes Ctrl+1..9), ordre de déplacement, A*, évitement simple.
*Fini quand* : on sélectionne et déplace 20 unités ; test de déterminisme (même seed → même état).

**M3 — Économie** ✅
Serfs récoltent minerai/énergie, Conseil, placement de bâtiments sur grille, chantier, Grenier (supply), file de production Caserne.
*Fini quand* : on monte une base et produit des unités.

**M4 — Combat** ✅
PV/armure, attaque mêlée/distance, acquisition de cible, attack-move, mort, Soigneur, brouillard de guerre, condition de victoire.
*Fini quand* : une partie peut être gagnée/perdue contre un adversaire passif.

**M5 — IA** ✅
IA scriptée d'après l'opening « Bioball auxiliaire » simplifié ; mode IA vs IA headless ; boucle d'équilibrage (stats extraites du mod SC2).
*Fini quand* : l'IA bat un débutant et 100 parties IA-vs-IA se terminent toutes.

**M6 — Habillage → V1** ✅
Modèles Humains, animations simples, effets, HUD façon SC (portrait, cartes de commande, raccourcis), sons de base, écran titre.
*Fini quand* : V1 jouable en ligne de bout en bout.

## 5. Après la V1 (ordre suggéré)
1. Améliorations Forge + capacités actives Humains.
2. Replays (export JSON des ordres).
3. **Isdaris** (bouclier psy, téléportation : le plus différenciant visuellement).
4. Multijoueur 1v1 lockstep.
5. **Z** (socles + armes modulaires, creep) puis **Dieux** (divinités/invocations).
6. Éditeur de cartes, campagne.

## 6. Décisions
- Camp V1 : **Humains**.
- Cible : **desktop** (souris + clavier).
- Hébergement : **GitHub Pages**.
- Assets : **Blender automatisé par scripts Python**, dans `tools/blender/`. Chaque script construit un modèle, applique un matériau avec zone de couleur d'équipe, exporte un **`.glb`** chargé par Three.js, et rend l'icône et le portrait du HUD.
- Rendu en jeu : **vrais modèles 3D `.glb`** (pas de sprites pré-rendus).
