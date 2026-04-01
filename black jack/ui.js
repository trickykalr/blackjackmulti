// ═══════════════════════════════════════════════════════════
//  ui.js — Rendu visuel uniquement
// ═══════════════════════════════════════════════════════════

const RED_SUITS = ['♥', '♦'];

// ── Cartes ───────────────────────────────────────────────────
function renderCard(card) {
  if (card.hidden) return `<div class="card hidden"></div>`;
  const isRed = RED_SUITS.includes(card.suit);
  return `
    <div class="card ${isRed ? 'red' : 'black-card'}">
      <span class="card-val">${card.rank}</span>
      <span class="card-suit">${card.suit}</span>
    </div>`;
}

function renderHandValue(player) {
  if (!player?.hand?.length) return '';
  if (player.hand.some(c => c.hidden)) return '';
  const t = player.handTotal;
  if (!t && t !== 0) return '';
  if (t > 21) return `Score : <span class="bust">Bust (${t})</span>`;
  if (t === 21 && player.hand.filter(c => !c.hidden).length === 2)
    return `Score : <span class="blackjack">Blackjack ! ♠</span>`;
  return `Score : ${t}`;
}

// ── Lobby ────────────────────────────────────────────────────
function renderLobby(state, mySocketId) {
  const list = document.getElementById('lobbyPlayersList');
  if (!list) return;
  list.innerHTML = '';

  const me       = state.players.find(p => p.socketId === mySocketId);
  const isHost   = state.hostSocketId === mySocketId;
  const isSolo   = state.players.filter(p => !p.isBot).length === 1;
  const canStart = me?.role === 'dealer' || isHost;

  // ── Liste des joueurs ──
  state.players.forEach(p => {
    const isMe      = p.socketId === mySocketId;
    const isCreator = p.socketId === state.hostSocketId;

    const kickBtn = (isHost && !isMe && !p.isBot)
      ? `<button onclick="window.gameActions.kickPlayer('${p.socketId}')"
           style="background:none;border:1px solid rgba(231,76,60,0.4);color:#e74c3c;
                  border-radius:6px;padding:2px 8px;cursor:pointer;font-size:0.8rem">✕</button>`
      : '';
    const removeBotBtn = (isHost && p.isBot)
      ? `<button onclick="window.gameActions.removeBot('${p.socketId}')"
           style="background:none;border:1px solid rgba(231,76,60,0.4);color:#e74c3c;
                  border-radius:6px;padding:2px 8px;cursor:pointer;font-size:0.8rem">✕</button>`
      : '';

    const li = document.createElement('li');
    li.className = `lobby-player ${isMe ? 'me' : ''}`;
    li.innerHTML = `
      <span class="lp-role">${p.role === 'dealer' ? '🎩' : p.isBot ? '🤖' : '🃏'}</span>
      <span class="lp-name">
        ${isCreator ? '<span style="color:var(--gold);margin-right:4px" title="Hôte">👑</span>' : ''}
        ${p.name}${isMe ? ' <em>(vous)</em>' : ''}
      </span>
      <span class="lp-balance">${p.isBot ? 'BOT' : p.balance + '$'}</span>
      ${kickBtn}${removeBotBtn}
    `;
    list.appendChild(li);
  });

  // ── Zone actions (sous la liste) ──
  let hostZone = document.getElementById('hostZone');
  if (!hostZone) {
    hostZone = document.createElement('div');
    hostZone.id = 'hostZone';
    hostZone.style.cssText = 'margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;';
    list.after(hostZone);
  }
  hostZone.innerHTML = '';

  // Bouton ajouter un bot — visible pour l'hôte
  if (isHost) {
    const botPlayers = state.players.filter(p => p.isBot && p.role === 'player').length;
    const humanPlayers = state.players.filter(p => p.role === 'player' && !p.isBot).length;
    if (humanPlayers + botPlayers < 4) {
      hostZone.innerHTML += `
        <button onclick="window.gameActions.addBot()"
          style="flex:1;background:rgba(41,128,185,0.12);border:1px solid rgba(41,128,185,0.35);
                 color:#5dade2;border-radius:8px;padding:9px 14px;cursor:pointer;
                 font-family:'Cormorant Garamond',serif;font-size:0.95rem;transition:all 0.2s"
          onmouseover="this.style.borderColor='#5dade2'"
          onmouseout="this.style.borderColor='rgba(41,128,185,0.35)'">
          🤖 Ajouter un bot
        </button>`;
    }
  }

  // Bouton inviter — tout le monde
  hostZone.innerHTML += `
    <button onclick="window.gameActions.showInvite()"
      style="flex:1;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.3);
             color:var(--gold);border-radius:8px;padding:9px 14px;cursor:pointer;
             font-family:'Cormorant Garamond',serif;font-size:0.95rem;transition:all 0.2s"
      onmouseover="this.style.borderColor='var(--gold)'"
      onmouseout="this.style.borderColor='rgba(201,168,76,0.3)'">
      ♠ Inviter
    </button>`;

  // ── Bouton LANCER ──
  const btnStart = document.getElementById('btnStart');
  const waitMsg  = document.getElementById('waitingMsg');
  const startInfo = document.getElementById('startInfo');

  // Créer la zone d'info si elle n'existe pas
  if (!startInfo && btnStart) {
    const div = document.createElement('div');
    div.id = 'startInfo';
    div.style.cssText = 'text-align:center;margin-top:8px;min-height:20px;font-size:0.85rem;font-style:italic;';
    btnStart.after(div);
  }

  if (btnStart) {
    if (canStart) {
      btnStart.style.display = '';

      // Analyser ce qui manque pour personnaliser le message du bouton
      const hasDealer  = state.players.some(p => p.role === 'dealer');
      const hasPlayers = state.players.some(p => p.role === 'player');
      const playerCount = state.players.filter(p => p.role === 'player').length;

      if (isSolo) {
        // Mode solo
        btnStart.textContent = '▶ Jouer en Solo';
        btnStart.style.opacity = '1';
        btnStart.disabled = false;
        if (document.getElementById('startInfo')) {
          let hint = '';
          if (!hasDealer)        hint = 'Un croupier bot sera ajouté automatiquement';
          else if (!hasPlayers)  hint = 'Un joueur bot sera ajouté automatiquement';
          else if (me?.role === 'player') hint = `Vous jouez vs le croupier bot${playerCount > 1 ? ' et ' + (playerCount - 1) + ' bot(s)' : ''}`;
          else hint = `${playerCount} joueur(s) bot dans la partie`;
          document.getElementById('startInfo').style.color = 'var(--gold-dark)';
          document.getElementById('startInfo').textContent = hint;
        }
      } else {
        // Mode multi
        btnStart.textContent = '▶ Lancer la partie';
        const totalPlayers = state.players.filter(p => p.role === 'player').length;
        const canLaunch = totalPlayers >= 1;
        btnStart.disabled = !canLaunch;
        btnStart.style.opacity = canLaunch ? '1' : '0.4';
        if (document.getElementById('startInfo')) {
          document.getElementById('startInfo').style.color = canLaunch ? 'var(--gold-dark)' : '#e74c3c';
          document.getElementById('startInfo').textContent = canLaunch
            ? `${totalPlayers} joueur(s) prêt(s)`
            : 'Ajoutez au moins 1 joueur ou un bot';
        }
      }
    } else {
      btnStart.style.display = 'none';
    }
  }

  if (waitMsg) {
    waitMsg.style.display = canStart ? 'none' : '';
    if (!canStart) {
      waitMsg.textContent = me?.role === 'player'
        ? 'En attente du croupier pour démarrer…'
        : 'En attente de l\'hôte…';
    }
  }
}

// ── Liste des rooms disponibles ───────────────────────────────
function renderRoomList(rooms) {
  let el = document.getElementById('roomList');
  if (!el) {
    el = document.createElement('div');
    el.id = 'roomList';
    el.style.cssText = 'margin-bottom:12px;';
    const btn = document.querySelector('#formJoin .btn-primary');
    btn.parentNode.insertBefore(el, btn);
  }

  if (rooms.length === 0) {
    el.innerHTML = `
      <div style="text-align:center;color:var(--gold-dark);font-style:italic;
                  margin:12px 0;padding:16px;background:rgba(0,0,0,0.15);
                  border-radius:10px;border:1px solid rgba(201,168,76,0.1)">
        Aucune salle disponible pour le moment
      </div>`;
    el.style.display = '';
    return;
  }

  el.style.display = '';
  el.innerHTML = `
    <div style="font-size:0.78rem;letter-spacing:0.15em;text-transform:uppercase;
                color:var(--gold-dark);margin-bottom:10px">
      Salles disponibles
    </div>` +
    rooms.map(r => `
      <div data-code="${r.code}" onclick="window.UI.selectRoom('${r.code}', this)"
        style="display:flex;align-items:center;justify-content:space-between;
               background:rgba(0,0,0,0.2);border:1px solid rgba(201,168,76,0.2);
               border-radius:10px;padding:12px 16px;margin-bottom:8px;cursor:pointer;transition:all 0.2s"
        onmouseover="if(!this.classList.contains('selected'))this.style.borderColor='rgba(201,168,76,0.5)'"
        onmouseout="if(!this.classList.contains('selected'))this.style.borderColor='rgba(201,168,76,0.2)'">
        <div>
          <div style="font-family:'Playfair Display',serif;color:var(--gold);font-size:1.1rem;letter-spacing:0.2em">
            ${r.code}
          </div>
          <div style="font-size:0.8rem;color:var(--gold-dark);margin-top:3px">
            👑 ${r.host} &nbsp;·&nbsp;
            ${r.dealer ? '🎩 Croupier' : '⏳ Sans croupier'} &nbsp;·&nbsp;
            ${r.players} joueur${r.players > 1 ? 's' : ''}
            ${r.bots > 0 ? ` · ${r.bots} bot${r.bots > 1 ? 's' : ''}` : ''}
          </div>
        </div>
        <div style="color:var(--gold);font-size:1.3rem">→</div>
      </div>
    `).join('');
}

// ── Zone croupier ─────────────────────────────────────────────
function renderDealerZone(state, mySocketId) {
  const dealer = state.players[state.dealerIdx];
  if (!dealer) return;

  document.getElementById('dealerName').textContent = dealer.name + (dealer.isBot ? ' 🤖' : '');
  document.getElementById('dealerHand').innerHTML   = dealer.hand.map(renderCard).join('');
  document.getElementById('dealerValue').innerHTML  = dealer.hand.length ? renderHandValue(dealer) : '';

  const actionsEl = document.getElementById('dealerActions');
  if (!actionsEl) return;
  actionsEl.innerHTML = '';

  // Boutons uniquement si c'est un croupier humain
  if (dealer.socketId !== mySocketId || dealer.isBot) return;

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

    let badge = '';
    if (isActive && !p.isBot) badge = `<div class="active-badge">Votre tour</div>`;
    if (isActive && p.isBot)  badge = `<div class="active-badge" style="background:#2980b9">🤖 Réfléchit...</div>`;
    if (p.busted)             badge = `<div class="active-badge bust-badge">Bust!</div>`;
    else if (p.stood)         badge = `<div class="active-badge stand-badge">Stand</div>`;

    let betSection = '';
    if (state.phase === 'betting' && isMe && !p.isBot) {
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
        ${p.isBot ? '<span style="font-size:0.75rem;color:var(--gold-dark)"> (auto)</span>' : ''}
      </div>`;
    }

    let actions = '';
    if (isActive && isMe && !p.isBot && state.phase === 'playing') {
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
      <div class="player-card-name">
        ${p.isBot ? '🤖 ' : ''}${p.name}
        ${isMe ? '<em style="font-size:0.75rem;opacity:0.6"> (vous)</em>' : ''}
      </div>
      <div class="player-balance">Solde : ${p.balance}$</div>
      ${betSection}
      <div class="hand">${p.hand.map(renderCard).join('')}</div>
      ${p.hand.length ? `<div class="hand-value">${renderHandValue(p)}</div>` : ''}
      ${actions}
    `;
    zone.appendChild(div);
  });
}

// ── Résultats ─────────────────────────────────────────────────
function renderResults(state, mySocketId) {
  const grid = document.getElementById('resultsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  state.players.filter(p => p.role === 'player').forEach((p, i) => {
    const label    = p.result === 'win' ? 'Gagné !' : p.result === 'push' ? 'Égalité' : 'Perdu';
    const gainText = p.gain > 0 ? `+${p.gain}$` : p.gain === 0 ? '±0$' : `${p.gain}$`;
    const isMe     = p.socketId === mySocketId;
    const card = document.createElement('div');
    card.className = `result-card ${p.result || ''}`;
    card.style.animationDelay = `${i * 0.1}s`;
    card.innerHTML = `
      <div class="result-name">${p.isBot ? '🤖 ' : ''}${p.name}${isMe ? ' ⭐' : ''}</div>
      <div style="font-size:0.85rem;color:rgba(245,239,224,0.5);margin-bottom:10px">
        ${p.hand.map(c => `${c.rank}${c.suit}`).join(' ')}
      </div>
      <div class="result-outcome ${p.result || ''}">${label}</div>
      <div class="result-money">${gainText}</div>
      <div class="result-balance">Solde : ${p.balance}$</div>
    `;
    grid.appendChild(card);
  });

  const dealer = state.players[state.dealerIdx];
  const el = document.getElementById('dealerFinalScore');
  if (el && dealer) {
    const t = dealer.handTotal || 0;
    el.textContent = t > 21 ? `Bust (${t})` : String(t);
  }

  const me = state.players.find(p => p.socketId === mySocketId);
  const btnNewRound = document.getElementById('btnNewRound');
  if (btnNewRound) {
    // Croupier ou hôte peut relancer
    const canRestart = me?.role === 'dealer' || state.hostSocketId === mySocketId;
    btnNewRound.style.display = canRestart ? '' : 'none';
  }
}

// ── Phase banner ──────────────────────────────────────────────
function renderPhaseBanner(state) {
  const el = document.getElementById('phaseBanner');
  if (!el) return;
  const cur = state.players[state.currentPlayerIdx];
  const banners = {
    lobby:   'Salle d\'attente',
    betting: 'Phase de mise — Placez vos paris',
    playing: cur ? `Tour de ${cur.name}${cur.isBot ? ' 🤖' : ''}` : '',
    dealer:  'Tour du croupier',
    results: 'Fin de la manche ✦',
  };
  el.textContent = banners[state.phase] || '';
}

// ── Rendu global ──────────────────────────────────────────────
function renderAll(state, mySocketId) {
  renderPhaseBanner(state);
  renderDealerZone(state, mySocketId);
  renderPlayersZone(state, mySocketId);
}

// ── Toast ─────────────────────────────────────────────────────
let _toastTimeout;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimeout);
  _toastTimeout = setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Modal invitation ──────────────────────────────────────────
function showInviteModal(code) {
  let modal = document.getElementById('inviteModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'inviteModal';
    modal.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:2000;
      display:flex;align-items:center;justify-content:center;padding:20px;
    `;
    document.body.appendChild(modal);
  }
  const link = `${window.location.origin}?code=${code}`;
  modal.innerHTML = `
    <div style="background:#0b3d2e;border:1px solid rgba(201,168,76,0.4);border-radius:20px;
                padding:36px;max-width:400px;width:100%;text-align:center;
                box-shadow:0 8px 40px rgba(0,0,0,0.5)">
      <div style="font-family:'Playfair Display',serif;font-size:1.4rem;color:var(--gold);margin-bottom:6px">
        Inviter des amis ♠
      </div>
      <div style="color:rgba(245,239,224,0.5);font-size:0.9rem;margin-bottom:20px">
        Partagez le code ou le lien direct
      </div>
      <div style="font-family:'Playfair Display',serif;font-size:3rem;color:var(--gold);
                  letter-spacing:0.3em;font-weight:700;margin-bottom:16px">${code}</div>
      <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(201,168,76,0.15);
                  border-radius:8px;padding:10px 14px;font-size:0.82rem;
                  color:rgba(245,239,224,0.4);word-break:break-all;margin-bottom:20px">${link}</div>
      <div style="display:flex;gap:10px">
        <button onclick="navigator.clipboard.writeText('${code}').then(()=>window.UI.showToast('Code copié !'))"
          style="flex:1;background:linear-gradient(135deg,var(--gold-dark),var(--gold));
                 border:none;border-radius:10px;padding:12px;color:var(--felt-dark);
                 font-family:'Playfair Display',serif;font-size:1rem;font-weight:700;cursor:pointer">
          Copier le code
        </button>
        <button onclick="navigator.clipboard.writeText('${link}').then(()=>window.UI.showToast('Lien copié !'))"
          style="flex:1;background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);
                 border-radius:10px;padding:12px;color:var(--gold);cursor:pointer;font-size:1rem">
          Copier le lien
        </button>
      </div>
      <button onclick="document.getElementById('inviteModal').style.display='none'"
        style="width:100%;background:none;border:none;color:rgba(245,239,224,0.3);
               cursor:pointer;margin-top:14px;font-size:0.9rem">
        Fermer
      </button>
    </div>
  `;
  modal.style.display = 'flex';
  modal.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };
}

// ── Export ────────────────────────────────────────────────────
window.UI = {
  renderAll,
  renderLobby,
  renderResults,
  renderRoomList,
  showToast,
  showInviteModal,

  selectRoom(code, el) {
    window._selectedRoom = code;
    document.querySelectorAll('#roomList [data-code]').forEach(d => {
      d.style.background  = 'rgba(0,0,0,0.2)';
      d.style.borderColor = 'rgba(201,168,76,0.2)';
      d.classList.remove('selected');
    });
    el.style.background  = 'rgba(201,168,76,0.1)';
    el.style.borderColor = 'var(--gold)';
    el.classList.add('selected');
  },
};// ═══════════════════════════════════════════════════════════
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
