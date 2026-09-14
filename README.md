# Mon Assistant — agent conversationnel pour iPhone

Une application que vous ouvrez sur votre iPhone comme n'importe quelle autre, et à qui vous parlez
(ou dictez) pour gérer votre vie professionnelle et personnelle. Elle est adaptée à la pratique du
Dr Achache (médecin conseil, assistance aux victimes) :

- **Documents PDF à votre en-tête, signés** : ordonnances, notes d'honoraires (TVA et TTC calculés),
  conclusions d'expertise (« Cher Maître »), certificats médicaux, courriers. Le PDF s'ouvre et se partage depuis l'iPhone.
- **Créneaux de rendez-vous** (20, 30 ou 45 min) selon vos règles : horaires, garde alternée, battement et trajet autour des expertises.
- **Google Agenda et Gmail** (après connexion) : lecture de l'agenda, création de rendez-vous, tri des mails par priorité,
  brouillons de réponse. Jamais d'envoi, jamais de suppression.
- **Préparation de la journée du lendemain**, tâches et rappels, notes, mémoire durable (l'assistant retient vos préférences,
  vos correspondants, vos dossiers en cours).
- **Rapports Word** : évaluation Dintilhac, discussion médico-légale, liquidation chiffrée (style Quantum), rapport de conseil.
- **Photos et documents** : envoyez une photo de courrier ou un PDF (synthèse de dossier…), l'assistant le lit.
- **Notifications sur l'iPhone** : rappels à l'heure dite, et journée du lendemain préparée automatiquement chaque soir si vous l'activez.
- **Recherche web** quand il faut une information à jour (adresse d'un expert, barème…).
- Un onglet **Vue d'ensemble** (agenda, tâches, notes, mémoire) et un onglet **Réglages** (connexion Google, signature manuscrite dessinée au doigt, documents générés).

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

## Installation sur votre propre serveur (VPS OVH)

Vous avez déjà un serveur ? Suivez **[GUIDE-OVH.md](GUIDE-OVH.md)** : une commande à coller, quatre questions, et c'est en ligne.

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

## Connecter Google Agenda et Gmail

Suivez **[GUIDE-GOOGLE.md](GUIDE-GOOGLE.md)** (10 minutes, une seule fois).

## Réglages possibles

Dans Render → votre service → **Environment** :

| Variable | Rôle | Valeur par défaut |
|---|---|---|
| `ANTHROPIC_API_KEY` | Clé Anthropic (obligatoire) | — |
| `APP_PASSWORD` | Mot de passe d'accès (fortement conseillé) | aucun |
| `USER_NAME` | Prénom utilisé par l'assistant | vide |
| `TIMEZONE` | Fuseau horaire pour les dates | `Europe/Paris` |
| `CLAUDE_MODEL` | Modèle Claude utilisé | `claude-opus-5` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Connexion Google (voir GUIDE-GOOGLE.md) | vide |

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
- `src/profile.js` : votre profil, vos règles et votre façon de travailler (à modifier pour changer un tarif, un contact…).
- `src/tools.js` : les outils de base (agenda local, tâches, notes, mémoire).
- `src/tools-pro.js` : les outils métier (documents PDF, créneaux, experts, Google Agenda, Gmail).
- `src/documents.js` : la mise en page des PDF. `src/reports.js` : les rapports Word. `src/slots.js` : le calcul des créneaux.
- `src/google.js` : la connexion Google. `src/notify.js` : notifications et préparation automatique. `src/seed.js` : mémoire de départ.
- `deploy/install.sh` : installation sur un serveur (voir GUIDE-OVH.md).
- `src/store.js` : l'enregistrement des données dans `data/db.json`.
- `public/` : l'application affichée sur l'iPhone.
- `tests/` : vérifications automatiques (`npm test`).

## Et ensuite ?

Pistes d'évolution : accès à app.indemnisation.com, lecture des pièces jointes des mails,
synchronisation Doctolib.
