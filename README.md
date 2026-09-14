# Mon Assistant — agent conversationnel pour iPhone

Une application que vous ouvrez sur votre iPhone comme n'importe quelle autre, et à qui vous parlez
(ou dictez) pour gérer votre vie professionnelle et personnelle :

- **Agenda** : ajouter, déplacer, consulter des rendez-vous (« Qu'est-ce que j'ai jeudi ? »).
- **Tâches et rappels** : « Rappelle-moi d'appeler le plombier demain à 9h ».
- **Notes** : « Note que le code du portail est 1234 ».
- **Mémoire** : l'assistant retient ce qui compte pour vous (préférences, proches, habitudes) d'une conversation à l'autre.
- **Recherche web** quand il faut une information à jour.
- **Rédaction** : courriers, messages, préparation d'une journée, aide à la décision.
- Un onglet **Vue d'ensemble** montre en un coup d'œil agenda, tâches, notes et ce que l'assistant sait de vous.

Techniquement, c'est une « application web installable » (PWA) : elle se lance depuis un site, mais une fois
ajoutée à l'écran d'accueil de l'iPhone, elle a son icône, s'ouvre en plein écran et se comporte comme une
application classique. Pas besoin de passer par l'App Store.

---

## Ce qu'il vous faut

1. **Une clé API Anthropic** (c'est ce qui fait fonctionner l'intelligence de l'assistant).
   Créez-la sur <https://console.anthropic.com> → *API Keys* → *Create Key*. Copiez-la, elle commence par `sk-ant-`.
   L'usage est facturé à la consommation (quelques centimes par échange en général).
2. **Un hébergeur** pour faire tourner le serveur 24 h/24. Le plus simple : [Render](https://render.com)
   (gratuit pour créer un compte, environ 7 $/mois pour le forfait « Starter » qui garde vos données).
3. **Un mot de passe** de votre choix pour protéger l'accès à l'application.

## Installation en 10 minutes (Render)

1. Créez un compte sur <https://render.com> et connectez-le à votre compte GitHub.
2. Sur Render : **New** → **Blueprint** → choisissez ce dépôt (`Agent-v3`). Render lit le fichier `render.yaml`
   et prépare tout.
3. Render vous demande deux valeurs :
   - `ANTHROPIC_API_KEY` : collez votre clé `sk-ant-…`
   - `APP_PASSWORD` : votre mot de passe
4. Cliquez sur **Apply**. Après 2 à 3 minutes, Render affiche l'adresse de votre application
   (du type `https://mon-assistant.onrender.com`).

## Mettre l'application sur l'iPhone

1. Ouvrez l'adresse dans **Safari** (pas Chrome : seul Safari permet l'installation).
2. Touchez le bouton **Partager** (le carré avec une flèche vers le haut).
3. Choisissez **« Sur l'écran d'accueil »** puis **Ajouter**.
4. L'icône « Assistant » apparaît. Ouvrez-la, entrez votre mot de passe : c'est prêt.

Astuce : le micro du clavier iPhone permet de dicter vos messages.

---

## Réglages possibles

Dans Render → votre service → **Environment** :

| Variable | Rôle | Valeur par défaut |
|---|---|---|
| `ANTHROPIC_API_KEY` | Clé Anthropic (obligatoire) | — |
| `APP_PASSWORD` | Mot de passe d'accès (fortement conseillé) | aucun |
| `USER_NAME` | Prénom utilisé par l'assistant | vide |
| `TIMEZONE` | Fuseau horaire pour les dates | `Europe/Paris` |
| `CLAUDE_MODEL` | Modèle Claude utilisé | `claude-opus-5` |

## Lancer sur un ordinateur (pour essayer)

```bash
npm install
cp .env.example .env      # puis remplissez ANTHROPIC_API_KEY et APP_PASSWORD
export $(cat .env | xargs)
npm start                 # ouvrez http://localhost:3000
```

Avec Docker : `docker build -t assistant . && docker run -p 3000:3000 -e ANTHROPIC_API_KEY=… -e APP_PASSWORD=… -v assistant-data:/app/data assistant`

## Organisation des fichiers

- `server.js` : le serveur (connexion, conversations, envoi des messages).
- `src/agent.js` : la logique de l'assistant (instructions, appel à Claude, exécution des outils).
- `src/tools.js` : les outils (agenda, tâches, notes, mémoire).
- `src/store.js` : l'enregistrement des données dans `data/db.json`.
- `public/` : l'application affichée sur l'iPhone.
- `tests/` : vérifications automatiques (`npm test`).

## Et ensuite ?

Pistes d'évolution prévues : connexion à Google Agenda et Gmail, notifications de rappel sur le téléphone,
envoi de photos ou de documents à l'assistant.
