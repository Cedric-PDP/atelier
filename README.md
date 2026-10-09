# SPAM — depuis le PC perso

Les pages claude.ai ne s'ouvrent pas sur ce PC. Cette branche les remplace : tu y trouves l'**Atelier de decks** à
ouvrir dans ton navigateur, tu y **déposes** les replays de tes parties, et Claude te **répond** dans
[REPONSE.md](REPONSE.md). Il n'y a rien à installer : un navigateur, ton compte GitHub et ce que Windows a déjà.

## Ouvrir l'Atelier de decks

1. Ouvre [`interface/atelier-spam.html`](interface/atelier-spam.html). Le fichier est trop gros pour que GitHub
   l'affiche : clique sur le bouton de téléchargement, la flèche vers le bas en haut à droite (« Download raw file »).
2. Double-clique sur le fichier téléchargé : il s'ouvre dans ton navigateur et marche sans connexion.
3. Les decks que tu enregistres restent dans ce navigateur. Ouvre toujours la page avec le même (Edge, par exemple).
   Quand Claude la met à jour, retélécharge-la et remplace l'ancienne : tes decks restent.

## Envoyer tes parties

Le jeu enregistre un replay de chaque partie, et Claude y lit tout : decks, tours, boutique, bans. Les captures
d'écran ne sont plus nécessaires.

1. Dans l'Explorateur de fichiers, colle ce chemin dans la barre d'adresse : `%USERPROFILE%\AppData\LocalLow\Ticroco\Spam`
2. Clic droit sur le dossier **replays**, puis **Compresser en fichier ZIP**.
3. Sur cette page, vérifie que la branche affichée en haut de la liste des fichiers est bien **pc-perso**. Puis
   **Add file**, **Upload files**, et glisse le zip.
4. Dans « Commit changes », écris si tu veux un mot pour Claude dans la description (ce que tu as joué, ce que tu
   cherches). Laisse coché « Commit directly to the pc-perso branch » et valide.

Envoie-le après chaque session de jeu : on ne sait pas combien de replays le jeu garde. N'envoie rien d'autre de
Steam ni de Windows : seul le dossier `replays` sert.

Juste un message, sans fichier : **Add file**, puis **Create new file**, nomme-le par exemple `message.md` et écris.

Ensuite, sur l'autre PC, dis à Claude : « j'ai envoyé un import ».

## Ce que fait Claude

Il décode les replays, range les envois traités dans `lus/<date>/`, ajoute les parties au Journal de parties et te
répond dans [REPONSE.md](REPONSE.md) : tes parties, ce qu'on en apprend, ce qu'il attend de toi. Quand le jeu change
de version, il remet à jour `interface/atelier-spam.html`.
