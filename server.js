/**
 * LgMore Backend Server
 * API REST pour la synchronisation PlayerData Minecraft → Site web
 *
 * Routes publiques :
 *   POST /api/ingest             ← reçoit les données depuis Minecraft (clé admin)
 *   POST /api/auth/register      ← inscription
 *   POST /api/auth/login         ← connexion
 *   GET  /api/users/:id          ← profil public
 *
 * Routes authentifiées (Bearer token) :
 *   GET    /api/me               ← profil + PlayerData liés
 *   PUT    /api/me               ← modifier pseudo / mcName / mot de passe
 *   DELETE /api/me               ← supprimer le compte
 *   POST   /api/heartbeat        ← maintenir la présence en ligne
 *   GET    /api/friends          ← liste des amis + statut en ligne + PlayerData
 *   GET    /api/friends/requests ← demandes reçues
 *   POST   /api/friends/request  ← envoyer demande { targetId }
 *   POST   /api/friends/accept   ← accepter demande  { requesterId }
 *   POST   /api/friends/decline  ← décliner demande  { requesterId }
 *   DELETE /api/friends/:id      ← retirer ami
 */

const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 25662;

// ─── CONFIG ──────────────────────────────────────────────────────
const ADMIN_KEY  = process.env.ADMIN_KEY  || 'lgmore-admin-key-fitzche';
const JWT_SECRET = process.env.JWT_SECRET || 'lgmore-jwt-fitzche';
const ONLINE_TTL = 5 * 60 * 1000; // 5 minutes = "en ligne"

// ─── MIDDLEWARES ─────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── STORAGE ─────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
  users:      path.join(DATA_DIR, 'users.json'),
  playerdata: path.join(DATA_DIR, 'playerdata.json'),
};

const readDB  = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
const writeDB = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8');

// ─── AUTH HELPERS ────────────────────────────────────────────────
const hashPw = pw => crypto.createHash('sha256').update(pw + JWT_SECRET).digest('hex');

const makeToken = uid => {
  const p = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 30*24*60*60*1000 })).toString('base64');
  const s = crypto.createHmac('sha256', JWT_SECRET).update(p).digest('hex');
  return `${p}.${s}`;
};

const verifyToken = tok => {
  try {
    const [p, s] = tok.split('.');
    if (crypto.createHmac('sha256', JWT_SECRET).update(p).digest('hex') !== s) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64').toString());
    return Date.now() > payload.exp ? null : payload;
  } catch { return null; }
};

const auth = (req, res, next) => {
  const tok = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const p   = verifyToken(tok);
  if (!p) return res.status(401).json({ error: 'Non authentifié' });
  const users = readDB(FILES.users);
  if (!users[p.uid]) return res.status(401).json({ error: 'Compte introuvable' });
  req.userId = p.uid;
  req.user   = users[p.uid];
  next();
};

const adminAuth = (req, res, next) => {
  if ((req.headers['x-admin-key'] || req.query.adminKey) !== ADMIN_KEY)
    return res.status(403).json({ error: 'Clé admin invalide' });
  next();
};

const clean = u => { const { pw, ...r } = u; return r; };

// ─── INGEST ──────────────────────────────────────────────────────
/**
 * POST /api/ingest
 * Header:  x-admin-key: <ADMIN_KEY>
 * Body (accepte les 3 formats) :
 *   { "players": [ {...}, ... ] }        // plusieurs joueurs
 *   { "player":  {...} }                 // un seul joueur
 *   { "Name": "...", "xp": 0, ... }      // corps = directement un PlayerData
 */
app.post('/api/ingest', adminAuth, (req, res) => {
  const pd  = readDB(FILES.playerdata);
  const now = Date.now();
  let players = [];

  if (Array.isArray(req.body.players))   players = req.body.players;
  else if (req.body.player)              players = [req.body.player];
  else                                   players = [req.body];

  const saved = [];
  for (const p of players) {
    const raw = p.Name || p.name;
    if (!raw) continue;
    const key = raw.toLowerCase();
    pd[key] = { ...p, _importedAt: now };
    saved.push(key);
  }

  writeDB(FILES.playerdata, pd);
  console.log(`[INGEST] ${saved.length} joueur(s) : ${saved.join(', ')}`);
  res.json({ success: true, imported: saved.length, players: saved });
});

// ─── AUTH ────────────────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
  const { username, pseudo, password } = req.body;
  if (!username || !pseudo || !password)
    return res.status(400).json({ error: 'Champs manquants' });
  if (username.length < 3 || !/^[a-zA-Z0-9_]+$/.test(username))
    return res.status(400).json({ error: 'Identifiant invalide (min 3 car, lettres/chiffres/_)' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Mot de passe trop court (min 6 car)' });

  const users = readDB(FILES.users);
  if (users[username]) return res.status(409).json({ error: 'Identifiant déjà pris' });

  users[username] = {
    id: username, pseudo, pw: hashPw(password),
    createdAt: Date.now(), lastSeen: Date.now(),
    friends: [], friendRequests: [],
    mcName: null,
  };
  writeDB(FILES.users, users);
  res.json({ token: makeToken(username), user: clean(users[username]) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const users = readDB(FILES.users);
  const u = users[username];
  if (!u || u.pw !== hashPw(password))
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });

  users[username].lastSeen = Date.now();
  writeDB(FILES.users, users);
  res.json({ token: makeToken(username), user: clean(u) });
});

// ─── MOI ─────────────────────────────────────────────────────────
app.get('/api/me', auth, (req, res) => {
  const pd   = readDB(FILES.playerdata);
  const user = clean(req.user);
  if (user.mcName) user.playerData = pd[user.mcName.toLowerCase()] || null;
  res.json(user);
});

app.put('/api/me', auth, (req, res) => {
  const users = readDB(FILES.users);
  const u = users[req.userId];
  const { pseudo, password, mcName } = req.body;
  if (pseudo) u.pseudo = pseudo.trim();

  // ── Vérification unicité du pseudo Minecraft ──────────────────────────
  // Un pseudo MC ne peut être associé qu'à un seul compte à la fois.
  if (mcName !== undefined) {
    const normalized = mcName ? mcName.trim().toLowerCase() : null;
    if (normalized) {
      // Chercher si un autre compte utilise déjà ce mcName
      const conflict = Object.values(users).find(
        other => other.id !== req.userId && other.mcName === normalized
      );
      if (conflict) {
        return res.status(409).json({
          error: `Le pseudo Minecraft "${mcName.trim()}" est déjà associé à un autre compte.`
        });
      }
    }
    u.mcName = normalized;
  }

  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court' });
    u.pw = hashPw(password);
  }
  users[req.userId] = u;
  writeDB(FILES.users, users);
  res.json({ success: true, user: clean(u) });
});

app.delete('/api/me', auth, (req, res) => {
  const users = readDB(FILES.users);
  for (const uid of Object.keys(users)) {
    users[uid].friends        = (users[uid].friends        || []).filter(f => f !== req.userId);
    users[uid].friendRequests = (users[uid].friendRequests || []).filter(f => f !== req.userId);
  }
  delete users[req.userId];
  writeDB(FILES.users, users);
  res.json({ success: true });
});

// ─── PRÉSENCE ────────────────────────────────────────────────────
app.post('/api/heartbeat', auth, (req, res) => {
  const users = readDB(FILES.users);
  users[req.userId].lastSeen = Date.now();
  writeDB(FILES.users, users);
  res.json({ ok: true });
});

// ─── PROFIL PUBLIC ────────────────────────────────────────────────
app.get('/api/users/:id', (req, res) => {
  const users = readDB(FILES.users);
  const u = users[req.params.id];
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const pd  = readDB(FILES.playerdata);
  const out = clean(u);
  if (u.mcName) out.playerData = pd[u.mcName.toLowerCase()] || null;
  res.json(out);
});

// ─── AMIS ────────────────────────────────────────────────────────
app.get('/api/friends', auth, (req, res) => {
  const users = readDB(FILES.users);
  const pd    = readDB(FILES.playerdata);
  const me    = users[req.userId];
  const now   = Date.now();

  const list = (me.friends || []).map(fId => {
    const f = users[fId]; if (!f) return null;
    return {
      id:         fId,
      pseudo:     f.pseudo,
      online:     now - f.lastSeen < ONLINE_TTL,
      lastSeen:   f.lastSeen,
      mcName:     f.mcName,
      playerData: f.mcName ? (pd[f.mcName.toLowerCase()] || null) : null,
    };
  }).filter(Boolean);

  res.json(list);
});

app.get('/api/friends/requests', auth, (req, res) => {
  const users = readDB(FILES.users);
  const me    = users[req.userId];
  const list  = (me.friendRequests || []).map(rId => {
    const f = users[rId]; if (!f) return null;
    return { id: rId, pseudo: f.pseudo };
  }).filter(Boolean);
  res.json(list);
});

app.post('/api/friends/request', auth, (req, res) => {
  const { targetId } = req.body;
  const users  = readDB(FILES.users);
  const me     = users[req.userId];
  const target = users[targetId];
  if (!target)                                    return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (targetId === req.userId)                    return res.status(400).json({ error: 'Vous ne pouvez pas vous ajouter vous-même' });
  if ((me.friends || []).includes(targetId))      return res.status(409).json({ error: 'Déjà amis' });
  if ((target.friendRequests || []).includes(req.userId))
                                                  return res.status(409).json({ error: 'Demande déjà envoyée' });
  target.friendRequests = [...(target.friendRequests || []), req.userId];
  users[targetId] = target;
  writeDB(FILES.users, users);
  res.json({ success: true });
});

app.post('/api/friends/accept', auth, (req, res) => {
  const { requesterId } = req.body;
  const users = readDB(FILES.users);
  const me    = users[req.userId];
  const other = users[requesterId];
  if (!other) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (!(me.friendRequests || []).includes(requesterId))
    return res.status(400).json({ error: 'Aucune demande de cet utilisateur' });
  me.friends    = [...new Set([...(me.friends    || []), requesterId])];
  other.friends = [...new Set([...(other.friends || []), req.userId])];
  me.friendRequests = (me.friendRequests || []).filter(r => r !== requesterId);
  users[req.userId]  = me;
  users[requesterId] = other;
  writeDB(FILES.users, users);
  res.json({ success: true });
});

app.post('/api/friends/decline', auth, (req, res) => {
  const { requesterId } = req.body;
  const users = readDB(FILES.users);
  users[req.userId].friendRequests = (users[req.userId].friendRequests || []).filter(r => r !== requesterId);
  writeDB(FILES.users, users);
  res.json({ success: true });
});

app.delete('/api/friends/:id', auth, (req, res) => {
  const fId   = req.params.id;
  const users = readDB(FILES.users);
  if (users[req.userId]) { users[req.userId].friends = (users[req.userId].friends || []).filter(f => f !== fId); }
  if (users[fId])        { users[fId].friends        = (users[fId].friends        || []).filter(f => f !== req.userId); }
  writeDB(FILES.users, users);
  res.json({ success: true });
});

// ─── START ───────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🐺 LgMore API → 91.197.6.199:${PORT}`);
  console.log(`   ADMIN_KEY = ${ADMIN_KEY}`);
  console.log(`   data/     = ${DATA_DIR}\n`);
});
