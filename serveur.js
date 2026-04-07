// ═══════════════════════════════════════════════════════════
//  server.js — Serveur Node.js + Socket.io
// ═══════════════════════════════════════════════════════════
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const {
  buildDeck, drawCard, handTotal,
  isBust, isBlackjack, isSoft17, resolvePlayer,
} = require('./gameLogic');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'joueur')));

const rooms = {};
const BOT_STRATEGIES = ['basic', 'conservative', 'aggressive', 'mimic'];

function generateCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function makePlayer(socketId, name, role) {
  return {
    socketId, name, role,
    balance: 1000, bet: 0, hand: [],
    stood: false, busted: false, doubled: false,
    result: null, gain: null, isBot: false, ready: false,
    // Split
    isSplit: false, splitHand: [], splitBet: 0,
    splitStood: false, splitBusted: false, playingSplit: false,
    splitResult: null, splitGain: null,
  };
}

function makeBot(name, role = 'player') {
  const id = 'bot_' + Math.random().toString(36).substring(2, 8);
  const strategy = BOT_STRATEGIES[Math.floor(Math.random() * BOT_STRATEGIES.length)];
  return {
    socketId: id, name, role, strategy,
    balance: role === 'dealer' ? 9999 : 1000,
    bet: 0, hand: [],
    stood: false, busted: false, doubled: false,
    result: null, gain: null, isBot: true, ready: true,
    isSplit: false, splitHand: [], splitBet: 0,
    splitStood: false, splitBusted: false, playingSplit: false,
    splitResult: null, splitGain: null,
  };
}

function createRoom(code) {
  return {
    code, phase: 'lobby', players: [], deck: [],
    currentPlayerIdx: -1, dealerIdx: -1, round: 0,
    hostSocketId: null, betTimerEnd: null, allPlayersReady: false,
    _betTimer: null,
  };
}

// ── Broadcast ─────────────────────────────────────────────────
function broadcastState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const revealDealer = room.phase === 'dealer' || room.phase === 'results';

  const publicState = {
    code: room.code, phase: room.phase,
    currentPlayerIdx: room.currentPlayerIdx,
    dealerIdx: room.dealerIdx, round: room.round,
    hostSocketId: room.hostSocketId,
    betTimerEnd: room.betTimerEnd,
    allPlayersReady: room.allPlayersReady,
    players: room.players.map((p, i) => {
      const hideSecond = i === room.dealerIdx && !revealDealer;
      const hand = hideSecond
        ? p.hand.map((c, ci) => ci === 1 ? { hidden: true } : c)
        : p.hand;
      return {
        ...p,
        hand,
        handTotal: handTotal(hand),
        splitHandTotal: p.splitHand?.length ? handTotal(p.splitHand) : 0,
      };
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

// ── Compléter les rôles manquants ─────────────────────────────
function autoFillRoles(room) {
  const msgs = [];
  if (!room.players.some(p => p.role === 'dealer')) {
    const bot = makeBot('Croupier 🎩', 'dealer');
    room.players.push(bot);
    room.dealerIdx = room.players.length - 1;
    msgs.push('Croupier bot ajouté automatiquement');
  }
  if (!room.players.some(p => p.role === 'player')) {
    room.players.push(makeBot('Alice 🤖', 'player'));
    msgs.push('Joueur bot ajouté automatiquement');
  }
  return msgs;
}

// ── Stratégies bot ────────────────────────────────────────────
function botShouldHit(bot, hand) {
  const total = handTotal(hand);
  switch (bot.strategy) {
    case 'conservative': return total < 15;
    case 'aggressive':   return total < 19;
    case 'mimic':        return total < 17 || isSoft17(hand);
    default: /* basic */ return total < 17;
  }
}

// ── Mises auto des bots ───────────────────────────────────────
function scheduleBotBets(room) {
  room.players.forEach(p => {
    if (p.isBot && p.role === 'player') {
      const amounts = [10, 25, 50, 100];
      p.bet = Math.min(amounts[Math.floor(Math.random() * amounts.length)], p.balance);
    }
  });
}

// ── Timer de mise ─────────────────────────────────────────────
function startBetTimer(room, seconds = 45) {
  if (room._betTimer) clearTimeout(room._betTimer);
  room.betTimerEnd = Date.now() + seconds * 1000;
  room._betTimer = setTimeout(() => {
    if (room.phase !== 'betting') return;
    // Mise minimum forcée pour les joueurs qui n'ont pas misé
    let changed = false;
    room.players.forEach(p => {
      if (p.role === 'player' && !p.isBot && p.bet === 0 && p.balance > 0) {
        p.bet = Math.min(10, p.balance);
        changed = true;
      }
    });
    if (changed) io.to(room.code).emit('toast', 'Temps écoulé — mise minimum appliquée');
    dealCardsForRoom(room);
  }, seconds * 1000);
}

// ── Init manche ───────────────────────────────────────────────
function initRound(room) {
  if (room._betTimer) { clearTimeout(room._betTimer); room._betTimer = null; }
  room.deck = buildDeck(2);
  room.phase = 'betting';
  room.round = (room.round || 0) + 1;
  room.currentPlayerIdx = -1;
  room.allPlayersReady = false;
  room.players.forEach(p => {
    p.hand = []; p.bet = 0;
    p.stood = false; p.busted = false; p.doubled = false;
    p.result = null; p.gain = null;
    p.ready = p.isBot; // bots toujours prêts
    // Reset split
    p.isSplit = false; p.splitHand = []; p.splitBet = 0;
    p.splitStood = false; p.splitBusted = false; p.playingSplit = false;
    p.splitResult = null; p.splitGain = null;
  });
  scheduleBotBets(room);
  startBetTimer(room, 45);
}

// ── Avancer le tour (avec gestion split) ──────────────────────
function advanceTurn(room) {
  const curP = room.players[room.currentPlayerIdx];

  // Si le joueur courant a un split hand non encore joué
  if (curP && curP.isSplit && !curP.playingSplit && !curP.splitStood && !curP.splitBusted) {
    curP.playingSplit = true;
    io.to(room.code).emit('toast', `${curP.name} — 2ème main`);
    if (curP.isBot) scheduleBotPlay(room, room.currentPlayerIdx);
    broadcastState(room.code);
    return;
  }

  const next = nextPlayerIdx(room.players, room.currentPlayerIdx);
  if (next === -1) {
    room.phase = 'dealer';
    room.currentPlayerIdx = -1;
    io.to(room.code).emit('toast', 'Tour du croupier !');
    autoDealerRevealIfBot(room);
  } else {
    room.currentPlayerIdx = next;
    const p = room.players[next];
    io.to(room.code).emit('toast', `Tour de ${p.name}`);
    if (p.isBot) scheduleBotPlay(room, next);
  }
}

// ── Bot joue ─────────────────────────────────────────────────
function scheduleBotPlay(room, botIdx) {
  setTimeout(() => {
    if (room.phase !== 'playing' || room.currentPlayerIdx !== botIdx) return;
    const bot  = room.players[botIdx];
    const hand = bot.playingSplit ? bot.splitHand : bot.hand;

    if (botShouldHit(bot, hand)) {
      hand.push({ ...drawCard(room.deck), hidden: false });
      const total = handTotal(hand);
      if (bot.playingSplit) {
        if (total > 21)        { bot.splitBusted = true; advanceTurn(room); }
        else if (total === 21) { bot.splitStood  = true; advanceTurn(room); }
        else { broadcastState(room.code); scheduleBotPlay(room, botIdx); return; }
      } else {
        if (total > 21)        { bot.busted = true; advanceTurn(room); }
        else if (total === 21) { bot.stood  = true; advanceTurn(room); }
        else { broadcastState(room.code); scheduleBotPlay(room, botIdx); return; }
      }
    } else {
      if (bot.playingSplit) bot.splitStood = true;
      else bot.stood = true;
      advanceTurn(room);
    }
    broadcastState(room.code);
  }, 900);
}

// ── Croupier révèle auto si bot ───────────────────────────────
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

// ── Croupier joue ─────────────────────────────────────────────
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
      room.players = computeResultsWithSplit(room);
      room.phase   = 'results';
      broadcastState(room.code);
    }, 400);
  }
}

// ── Distribution des cartes (logique extraite) ────────────────
function dealCardsForRoom(room) {
  if (room.phase !== 'betting') return;
  if (room._betTimer) { clearTimeout(room._betTimer); room._betTimer = null; }

  // Déduire mises joueurs ET croupier
  room.players.forEach(p => {
    if ((p.role === 'player' || p.role === 'dealer') && p.bet > 0) {
      p.balance -= p.bet;
    }
  });

  // Distribuer 2 cartes à tout le monde
  room.players.forEach(p => {
    p.hand.push({ ...drawCard(room.deck), hidden: false });
    p.hand.push({ ...drawCard(room.deck), hidden: false });
  });
  room.players[room.dealerIdx].hand[1].hidden = true;

  // Blackjacks immédiats
  room.players.forEach(p => {
    if (p.role === 'player' && isBlackjack(p.hand)) {
      p.stood = true;
      io.to(room.code).emit('blackjack', { name: p.name });
      setTimeout(() => io.to(room.code).emit('toast', `${p.name} — Blackjack ! ♠`), 600);
    }
  });

  room.phase = 'playing';
  room.currentPlayerIdx = nextPlayerIdx(room.players, -1);

  if (room.currentPlayerIdx === -1) {
    room.phase = 'dealer';
    io.to(room.code).emit('toast', 'Tour du croupier !');
    autoDealerRevealIfBot(room);
  } else {
    const cur = room.players[room.currentPlayerIdx];
    io.to(room.code).emit('toast', `Tour de ${cur.name}`);
    if (cur.isBot) scheduleBotPlay(room, room.currentPlayerIdx);
  }
  broadcastState(room.code);
}

// ── Résultats avec split ──────────────────────────────────────
function computeResultsWithSplit(room) {
  const dealer = room.players[room.dealerIdx];
  if (!dealer) {
    return room.players.map(p => ({
      ...p, result: 'push', gain: 0,
      balance: p.role === 'player' ? p.balance + p.bet : p.balance,
    }));
  }

  let dealerDelta = 0;

  const updated = room.players.map(p => {
    if (p.role === 'dealer') return p;

    // Main hand
    const { result, gain } = resolvePlayer(p, dealer.hand);
    let newBalance = p.balance + (result === 'lose' ? 0 : p.bet + gain);
    dealerDelta += result === 'lose' ? p.bet : result === 'win' ? -gain : 0;

    // Split hand
    let splitResult = null, splitGain = null;
    if (p.isSplit && p.splitHand.length > 0) {
      const fakeP = { hand: p.splitHand, busted: p.splitBusted, bet: p.splitBet };
      const sr    = resolvePlayer(fakeP, dealer.hand);
      splitResult = sr.result;
      splitGain   = sr.gain;
      newBalance += splitResult === 'lose' ? 0 : p.splitBet + splitGain;
      dealerDelta += splitResult === 'lose' ? p.splitBet : splitResult === 'win' ? -splitGain : 0;
    }

    return { ...p, result, gain, splitResult, splitGain, balance: newBalance };
  });

  // Mettre à jour la balance du croupier
  const dIdx = updated.findIndex(p => p.role === 'dealer');
  if (dIdx >= 0) {
    updated[dIdx] = { ...updated[dIdx], balance: updated[dIdx].balance + dealerDelta };
  }
  return updated;
}

// ── Vérifier si tous les humains sont prêts ───────────────────
function checkAllReady(room) {
  const humans = room.players.filter(p => p.role === 'player' && !p.isBot);
  if (humans.length === 0) return;
  const allReady = humans.every(p => p.ready);
  if (allReady && !room.allPlayersReady) {
    room.allPlayersReady = true;
    io.to(room.code).emit('toast', '✓ Tous les joueurs sont prêts !');
    broadcastState(room.code);
  }
}

// ════════════════════════════════════════════════════════════
//  SOCKET EVENTS
// ════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  // ── Créer une room ──────────────────────────────────────────
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

  // ── Rejoindre ───────────────────────────────────────────────
  socket.on('joinRoom', ({ code, name, role }, cb) => {
    const room = rooms[code];
    if (!room)                  return cb({ ok: false, error: 'Room introuvable.' });
    if (room.phase !== 'lobby') return cb({ ok: false, error: 'Partie déjà commencée.' });
    const hasDealer   = room.players.some(p => p.role === 'dealer');
    const playerCount = room.players.filter(p => p.role === 'player' && !p.isBot).length;
    if (role === 'dealer' && hasDealer)     return cb({ ok: false, error: 'Il y a déjà un croupier.' });
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

  // ── Liste des rooms ─────────────────────────────────────────
  socket.on('getRooms', (_, cb) => {
    const available = Object.values(rooms)
      .filter(r => r.phase === 'lobby')
      .map(r => ({
        code: r.code,
        players: r.players.filter(p => p.role === 'player' && !p.isBot).length,
        bots:    r.players.filter(p => p.isBot).length,
        dealer:  r.players.some(p => p.role === 'dealer'),
        host:    r.players.find(p => p.socketId === r.hostSocketId)?.name || '?',
      }));
    cb({ ok: true, rooms: available });
  });

  // ── Ajouter un bot ──────────────────────────────────────────
  socket.on('addBot', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'lobby' || !isHostSocket(socket, room))
      return cb?.({ ok: false, error: 'Seul l\'hôte peut ajouter des bots.' });
    const bots  = room.players.filter(p => p.isBot && p.role === 'player').length;
    const hums  = room.players.filter(p => p.role === 'player' && !p.isBot).length;
    if (hums + bots >= 4) return cb?.({ ok: false, error: 'Maximum 4 joueurs.' });
    const names = ['Alice 🤖', 'Bob 🤖', 'Charlie 🤖', 'Diana 🤖'];
    const bot   = makeBot(names[bots] || `Bot ${bots + 1} 🤖`, 'player');
    room.players.push(bot);
    io.to(room.code).emit('toast', `${bot.name} rejoint (stratégie: ${bot.strategy})`);
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  socket.on('removeBot', ({ botSocketId }, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'lobby' || !isHostSocket(socket, room)) return cb?.({ ok: false });
    room.players = room.players.filter(p => !(p.socketId === botSocketId && p.isBot));
    room.dealerIdx = room.players.findIndex(p => p.role === 'dealer');
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  socket.on('kickPlayer', ({ targetSocketId }, cb) => {
    const room = getRoom(socket);
    if (!room || !isHostSocket(socket, room)) return cb?.({ ok: false });
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

  // ── Démarrer ────────────────────────────────────────────────
  socket.on('startGame', (_, cb) => {
    const room = getRoom(socket);
    if (!room) return cb?.({ ok: false, error: 'Room introuvable.' });
    const me = getPlayer(socket, room);
    if (!me) return cb?.({ ok: false });
    if (me.role !== 'dealer' && !isHostSocket(socket, room))
      return cb?.({ ok: false, error: 'Seul le croupier ou l\'hôte peut démarrer.' });
    const msgs = autoFillRoles(room);
    msgs.forEach((m, i) => setTimeout(() => io.to(room.code).emit('toast', m), 300 * i));
    room.dealerIdx = room.players.findIndex(p => p.role === 'dealer');
    initRound(room);
    broadcastState(room.code);
    cb?.({ ok: true });
  });

  // ── Joueur prêt ─────────────────────────────────────────────
  socket.on('playerReady', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'betting') return cb?.({ ok: false });
    const p = getPlayer(socket, room);
    if (!p || p.role !== 'player' || p.isBot) return cb?.({ ok: false });
    if (p.bet === 0) return cb?.({ ok: false, error: 'Misez d\'abord !' });
    p.ready = true;
    io.to(room.code).emit('toast', `${p.name} est prêt !`);
    checkAllReady(room);
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  // ── Mises (joueurs ET croupier) ──────────────────────────────
  socket.on('placeBet', ({ amount }, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'betting') return cb?.({ ok: false });
    const p = getPlayer(socket, room);
    if (!p || p.isBot) return cb?.({ ok: false });
    if (p.balance - p.bet < amount) return cb?.({ ok: false, error: 'Solde insuffisant.' });
    p.bet += amount;
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  socket.on('clearBet', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'betting') return;
    const p = getPlayer(socket, room);
    if (!p || p.isBot) return;
    p.bet = 0;
    if (p.role === 'player') p.ready = false;
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  // ── Distribuer les cartes ───────────────────────────────────
  socket.on('dealCards', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'betting') return cb?.({ ok: false });
    if (!isDealerSocket(socket, room)) return cb?.({ ok: false, error: 'Seul le croupier distribue.' });
    const unbetted = room.players.filter(p => p.role === 'player' && !p.isBot && p.bet === 0);
    if (unbetted.length > 0)
      return cb?.({ ok: false, error: `${unbetted[0].name} n'a pas encore misé.` });
    dealCardsForRoom(room);
    cb?.({ ok: true });
  });

  // ── Hit ─────────────────────────────────────────────────────
  socket.on('hit', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const p   = getPlayer(socket, room);
    const idx = room.players.indexOf(p);
    if (idx !== room.currentPlayerIdx || p?.isBot) return cb?.({ ok: false, error: 'Pas ton tour.' });

    const hand = p.playingSplit ? p.splitHand : p.hand;
    hand.push({ ...drawCard(room.deck), hidden: false });
    const total = handTotal(hand);

    if (p.playingSplit) {
      if (total > 21)        { p.splitBusted = true; advanceTurn(room); }
      else if (total === 21) { p.splitStood  = true; advanceTurn(room); }
    } else {
      if (total > 21)        { p.busted = true; advanceTurn(room); }
      else if (total === 21) { p.stood  = true; advanceTurn(room); }
    }
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  // ── Stand ───────────────────────────────────────────────────
  socket.on('stand', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const p = getPlayer(socket, room);
    if (room.players.indexOf(p) !== room.currentPlayerIdx || p?.isBot) return cb?.({ ok: false });
    if (p.playingSplit) p.splitStood = true;
    else p.stood = true;
    advanceTurn(room);
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  // ── Double ──────────────────────────────────────────────────
  socket.on('double', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const p = getPlayer(socket, room);
    if (room.players.indexOf(p) !== room.currentPlayerIdx || p?.isBot) return cb?.({ ok: false });
    const hand = p.playingSplit ? p.splitHand : p.hand;
    const bet  = p.playingSplit ? p.splitBet  : p.bet;
    if (hand.length !== 2 || p.balance < bet) return cb?.({ ok: false, error: 'Double impossible.' });
    p.balance -= bet;
    if (p.playingSplit) {
      p.splitBet *= 2;
      p.splitHand.push({ ...drawCard(room.deck), hidden: false });
      if (handTotal(p.splitHand) > 21) p.splitBusted = true;
      p.splitStood = true;
    } else {
      p.bet *= 2; p.doubled = true;
      p.hand.push({ ...drawCard(room.deck), hidden: false });
      if (handTotal(p.hand) > 21) p.busted = true;
      p.stood = true;
    }
    advanceTurn(room);
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  // ── Split ───────────────────────────────────────────────────
  socket.on('split', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const p   = getPlayer(socket, room);
    const idx = room.players.indexOf(p);
    if (idx !== room.currentPlayerIdx || p?.isBot) return cb?.({ ok: false, error: 'Pas ton tour.' });
    if (p.isSplit)            return cb?.({ ok: false, error: 'Déjà splitté.' });
    if (p.hand.length !== 2)  return cb?.({ ok: false, error: 'Split impossible.' });
    if (p.hand[0].rank !== p.hand[1].rank) return cb?.({ ok: false, error: 'Les cartes doivent être identiques pour splitter.' });
    if (p.balance < p.bet)    return cb?.({ ok: false, error: 'Solde insuffisant pour splitter.' });

    p.balance  -= p.bet;
    p.splitBet  = p.bet;
    p.isSplit   = true;
    p.splitHand = [p.hand.pop()];                                   // 2e carte → split
    p.hand.push({ ...drawCard(room.deck), hidden: false });          // complète main 1
    p.splitHand.push({ ...drawCard(room.deck), hidden: false });     // complète main 2

    if (isBlackjack(p.hand))      p.stood      = true;
    if (isBlackjack(p.splitHand)) p.splitStood = true;

    io.to(room.code).emit('toast', `${p.name} — Split ! ✂`);
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  // ── Révélation croupier ─────────────────────────────────────
  socket.on('dealerReveal', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'dealer' || !isDealerSocket(socket, room)) return cb?.({ ok: false });
    const dealer = room.players[room.dealerIdx];
    if (dealer) dealer.hand.forEach(c => (c.hidden = false));
    cb?.({ ok: true });
    broadcastState(room.code);
    scheduleDealerPlay(room);
  });

  // ── Nouvelle manche ─────────────────────────────────────────
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

  // ── Quitter ─────────────────────────────────────────────────
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
      if (room._betTimer) clearTimeout(room._betTimer);
      delete rooms[room.code];
    } else {
      room.dealerIdx = room.players.findIndex(p => p.role === 'dealer');
      if (leaving) io.to(room.code).emit('toast', `${leaving.name} a quitté`);
      broadcastState(room.code);
    }
    cb?.({ ok: true });
  });

  // ── Déconnexion ─────────────────────────────────────────────
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
      if (room._betTimer) clearTimeout(room._betTimer);
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
