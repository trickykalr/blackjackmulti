// ═══════════════════════════════════════════════════════════
//  server.js — Serveur Node.js + Socket.io
// ═══════════════════════════════════════════════════════════

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const {
  buildDeck, drawCard, handTotal,
  isBust, isBlackjack, isSoft17, computeResults,
} = require('./gameLogic');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '../joueur')));

const rooms = {};

function generateCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function makePlayer(socketId, name, role) {
  return {
    socketId, name, role,
    balance: 1000, bet: 0, hand: [],
    stood: false, busted: false, doubled: false,
    result: null, gain: null, isBot: false,
  };
}

function makeBot(name, role = 'player') {
  const id = 'bot_' + Math.random().toString(36).substring(2, 8);
  return {
    socketId: id, name, role,
    balance: role === 'dealer' ? 9999 : 1000,
    bet: 0, hand: [],
    stood: false, busted: false, doubled: false,
    result: null, gain: null, isBot: true,
  };
}

function createRoom(code) {
  return {
    code, phase: 'lobby', players: [], deck: [],
    currentPlayerIdx: -1, dealerIdx: -1, round: 0, hostSocketId: null,
  };
}

// ── Broadcast ─────────────────────────────────────────────────
function broadcastState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const revealDealer = room.phase === 'dealer' || room.phase === 'results';

  const publicState = {
    ...room,
    players: room.players.map((p, i) => {
      const hideSecond = i === room.dealerIdx && !revealDealer;
      const hand = hideSecond
        ? p.hand.map((c, ci) => (ci === 1 ? { hidden: true } : c))
        : p.hand;
      return { ...p, hand, handTotal: handTotal(hand) };
    }),
  };
  io.to(roomCode).emit('state', publicState);
}

// ── Helpers ───────────────────────────────────────────────────
function getRoom(socket)         { return rooms[socket.data.roomCode]; }
function getPlayer(socket, room) { return room.players.find(p => p.socketId === socket.id); }
function isDealerSocket(socket, room) { return getPlayer(socket, room)?.role === 'dealer'; }
function isHostSocket(socket, room)   { return room.hostSocketId === socket.id; }

function nextPlayerIdx(players, from) {
  for (let i = from + 1; i < players.length; i++) {
    if (players[i].role === 'player' && !players[i].stood && !players[i].busted) return i;
  }
  return -1;
}

// ── Compléter les rôles manquants avant le départ ─────────────
function autoFillRoles(room) {
  const msgs = [];
  const hasDealer  = room.players.some(p => p.role === 'dealer');
  const hasPlayers = room.players.some(p => p.role === 'player');

  if (!hasDealer) {
    const bot = makeBot('Croupier 🎩', 'dealer');
    room.players.push(bot);
    room.dealerIdx = room.players.length - 1;
    msgs.push('Croupier bot ajouté automatiquement');
  }
  if (!hasPlayers) {
    room.players.push(makeBot('Alice 🤖', 'player'));
    msgs.push('Joueur bot ajouté automatiquement');
  }
  return msgs;
}

// ── Bots : mises auto ─────────────────────────────────────────
function scheduleBotBets(room) {
  room.players.forEach(p => {
    if (p.isBot && p.role === 'player') {
      const amounts = [10, 25, 50];
      p.bet = Math.min(amounts[Math.floor(Math.random() * amounts.length)], p.balance);
    }
  });
}

// ── Init manche ───────────────────────────────────────────────
function initRound(room) {
  room.deck = buildDeck(2);
  room.phase = 'betting';
  room.round = (room.round || 0) + 1;
  room.currentPlayerIdx = -1;
  room.players.forEach(p => {
    p.hand = []; p.bet = 0; p.stood = false;
    p.busted = false; p.doubled = false; p.result = null; p.gain = null;
  });
  scheduleBotBets(room);
}

function advanceTurn(room) {
  const next = nextPlayerIdx(room.players, room.currentPlayerIdx);
  if (next === -1) {
    room.phase = 'dealer';
    room.currentPlayerIdx = -1;
    io.to(room.code).emit('toast', 'Tour du croupier !');
    // Si croupier est un bot → joue automatiquement
    autoDealerRevealIfBot(room);
  } else {
    room.currentPlayerIdx = next;
    const p = room.players[next];
    io.to(room.code).emit('toast', `Tour de ${p.name}`);
    if (p.isBot) scheduleBotPlay(room, next);
  }
}

function autoDealerRevealIfBot(room) {
  const dealer = room.players[room.dealerIdx];
  if (!dealer?.isBot) return;
  setTimeout(() => {
    if (room.phase !== 'dealer') return;
    dealer.hand.forEach(c => (c.hidden = false));
    broadcastState(room.code);
    scheduleDealerPlay(room);
  }, 1200);
}

function scheduleDealerPlay(room) {
  const dealer = room.players[room.dealerIdx];
  if (!dealer) return;
  const total = handTotal(dealer.hand);
  if (total < 17 || isSoft17(dealer.hand)) {
    setTimeout(() => {
      dealer.hand.push({ ...drawCard(room.deck), hidden: false });
      broadcastState(room.code);
      scheduleDealerPlay(room);
    }, 700);
  } else {
    setTimeout(() => {
      room.players = computeResults(room);
      room.phase   = 'results';
      broadcastState(room.code);
    }, 400);
  }
}

function scheduleBotPlay(room, botIdx) {
  setTimeout(() => {
    if (room.phase !== 'playing' || room.currentPlayerIdx !== botIdx) return;
    const bot   = room.players[botIdx];
    const total = handTotal(bot.hand);
    if (total < 17) {
      bot.hand.push({ ...drawCard(room.deck), hidden: false });
      const newTotal = handTotal(bot.hand);
      if (newTotal > 21)        { bot.busted = true; advanceTurn(room); }
      else if (newTotal === 21) { bot.stood  = true; advanceTurn(room); }
      else { broadcastState(room.code); scheduleBotPlay(room, botIdx); return; }
    } else {
      bot.stood = true;
      advanceTurn(room);
    }
    broadcastState(room.code);
  }, 900);
}

// ── Socket events ─────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  socket.on('createRoom', ({ name, role }, cb) => {
    const code = generateCode();
    rooms[code] = createRoom(code);
    rooms[code].hostSocketId = socket.id;
    const player = makePlayer(socket.id, name, role);
    rooms[code].players.push(player);
    if (role === 'dealer') rooms[code].dealerIdx = 0;
    socket.join(code);
    socket.data.roomCode = code;
    cb({ ok: true, code, playerIndex: 0 });
    broadcastState(code);
  });

  socket.on('joinRoom', ({ code, name, role }, cb) => {
    const room = rooms[code];
    if (!room)                  return cb({ ok: false, error: 'Room introuvable.' });
    if (room.phase !== 'lobby') return cb({ ok: false, error: 'Partie déjà commencée.' });
    const hasDealer   = room.players.some(p => p.role === 'dealer');
    const playerCount = room.players.filter(p => p.role === 'player' && !p.isBot).length;
    if (role === 'dealer' && hasDealer)    return cb({ ok: false, error: 'Il y a déjà un croupier.' });
    if (role === 'player' && playerCount >= 4) return cb({ ok: false, error: 'Room pleine (4 joueurs max).' });
    const player = makePlayer(socket.id, name, role);
    room.players.push(player);
    if (role === 'dealer') room.dealerIdx = room.players.length - 1;
    socket.join(code);
    socket.data.roomCode = code;
    io.to(code).emit('toast', `${name} a rejoint la salle !`);
    cb({ ok: true, code, playerIndex: room.players.length - 1 });
    broadcastState(code);
  });

  socket.on('getRooms', (_, cb) => {
    const available = Object.values(rooms)
      .filter(r => r.phase === 'lobby')
      .map(r => ({
        code:    r.code,
        players: r.players.filter(p => p.role === 'player' && !p.isBot).length,
        bots:    r.players.filter(p => p.isBot).length,
        dealer:  r.players.some(p => p.role === 'dealer'),
        host:    r.players.find(p => p.socketId === r.hostSocketId)?.name || '?',
      }));
    cb({ ok: true, rooms: available });
  });

  // ── Ajouter un bot joueur (hôte) ────────────────────────────
  socket.on('addBot', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'lobby') return cb?.({ ok: false });
    if (!isHostSocket(socket, room))
      return cb?.({ ok: false, error: 'Seul l\'hôte peut ajouter des bots.' });
    const botPlayers = room.players.filter(p => p.isBot && p.role === 'player').length;
    const humans     = room.players.filter(p => p.role === 'player' && !p.isBot).length;
    if (humans + botPlayers >= 4) return cb?.({ ok: false, error: 'Maximum 4 joueurs.' });
    const botNames = ['Alice 🤖', 'Bob 🤖', 'Charlie 🤖', 'Diana 🤖'];
    const name = botNames[botPlayers] || `Bot ${botPlayers + 1} 🤖`;
    room.players.push(makeBot(name, 'player'));
    cb?.({ ok: true });
    io.to(room.code).emit('toast', `${name} rejoint comme bot`);
    broadcastState(room.code);
  });

  socket.on('removeBot', ({ botSocketId }, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'lobby' || !isHostSocket(socket, room)) return cb?.({ ok: false });
    const bot = room.players.find(p => p.socketId === botSocketId && p.isBot);
    if (!bot) return cb?.({ ok: false });
    room.players   = room.players.filter(p => p.socketId !== botSocketId);
    room.dealerIdx = room.players.findIndex(p => p.role === 'dealer');
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  socket.on('kickPlayer', ({ targetSocketId }, cb) => {
    const room = getRoom(socket);
    if (!room || !isHostSocket(socket, room)) return cb?.({ ok: false, error: 'Seul l\'hôte peut expulser.' });
    const target = room.players.find(p => p.socketId === targetSocketId);
    if (!target || target.socketId === socket.id) return cb?.({ ok: false });
    room.players   = room.players.filter(p => p.socketId !== targetSocketId);
    room.dealerIdx = room.players.findIndex(p => p.role === 'dealer');
    io.to(targetSocketId).emit('kicked', { reason: 'Vous avez été expulsé par l\'hôte.' });
    io.to(room.code).emit('toast', `${target.name} a été expulsé`);
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  socket.on('getInviteCode', (_, cb) => {
    const room = getRoom(socket);
    if (!room) return cb?.({ ok: false });
    cb?.({ ok: true, code: room.code });
  });

  // ── Démarrer — solo ou multi, complète les rôles auto ───────
  socket.on('startGame', (_, cb) => {
    const room = getRoom(socket);
    if (!room) return cb?.({ ok: false, error: 'Room introuvable.' });
    const me = getPlayer(socket, room);
    if (!me) return cb?.({ ok: false });
    if (me.role !== 'dealer' && !isHostSocket(socket, room))
      return cb?.({ ok: false, error: 'Seul le croupier ou l\'hôte peut démarrer.' });

    // Compléter automatiquement les rôles manquants
    const msgs = autoFillRoles(room);
    msgs.forEach(m => setTimeout(() => io.to(room.code).emit('toast', m), 300));
    room.dealerIdx = room.players.findIndex(p => p.role === 'dealer');

    initRound(room);
    broadcastState(room.code);
    cb?.({ ok: true });
  });

  socket.on('placeBet', ({ amount }, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'betting') return cb?.({ ok: false });
    const p = getPlayer(socket, room);
    if (!p || p.role !== 'player' || p.isBot) return cb?.({ ok: false });
    if (p.balance - p.bet < amount) return cb?.({ ok: false, error: 'Solde insuffisant.' });
    p.bet += amount;
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  socket.on('clearBet', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'betting') return;
    const p = getPlayer(socket, room);
    if (!p || p.role !== 'player' || p.isBot) return;
    p.bet = 0;
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  socket.on('dealCards', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'betting') return cb?.({ ok: false });
    if (!isDealerSocket(socket, room)) return cb?.({ ok: false, error: 'Seul le croupier distribue.' });
    const unbetted = room.players.filter(p => p.role === 'player' && !p.isBot && p.bet === 0);
    if (unbetted.length > 0)
      return cb?.({ ok: false, error: `${unbetted[0].name} n'a pas encore misé.` });

    room.players.forEach(p => { if (p.role === 'player') p.balance -= p.bet; });
    room.players.forEach(p => {
      p.hand.push({ ...drawCard(room.deck), hidden: false });
      p.hand.push({ ...drawCard(room.deck), hidden: false });
    });
    room.players[room.dealerIdx].hand[1].hidden = true;

    room.players.forEach(p => {
      if (p.role === 'player' && isBlackjack(p.hand)) {
        p.stood = true;
        io.to(room.code).emit('toast', `${p.name} — Blackjack ! ♠`);
      }
    });

    room.phase = 'playing';
    room.currentPlayerIdx = nextPlayerIdx(room.players, -1);

    if (room.currentPlayerIdx === -1) {
      room.phase = 'dealer';
      io.to(room.code).emit('toast', 'Tous en Blackjack !');
      autoDealerRevealIfBot(room);
    } else {
      const cur = room.players[room.currentPlayerIdx];
      io.to(room.code).emit('toast', `Tour de ${cur.name}`);
      if (cur.isBot) scheduleBotPlay(room, room.currentPlayerIdx);
    }
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  socket.on('hit', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const p   = getPlayer(socket, room);
    const idx = room.players.indexOf(p);
    if (idx !== room.currentPlayerIdx || p?.isBot) return cb?.({ ok: false, error: 'Pas ton tour.' });
    p.hand.push({ ...drawCard(room.deck), hidden: false });
    const total = handTotal(p.hand);
    if (total > 21)        { p.busted = true; advanceTurn(room); }
    else if (total === 21) { p.stood  = true; advanceTurn(room); }
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  socket.on('stand', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const p = getPlayer(socket, room);
    if (room.players.indexOf(p) !== room.currentPlayerIdx || p?.isBot) return cb?.({ ok: false });
    p.stood = true;
    advanceTurn(room);
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  socket.on('double', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const p = getPlayer(socket, room);
    if (room.players.indexOf(p) !== room.currentPlayerIdx || p?.isBot) return cb?.({ ok: false });
    if (p.hand.length !== 2 || p.balance < p.bet) return cb?.({ ok: false, error: 'Double impossible.' });
    p.balance -= p.bet; p.bet *= 2; p.doubled = true;
    p.hand.push({ ...drawCard(room.deck), hidden: false });
    if (handTotal(p.hand) > 21) p.busted = true;
    p.stood = true;
    advanceTurn(room);
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  socket.on('dealerReveal', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'dealer' || !isDealerSocket(socket, room)) return cb?.({ ok: false });
    const dealer = room.players[room.dealerIdx];
    if (dealer) dealer.hand.forEach(c => (c.hidden = false));
    cb?.({ ok: true });
    broadcastState(room.code);
    scheduleDealerPlay(room);
  });

  socket.on('newRound', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'results') return cb?.({ ok: false });
    const me = getPlayer(socket, room);
    if (!me || (me.role !== 'dealer' && !isHostSocket(socket, room))) return cb?.({ ok: false });

    room.players = room.players.filter(p => p.role === 'dealer' || p.isBot || p.balance > 0);
    room.dealerIdx = room.players.findIndex(p => p.role === 'dealer');

    if (room.players.filter(p => p.role === 'player').length === 0) {
      io.to(room.code).emit('toast', 'Plus de joueurs solvables !');
      room.phase = 'lobby';
      broadcastState(room.code);
      return cb?.({ ok: true });
    }
    initRound(room);
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  socket.on('leaveRoom', (_, cb) => {
    const room = getRoom(socket);
    if (!room) return cb?.({ ok: false });
    const idx = room.players.findIndex(p => p.socketId === socket.id);
    if (idx === room.currentPlayerIdx && room.phase === 'playing') {
      room.players[idx].stood = true;
      advanceTurn(room);
    }
    const leaving = room.players.find(p => p.socketId === socket.id);
    room.players  = room.players.filter(p => p.socketId !== socket.id);
    if (room.hostSocketId === socket.id && room.players.length > 0) {
      const newHost = room.players.find(p => !p.isBot) || room.players[0];
      room.hostSocketId = newHost.socketId;
      io.to(newHost.socketId).emit('toast', 'Vous êtes maintenant l\'hôte 👑');
    }
    socket.leave(room.code);
    socket.data.roomCode = null;
    if (room.players.length === 0 || room.players.every(p => p.isBot)) {
      delete rooms[room.code];
    } else {
      room.dealerIdx = room.players.findIndex(p => p.role === 'dealer');
      if (leaving) io.to(room.code).emit('toast', `${leaving.name} a quitté`);
      broadcastState(room.code);
    }
    cb?.({ ok: true });
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    const idx  = room.players.findIndex(p => p.socketId === socket.id);
    if (idx === room.currentPlayerIdx && room.phase === 'playing') {
      room.players[idx].stood = true;
      advanceTurn(room);
    }
    const leaving = room.players.find(p => p.socketId === socket.id);
    room.players  = room.players.filter(p => p.socketId !== socket.id);
    if (room.hostSocketId === socket.id && room.players.length > 0) {
      const newHost = room.players.find(p => !p.isBot) || room.players[0];
      if (newHost) {
        room.hostSocketId = newHost.socketId;
        io.to(newHost.socketId).emit('toast', 'Vous êtes maintenant l\'hôte 👑');
      }
    }
    if (room.players.length === 0 || room.players.every(p => p.isBot)) {
      delete rooms[code];
    } else {
      room.dealerIdx = room.players.findIndex(p => p.role === 'dealer');
      if (leaving) io.to(code).emit('toast', `${leaving.name} s'est déconnecté`);
      broadcastState(code);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🃏 BlackJack → http://localhost:${PORT}`));
