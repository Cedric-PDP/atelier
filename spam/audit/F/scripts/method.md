## 2. Méthode — quatre proxies d'adversaire, puis un mélange explicite

Aucune donnée de parties n'est observable, donc on modélise **comment un adversaire construit son deck**, à partir de
ce qui est mesurable : le moteur du wiki (ce que les joueurs « optimisés » obtiennent), la rareté (ce que les joueurs
possèdent) et les classements publics (ce que les joueurs lisent). Chaque proxy produit une liste de decks pondérés ;
pour chaque mécanique M on mesure **P(M) = part (pondérée) des decks qui contiennent au moins une carte portant M**,
et pour chaque carte c, **P(c) = part des decks qui la contiennent**.

| Proxy | Joueur modélisé | Construction (reproductible : `F/scripts/`) |
|---|---|---|
| **P1** moteur, pool complet | possède les 127 cartes et joue ce que le moteur classe en tête | Recherche avec le moteur 1.20 (`simulation.js`, model.json engineHash a8193b3d422a54a9) : les **333 375 triplets** (exhaustif) au score rapide du moteur (`J(q(...))`, adversaire neutre, 1er joueur — le score que la beam search du wiki utilise) → 5 000 meilleurs triplets × 124 4ᵉ cartes → quadruplets classés → les 4 000 premiers rescorés au **score complet** (`X` = 9 profils × 2 ordres, = `evaluate()`), puis, pour la variante avec talents, les 1 500 premiers ré-optimisés en talents (`Te`, comme `bestDecks`). Fréquences dans les top 100 / 500 / 1 000. **T** = avec talents (1 talent optimisé par carte), **N** = sans talent. |
| **P2** accessibilité seule | ne lit rien, joue 4 cartes de sa collection | Collections tirées carte par carte selon la rareté : scénario **U** (calé sur la collection du joueur : 6 Esprits toujours possédés, autres communes 13/60, rares 6/30, épiques 1/18, légendaires et divine 0,5/13 ≈ 3,8 % ; ≈ 27 cartes en moyenne) et scénario **V** « vétéran » (hypothèse : 60 % / 50 % / 25 % / 15 % ; 64 cartes). Deck = 4 cartes au hasard parmi les possédées (probabilité exacte, 20 000 collections). |
| **P3** classements publics | copie ce que le wiki affiche | Listes du wiki telles que publiées : tier list « All » avec talents (40 decks), « No talent » (40), filtres « Accessible », catalogue complet (205 decks 1.20 = la source des blocs « Its best decks » de chaque page carte ; 187 en 1.21), et les 28 synergies de la page Strategies. Versions **1.20** (page sauvegardée, analysée le 09/10 09:06 UTC) et **1.21** (page live, 09/10 14:30 UTC). |
| **B** P2 × classement des cartes | joue ses 4 cartes les mieux classées individuellement | Collections U/V ; deck = les 4 cartes possédées les mieux placées dans le classement public des cartes du wiki 1.20 (utilisé comme mesure de « force perçue » ; le classement lui-même n'est pas affiché ici). |
| **C** P1 × P2 (atelier) | utilise l'atelier du wiki « meilleurs decks pour ma collection » | Pour chaque collection tirée (U : 120, V : 40), appel de la **vraie fonction du wiki `bestDecks(collection)`** (beam 120/100/400 + optimisation des talents) ; deck = le 1ᵉʳ proposé (variantes : les 3 proposés à 1/3). |
| **D** P3 × P2 (copieur) | copie le meilleur deck publié qu'il peut monter | Mêmes collections ; deck = le deck du catalogue wiki le mieux noté qu'il possède entièrement ; s'il n'en possède aucun, il retombe sur l'atelier (C). Variante catalogue 1.21. |

**Mélange (formule).** Avec s ∈ {U, V, F} (F = collection complète), t ∈ {hasard, meilleures cartes, atelier, copieur}
et τ_s la part de joueurs ayant des talents :

> **P_mix(M) = Σ_s w_s · Σ_t v_t · [ τ_s · P_{s,t,talents}(M) + (1 − τ_s) · P_{s,t,sans talent}(M) ]**
>
> w = {U : 0,50 ; V : 0,35 ; F : 0,15} · v = {hasard : 0,25 ; meilleures cartes : 0,25 ; atelier : 0,30 ; copieur : 0,20} · τ = {U : 0,25 ; V : 0,5 ; F : 0,5}
>
> Cellules : U/V → P2, B, C, D ; F → P2 sur 127 cartes, B sur 127 cartes, P1 top 1 000, P3 tier list (All / No talent). Les proxies sans notion de talent (P2, B) servent pour les deux variantes.

Justification des poids (toutes des **hypothèses**, aucune n'est mesurée) : la moitié des adversaires ressemblent au
joueur (≈ 27 cartes) parce qu'un matchmaking classé apparie des niveaux proches ; joueurs « sans wiki » (hasard +
meilleures cartes) = joueurs « wiki » (atelier + copieur) = 50/50 faute de mieux ; talents rares chez les petites
collections (ils exigent des doublons). La **sensibilité** est donnée à côté : « casual » (hasard + meilleures cartes
seulement), « wiki-only » (atelier + copieur seulement), « vétéran » (V + F seulement), « copie 1.21 » (copieurs sur le
catalogue 1.21), « sans B » (hasard 0,35 ; atelier 0,40 ; copieur 0,25 — sans le proxy « meilleures cartes »), et le
**min–max** sur les 23 cellules du mélange (hors la cellule B F, qui n'est qu'un seul deck donc vaut 0 ou 100 %).
