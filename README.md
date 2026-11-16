# Xcraft

RTS jouable dans le navigateur, en 3D isométrique façon StarCraft 1, d'après le projet Xcraft (voir `ROADMAP.md`).

**Jouer :** https://maxbecq.github.io/xcraft/
**Regarder deux IA s'affronter :** https://maxbecq.github.io/xcraft/?spectate&speed=2

## Camps jouables

- **Humains** (récup', Mad Max / Terran) : Serf, Auxiliaire, Légionnaire-scieur, Soigneur ; Conseil des Échevins, Grenier, Caserne, Mine (sur puits énergétique, produit l'énergie, coûte 4 de logistique).
- **Isdaris** (SF Art déco) : Robot moissonneur, Archer, Créature (régénère), Druide ; Obélisque, Émetteur, Réserve psy, Portail, Récepteur. Boucliers psy (absorbent les dégâts, se rechargent hors combat, vite près d'une Réserve psy). Bâtiments matérialisés depuis l'orbite : le robot est libre aussitôt, le bâtiment se construit seul, et doit être dans un champ d'énergie (Obélisque, Émetteur) sauf l'Obélisque et le Récepteur.
- Ressources : minerai (récolté par les serfs) et énergie (produite par les mines).
- Brouillard de guerre : on ne voit pas en haut d'une falaise depuis le bas.
- Victoire : détruire tous les bâtiments adverses.
- IA : trois difficultés (facile, normale, difficile) par handicap de récolte (70 %, 100 %, 130 %).

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
| Aide | `F1` |

**Sur téléphone ou tablette** (en portrait ou en paysage) : tap pour sélectionner puis tap pour donner l'ordre, double tap pour toutes les unités du même type à l'écran, glisser un doigt pour déplacer la vue, pincer pour zoomer, appui long puis glisser pour un rectangle de sélection.

Paramètres d'URL : `?play` (sans écran titre), `?ai=easy|normal|hard` (difficulté), `?spectate` (IA contre IA, sans brouillard), `?speed=4` (vitesse ×4), `?lowfx` (sans post-traitement, pour les petites machines), `?noink` (sans le trait encré façon BD), `?biome=desert|alien` (planète), `?camp=humains|isdaris` et `?adversaire=humains|isdaris` (factions) — aussi au choix dans le menu.

## Développement

```bash
npx -y npm@11.6.2 install   # npm 10 plante sur l'installation de vitest
npm run dev                 # http://localhost:5173/xcraft/
npm test                    # simulation, pathfinding, économie, combat, IA
npm run balance             # rapport minute par minute d'une partie IA contre IA
npm run models              # régénère les modèles .glb et les icônes avec Blender
```

Architecture :

- `src/sim/` : simulation déterministe en entiers (virgule fixe, 20 ticks/s), pilotée uniquement par des commandes. Prête pour les replays et le multijoueur lockstep.
- `src/ai/` : IA qui joue par commandes, comme un humain.
- `src/render/`, `src/game/` : rendu Three.js, HUD et contrôles. Le rendu lit la simulation et ne la modifie jamais.
- `tools/blender/models.py` : modèles low-poly générés par script (Blender 5.3, sans interface), membres animables séparés, décors (`doodads.glb`) et icônes du HUD. La matière nommée `team` prend la couleur du joueur.
- `tools/meshy/` : personnages générés par IA, avec les clés `OPENAI_API_KEY` et `MESHY_API_KEY` dans l'environnement. `sketch.mjs` dessine un concept (gpt-image-2), `img3d.mjs` en fait un modèle texturé (Meshy image-to-3D), `rig.mjs` ajoute squelette et animations, `pack.py` (Blender) regroupe les clips et réduit la texture dans `public/models/<type>-meshy.glb`. `gen.mjs` (texte vers 3D) et `prop.py` servent aux armes, accrochées à l'os de la main droite. Les bandes bleues de la texture prennent la couleur du joueur. `CHARACTERS` et `STATIC_MESHY` (`src/render/units.ts`) listent les unités qui utilisent ces modèles (toutes aujourd'hui), `?proc` revient aux modèles Blender. Les robots, créatures et bâtiments passent par `normalize.py`, sans squelette (`FOOTPRINT=<largeur>` cale un bâtiment sur son emprise au sol). Les textures humaines, ternes, sont ravivées dans le shader (saturation et lumière).
- `src/render/` : terrain texturé procédural (falaises rocheuses inclinées, diagonales lissées), décors instanciés, particules, post-traitement (occlusion ambiante GTAO, trait encré et étalonnage façon BD peinte, bloom, tone mapping ACES, SMAA). Les modèles sont « peints » en couleurs de sommets dans Blender (rehauts sur les arêtes, dégradés).
- Sons : bruitages synthétisés en WebAudio. La musique sera ajoutée à part.
- `src/data.ts` : toutes les stats des unités et bâtiments.
