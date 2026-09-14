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
4. **Un Mac ou un PC** pour taper deux commandes (l'iPhone servira ensuite).

## Étape 1 : rendre le dépôt accessible au serveur

Le code de l'application est sur GitHub dans un dépôt privé. Le serveur doit pouvoir le télécharger. Le plus simple :

1. Ouvrez <https://github.com/achacheben-jpg/Agent-v3/settings>.
2. Tout en bas, section **Danger Zone** → **Change repository visibility** → **Make public** → confirmez.

Le dépôt ne contient aucun secret (ni clé, ni mot de passe, ni données) : le rendre public est sans risque.
Si vous préférez le garder privé, le script vous demandera un « code d'accès GitHub » ; c'est plus compliqué.

## Étape 2 : se connecter au serveur

Sur Mac : ouvrez l'application **Terminal** (Cmd + Espace, tapez « Terminal »).
Sur Windows : ouvrez **PowerShell**.

Tapez puis validez :

```
ssh ubuntu@vps-98742a92.vps.ovh.net
```

- À la question « Are you sure you want to continue connecting ? », tapez `yes`.
- Tapez le mot de passe du serveur (rien ne s'affiche pendant la frappe, c'est normal) puis Entrée.

Vous êtes sur le serveur quand la ligne commence par `ubuntu@vps-98742a92`.

## Étape 3 : lancer l'installation

Copiez-collez cette ligne, puis Entrée :

```
curl -fsSL https://raw.githubusercontent.com/achacheben-jpg/Agent-v3/claude/conversational-agent-iphone-1djevb/deploy/install.sh | sudo bash
```

Le script travaille seul pendant 2 à 4 minutes, puis pose quatre questions :

| Question | Que répondre |
|---|---|
| Clé API Anthropic | collez votre clé `sk-ant-…` (invisible à l'écran, c'est normal) |
| Mot de passe pour ouvrir l'application | le mot de passe de votre choix |
| Votre prénom | `Ben` (Entrée pour garder) |
| Adresse du site | Entrée pour garder `vps-98742a92.vps.ovh.net` |

À la fin, le script affiche « Installation terminée » et l'adresse à ouvrir.

## Étape 4 : mettre l'application sur l'iPhone

1. Sur l'iPhone, ouvrez **Safari** et allez sur `https://vps-98742a92.vps.ovh.net`.
2. Touchez **Partager** (le carré avec la flèche), puis **« Sur l'écran d'accueil »**, puis **Ajouter**.
3. Ouvrez l'icône « Assistant », entrez votre mot de passe. C'est prêt.

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
