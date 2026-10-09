# SPAM — depuis le PC perso

Les pages claude.ai ne s'ouvrent pas sur ce PC. Cette branche les remplace : tu y trouves l'**Atelier de decks** à
ouvrir dans ton navigateur, tu y **déposes** les fichiers du jeu, et Claude te **répond** dans
[REPONSE.md](REPONSE.md). Il n'y a rien à installer : un navigateur, ton compte GitHub et ce que Windows a déjà.

## Ouvrir l'Atelier de decks

1. Ouvre [`interface/atelier-spam.html`](interface/atelier-spam.html). Le fichier est trop gros pour que GitHub
   l'affiche : clique sur le bouton de téléchargement, la flèche vers le bas en haut à droite (« Download raw file »).
2. Double-clique sur le fichier téléchargé : il s'ouvre dans ton navigateur et marche sans connexion.
3. Les decks que tu enregistres restent dans ce navigateur. Ouvre toujours la page avec le même (Edge, par exemple).
   Quand Claude la met à jour, retélécharge-la et remplace l'ancienne : tes decks restent.

## Envoyer les fichiers du jeu

### 1. Trouver les dossiers

| Quoi | Où | Que prendre |
|---|---|---|
| Données du jeu | `%USERPROFILE%\AppData\LocalLow\<éditeur>\<jeu>` | le dossier du jeu, pas tout LocalLow |
| Captures F12 | `C:\Program Files (x86)\Steam\userdata\<ton numéro>\760\remote\2902720\screenshots` | les images, pas le sous-dossier `thumbnails` |
| Sauvegarde cloud | `C:\Program Files (x86)\Steam\userdata\<ton numéro>\2902720` | le dossier, s'il existe |
| Fiche d'installation | `C:\Program Files (x86)\Steam\steamapps\appmanifest_2902720.acf` | ce fichier |

Pour aller à un de ces dossiers, colle le chemin dans la barre d'adresse de l'Explorateur de fichiers
(`%USERPROFILE%` marche tel quel).

Si tu ne les trouves pas : ouvre PowerShell (menu Démarrer, tape « PowerShell »), colle cette commande et appuie
sur Entrée. Elle ne fait que lire et liste les fichiers liés à SPAM, les plus récents d'abord. Si Steam est installé
ailleurs (par exemple `D:\SteamLibrary`), change ce chemin dans la commande.

```powershell
Get-ChildItem "$env:USERPROFILE\AppData\LocalLow","$env:APPDATA","$env:LOCALAPPDATA","${env:ProgramFiles(x86)}\Steam\userdata","${env:ProgramFiles(x86)}\Steam\steamapps" -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'spam|ticroco|2902720' -and $_.FullName -notmatch 'antispam' } | Sort-Object LastWriteTime -Descending | Select-Object -First 60 -ExpandProperty FullName
```

### 2. Ne jamais envoyer

- `Steam\config\`, les fichiers `ssfn…` à la racine de Steam, ni `userdata\<ton numéro>\config\` : ils contiennent
  ta connexion et tes réglages Steam.
- Tout `userdata` ou tout `LocalLow` d'un coup.

### 3. Compresser

Clic droit sur chaque dossier, puis **Compresser en fichier ZIP**. GitHub refuse les fichiers de plus de 25 Mo
envoyés depuis le navigateur : pour beaucoup de captures, fais plusieurs zip ou ne garde que les plus récentes.

### 4. Déposer

1. En haut de la liste des fichiers, vérifie que la branche affichée est bien **pc-perso**.
2. **Add file**, puis **Upload files**, et glisse les zip (ou directement des captures, 100 fichiers au plus par envoi).
3. Dans « Commit changes », écris dans la description un mot pour Claude : ce que tu as joué, contre quoi, ce que tu
   cherches.
4. Laisse coché « Commit directly to the pc-perso branch » et valide.

Juste un message, sans fichier : **Add file**, puis **Create new file**, nomme-le par exemple `message.md` et écris.

Ensuite, sur l'autre PC, dis à Claude : « j'ai envoyé un import ».

## Ce que fait Claude

Il lit les nouveaux envois, range ceux qu'il a traités dans `lus/<date>/`, te répond dans
[REPONSE.md](REPONSE.md) (ce qu'on sait, ce qu'il attend de toi) et ajoute les parties et les captures au Journal de
parties. Quand le jeu change de version, il remet à jour `interface/atelier-spam.html`.
