# Connecter Google Agenda et Gmail à l'assistant

Cette connexion permet à l'assistant de lire votre agenda (créneaux, préparation de journée),
de chercher dans vos mails, de les trier et de préparer des brouillons. Il n'envoie jamais de mail
et ne supprime rien.

Il faut d'abord obtenir deux « codes » auprès de Google (un identifiant et un secret), une seule fois.
Comptez 10 minutes. Vous avez déjà un compte Google Cloud (essai ouvert en mars 2026), il servira.

## Étape 1 : créer le projet et l'écran de consentement

1. Ouvrez <https://console.cloud.google.com/> avec le compte `achacheben@gmail.com`.
2. En haut, menu déroulant du projet → **Nouveau projet** → nom « Mon Assistant » → **Créer**, puis sélectionnez-le.
3. Menu ☰ → **API et services** → **Bibliothèque**. Cherchez et **activez** :
   - *Google Calendar API*
   - *Gmail API*
4. Menu ☰ → **API et services** → **Écran de consentement OAuth** (ou « Google Auth Platform » → « Branding »).
   - Type d'utilisateur : **Externe** → Créer.
   - Nom de l'application : `Mon Assistant`. E-mail d'assistance : votre adresse. Enregistrez.
   - Section **Audience** (ou « Utilisateurs tests ») → **Ajouter des utilisateurs** → `achacheben@gmail.com` → Enregistrer.
     Laissez l'application en mode « Test » : c'est suffisant pour un usage personnel.

## Étape 2 : créer les identifiants

1. Menu ☰ → **API et services** → **Identifiants** → **Créer des identifiants** → **ID client OAuth**.
2. Type d'application : **Application Web**. Nom : `Mon Assistant`.
3. Dans **URI de redirection autorisés** → **Ajouter un URI** et collez exactement :

   ```
   https://vps-98742a92.vps.ovh.net/auth/google/callback
   ```

   (si votre application a une autre adresse, remplacez la partie avant `/auth/google/callback`).
4. **Créer**. Google affiche un **ID client** (se termine par `.apps.googleusercontent.com`) et un **Code secret du client**.
   Copiez-les tous les deux.

## Étape 3 : les donner au serveur

Deux possibilités :

- **Pendant l'installation** : le script les demande (« Google client ID », « Google client secret »).
- **Après coup** : connectez-vous au serveur (Termius) et tapez `mon-assistant reglages`. Remplissez les lignes
  `GOOGLE_CLIENT_ID=` et `GOOGLE_CLIENT_SECRET=`, puis Ctrl + O, Entrée, Ctrl + X. L'application redémarre seule.

## Étape 4 : autoriser depuis l'iPhone

1. Dans l'application → onglet **Réglages** → **Connecter Google**.
2. Choisissez le compte `achacheben@gmail.com`. Google prévient que l'application « n'est pas validée » :
   touchez **Continuer** (c'est normal pour une application personnelle en mode test).
3. Cochez les accès demandés (agenda et Gmail) → **Continuer**.
4. Vous revenez dans l'application : les réglages affichent « Connecté ».

## Ce que l'assistant pourra faire ensuite

- « Trouve-moi un créneau de 20 min » : calcule les 3 prochains créneaux libres selon vos règles.
- « Trie mes mails » : classe les mails non lus par priorité et prépare des brouillons de réponse.
- « Prépare ma journée de demain » : liste les rendez-vous de J+1 avec les points à vérifier.
- « Ajoute un rendez-vous jeudi 10h avec … » : crée l'événement dans Google Agenda.

## En cas de problème

- **« redirect_uri_mismatch »** : l'adresse de redirection de l'étape 2 ne correspond pas exactement. Corrigez-la dans Google Cloud.
- **« Accès bloqué : cette application n'a pas été validée »** : ajoutez votre adresse dans les utilisateurs tests (étape 1, point 4).
- **« Connexion Google expirée »** dans l'assistant : en mode test, Google coupe l'accès au bout de 7 jours.
  Retournez dans Réglages → Connecter Google. Pour éviter cela, publiez l'application (écran de consentement → **Publier**) ;
  un avertissement s'affichera à la connexion mais l'accès durera.
