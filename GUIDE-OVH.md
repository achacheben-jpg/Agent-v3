# Installer « Mon Assistant » sur votre serveur OVH

Ce guide est écrit pour quelqu'un qui n'a jamais utilisé un serveur. Comptez 20 minutes.
Le serveur concerné est votre VPS OVHcloud `vps-98742a92.vps.ovh.net` (compte `ab166396-ovh`).

## Ce qu'il vous faut sous la main

1. **Votre clé API Anthropic** (commence par `sk-ant-`). Sinon : <https://console.anthropic.com> → *API Keys* → *Create Key*.
2. **Le mot de passe du serveur.** OVH vous l'a envoyé par mail le 5 mai 2026, objet
   « [vps-98742a92.vps.ovh.net] Installation de votre VPS ». L'utilisateur est `ubuntu`.
   Si ce mot de passe ne fonctionne plus : dans l'espace client OVH → *Bare Metal Cloud* → *VPS* → votre VPS →
   bouton **Réinstaller** (choisir Ubuntu). Un nouveau mot de passe vous est envoyé par mail. Attention, cela efface ce qui était sur le serveur.
3. **Un mot de passe de votre choix** pour protéger l'application.
4. **Un Mac, un PC… ou seulement l'iPhone** avec l'application gratuite **Termius** (App Store), qui permet de se connecter au serveur et d'y coller une commande.

## Étape 1 : rendre le dépôt accessible au serveur

Le code de l'application est sur GitHub dans un dépôt **privé** (il contient vos règles de travail et vos
coordonnées professionnelles : mieux vaut qu'il le reste). Le serveur a donc besoin d'un « code d'accès » pour le télécharger.

1. Ouvrez <https://github.com/settings/personal-access-tokens/new> (connecté à votre compte GitHub).
2. Nom : `Serveur assistant`. Expiration : choisissez la durée la plus longue proposée.
3. **Repository access** → *Only select repositories* → cochez `Agent-v3`.
4. **Permissions** → *Repository permissions* → **Contents** → *Read-only*.
5. **Generate token**. Copiez le code (il commence par `github_pat_`) : il ne sera plus affiché ensuite. Gardez-le dans vos notes, il servira à l'étape 3.

Alternative plus simple mais moins discrète : rendre le dépôt public le temps de l'installation
(<https://github.com/achacheben-jpg/Agent-v3/settings> → tout en bas → *Change visibility* → *Make public*), puis le repasser en privé.

## Étape 2 : se connecter au serveur

**Depuis l'iPhone (Termius)** : onglet *Hosts* → **+** → *New Host* → Hostname `vps-98742a92.vps.ovh.net`,
Username `ubuntu`, Password : le mot de passe du serveur. Enregistrez puis touchez le serveur pour vous connecter.
Pour coller une commande : appui long sur l'écran noir → *Coller* → Entrée.

**Depuis un Mac** (application Terminal) ou un PC (PowerShell) :

```
ssh ubuntu@vps-98742a92.vps.ovh.net
```

- À la question « Are you sure you want to continue connecting ? », tapez `yes`.
- Tapez le mot de passe du serveur (rien ne s'affiche pendant la frappe, c'est normal) puis Entrée.

Vous êtes sur le serveur quand la ligne commence par `ubuntu@vps-98742a92`.

## Étape 3 : lancer l'installation

Copiez-collez cette ligne en remplaçant `VOTRE_CODE` par le code d'accès GitHub de l'étape 1 (sans les guillemets), puis Entrée :

```
export GITHUB_TOKEN="VOTRE_CODE"; curl -fsSL -H "Authorization: token $GITHUB_TOKEN" https://raw.githubusercontent.com/achacheben-jpg/Agent-v3/claude/conversational-agent-iphone-1djevb/deploy/install.sh | sudo -E bash
```

(Si vous avez choisi de rendre le dépôt public, la ligne se réduit à :
`curl -fsSL https://raw.githubusercontent.com/achacheben-jpg/Agent-v3/claude/conversational-agent-iphone-1djevb/deploy/install.sh | sudo bash`)

Le script travaille seul pendant 2 à 4 minutes, puis pose ses questions :

| Question | Que répondre |
|---|---|
| Clé API Anthropic | collez votre clé `sk-ant-…` (invisible à l'écran, c'est normal) |
| Mot de passe pour ouvrir l'application | le mot de passe de votre choix |
| Votre prénom | `Ben` (Entrée pour garder) |
| Adresse du site | Entrée pour garder `vps-98742a92.vps.ovh.net` |
| Google client ID / secret | Entrée pour passer (à faire plus tard avec GUIDE-GOOGLE.md) |

À la fin, le script affiche « Installation terminée » et l'adresse à ouvrir.

## Étape 4 : mettre l'application sur l'iPhone

1. Sur l'iPhone, ouvrez **Safari** et allez sur `https://vps-98742a92.vps.ovh.net`.
2. Touchez **Partager** (le carré avec la flèche), puis **« Sur l'écran d'accueil »**, puis **Ajouter**.
3. Ouvrez l'icône « Assistant », entrez votre mot de passe. C'est prêt.
4. Onglet **Réglages** : dessinez votre signature avec le doigt (elle sera apposée sur les PDF), et connectez Google
   quand vous aurez suivi GUIDE-GOOGLE.md.

## Plus tard

Reconnectez-vous au serveur (étape 2) puis :

| Pour… | Tapez |
|---|---|
| Mettre à jour l'application | `mon-assistant maj` |
| Vérifier que tout tourne | `mon-assistant statut` |
| Voir ce qui se passe en direct | `mon-assistant journal` (Ctrl + C pour sortir) |
| Changer la clé API ou le mot de passe | `mon-assistant reglages` |
| Redémarrer | `mon-assistant redemarrer` |

Vos données (conversations, agenda, tâches, notes, mémoire) sont dans le dossier `/var/lib/mon-assistant` du serveur,
couvert par la sauvegarde automatique OVH que vous avez activée.

## Si quelque chose bloque

- **« Permission denied »** à la connexion : mauvais mot de passe. Voir le point 2 de « Ce qu'il vous faut ».
- **« Could not resolve host »** : le VPS est éteint ou résilié. Vérifiez dans l'espace client OVH.
- **Safari affiche un avertissement de sécurité** : attendez une minute (le certificat se crée au premier accès) puis rechargez.
- **L'assistant répond « clé API invalide »** : `mon-assistant reglages`, corrigez la ligne `ANTHROPIC_API_KEY`, enregistrez (Ctrl + O, Entrée, Ctrl + X).
- Tout autre problème : copiez le message d'erreur et envoyez-le moi.
