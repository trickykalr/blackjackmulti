// ═══════════════════════════════════════════════════════════
//  gameLogic.js — Logique pure du Blackjack (aucun DOM, aucun état global)
//  Toutes ces fonctions sont stateless : elles reçoivent des données
//  et retournent des données. Faciles à tester unitairement.
// ═══════════════════════════════════════════════════════════

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RED_SUITS = ['♥', '♦'];

// ── Deck ────────────────────────────────────────────────────
function buildDeck(numDecks = 2) {
  const deck = [];
  for (let d = 0; d < numDecks; d++)
    for (const suit of SUITS)
      for (const rank of RANKS)
        deck.push({ rank, suit });
  return shuffle(deck);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawCard(deck) {
  if (deck.length === 0) throw new Error('Deck vide');
  return deck.pop();
}

// ── Valeurs ──────────────────────────────────────────────────
function cardValue(rank) {
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  if (rank === 'A') return 11;
  return parseInt(rank, 10);
}

/**
 * Calcule le total d'une main en ignorant les cartes cachées.
 * @param {Array} hand - tableau de { rank, suit, hidden? }
 * @returns {number}
 */
function handTotal(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.hidden) continue;
    total += cardValue(card.rank);
    if (card.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function isBust(hand)      { return handTotal(hand) > 21; }
function isBlackjack(hand) { return handTotal(hand) === 21 && hand.length === 2; }
function isSoft17(hand) {
  // Main molle 17 : contient un as compté comme 11 + total = 17
  const total = handTotal(hand);
  if (total !== 17) return false;
  // Vérifier qu'il y a un as "souple"
  let t = 0, aces = 0;
  for (const c of hand) {
    if (c.hidden) continue;
    t += cardValue(c.rank);
    if (c.rank === 'A') aces++;
  }
  return aces > 0 && t !== 17; // l'as est compté comme 11 donc t > 17 avant réduction
}

// ── Résultats ────────────────────────────────────────────────
/**
 * Détermine le résultat d'un joueur par rapport au croupier.
 * @returns {{ result: 'win'|'lose'|'push', gain: number }}
 */
function resolvePlayer(player, dealerHand) {
  const dealerTotal = handTotal(dealerHand);
  const dealerBJ    = isBlackjack(dealerHand);
  const dealerBust  = isBust(dealerHand);

  const pTotal = handTotal(player.hand);
  const pBJ    = isBlackjack(player.hand);

  if (player.busted) {
    return { result: 'lose', gain: -player.bet };
  }
  if (pBJ && dealerBJ) {
    return { result: 'push', gain: 0 };
  }
  if (pBJ) {
    const gain = Math.floor(player.bet * 1.5);
    return { result: 'win', gain };
  }
  if (dealerBust || pTotal > dealerTotal) {
    return { result: 'win', gain: player.bet };
  }
  if (pTotal === dealerTotal) {
    return { result: 'push', gain: 0 };
  }
  return { result: 'lose', gain: -player.bet };
}

/**
 * Calcule les résultats pour tous les joueurs d'une room.
 * @param {Object} gameState - état complet du jeu côté serveur
 * @returns {Array} joueurs avec result + gain + balance mis à jour
 */
function computeResults(gameState) {
  const dealer = gameState.players[gameState.dealerIdx];
  return gameState.players.map(p => {
    if (p.role === 'dealer') return p;
    const { result, gain } = resolvePlayer(p, dealer.hand);
    const balanceDelta = gain; // la mise a déjà été déduite au deal
    return {
      ...p,
      result,
      gain,
      balance: p.balance + (result === 'lose' ? 0 : p.bet + gain)
    };
  });
}

// ── Export (Node.js) ─────────────────────────────────────────
module.exports = {
  buildDeck,
  drawCard,
  handTotal,
  isBust,
  isBlackjack,
  isSoft17,
  resolvePlayer,
  computeResults,
  RED_SUITS,
};

// ═══════════════════════════════════════════════════════════
//  server.js — Serveur Node.js + Socket.io
//  Gestion des rooms, flux du jeu, broadcast d'état
// ═══════════════════════════════════════════════════════════

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const path      = require('path');
const {
  buildDeck, drawCard, handTotal,
  isBust, isBlackjack, isSoft17, computeResults
} = require('./gameLogic');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, '../client')));

// ── Rooms ────────────────────────────────────────────────────
// rooms[roomCode] = { gameState }
const rooms = {};

function generateCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

/**
 * État initial d'une room.
 */
function createRoom(code) {
  return {
    code,
    phase: 'lobby',      // lobby | betting | playing | dealer | results
    players: [],         // { socketId, name, role, balance, bet, hand, stood, busted, doubled, result, gain }
    deck: [],
    currentPlayerIdx: -1,
    dealerIdx: -1,
    round: 0,
  };
}

// ── Helper : broadcast l'état à toute la room ─────────────────
function broadcastState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  // On envoie l'état publique : masquer la carte cachée du croupier
  const publicState = {
    ...room,
    players: room.players.map((p, i) => {
      if (i === room.dealerIdx && room.phase !== 'dealer' && room.phase !== 'results') {
        return {
          ...p,
          hand: p.hand.map((c, ci) => (ci === 1 && c.hidden ? { hidden: true } : c))
        };
      }
      return p;
    }),
  };

  io.to(roomCode).emit('state', publicState);
}

// ── Helper : trouver le prochain joueur actif ──────────────────
function nextPlayerIdx(players, from) {
  for (let i = from + 1; i < players.length; i++) {
    const p = players[i];
    if (p.role === 'player' && !p.stood && !p.busted) return i;
  }
  return -1;
}

// ── Socket events ─────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Connexion : ${socket.id}`);

  // ── Créer une room ──────────────────────────────────────────
  socket.on('createRoom', ({ name, role }, cb) => {
    const code = generateCode();
    rooms[code] = createRoom(code);
    const player = {
      socketId: socket.id, name, role,
      balance: 1000, bet: 0, hand: [],
      stood: false, busted: false, doubled: false,
      result: null, gain: null
    };
    rooms[code].players.push(player);
    if (role === 'dealer') rooms[code].dealerIdx = 0;

    socket.join(code);
    socket.data.roomCode = code;
    cb({ ok: true, code, playerIndex: 0 });
    broadcastState(code);
  });

  // ── Rejoindre une room ──────────────────────────────────────
  socket.on('joinRoom', ({ code, name, role }, cb) => {
    const room = rooms[code];
    if (!room) return cb({ ok: false, error: 'Room introuvable.' });
    if (room.phase !== 'lobby') return cb({ ok: false, error: 'Partie déjà commencée.' });

    const totalPlayers = room.players.filter(p => p.role === 'player').length;
    const hasDealer    = room.players.some(p => p.role === 'dealer');

    if (role === 'dealer' && hasDealer)
      return cb({ ok: false, error: 'Il y a déjà un croupier dans cette room.' });
    if (role === 'player' && totalPlayers >= 4)
      return cb({ ok: false, error: 'La room est pleine (4 joueurs max).' });

    const player = {
      socketId: socket.id, name, role,
      balance: 1000, bet: 0, hand: [],
      stood: false, busted: false, doubled: false,
      result: null, gain: null
    };
    room.players.push(player);
    if (role === 'dealer') room.dealerIdx = room.players.length - 1;

    socket.join(code);
    socket.data.roomCode = code;
    const playerIndex = room.players.length - 1;
    cb({ ok: true, code, playerIndex });
    broadcastState(code);
  });

  // ── Démarrer la partie (croupier seulement) ─────────────────
  socket.on('startGame', (_, cb) => {
    const room = getRoom(socket);
    if (!room) return cb?.({ ok: false, error: 'Room introuvable.' });

    const dealer  = room.players.some(p => p.role === 'dealer');
    const players = room.players.filter(p => p.role === 'player');

    if (!dealer)         return cb?.({ ok: false, error: 'Aucun croupier.' });
    if (players.length < 1) return cb?.({ ok: false, error: 'Au moins 1 joueur requis.' });
    if (!isDealerSocket(socket, room)) return cb?.({ ok: false, error: 'Seul le croupier peut démarrer.' });

    initRound(room);
    broadcastState(room.code);
    cb?.({ ok: true });
  });

  // ── Placer une mise ─────────────────────────────────────────
  socket.on('placeBet', ({ amount }, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'betting') return cb?.({ ok: false });

    const p = getPlayer(socket, room);
    if (!p || p.role !== 'player') return cb?.({ ok: false });

    if (p.balance - p.bet < amount) return cb?.({ ok: false, error: 'Solde insuffisant.' });
    p.bet += amount;
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  socket.on('clearBet', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'betting') return;
    const p = getPlayer(socket, room);
    if (!p || p.role !== 'player') return;
    p.bet = 0;
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  // ── Distribuer les cartes (croupier) ────────────────────────
  socket.on('dealCards', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'betting') return cb?.({ ok: false });
    if (!isDealerSocket(socket, room)) return cb?.({ ok: false, error: 'Seul le croupier distribue.' });

    const unbetted = room.players.filter(p => p.role === 'player' && p.bet === 0);
    if (unbetted.length > 0)
      return cb?.({ ok: false, error: `${unbetted[0].name} n'a pas encore misé.` });

    // Déduire les mises
    room.players.forEach(p => { if (p.role === 'player') p.balance -= p.bet; });

    // Distribuer 2 cartes
    room.players.forEach(p => {
      p.hand.push({ ...drawCard(room.deck), hidden: false });
      p.hand.push({ ...drawCard(room.deck), hidden: false });
    });

    // Cacher la 2e carte du croupier
    room.players[room.dealerIdx].hand[1].hidden = true;

    // Blackjacks immédiats
    room.players.forEach(p => {
      if (p.role === 'player' && isBlackjack(p.hand)) p.stood = true;
    });

    room.phase = 'playing';
    room.currentPlayerIdx = nextPlayerIdx(room.players, -1);
    if (room.currentPlayerIdx === -1) {
      room.phase = 'dealer';
      io.to(room.code).emit('toast', 'Tour du croupier !');
    } else {
      io.to(room.code).emit('toast', `Tour de ${room.players[room.currentPlayerIdx].name}`);
    }

    cb?.({ ok: true });
    broadcastState(room.code);
  });

  // ── Actions joueur ──────────────────────────────────────────
  socket.on('hit', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });

    const p = getPlayer(socket, room);
    const idx = room.players.indexOf(p);
    if (idx !== room.currentPlayerIdx) return cb?.({ ok: false, error: 'Pas ton tour.' });

    p.hand.push({ ...drawCard(room.deck), hidden: false });
    const total = handTotal(p.hand);

    if (total > 21)      { p.busted = true; advanceTurn(room); }
    else if (total === 21) { p.stood  = true; advanceTurn(room); }

    cb?.({ ok: true });
    broadcastState(room.code);
  });

  socket.on('stand', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const p = getPlayer(socket, room);
    if (room.players.indexOf(p) !== room.currentPlayerIdx) return cb?.({ ok: false });

    p.stood = true;
    advanceTurn(room);
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  socket.on('double', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const p = getPlayer(socket, room);
    if (room.players.indexOf(p) !== room.currentPlayerIdx) return cb?.({ ok: false });
    if (p.hand.length !== 2 || p.balance < p.bet) return cb?.({ ok: false });

    p.balance -= p.bet;
    p.bet     *= 2;
    p.doubled  = true;
    p.hand.push({ ...drawCard(room.deck), hidden: false });
    if (handTotal(p.hand) > 21) p.busted = true;
    p.stood = true;
    advanceTurn(room);
    cb?.({ ok: true });
    broadcastState(room.code);
  });

  // ── Révélation + jeu du croupier ────────────────────────────
  socket.on('dealerReveal', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'dealer') return cb?.({ ok: false });
    if (!isDealerSocket(socket, room)) return cb?.({ ok: false });

    const dealer = room.players[room.dealerIdx];
    dealer.hand.forEach(c => (c.hidden = false));

    cb?.({ ok: true });
    broadcastState(room.code);

    // Auto-play dealer avec délai pour l'animation
    scheduleDealerPlay(room);
  });

  // ── Nouvelle manche (croupier) ───────────────────────────────
  socket.on('newRound', (_, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== 'results') return cb?.({ ok: false });
    if (!isDealerSocket(socket, room)) return cb?.({ ok: false });

    // Supprimer joueurs à court d'argent
    room.players = room.players.filter(p => p.role === 'dealer' || p.balance > 0);
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

  // ── Déconnexion ─────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[-] Déconnexion : ${socket.id}`);
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    room.players = room.players.filter(p => p.socketId !== socket.id);
    if (room.players.length === 0) {
      delete rooms[code];
    } else {
      room.dealerIdx = room.players.findIndex(p => p.role === 'dealer');
      broadcastState(code);
    }
  });
});

// ── Helpers internes ──────────────────────────────────────────
function getRoom(socket)   { return rooms[socket.data.roomCode]; }
function getPlayer(socket, room) {
  return room.players.find(p => p.socketId === socket.id);
}
function isDealerSocket(socket, room) {
  const p = getPlayer(socket, room);
  return p && p.role === 'dealer';
}

function initRound(room) {
  room.deck    = buildDeck(2);
  room.phase   = 'betting';
  room.round   = (room.round || 0) + 1;
  room.currentPlayerIdx = -1;
  room.players.forEach(p => {
    p.hand    = [];
    p.bet     = 0;
    p.stood   = false;
    p.busted  = false;
    p.doubled = false;
    p.result  = null;
    p.gain    = null;
  });
}

function advanceTurn(room) {
  const next = nextPlayerIdx(room.players, room.currentPlayerIdx);
  if (next === -1) {
    room.phase = 'dealer';
    room.currentPlayerIdx = -1;
    io.to(room.code).emit('toast', 'Tour du croupier !');
  } else {
    room.currentPlayerIdx = next;
    io.to(room.code).emit('toast', `Tour de ${room.players[next].name}`);
  }
}

function scheduleDealerPlay(room) {
  const dealer = room.players[room.dealerIdx];
  const total  = handTotal(dealer.hand);

  // Règle standard : tire jusqu'à >= 17 (y compris soft 17)
  if (total < 17 || (total === 17 && isSoft17(dealer.hand))) {
    setTimeout(() => {
      dealer.hand.push({ ...drawCard(room.deck), hidden: false });
      broadcastState(room.code);
      scheduleDealerPlay(room);
    }, 700);
  } else {
    // Fin du tour du croupier
    setTimeout(() => {
      room.players = computeResults(room);
      room.phase   = 'results';
      broadcastState(room.code);
    }, 400);
  }
}

// ── Démarrage ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🃏 BlackJack server running on http://localhost:${PORT}`);
});

// ═══════════════════════════════════════════════════════════
//  ui.js — Rendu visuel uniquement
//  Ce fichier ne contient AUCUNE logique de jeu.
//  Il reçoit un état (gameState) et met à jour le DOM.
// ═══════════════════════════════════════════════════════════

const RED_SUITS = ['♥', '♦'];

// ── Cartes ───────────────────────────────────────────────────
function renderCard(card) {
  if (card.hidden) {
    return `<div class="card hidden"></div>`;
  }
  const isRed = RED_SUITS.includes(card.suit);
  return `
    <div class="card ${isRed ? 'red' : 'black-card'}">
      <span class="card-val">${card.rank}</span>
      <span class="card-suit">${card.suit}</span>
    </div>`;
}

function renderHandValue(hand) {
  const hasHidden = hand.some(c => c.hidden);
  if (hasHidden || hand.length === 0) return '';

  const total = hand.reduce((acc, c) => {
    if (c.hidden) return acc;
    let v = ['J','Q','K'].includes(c.rank) ? 10 : c.rank === 'A' ? 11 : parseInt(c.rank);
    return acc + v;
  }, 0);
  // Simple display (le vrai calcul est côté serveur, ici c'est juste l'affichage)
  return `Score : ${total > 21 ? `<span class="bust">Bust</span>` : total}`;
}

// ── Lobby ────────────────────────────────────────────────────
function renderLobby(state, mySocketId) {
  const list = document.getElementById('lobbyPlayersList');
  if (!list) return;
  list.innerHTML = '';

  state.players.forEach(p => {
    const isMe = p.socketId === mySocketId;
    const li = document.createElement('li');
    li.className = `lobby-player ${isMe ? 'me' : ''}`;
    li.innerHTML = `
      <span class="lp-role">${p.role === 'dealer' ? '🎩' : '🃏'}</span>
      <span class="lp-name">${p.name}${isMe ? ' <em>(vous)</em>' : ''}</span>
      <span class="lp-balance">1000$</span>
    `;
    list.appendChild(li);
  });

  // Bouton start visible seulement pour le croupier
  const btnStart = document.getElementById('btnStart');
  if (btnStart) {
    const me = state.players.find(p => p.socketId === mySocketId);
    btnStart.style.display = me?.role === 'dealer' ? '' : 'none';
  }
}

// ── Phase de mise ─────────────────────────────────────────────
function renderBetting(state, mySocketId) {
  const me = state.players.find(p => p.socketId === mySocketId);
  if (!me || me.role === 'dealer') return;

  const betEl = document.getElementById('myBetAmount');
  if (betEl) betEl.textContent = me.bet + '$';

  const clearBtn = document.getElementById('btnClearBet');
  if (clearBtn) clearBtn.style.display = me.bet > 0 ? '' : 'none';
}

// ── Zone croupier ─────────────────────────────────────────────
function renderDealerZone(state, mySocketId) {
  const dealer = state.players[state.dealerIdx];
  if (!dealer) return;

  const nameEl = document.getElementById('dealerName');
  if (nameEl) nameEl.textContent = dealer.name;

  const handEl = document.getElementById('dealerHand');
  if (handEl) handEl.innerHTML = dealer.hand.map(renderCard).join('');

  const valEl = document.getElementById('dealerValue');
  if (valEl) {
    valEl.innerHTML = dealer.hand.length > 0 ? renderHandValue(dealer.hand) : '';
  }

  // Actions croupier
  const isDealer = dealer.socketId === mySocketId;
  const actionsEl = document.getElementById('dealerActions');
  if (!actionsEl) return;

  actionsEl.innerHTML = '';
  if (!isDealer) return;

  if (state.phase === 'betting') {
    actionsEl.innerHTML = `
      <button class="btn-dealer" onclick="window.gameActions.dealCards()">
        Distribuer les cartes
      </button>`;
  } else if (state.phase === 'dealer') {
    actionsEl.innerHTML = `
      <button class="btn-dealer" onclick="window.gameActions.dealerReveal()">
        Révéler & Jouer
      </button>`;
  }
}

// ── Zone joueurs ──────────────────────────────────────────────
function renderPlayersZone(state, mySocketId) {
  const zone = document.getElementById('playersZone');
  if (!zone) return;
  zone.innerHTML = '';

  state.players.forEach((p, idx) => {
    if (p.role === 'dealer') return;

    const isMe     = p.socketId === mySocketId;
    const isActive = idx === state.currentPlayerIdx && state.phase === 'playing';
    const isDone   = p.stood || p.busted;

    const div = document.createElement('div');
    div.className = `player-card ${isActive ? 'active' : ''} ${isDone && !isActive ? 'done' : ''}`;
    div.id = `pcard-${idx}`;

    // Badge statut
    let badge = '';
    if (isActive)   badge = `<div class="active-badge">Votre tour</div>`;
    if (p.busted)   badge = `<div class="active-badge bust-badge">Bust!</div>`;
    else if (p.stood) badge = `<div class="active-badge stand-badge">Stand</div>`;

    // Section mise
    let betSection = '';
    if (state.phase === 'betting' && isMe) {
      betSection = `
        <div class="bet-section">
          <div class="bet-label">Mise</div>
          <div class="chips">
            <div class="chip c5"   onclick="window.gameActions.placeBet(5)">5</div>
            <div class="chip c10"  onclick="window.gameActions.placeBet(10)">10</div>
            <div class="chip c25"  onclick="window.gameActions.placeBet(25)">25</div>
            <div class="chip c50"  onclick="window.gameActions.placeBet(50)">50</div>
            <div class="chip c100" onclick="window.gameActions.placeBet(100)">100</div>
          </div>
          <div class="bet-display">
            Mise : <span class="bet-amount">${p.bet}$</span>
            ${p.bet > 0 ? `<button class="btn-clear-bet" onclick="window.gameActions.clearBet()">✕</button>` : ''}
          </div>
        </div>`;
    } else if (p.bet > 0) {
      betSection = `<div class="bet-display" style="margin-bottom:10px">
        Mise : <span class="bet-amount">${p.bet}$</span>
      </div>`;
    }

    // Actions joueur actif
    let actions = '';
    if (isActive && isMe && state.phase === 'playing') {
      const canDouble = p.hand.length === 2 && p.balance >= p.bet;
      actions = `
        <div class="player-actions">
          <button class="btn-action btn-hit"   onclick="window.gameActions.hit()">Tirer</button>
          <button class="btn-action btn-stand" onclick="window.gameActions.stand()">Rester</button>
          ${canDouble ? `<button class="btn-action btn-double" onclick="window.gameActions.double()">Double</button>` : ''}
        </div>`;
    }

    div.innerHTML = `
      ${badge}
      <div class="player-card-name">${p.name}${isMe ? ' <em style="font-size:0.75rem;opacity:0.6">(vous)</em>' : ''}</div>
      <div class="player-balance">Solde : ${p.balance}$</div>
      ${betSection}
      <div class="hand" id="hand-${idx}">${p.hand.map(renderCard).join('')}</div>
      ${p.hand.length > 0 ? `<div class="hand-value">${renderHandValue(p.hand)}</div>` : ''}
      ${actions}
    `;
    zone.appendChild(div);
  });
}

// ── Résultats ────────────────────────────────────────────────
function renderResults(state, mySocketId) {
  const grid = document.getElementById('resultsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  state.players.filter(p => p.role === 'player').forEach((p, i) => {
    const label    = p.result === 'win' ? 'Gagné !' : p.result === 'push' ? 'Égalité' : 'Perdu';
    const gainText = p.gain > 0 ? `+${p.gain}$` : p.gain === 0 ? '±0$' : `${p.gain}$`;
    const pHand    = p.hand.map(c => `${c.rank}${c.suit}`).join(' ');
    const isMe     = p.socketId === mySocketId;

    const card = document.createElement('div');
    card.className = `result-card ${p.result || ''}`;
    card.style.animationDelay = `${i * 0.1}s`;
    card.innerHTML = `
      <div class="result-name">${p.name}${isMe ? ' ⭐' : ''}</div>
      <div style="font-size:0.85rem;color:rgba(245,239,224,0.5);margin-bottom:10px">${pHand}</div>
      <div class="result-outcome ${p.result || ''}">${label}</div>
      <div class="result-money">${gainText}</div>
      <div class="result-balance">Solde : ${p.balance}$</div>
    `;
    grid.appendChild(card);
  });

  // Score final croupier
  const dealer = state.players[state.dealerIdx];
  const dealerScoreEl = document.getElementById('dealerFinalScore');
  if (dealerScoreEl && dealer) {
    const total = dealer.hand.reduce((acc, c) => {
      let v = ['J','Q','K'].includes(c.rank) ? 10 : c.rank === 'A' ? 11 : parseInt(c.rank);
      return acc + v;
    }, 0);
    dealerScoreEl.textContent = total > 21 ? `Bust (${total})` : String(total);
  }

  // Bouton nouvelle manche visible seulement pour le croupier
  const me = state.players.find(p => p.socketId === mySocketId);
  const btnNewRound = document.getElementById('btnNewRound');
  if (btnNewRound) btnNewRound.style.display = me?.role === 'dealer' ? '' : 'none';
}

// ── Phase banner ──────────────────────────────────────────────
function renderPhaseBanner(state) {
  const el = document.getElementById('phaseBanner');
  if (!el) return;
  const banners = {
    lobby:   'Salle d\'attente',
    betting: 'Phase de mise — Placez vos paris',
    playing: state.currentPlayerIdx >= 0
      ? `Tour de ${state.players[state.currentPlayerIdx]?.name || ''}`
      : '',
    dealer:  `Tour du croupier`,
    results: 'Fin de la manche ✦',
  };
  el.textContent = banners[state.phase] || '';
}

// ── Rendu global (point d'entrée appelé par client.js) ────────
function renderAll(state, mySocketId) {
  renderPhaseBanner(state);
  renderDealerZone(state, mySocketId);
  renderPlayersZone(state, mySocketId);
  if (state.phase === 'betting') renderBetting(state, mySocketId);
}

// ── Toast ─────────────────────────────────────────────────────
let _toastTimeout;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimeout);
  _toastTimeout = setTimeout(() => t.classList.remove('show'), 2200);
}

// Export pour client.js (module ES ou global)
window.UI = {
  renderAll,
  renderLobby,
  renderResults,
  showToast,
};

// ═══════════════════════════════════════════════════════════
//  client.js — Pont entre Socket.io et l'interface visuelle
//  Ce fichier NE contient PAS de logique de jeu ni de DOM brut.
//  Il écoute le serveur et délègue :
//    → les données brutes à ui.js (rendu)
//    → les actions utilisateur au serveur via socket
// ═══════════════════════════════════════════════════════════

const socket = io(); // connexion automatique au serveur

// ── État local minimal (pas de logique, juste pour le rendu) ──
let mySocketId  = null;
let currentState = null;

// ── Connexion établie ─────────────────────────────────────────
socket.on('connect', () => {
  mySocketId = socket.id;
  console.log('Connecté :', mySocketId);
});

// ── Réception de l'état (broadcast serveur) ──────────────────
socket.on('state', (state) => {
  currentState = state;
  syncScreens(state);
});

// ── Toasts serveur ────────────────────────────────────────────
socket.on('toast', (msg) => {
  UI.showToast(msg);
});

// ── Gestion des écrans ────────────────────────────────────────
function syncScreens(state) {
  const screens = {
    lobby:   document.getElementById('screenLobby'),
    game:    document.getElementById('screenGame'),
    results: document.getElementById('screenResults'),
  };

  // Masquer tous, afficher le bon
  Object.values(screens).forEach(s => s && (s.style.display = 'none'));

  if (state.phase === 'lobby') {
    screens.lobby.style.display = 'flex';
    UI.renderLobby(state, mySocketId);
    return;
  }

  if (state.phase === 'results') {
    screens.results.style.display = 'block';
    UI.renderResults(state, mySocketId);
    return;
  }

  screens.game.style.display = 'block';
  UI.renderAll(state, mySocketId);
}

// ── Actions exposées au DOM via window.gameActions ────────────
// ui.js appelle ces fonctions via onclick="window.gameActions.xxx()"
window.gameActions = {

  // Mises
  placeBet(amount) {
    socket.emit('placeBet', { amount }, (res) => {
      if (!res?.ok) UI.showToast(res?.error || 'Erreur mise');
    });
  },

  clearBet() {
    socket.emit('clearBet');
  },

  // Croupier
  dealCards() {
    socket.emit('dealCards', null, (res) => {
      if (!res?.ok) UI.showToast(res?.error || 'Impossible de distribuer');
    });
  },

  dealerReveal() {
    socket.emit('dealerReveal', null, (res) => {
      if (!res?.ok) UI.showToast(res?.error || 'Erreur révélation');
    });
  },

  // Joueur
  hit() {
    socket.emit('hit', null, (res) => {
      if (!res?.ok) UI.showToast(res?.error || 'Erreur');
    });
  },

  stand() {
    socket.emit('stand', null, (res) => {
      if (!res?.ok) UI.showToast(res?.error || 'Erreur');
    });
  },

  double() {
    socket.emit('double', null, (res) => {
      if (!res?.ok) UI.showToast(res?.error || 'Erreur double');
    });
  },

  // Nouvelle manche (croupier)
  newRound() {
    socket.emit('newRound', null, (res) => {
      if (!res?.ok) UI.showToast(res?.error || 'Erreur');
    });
  },

  // Retour lobby (reload simple)
  backToLobby() {
    window.location.reload();
  },
};

// ── Formulaire d'accueil : créer ou rejoindre une room ────────
document.getElementById('formJoin')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const name   = document.getElementById('inputName').value.trim();
  const role   = document.getElementById('selectRole').value;
  const action = document.querySelector('[name=action]:checked')?.value || 'create';
  const code   = document.getElementById('inputCode')?.value.trim().toUpperCase();
  const errEl  = document.getElementById('joinError');

  if (!name) { errEl.textContent = 'Entrez votre nom.'; return; }

  errEl.textContent = '';

  if (action === 'create') {
    socket.emit('createRoom', { name, role }, (res) => {
      if (!res.ok) { errEl.textContent = res.error; return; }
      document.getElementById('roomCodeDisplay').textContent = res.code;
      document.getElementById('roomCodeBanner').style.display = '';
    });
  } else {
    if (!code) { errEl.textContent = 'Entrez le code de la room.'; return; }
    socket.emit('joinRoom', { code, name, role }, (res) => {
      if (!res.ok) { errEl.textContent = res.error; return; }
    });
  }
});

// ── Toggle affichage du champ code ───────────────────────────
document.querySelectorAll('[name=action]').forEach(radio => {
  radio.addEventListener('change', () => {
    const codeField = document.getElementById('codeField');
    if (codeField) codeField.style.display = radio.value === 'join' ? '' : 'none';
  });
});

// Bouton démarrer (affiché seulement pour le croupier dans ui.js)
document.getElementById('btnStart')?.addEventListener('click', () => {
  socket.emit('startGame', null, (res) => {
    if (!res?.ok) UI.showToast(res?.error || 'Impossible de démarrer');
  });
});