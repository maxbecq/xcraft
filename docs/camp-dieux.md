# Camp des Dieux — conception (phase 1)

Quatrième camp de Xcraft, d'après la notice 1.2 et 1.2-1 (`Old_Project/notice 1.2.doc`, `Old_Project/notice_1.2-1.doc` : les deux versions sont identiques pour les Dieux) et l'arbre technologique dessiné page 32 à 34 de la notice.

Ce document ne contient aucun code. Il attend ton accord sur :
1. le périmètre de la **V1 jouable** (section 6) ;
2. la **direction artistique** (section 7 et les planches `docs/concepts-dieux/`) ;
3. les réponses aux **questions** de la section 5.

Toutes les statistiques de la section 4 sont **provisoires** : elles sont calquées sur les unités existantes de `src/balance.json` et reviennent à l'équilibreur.

---

## 1. En une phrase

Les Dieux ne forment pas de soldats dans des bâtiments : **les divinités font office de bâtiments**. Grandes comme des bâtiments, uniques et mobiles, elles invoquent leurs troupes à leurs pieds, sur le champ de bataille, et l'arbre technologique est le panthéon lui-même. Plus le joueur a de dieux vivants, plus il a accès à des troupes, des sorts et des bâtiments.

La notice demande « de l'heroic-fantasy classique, même si quelques innovations ne seront pas nécessairement malvenues ».

## 2. Ce qui distingue les Dieux des trois autres camps

| | Humains | Isdaris | Z | **Dieux** |
|---|---|---|---|---|
| Production | casernes, file d'attente | portails, téléportation | socles + kits d'armes | **les dieux, grands comme des bâtiments, invoquent où qu'ils soient** |
| Arbre techno | bâtiments | bâtiments + extensions | bâtiments + armes | **les dieux eux-mêmes : 3 rangs, « 2 sur 3 » pour passer au rang suivant** |
| Protection | armure | bouclier psy | blindage, réparation sur creep | **armure lourde + soins et résurrection** |
| Population | grenier | récepteurs | pods | **Branche d'Yggdrasill (qui se bat, puis devient tour, puis se déplace)** |
| Fin de partie | Grand Conseil | Trône | Centre d'optimisation | **sorts ultimes du Temple primordial (3 dieux d'une même mythologie)** |

Points forts (notice, « Descriptifs des camps ») : puissance au corps à corps, résistance des unités, efficacité de la magie, puissance individuelle des divinités, détection des unités camouflées (chaque dieu est détecteur).

Points faibles : coût et lenteur de l'expansion, faible mobilité, peu d'unités aériennes, unités chères en minerai, micro-gestion très ardue, arbre technologique très grand.

### 2.1 L'invocation

- La **Porte d'Asgaard** (bâtiment principal) invoque les dieux. Elle seule.
- **Les dieux tiennent lieu de casernes** : chaque dieu a sa file d'invocation, comme un bâtiment, et ses unités apparaissent à ses pieds. Ils en ont la taille (environ 3 cases de côté, la hauteur de la Porte d'Asgaard) et la solidité. Le camp n'a donc que peu de bâtiments : la Porte, les Branches d'Yggdrasill, les dépôts, le Puits et quelques bâtiments de soutien.
- Chaque **dieu invoque ses propres unités**. Perdre un dieu, c'est perdre l'accès à ses troupes jusqu'à ce qu'il soit réinvoqué. Tuer les dieux adverses devient l'objectif tactique majeur.
- **Gaïa** est la divinité de départ, hors mythologie : elle invoque les Esprits (ouvriers), construit tous les bâtiments de base et peut se téléporter près d'un bâtiment allié.
- Les ressources restent les deux du jeu (minerai et énergie). La notice parle d'« énergie éthérée » : c'est la même énergie, récoltée au **Puits** (l'équivalent de la Mine) ; la Porte transforme le minerai rapporté par les Esprits. Seul le nom change à l'écran si tu le souhaites.

### 2.2 Les trois mythologies

| Rang | Scandinave | Grecque | Égyptienne |
|---|---|---|---|
| 1 | **Thor** | **Apollon** | **Seth** |
| 2 | **Odin** | **Athéna** | **Isis** |
| 3 | **Frigg** | **Hadès** | **Osiris** |

Règle de l'arbre (dessin de la notice) : Gaïa → les trois dieux de rang 1 ; **2 divinités de rang 1 sur 3** débloquent le rang 2 ; **2 de rang 2 sur 3** débloquent le rang 3. Chaque rang compte un dieu de chaque mythologie. Réunir les trois dieux d'une même mythologie charge son sort ultime au Temple primordial.

## 3. Roster complet et arbre technologique

### 3.1 Divinités (unités uniques, invoquées à la Porte d'Asgaard)

Toutes ont la **Détection**.

| Dieu | Rang | Rôle | Invoque / construit | Capacités (notice) |
|---|---|---|---|---|
| **Gaïa** | 0 | bâtisseuse, quasi invulnérable, pas d'attaque | Esprit ; Porte d'Asgaard, Branche d'Yggdrasill, Antre, Puits, Temple primordial | Téléportation de Gaïa (vers un bâtiment allié), Flèche magique (« Déflagration » dans l'arbre) |
| **Thor** | 1 | mêlée lente, très endurante ; le dieu le moins cher | Nain ; Temple de vénération | Courroux du marteau (prochain coup multiplié ; onde de choc quand Thor évolue) |
| **Apollon** | 1 | lanceur de sorts rapide et fragile | Minotaure | Pluie de feu (météores en zone), Aveuglement (lumière : ralentit déplacement et attaque de l'infanterie en zone) |
| **Seth** | 1 | rapide, achève les unités faibles | Sphinx | Tempête de sable (les unités à distance dedans ne tirent plus), Jet de sable (immobilise presque un véhicule) |
| **Odin** | 2 | commandant de mêlée | Nain, Corbeau, Drake | Aura de guerre (les troupes proches frappent plus fort), Foudre puissante (dégâts + étourdissement) |
| **Athéna** | 2 | mêlée en armure d'or, soutien | Minotaure, Esprit (arbre) — Minotaure, Élémentaire (texte) | Aura de protection (dégâts subis réduits autour d'elle), Chouette (révèle une zone), Cri de guerre (dégâts des troupes très augmentés un moment) |
| **Isis** | 2 | soigneuse, attaque symbolique, très endurante | Sphinx, Prêtresse | Soins divins (soin de groupe), Résurrection |
| **Frigg** | 3 | mentaliste ; ignore le terrain (falaises, eau) | Nain, Walkyrie ; Artefacterie | Soumission divine (contrôle temporaire d'une unité ennemie), Voile de nuage (elle et les troupes proches invisibles longtemps) |
| **Hadès** | 3 | attaque à distance très puissante | Minotaure, Titan | Rayon de mort (frappe toutes les unités ennemies en vue), Voyage souterrain (téléportation), Armée des enfers (fantômes invincibles temporaires) |
| **Osiris** | 3 | mêlée lente, dévastatrice contre l'organique | Sphinx, Immortel ; Fontaine d'eau du Nil | Aura putride (dégâts aux organiques proches), Nuée nauséabonde (essaim autour de lui, rend de la vie) |

### 3.2 Unités invoquées

| Unité | Invoquée par | Rôle | Capacités / recherches |
|---|---|---|---|
| **Esprit** | Gaïa (Athéna dans l'arbre) | ouvrier : récolte, répare ; sans défense | — |
| **Nain** | Thor, Odin, Frigg | infanterie de mêlée lente et robuste, le gros de l'armée | Célérité naine : bond fulgurant vers un ennemi proche |
| **Minotaure** | Apollon, Athéna, Hadès | mêlée lourde, lent | Transe enragée ; Coup puissant (chance de dégâts doubles) |
| **Sphinx** | Seth, Isis, Osiris | statue rapide et blindée, boules de feu à moyenne portée | Peau de roc (statue : lent mais blindé et régénère) |
| **Corbeau** | Odin | éclaireur volant rapide, détecteur | invisible en permanence |
| **Drake** | Odin | volant très lent, très endurant, feu en zone | Drake géant : plus de vie et transport d'unités dans sa gueule |
| **Élémentaire** | Athéna (texte seulement) | petite créature polyvalente, change de forme à volonté | formes Eau (tir de glace qui ralentit, lévite), Feu (souffle de zone, tire en l'air), Terre (très lent, très résistant, lames anti-infanterie), Air (vole, très rapide, n'attaque que l'air) ; deux élémentaires fusionnent en Golem |
| **Golem** | fusion de 2 élémentaires | artillerie de siège à portée énorme, imprécise contre les cibles mobiles | — |
| **Prêtresse** | Isis | soin de zone, sans attaque | Dissipation : retire les effets négatifs d'un allié, les effets positifs d'un ennemi, gros dégâts aux unités invoquées et aux sphères de protection |
| **Walkyrie** | Frigg | guerrière volante, double-épée projetée | disparition brève (invisibilité) |
| **Immortel** | Osiris | momie géante, mêlée hors pair, très lente | nuage toxique contre les organiques |
| **Titan** | Hadès | demi-dieu, foudre à longue portée, rase les bâtiments | Armure zodiacale (blindage et vie) |
| **Avatar de Jormunggand** | sort ultime scandinave | serpent géant temporaire, frappe par grappes | se nourrit des cadavres pour se soigner ; s'il meurt, il pourra être rappelé plus tard |

### 3.3 Bâtiments

| Bâtiment | Construit par | Rôle |
|---|---|---|
| **Porte d'Asgaard** | Gaïa | bâtiment principal : invoque les dieux, reçoit les ressources ; plus chère que les bâtiments principaux des autres camps |
| **Antre** | Gaïa | dépôt de ressources bon marché + un peu de population ; rien d'autre |
| **Puits** | Gaïa | extraction d'énergie sur un gisement (comme la Mine) |
| **Branche d'Yggdrasill** | Gaïa | population + attaque de mêlée ; évolue (ci-dessous) |
| **Temple de vénération** | Thor | toutes les recherches (la notice l'appelle aussi « Autel », voir questions) |
| **Fontaine d'eau du Nil** | Osiris | régénération rapide des organiques alliés proches (Aura de soin) |
| **Artefacterie** (unique) | Frigg | améliorations des dieux, où qu'ils soient : Force, Résistance, Agilité, Vitesse ; 4 au total par dieu, cumulables |
| **Temple primordial** (unique) | Gaïa | charge les sorts ultimes |

**Branche d'Yggdrasill**, trois formes (flèches vertes de l'arbre) :
1. **Branche** : population + attaque au corps à corps.
2. **Yggdrasill protecteur** (quand 2 dieux de rang 1 sont invoqués) : tour défensive, flèches magiques très destructrices, bonne portée, cadence faible.
3. **Yggdrasill furieux** (quand Hadès est invoqué) : destruction et portée « à peine concevables ».
- **Déracinement** (recherche au Temple de vénération) : toute forme peut se déplacer, mais ne combat pas tant qu'elle n'a pas repris racine (quelques secondes).

**Sorts ultimes** (Temple primordial) : le chargement ne commence que si les trois dieux d'une mythologie sont vivants, s'arrête si l'un meurt, reprend à sa réinvocation. Une fois chargé, n'importe lequel des trois le lance.
- Scandinave — **Appel de Jormunggand** : un avatar du serpent combat un temps aux côtés du dieu.
- Grec — **Tempête de Zeus** : éclairs sur une large zone, alliés compris ; plus une unité est puissante, plus elle souffre.
- Égyptien — **Flamboiement d'Amon-Râ** : ennemis de la zone aveuglés et immobilisés longtemps (mécaniques : plus brièvement).

### 3.4 Recherches (Temple de vénération)

| Recherche | Effet |
|---|---|
| Attaque corps à corps 1-3 | toutes les unités de mêlée |
| Attaque à distance 1-3 | toutes les unités à distance |
| Amélioration armure 1-3 | toutes les unités |
| Célérité naine | les nains bondissent vers un ennemi proche |
| Coup puissant | le minotaure a une chance de doubler ses dégâts |
| Peau de roc | le sphinx peut se changer en statue |
| Prescience d'Yggdrasill | les branches détectent les unités camouflées |
| Drake géant | vie du drake + transport |
| Offrandes | les dieux ne comptent plus dans la population |
| Armure zodiacale | blindage et vie des titans |
| Déracinement (arbre) | Yggdrasill mobile |

### 3.5 Arbre technologique

```
Porte d'Asgaard ── invoque ──► Gaïa ── Esprit
                                 │      bâtit : Porte, Antre, Puits, Branche d'Yggdrasill, Temple primordial
                                 ▼
            ┌───────────── rang 1 ─────────────┐
            Thor              Apollon          Seth
            Nain              Minotaure        Sphinx
            Temple de vénération
                    └──── 2 dieux sur 3 ────┘   ──► Yggdrasill protecteur
            ┌───────────── rang 2 ─────────────┐
            Odin              Athéna           Isis
            Nain, Corbeau,    Minotaure,       Sphinx,
            Drake             Esprit/Élém.     Prêtresse
                    └──── 2 dieux sur 3 ────┘
            ┌───────────── rang 3 ─────────────┐
            Frigg             Hadès            Osiris
            Nain, Walkyrie    Minotaure, Titan Sphinx, Immortel
            Artefacterie      ──► Yggdrasill furieux   Fontaine du Nil

3 dieux d'une même mythologie + Temple primordial ──► sort ultime
```

## 4. Statistiques provisoires (premier jet)

Mêmes unités que `balance.json` : vitesse en cases par seconde, temps en secondes, portée en cases (0.1 = mêlée), coût minerai/énergie. **Tout est provisoire**, à noter dans `BALANCE.md` et à confier à l'équilibreur.

Logique suivie : les Dieux paient plus cher en minerai, leurs unités sont plus lentes et plus résistantes (armure plus haute) ; leurs dieux sont des héros chers mais décisifs. Le Nain se compare au Légionnaire, le Minotaure à l'Ankylosaure, le Sphinx au Phalangiste et à la Baliste, le Drake au Char Pégase, le Titan au Béhémoth.

### 4.1 Divinités

Population 4 chacune (avant Offrandes), uniques, détection 10. Les dieux font office de bâtiments : leurs PV sont ceux d'un bâtiment de production (Caserne 2600, Forge 2800), leur emprise d'environ 3 cases (rayon 1.4, comme la Caserne volante en vol).

| Dieu | PV | Armure | Vitesse | Coût | Temps | Attaque (dégâts / portée / recharge) |
|---|---|---|---|---|---|---|
| Gaïa | 3000 | 6 | 2.0 | offerte au départ | — | aucune ; Flèche magique 30 |
| Thor | 2200 | 3 | 1.8 | 400 / 100 | 45 | 45 / 0.1 / 1.5 |
| Apollon | 1500 | 1 | 2.6 | 500 / 250 | 50 | 25 / 6 / 1.5 |
| Seth | 1700 | 2 | 2.5 | 500 / 200 | 50 | 35 / 0.1 / 1.2 (bonus contre les unités blessées) |
| Odin | 2500 | 3 | 2.1 | 750 / 400 | 60 | 50 / 0.1 / 1.5 |
| Athéna | 2800 | 5 | 2.0 | 750 / 400 | 60 | 45 / 0.1 / 1.5 |
| Isis | 2600 | 3 | 2.0 | 700 / 500 | 60 | 5 / 5 / 1.5 ; soin |
| Frigg | 2000 | 2 | 2.3 | 1000 / 700 | 75 | 25 / 6 / 1.5 |
| Hadès | 2800 | 3 | 1.9 | 1100 / 800 | 80 | 60 / 8 / 2 |
| Osiris | 3500 | 4 | 1.6 | 1000 / 700 | 80 | 80 / 0.1 / 2 |

### 4.2 Unités invoquées

| Unité | PV | Armure | Vitesse | Pop. | Coût | Temps | Attaque | Analogie |
|---|---|---|---|---|---|---|---|---|
| Esprit | 60 | 0 | 2.6 | 1 | 75 / 0 | 14 | aucune | Serf, Drone |
| Nain | 150 | 2 | 2.1 | 1 | 125 / 0 | 22 | 18 / 0.1 / 1.2 | Légionnaire |
| Minotaure | 380 | 1 | 2.2 | 2 | 300 / 100 | 35 | 40 / 0.1 / 1.6 | Ankylosaure, Belluaire |
| Sphinx | 320 | 3 | 2.7 | 2 | 275 / 150 | 38 | 22 / 5 / 1.4 | Phalangiste, Baliste ; mécanique |
| Corbeau | 60 | 0 | 3.6 | 1 | 100 / 50 | 20 | aucune ; détection 10 | Espion |
| Drake | 700 | 1 | 1.6 | 4 | 550 / 300 | 55 | 30 / 4 / 2, zone 1.2 | Char Pégase |
| Élémentaire | 90 | 0 | 2.6 | 1 | 125 / 75 | 25 | 8 / 3 / 1.2 | Créature |
| – Eau | 80 | 0 | 2.8 | | | | 12 / 6 / 1.3, ralentit | |
| – Feu | 140 | 1 | 2.5 | | | | 20 / 3 / 1.5, zone 0.8 | |
| – Terre | 320 | 3 | 1.8 | | | | 25 / 0.1 / 1.4 | |
| – Air | 70 | 0 | 3.6 | | | | 18 / 4 / 1.2, air seulement | |
| Golem | 600 | 3 | 1.7 | 2 | (2 élémentaires) | 10 | 80 / 11 / 4, contre bâtiments +80, sol seulement | Cuve, Pylône |
| Prêtresse | 70 | 0 | 2.5 | 1 | 125 / 100 | 25 | soin 10 | Soigneur |
| Walkyrie | 260 | 2 | 3.0 | 2 | 350 / 200 | 40 | 30 / 4 / 1.5 | Chimère |
| Immortel | 900 | 3 | 1.8 | 4 | 600 / 250 | 60 | 55 / 0.1 / 1.6 ; aura 4/s | Allosaure |
| Titan | 1200 | 4 | 2.0 | 6 | 900 / 600 | 90 | 70 / 9 / 2.5, contre bâtiments +60 | Béhémoth |
| Jormunggand | 4000 | 4 | 2.4 | 0 | sort | — | 60 / 2 / 1.5, zone 2 ; 60 s de vie | Cadavre réanimé (durée de vie) |

### 4.3 Bâtiments

| Bâtiment | PV | Armure | Pop. | Coût | Temps | Remarque | Analogie |
|---|---|---|---|---|---|---|---|
| Porte d'Asgaard | 4500 | 3 | +10 | 1200 / 0 | 90 | dépôt | Conseil (1000, 80 s) |
| Antre | 900 | 1 | +4 | 300 / 0 | 30 | dépôt | — |
| Puits | 1000 | 1 | comme la Mine | 600 / 0 | 30 | énergie 2.5/s | Mine |
| Branche d'Yggdrasill | 600 | 1 | +10 | 200 / 0 | 25 | 12 / 1 / 1.2 | Grenier + Fortin |
| Yggdrasill protecteur | +200 | 2 | | +150 / 100 | 30 | 60 / 9 / 3 | Tour |
| Yggdrasill furieux | +300 | 2 | | +250 / 250 | 40 | 120 / 12 / 3.5 | Pylône sanglant |
| Temple de vénération | 2800 | 2 | | 400 / 0 | 50 | recherches | Forge |
| Fontaine d'eau du Nil | 800 | 1 | | 300 / 150 | 35 | +2 PV/s aux organiques à 6 cases | — |
| Artefacterie | 1500 | 2 | | 500 / 400 | 50 | unique | — |
| Temple primordial | 3000 | 3 | | 600 / 600 | 80 | unique ; ultimes 180 s de charge | Grand Conseil |

Population maximale de départ : Porte +10 ; Gaïa et 6 Esprits au départ (comme `rules.start.serfs = 6`).

## 5. Ce qui manque ou se contredit dans la notice — questions

1. **Autel ou Temple de vénération ?** Le texte dit « Autel, construit par Thor » ; l'arbre et la liste des recherches disent « Temple de vénération ». Les Isdaris ont déjà un Autel. Je propose **Temple de vénération**.
2. **Qui invoque les Élémentaires ?** Le texte donne Athéna (Minotaure, Élémentaire) ; l'arbre donne Athéna (Minotaure, Esprit). Personne d'autre ne les invoque. Je propose Athéna : Minotaure et Élémentaire.
3. **Un dieu mort revient-il ?** La notice parle de « réinvocation ». À quel prix et après combien de temps ? Je propose : réinvocation à la Porte, au coût plein, après 60 s de deuil.
4. **Gaïa peut-elle mourir ?** Elle est « presque insensible aux coups ». Si elle meurt, le camp ne peut plus bâtir. Je propose : elle revient seule à la Porte après 45 s, sans coût.
5. **Comment se passe l'invocation sur le terrain ?** Le dieu doit-il rester immobile pendant l'invocation (vulnérable, plus de micro) ou peut-il marcher pendant que la file avance ? Je propose : **il doit rester sur place** ; un ordre de déplacement suspend la file.
6. **Niveaux des dieux.** La notice parle de Thor « qui évolue » et des météores d'Apollon « à des niveaux élevés ». Le jeu n'a ni expérience ni niveaux. Veux-tu des niveaux, ou suffisent l'Artefacterie et des recherches ?
7. **« 2 divinités sur les 3 »** : faut-il qu'elles soient **vivantes en même temps**, ou les avoir **invoquées une fois** suffit-il ? Je propose : vivantes (cohérent avec la règle des ultimes).
8. **Un seul exemplaire de chaque dieu ?** La notice le laisse entendre partout. Je le suppose.
9. **Drake : transport natif ou après Drake géant ?** La fiche dit qu'il transporte, la recherche dit qu'il l'obtient. Je propose : après la recherche.
10. **Peau de roc du Sphinx** : capacité de base (fiche) ou recherche (liste) ? Je propose : recherche, comme la liste. Le nom « Peau de roc » est déjà pris par une capacité du Soigneur humain : je propose **Peau de pierre** pour le Sphinx.
11. **Flèche magique / Déflagration de Gaïa** : même sort ? « Déflagration » existe déjà chez les Isdaris. Je propose **Flèche de Gaïa**.
12. **Qui est organique ?** Pour la Fontaine du Nil, l'Aura putride, l'Immortel et les bonus contre les mécaniques des autres camps. Je propose : Sphinx, Golem et Titan comptent comme mécaniques (pierre, éther, or) ; le reste est organique ; l'Esprit et les Élémentaires ne sont ni l'un ni l'autre (pas soignés, pas empoisonnés).
13. **Puits et énergie éthérée** : y a-t-il une troisième ressource ? Je propose que non : le Puits produit l'énergie habituelle.
14. **Recherches des Dieux sur les dieux** : les améliorations d'attaque et d'armure du Temple touchent-elles aussi les divinités (« et parfois les divinités ») ? Je propose : non, les dieux ont l'Artefacterie.
15. **Jormunggand** : le texte de l'unité dit qu'il faut « un nombre suffisant de divinités scandinaves », le sort ultime dit les trois. Je suis le sort ultime.
16. **Armée des enfers** (Hadès) : quelles unités, combien ? Je propose 6 fantômes de Nains et de Minotaures, invulnérables, qui disparaissent après 300 dégâts chacun ou 20 s.
17. **Taille des dieux et déplacements.** Un dieu de 3 cases passe-t-il par les rampes et les ponts étroits des cartes actuelles ? Je propose : oui, il marche comme une grosse unité (il pousse les petites), et les cartes seront vérifiées en V1.
18. **Un dieu se bat-il pendant qu'il invoque ?** Je propose : oui, sauf s'il doit rester sur place (question 5).

## 6. Plan par étapes

### V1 — camp minimal jouable (rang 1)

But : une partie complète contre les trois autres camps, IA comprise.

- **Unités** : Gaïa, Esprit, Thor, Apollon, Seth, Nain, Minotaure, Sphinx.
- **Bâtiments** : Porte d'Asgaard, Branche d'Yggdrasill (forme 1 et Yggdrasill protecteur), Antre, Puits, Temple de vénération.
- **Capacités** : Téléportation de Gaïa, Courroux du marteau, Pluie de feu, Tempête de sable ; détection des dieux.
- **Recherches** : attaque mêlée 1-3, attaque distance 1-3, armure 1-3, Célérité naine.
- **Règles nouvelles** : invocation par une unité (aujourd'hui seuls les bâtiments produisent, `src/sim/world.ts`) ; dieux uniques ; réinvocation ; « tant que le dieu vit ».
- **IA** (`src/ai/ai.ts`) : plan Dieux (Gaïa bâtit, deux dieux de rang 1, armée de Nains + Sphinx, protège ses dieux et recule un dieu blessé).
- **Rendu** : modèles Blender (`tools/blender/models.py`) pour ces 8 unités et 5 bâtiments, icônes, sons ; HUD (boutons d'invocation sur les dieux).
- **Équilibre** : nouvelles paires dans `npm run balance:big` (Dieux contre chacun des trois camps).

### V2 — rang 2

Odin, Athéna, Isis ; Corbeau, Drake (+ Drake géant), Élémentaire (4 formes, fusion en Golem), Prêtresse (soin, Dissipation) ; auras d'Odin et d'Athéna, Chouette, Cri de guerre, Foudre, Soins divins, Résurrection ; Coup puissant, Peau de pierre, Prescience d'Yggdrasill.

### V3 — rang 3

Frigg, Hadès, Osiris ; Walkyrie, Titan (+ Armure zodiacale), Immortel ; Artefacterie, Fontaine du Nil, Yggdrasill furieux, Déracinement ; Soumission divine, Voile de nuage, Rayon de mort, Voyage souterrain, Armée des enfers, Aura putride, Nuée ; Offrandes.

### V4 — fin de partie

Temple primordial, les trois sorts ultimes, l'Avatar de Jormunggand ; niveaux des dieux si tu les veux (question 6).

## 7. Direction artistique

Planches : [`docs/concepts-dieux/planche-camp.png`](concepts-dieux/planche-camp.png) (palette, matériaux, silhouettes) et [`docs/concepts-dieux/planche-v1.png`](concepts-dieux/planche-v1.png) (bâtiments clés et unités de la V1), rendues dans Blender sous l'angle du jeu (environ 35° au-dessus de l'horizon).

**Idée directrice : le sanctuaire.** Les Humains bricolent (ferraille, rouille), les Isdaris sont Art déco chromé, les Z sont des machines rouillées sur câbles. Les Dieux sont **de la pierre sculptée et polie, de l'or et de la lumière** : rien de rapiécé, rien de mécanique, des formes posées et symétriques.

- **Matériaux** : marbre blanc veiné, pierre claire taillée, or poli (les dieux et les arêtes), bois vivant et écorce (Yggdrasill), éther translucide (Esprits, Élémentaires).
- **Palette** : blanc marbre et ivoire, or, **bleu nuit profond** pour les ombres et les étoffes, et une lumière **turquoise-éther** pour les runes, les auras et les invocations. Chaque mythologie a sa touche : Scandinave = bleu acier et fer, Grecque = blanc et or, Égyptienne = lapis et sable.
- **Signes** : runes gravées qui luisent, cercles d'invocation au sol, auras et halos, petites flammes d'éther en lévitation au-dessus des bâtiments.
- **Silhouettes vues d'en haut** : les bâtiments ont une **base circulaire ou octogonale** (les Humains ont des toits rectangulaires, les Isdaris des tours, les Z des structures à pattes) ; la Porte d'Asgaard est un **arc monumental sur un cercle de runes** ; la Branche d'Yggdrasill un **tronc torsadé à couronne lumineuse**, très lisible en population. Les dieux **font office de bâtiments et en ont la taille** (environ 3 cases, la hauteur de la Porte), avec un halo au sol d'or et d'éther et leurs troupes à leurs pieds ; les Nains sont trapus et larges, les Minotaures massifs, le Sphinx un bloc de pierre allongé.
- **Ce que je veux éviter** : copier un jeu existant ; le look « orque et elfe » vert et violet ; le doré partout (l'or reste un accent sur fond de marbre et de bleu nuit).
