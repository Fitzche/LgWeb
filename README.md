# LgMore Backend

API REST + site web pour synchroniser les PlayerData Minecraft avec la communauté.

## Architecture

```
Serveur Minecraft
  └─ /lga export [joueur]
       └─ HTTP POST → lgmore-backend (Node.js)
                            ├─ data/users.json       (comptes)
                            └─ data/playerdata.json  (données MC)
                                     ↑
                              Site web (index.html)
                              ├─ GET /api/me          (profil + PlayerData liés)
                              ├─ GET /api/friends     (amis + statut en ligne)
                              └─ POST /api/friends/*  (système d'amitié)
```

## Installation

```bash
cd lgmore-backend
npm install
```

## Configuration

Variables d'environnement (ou modifier directement dans server.js) :

| Variable     | Défaut                          | Description                              |
|--------------|---------------------------------|------------------------------------------|
| `PORT`       | `3000`                          | Port d'écoute                            |
| `ADMIN_KEY`  | `lgmore-admin-key-changeme`     | Clé secrète pour l'ingest Minecraft      |
| `JWT_SECRET` | `lgmore-jwt-changeme`           | Secret pour les tokens utilisateurs      |

**⚠️ Changez impérativement `ADMIN_KEY` et `JWT_SECRET` en production.**

## Démarrage

```bash
# Développement
ADMIN_KEY=ma-cle-secrete JWT_SECRET=mon-secret-jwt node server.js

# Ou avec nodemon (rechargement auto)
npm run dev
```

## Plugin Minecraft — Commande d'export

### 1. Copier `ExportCommand.java` dans votre projet

Placez `ExportCommand.java` dans le package `fr.fitzche.lgmore.commands`.

### 2. Configurer l'URL

Dans `ExportCommand.java`, modifiez :
```java
private static final String SITE_URL  = "http://VOTRE_SERVEUR:3000";
private static final String ADMIN_KEY = "votre-cle-admin-identique-au-backend";
```

### 3. Enregistrer la commande dans Lga.java

```java
// Dans Lga.java, dans onCommand(), ajouter :
if (args[0].equals("export")) {
    new ExportCommand().onCommand(sender, cmd, label,
        Arrays.copyOfRange(args, 1, args.length));
    return true;
}
```

### 4. Utilisation

```
/lga export                  → exporte TOUS les joueurs connus
/lga export online           → exporte uniquement les connectés
/lga export NomDuJoueur      → exporte un seul joueur
```

## API Endpoints

### Publics

| Méthode | Route                    | Description                          |
|---------|--------------------------|--------------------------------------|
| POST    | `/api/ingest`            | Reçoit les PlayerData (clé admin)    |
| POST    | `/api/auth/register`     | Création de compte                   |
| POST    | `/api/auth/login`        | Connexion                            |
| GET     | `/api/users/:id`         | Profil public d'un utilisateur       |

### Authentifiés (Bearer token)

| Méthode | Route                      | Description                        |
|---------|----------------------------|------------------------------------|
| GET     | `/api/me`                  | Mon profil + PlayerData liés       |
| PUT     | `/api/me`                  | Modifier pseudo / mcName / mdp     |
| DELETE  | `/api/me`                  | Supprimer le compte                |
| POST    | `/api/heartbeat`           | Maintenir le statut "en ligne"     |
| GET     | `/api/friends`             | Liste amis + statut + PlayerData   |
| GET     | `/api/friends/requests`    | Demandes reçues                    |
| POST    | `/api/friends/request`     | Envoyer une demande `{targetId}`   |
| POST    | `/api/friends/accept`      | Accepter `{requesterId}`           |
| POST    | `/api/friends/decline`     | Décliner `{requesterId}`           |
| DELETE  | `/api/friends/:id`         | Retirer un ami                     |

## Lier son compte au pseudo Minecraft

1. Se connecter sur le site
2. Aller dans **Paramètres → "Pseudo Minecraft"**
3. Entrer son pseudo exact (sensible à la casse)
4. Sauvegarder
5. Demander à un admin : `/lga export VotrePseudoMC`

Les données apparaîtront automatiquement dans le profil.

## Déploiement en production

```bash
# Avec PM2 (recommandé)
npm install -g pm2
ADMIN_KEY=cle-secrete JWT_SECRET=jwt-secret pm2 start server.js --name lgmore

# Avec un fichier .env (créer .env à la racine) :
# PORT=3000
# ADMIN_KEY=cle-secrete
# JWT_SECRET=jwt-secret
```

Le frontend (`public/index.html`) est servi automatiquement par le backend.
Mettez votre domaine dans la variable `API` en haut du JS du frontend.
