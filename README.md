# Xcraft

RTS jouable dans le navigateur, en 3D isométrique façon StarCraft 1, d'après le projet Xcraft (voir `ROADMAP.md`).

**Jouer :** https://maxbecq.github.io/xcraft/
**Regarder deux IA s'affronter :** https://maxbecq.github.io/xcraft/?spectate&speed=2
**Isdaris contre Isdaris :** https://maxbecq.github.io/xcraft/?spectate&speed=2&camp=isdaris&adversaire=isdaris

## Camps jouables

- **Humains** (récup', Mad Max / Terran) : Serf, Auxiliaire, Légionnaire-scieur, Soigneur ; Conseil des Échevins, Grenier, Caserne, Mine (sur puits énergétique, produit l'énergie, coûte 4 de logistique), Forge, Tour alchimistique (détecte les unités invisibles).
  - **Forge** : améliorations en 3 niveaux (attaque corps à corps, attaque à distance : +10 % des dégâts de base par niveau, au moins +1 ; armure infanterie : +1 par niveau), 250/350/450 minerai et autant d'énergie, recherchées dans sa file comme des unités ; le niveau 2 demande deux Casernes, le niveau 3 aussi une Tour alchimistique (bouton grisé, la raison dans son info-bulle). **Observation céleste** (`O`, 50 énergie) : révèle une zone et y détecte les invisibles pendant 10 s.
  - Capacités : Auxiliaire **Stimulant** (`T`, −10 PV, attaque et marche 50 % plus vite 8 s), Légionnaire **Charge** (`C`, vitesse doublée 3 s), Soigneur **Peau de roc** (`R`, l'allié le plus blessé à 4 cases subit 5 dégâts de moins par coup pendant 35 s).
- **Isdaris** (SF Art déco) : Robot moissonneur, Archer, Créature (régénère), Druide, Assassin (invisible en permanence, tue un ouvrier d'un coup, mais 70 de bouclier au lieu des 210 du mod : quatre Auxiliaires le battent une fois détecté) ; Obélisque (**Rappel**, `R`, 100 énergie, recharge 60 s : jusqu'à 8 unités de l'armée à 5 cases du point visé se figent 4 s puis apparaissent autour de l'Obélisque, étourdies 4 s), Émetteur, Réserve psy, Portail, Récepteur, Orbe plasma (défense contre les unités au sol, détecte les invisibles). Boucliers psy (absorbent les dégâts, se rechargent hors combat, vite près d'une Réserve psy). Bâtiments matérialisés depuis l'orbite par un grand rayon venu de l'Obélisque le plus proche : le robot est libre aussitôt, le bâtiment se construit seul, et doit être dans un champ d'énergie (Obélisque, Émetteur) sauf l'Obélisque et le Récepteur. Un Émetteur doit toucher de sa zone le réseau relié à l'Obélisque : coupé du réseau (relais détruit), il n'alimente plus rien. Les zones d'émission épousent le terrain (vives pendant le placement) et les rayons de lumière montrent le réseau.
- Ressources : minerai (récolté par les serfs) et énergie (produite par les mines).
- Brouillard de guerre : on ne voit pas en haut d'une falaise depuis le bas.
- Invisibilité : une unité invisible n'est vue ni ciblée par l'adversaire que près d'un de ses détecteurs (Tour alchimistique, Orbe plasma, Observation céleste). Ses propres unités invisibles sont dessinées translucides.
- Victoire : détruire tous les bâtiments adverses.
- IA : trois difficultés (facile, normale, difficile) par handicap de récolte (70 %, 100 %, 130 %). Elle défend toute sa base (sa vague revient si elle est en infériorité chez elle, les ouvriers repoussent un petit raid sans armée), vise d'abord le QG ennemi et ses ouvriers, et replie un groupe qui se ferait massacrer (les Isdaris plus tôt : leurs boucliers se rechargent). Les Assassins vont seuls chasser les ouvriers. Les unités qui frappent un bâtiment se tournent vers un ouvrier puis un soldat qui arrive. En spectateur, aucun ordre n'est possible.
- Planètes : Désert, Lune (régolithe gris, dunes, rien que des pierres), Monde étrange.

Stats issues du mod SC2 « XC Mod 1.53 ».

## Contrôles

| Action | Commande |
|---|---|
| Sélectionner | clic gauche, rectangle, `Maj` pour ajouter |
| Déplacer / récolter / attaquer / ralliement | clic droit |
| Attaquer, attaque-déplacement | `A` puis clic |
| Stop / Construire (serf) / Annuler | `S` / `B` / `Échap` |
| Groupes | `Ctrl`+`1`…`9`, rappel `1`…`9` (deux fois : centrer) |
| Caméra | flèches, bords de l'écran, minimap, glisser avec le clic molette, deux doigts sur le trackpad ; molette ou pincer pour zoomer |
| Toute l'armée | `F2` ou bouton ⚔ Armée |
| Menu et pause | `F1`, `F10` ou bouton ≡ Menu (reprendre, contrôles, recommencer, quitter) |

**Sur téléphone ou tablette** (en portrait ou en paysage) : tap pour sélectionner puis tap pour donner l'ordre, double tap pour toutes les unités du même type à l'écran, glisser un doigt pour déplacer la vue, pincer pour zoomer, appui long puis glisser pour un rectangle de sélection.

Paramètres d'URL : `?play` (sans écran titre), `?ai=easy|normal|hard` (difficulté), `?spectate` (IA contre IA, sans brouillard, avec l'interface du camp `camp` ; `?ai0=` et `?ai1=` donnent la difficulté de chaque IA), `?speed=4` (vitesse ×4), `?replay` (revoit la dernière partie ; le menu propose aussi « Revoir la dernière partie » et « Ouvrir un replay… », et le menu pause « Enregistrer le replay »), `?lowfx` (sans post-traitement, pour les petites machines), `?noink` (sans le trait encré façon BD), `?biome=desert|lune|alien` (planète), `?camp=humains|isdaris` et `?adversaire=humains|isdaris` (factions) — aussi au choix dans le menu : « Nouvelle partie » ouvre un écran où l'on règle chaque joueur (camp, vous ou IA facile, normale, difficile), la planète et, entre deux IA, la vitesse.

## Développement

```bash
npx -y npm@11.6.2 install   # npm 10 plante sur l'installation de vitest
npm run dev                 # http://localhost:5173/xcraft/
npm test                    # simulation, pathfinding, économie, combat, IA
npm run balance             # rapport minute par minute d'une partie IA contre IA
BIG=1 npx vitest run scripts/big.test.ts --silent=false --reporter=verbose   # équilibre des factions sur 50 parties
npm run models              # régénère les modèles .glb et les icônes avec Blender
```

Architecture :

- `src/sim/` : simulation déterministe en entiers (virgule fixe, 20 ticks/s), pilotée uniquement par des commandes. Prête pour les replays et le multijoueur lockstep.
- `src/ai/` : IA qui joue par commandes, comme un humain.
- `src/render/`, `src/game/` : rendu Three.js, HUD et contrôles. Le rendu lit la simulation et ne la modifie jamais.
- `tools/blender/models.py` : modèles low-poly générés par script (Blender 5.3, sans interface), membres animables séparés, décors (`doodads.glb`) et icônes du HUD. La matière nommée `team` prend la couleur du joueur.
- `tools/meshy/` : personnages générés par IA, avec les clés `OPENAI_API_KEY` et `MESHY_API_KEY` dans l'environnement. `sketch.mjs` dessine un concept (gpt-image-2), `img3d.mjs` en fait un modèle texturé (Meshy image-to-3D), `rig.mjs` ajoute squelette et animations, `pack.py` (Blender) regroupe les clips et réduit la texture dans `public/models/<type>-meshy.glb`. `repaint.mjs` repeint un rendu d'un ancien modèle Blender en concept (bâtiments humains, pour garder leurs formes simples), `gen.mjs` (texte vers 3D) et `prop.py` servent aux armes, accrochées à l'os de la main droite. Les bandes bleues de la texture prennent la couleur du joueur. `CHARACTERS` et `STATIC_MESHY` (`src/render/units.ts`) listent les unités qui utilisent ces modèles (toutes aujourd'hui), `?proc` revient aux modèles Blender. `icons.py` (Blender) rend les icônes du HUD depuis ces modèles, `upgrade-icons.mjs` et `.py` celles des améliorations de la Forge. `compress.sh` finit chaque modèle (textures 512 px en WebP, maillage compressé meshopt : environ trois fois plus léger). `thin.mjs <ratio>` allège ensuite le maillage des unités et des armes (0.25 : environ 4 000 sommets par personnage), pour les grandes batailles. Les robots, créatures et bâtiments passent par `normalize.py`, sans squelette (`FOOTPRINT=<largeur>` cale un bâtiment sur son emprise au sol). Les textures humaines, ternes, sont ravivées dans le shader (saturation et lumière).
- `src/render/` : terrain texturé procédural (falaises rocheuses inclinées, diagonales lissées), décors instanciés, particules, post-traitement (occlusion ambiante GTAO, trait encré et étalonnage façon BD peinte, bloom, tone mapping ACES, SMAA). Les modèles sont « peints » en couleurs de sommets dans Blender (rehauts sur les arêtes, dégradés).
- Sons : bruitages synthétisés en WebAudio. La musique sera ajoutée à part.
- `src/data.ts` : toutes les stats des unités et bâtiments.
