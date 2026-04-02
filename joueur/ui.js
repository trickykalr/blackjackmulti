// ═══════════════════════════════════════════════════════════
//  ui.js — Rendu DOM
// ═══════════════════════════════════════════════════════════

const RED_SUITS = ['♥', '♦'];

function renderCard(card) {
  if (card.hidden) return `<div class="card hidden"></div>`;
  const r = RED_SUITS.includes(card.suit);
  return `<div class="card ${r ? 'red' : 'black-card'}">
    <span class="card-val">${card.rank}</span>
    <span class="card-suit">${card.suit}</span>
  </div>`;
}

function renderHandValue(hand, total) {
  if (!hand?.length || hand.some(c => c.hidden)) return '';
  if (total == null) return '';
  if (total > 21) return `Score : <span class="bust">Bust (${total})</span>`;
  if (total === 21 && hand.filter(c => !c.hidden).length === 2)
    return `Score : <span class="blackjack">✦ Blackjack !</span>`;
  return `Score : ${total}`;
}

// ── 🎰 Célébration BLACK JACK ─────────────────────────────────
function showBlackjackCelebration(name) {
  document.getElementById('bjOverlay')?.remove();
  const el = document.createElement('div');
  el.id = 'bjOverlay';
  el.style.cssText = `
    position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.93);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    animation:bjFadeIn .35s ease;overflow:hidden;cursor:pointer;padding:20px;`;
  const syms = ['🪙','💰','♠','♣','🎰','💎','♥','♦'];
  let rain = '';
  for (let i = 0; i < 40; i++) {
    const s = syms[i % syms.length];
    const left = Math.random() * 100;
    const delay = Math.random() * 2.5;
    const dur = 1.8 + Math.random() * 2;
    const sz = 0.8 + Math.random() * 1.4;
    rain += `<span style="position:absolute;top:-60px;left:${left}%;font-size:${sz}rem;
      animation:coinFall ${dur}s ${delay}s linear infinite;pointer-events:none">${s}</span>`;
  }
  el.innerHTML = `${rain}
    <div style="font-family:'Playfair Display',serif;
      font-size:clamp(3rem,15vw,9rem);font-weight:900;color:var(--gold);
      text-shadow:0 0 80px rgba(201,168,76,.95),0 0 160px rgba(201,168,76,.5);
      animation:bjPulse .55s ease-in-out infinite alternate;
      text-align:center;z-index:1;line-height:1.05">✦ BLACK JACK ✦</div>
    <div style="font-family:'Cormorant Garamond',serif;font-style:italic;
      font-size:clamp(1.1rem,4.5vw,2rem);color:var(--cream);
      margin-top:16px;z-index:1;letter-spacing:.08em;text-align:center">${name}</div>
    <div style="margin-top:24px;font-size:.72rem;color:rgba(245,239,224,.3);
      z-index:1;letter-spacing:.2em;text-transform:uppercase">Toucher pour continuer</div>`;
  document.body.appendChild(el);
  const close = () => {
    el.style.animation = 'bjFadeOut .3s ease forwards';
    setTimeout(() => el.remove(), 300);
  };
  el.addEventListener('click', close);
  setTimeout(close, 4500);
}

// ── 🎭 Bannière dramatique ────────────────────────────────────
function getDrama(state) {
  const players = state.players.filter(p => p.role === 'player');
  const dealer  = state.players[state.dealerIdx];
  const dbust   = dealer && dealer.handTotal > 21;
  const allLost = players.length > 0 && players.every(p => p.result === 'lose');
  const allWon  = players.length > 0 && players.every(p => p.result === 'win');
  const wins    = players.filter(p => p.result === 'win').length;

  if (allLost && !dbust)
    return { text: 'Le croupier vous a dépouillés !', sub: 'La banque remercie votre générosité…', icon: '💀', cls: 'drama-lose' };
  if (dbust)
    return { text: 'Le croupier a sauté !', sub: 'Les joueurs empochent leurs gains !', icon: '💥', cls: 'drama-win' };
  if (allWon)
    return { text: 'On a braqué la banque !', sub: 'Les joueurs repartent les poches pleines !', icon: '🎰', cls: 'drama-win' };
  if (wins > 0 && wins > players.length / 2)
    return { text: 'Les joueurs prennent le dessus !', sub: 'La banque commence à transpirer…', icon: '💸', cls: 'drama-win' };
  return null;
}

// ── ⏱ Timer de mise ──────────────────────────────────────────
let _timerInterval = null;
function updateBetTimer(state) {
  if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
  const el = document.getElementById('betTimer');
  if (!el) return;
  if (state.phase !== 'betting' || !state.betTimerEnd) { el.style.display = 'none'; return; }

  el.style.display = 'flex';
  function tick() {
    const rem = Math.max(0, Math.ceil((state.betTimerEnd - Date.now()) / 1000));
    // Anneau SVG
    const pct = rem / 45;
    const r = 20, circ = 2 * Math.PI * r;
    const dash = pct * circ;
    el.innerHTML = `
      <svg width="54" height="54" style="transform:rotate(-90deg)">
        <circle cx="27" cy="27" r="${r}" fill="none" stroke="rgba(201,168,76,.15)" stroke-width="4"/>
        <circle cx="27" cy="27" r="${r}" fill="none"
          stroke="${rem <= 10 ? '#e74c3c' : 'var(--gold)'}" stroke-width="4"
          stroke-dasharray="${dash} ${circ}" stroke-linecap="round"
          style="transition:stroke-dasharray .5s linear"/>
      </svg>
      <span style="position:absolute;font-family:'Playfair Display',serif;font-size:.95rem;
        color:${rem <= 10 ? '#e74c3c' : 'var(--gold)'};">${rem}</span>`;
    if (rem <= 0) clearInterval(_timerInterval);
  }
  tick();
  _timerInterval = setInterval(tick, 500);
}

// ── 📱 Barre d'actions mobile ─────────────────────────────────
function updateActionBar(state, mySocketId) {
  const bar = document.getElementById('actionBar');
  if (!bar) return;
  const me    = state.players.find(p => p.socketId === mySocketId);
  const myIdx = state.players.indexOf(me);
  const myTurn = state.phase === 'playing'
    && myIdx >= 0 && myIdx === state.currentPlayerIdx
    && me && !me.isBot && me.role === 'player';

  if (myTurn) {
    bar.classList.add('show');
    const canDbl   = (me.playingSplit ? me.splitHand : me.hand).length === 2 && me.balance >= (me.playingSplit ? me.splitBet : me.bet);
    const canSplit = !me.playingSplit && !me.isSplit && me.hand.length === 2
      && me.hand[0].rank === me.hand[1].rank && me.balance >= me.bet;
    const dbl  = document.getElementById('abDouble');
    const spl  = document.getElementById('abSplit');
    if (dbl) dbl.style.display = canDbl ? '' : 'none';
    if (spl) spl.style.display = canSplit ? '' : 'none';
  } else {
    bar.classList.remove('show');
  }
}

// ── Lobby ─────────────────────────────────────────────────────
function renderLobby(state, mySocketId) {
  const list = document.getElementById('lobbyPlayersList');
  if (!list) return;
  list.innerHTML = '';

  const me     = state.players.find(p => p.socketId === mySocketId);
  const isHost = state.hostSocketId === mySocketId;
  const canStart = isHost || me?.role === 'dealer';

  state.players.forEach(p => {
    const isMe    = p.socketId === mySocketId;
    const isOwner = p.socketId === state.hostSocketId;
    const strategyLabel = p.isBot && p.strategy ? ` <span style="font-size:.65rem;opacity:.5">[${p.strategy}]</span>` : '';
    const kickBtn  = (isHost && !isMe && !p.isBot)
      ? `<button onclick="window.gameActions.kickPlayer('${p.socketId}')"
          style="background:none;border:1px solid rgba(231,76,60,.4);color:#e74c3c;
                 border-radius:6px;padding:4px 10px;cursor:pointer;font-size:.78rem;min-height:32px">✕</button>` : '';
    const rmBotBtn = (isHost && p.isBot)
      ? `<button onclick="window.gameActions.removeBot('${p.socketId}')"
          style="background:none;border:1px solid rgba(231,76,60,.4);color:#e74c3c;
                 border-radius:6px;padding:4px 10px;cursor:pointer;font-size:.78rem;min-height:32px">✕</button>` : '';
    const li = document.createElement('li');
    li.className = `lobby-player${isMe ? ' me' : ''}`;
    li.innerHTML = `
      <span class="lp-role">${p.role==='dealer'?'🎩':p.isBot?'🤖':'🃏'}</span>
      <span class="lp-name">
        ${isOwner ? '<span style="color:var(--gold);margin-right:3px">👑</span>' : ''}
        ${p.name}${isMe?' <em>(vous)</em>':''}${strategyLabel}
        ${p.ready && p.role==='player' ? '<span style="color:#2ecc71;margin-left:6px;font-size:.75rem">✓</span>' : ''}
      </span>
      <span class="lp-bal">${p.isBot?'BOT':p.balance+'$'}</span>
      ${kickBtn}${rmBotBtn}`;
    list.appendChild(li);
  });

  // Zone hôte
  let hz = document.getElementById('hostZone');
  if (!hz) {
    hz = document.createElement('div');
    hz.id = 'hostZone';
    hz.style.cssText = 'margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;';
    list.after(hz);
  }
  hz.innerHTML = '';
  if (isHost) {
    const bots = state.players.filter(p=>p.isBot&&p.role==='player').length;
    const hums = state.players.filter(p=>p.role==='player'&&!p.isBot).length;
    if (hums + bots < 4) {
      hz.innerHTML += `<button onclick="window.gameActions.addBot()"
        style="flex:1;background:rgba(41,128,185,.12);border:1px solid rgba(41,128,185,.35);
               color:#5dade2;border-radius:10px;padding:11px 12px;cursor:pointer;
               font-family:'Cormorant Garamond',serif;font-size:.93rem;min-height:44px">🤖 Ajouter un bot</button>`;
    }
  }
  hz.innerHTML += `<button onclick="window.gameActions.showInvite()"
    style="flex:1;background:rgba(201,168,76,.08);border:1px solid rgba(201,168,76,.3);
           color:var(--gold);border-radius:10px;padding:11px 12px;cursor:pointer;
           font-family:'Cormorant Garamond',serif;font-size:.93rem;min-height:44px">♠ Inviter</button>`;

  const btnStart = document.getElementById('btnStart');
  const waitMsg  = document.getElementById('waitingMsg');
  let info = document.getElementById('startInfo');
  if (!info && btnStart) {
    info = document.createElement('div');
    info.id = 'startInfo';
    info.style.cssText = 'text-align:center;margin-top:6px;font-size:.8rem;font-style:italic;color:var(--gold-dark);min-height:16px';
    btnStart.after(info);
  }
  if (btnStart) {
    if (canStart) {
      btnStart.style.display = 'block';
      const hasDealer   = state.players.some(p => p.role === 'dealer');
      const playerCount = state.players.filter(p => p.role === 'player').length;
      const solo        = state.players.filter(p => !p.isBot).length === 1;
      btnStart.textContent = solo ? '▶ Jouer en Solo' : '▶ Lancer la partie';
      btnStart.disabled = false;
      if (info) {
        if (!hasDealer)       info.textContent = '🎩 Croupier bot ajouté automatiquement';
        else if (!playerCount) info.textContent = '🤖 Joueur bot ajouté automatiquement';
        else                  info.textContent = `${playerCount} joueur${playerCount>1?'s':''} prêt${playerCount>1?'s':''}`;
      }
    } else {
      btnStart.style.display = 'none';
    }
  }
  if (waitMsg) {
    if (canStart) { waitMsg.style.display = 'none'; }
    else {
      waitMsg.style.display = '';
      waitMsg.textContent = state.players.some(p=>p.role==='dealer')
        ? 'En attente que le croupier lance la partie…'
        : "En attente du démarrage par l'hôte…";
    }
  }
}

// ── Liste des rooms ───────────────────────────────────────────
function renderRoomList(rooms) {
  const el = document.getElementById('roomList');
  if (!el) return;
  el.style.display = '';
  if (rooms.length === 0) {
    el.innerHTML = `<div style="text-align:center;color:var(--gold-dark);font-style:italic;
      padding:12px;background:rgba(0,0,0,.15);border-radius:10px;border:1px solid rgba(201,168,76,.1);margin-bottom:10px">
      Aucune salle disponible</div>`;
    return;
  }
  el.innerHTML = `<div style="font-size:.72rem;letter-spacing:.15em;text-transform:uppercase;color:var(--gold-dark);margin-bottom:8px">Salles disponibles</div>`
    + rooms.map(r => `
      <div data-code="${r.code}" onclick="window.UI.selectRoom('${r.code}',this)"
        style="display:flex;align-items:center;justify-content:space-between;
               background:rgba(0,0,0,.2);border:1px solid rgba(201,168,76,.2);
               border-radius:10px;padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:all .2s;min-height:58px">
        <div>
          <div style="font-family:'Playfair Display',serif;color:var(--gold);font-size:1rem;letter-spacing:.18em">${r.code}</div>
          <div style="font-size:.76rem;color:var(--gold-dark);margin-top:2px">
            👑 ${r.host} · ${r.dealer?'🎩 Croupier':'⏳ sans croupier'} · ${r.players}J${r.bots>0?' · '+r.bots+'🤖':''}
          </div>
        </div>
        <div style="color:var(--gold)">→</div>
      </div>`).join('');
}

// ── Zone croupier ─────────────────────────────────────────────
function renderDealerZone(state, mySocketId) {
  const dealer = state.players[state.dealerIdx];
  if (!dealer) return;
  document.getElementById('dealerName').textContent = dealer.name + (dealer.isBot?' 🤖':'');
  document.getElementById('dealerHand').innerHTML   = dealer.hand.map(renderCard).join('');
  document.getElementById('dealerValue').innerHTML  = dealer.hand.length ? renderHandValue(dealer.hand, dealer.handTotal) : '';
  const acts = document.getElementById('dealerActions');
  if (!acts) return;
  acts.innerHTML = '';
  if (dealer.socketId !== mySocketId || dealer.isBot) return;

  if (state.phase === 'betting') {
    const readyCount  = state.players.filter(p => p.role==='player' && !p.isBot && p.ready).length;
    const totalHumans = state.players.filter(p => p.role==='player' && !p.isBot).length;
    const allReady    = state.allPlayersReady;
    acts.innerHTML = `
      <div style="text-align:center;width:100%">
        <div style="font-size:.7rem;letter-spacing:.13em;text-transform:uppercase;color:var(--gold-dark);margin-bottom:7px">
          Votre mise (optionnelle)
        </div>
        <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-bottom:8px">
          <div class="chip c5"   onclick="window.gameActions.placeBet(5)">5</div>
          <div class="chip c10"  onclick="window.gameActions.placeBet(10)">10</div>
          <div class="chip c25"  onclick="window.gameActions.placeBet(25)">25</div>
          <div class="chip c50"  onclick="window.gameActions.placeBet(50)">50</div>
          <div class="chip c100" onclick="window.gameActions.placeBet(100)">100</div>
        </div>
        <div style="color:var(--cream);font-size:.88rem;margin-bottom:10px">
          Mise : <span style="color:var(--gold);font-weight:600">${dealer.bet||0}$</span>
          ${dealer.bet>0?`<button class="btn-clr" onclick="window.gameActions.clearBet()" style="margin-left:8px">✕</button>`:''}
        </div>
        <div style="font-size:.8rem;margin-bottom:10px;
          color:${allReady?'#2ecc71':'var(--gold-dark)'}">
          ${totalHumans>0?`${readyCount}/${totalHumans} joueur${totalHumans>1?'s':''} prêt${readyCount>1?'s':''}`:''} 
          ${allReady?'✓ Tous prêts !':''}
        </div>
      </div>
      <button class="btn-dealer" onclick="window.gameActions.dealCards()"
        style="${allReady?'border-color:#2ecc71;color:#2ecc71;box-shadow:0 0 14px rgba(46,204,113,.3)':''}">
        ${allReady?'✓ Distribuer les cartes':'Distribuer les cartes'}
      </button>`;
  } else if (state.phase === 'dealer') {
    acts.innerHTML = `<button class="btn-dealer" onclick="window.gameActions.dealerReveal()">Révéler & Jouer</button>`;
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
    const isDone   = (p.stood && (!p.isSplit || p.splitStood)) || (p.busted && (!p.isSplit || p.splitBusted));

    const div = document.createElement('div');
    div.className = `player-card${isActive?' active':''}${isDone&&!isActive?' done':''}`;

    // Badge
    let badge = '';
    if (isActive && !p.isBot) badge = `<div class="active-badge">${p.playingSplit?'✂ Main 2':'À vous !'}</div>`;
    if (isActive && p.isBot)  badge = `<div class="active-badge" style="background:#2980b9">🤖…</div>`;
    if (p.busted && p.splitBusted && p.isSplit) badge = `<div class="active-badge bust-badge">Bust ×2</div>`;
    else if (p.busted && !p.isSplit) badge = `<div class="active-badge bust-badge">Bust!</div>`;
    else if (p.stood && (!p.isSplit || p.splitStood)) badge = `<div class="active-badge stand-badge">Stand</div>`;

    // Section mise (phase betting, humain)
    let bet = '';
    if (state.phase === 'betting' && isMe && !p.isBot) {
      const canReady = p.bet > 0 && !p.ready;
      const isReady  = p.ready;
      bet = `<div class="bet-section">
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
          ${p.bet>0&&!p.ready?`<button class="btn-clr" onclick="window.gameActions.clearBet()">✕</button>`:''}
        </div>
        ${canReady ? `<button onclick="window.gameActions.playerReady()"
          style="margin-top:9px;width:100%;background:rgba(39,174,96,.15);
                 border:1px solid #27ae60;color:#2ecc71;border-radius:9px;
                 padding:10px;cursor:pointer;font-family:'Cormorant Garamond',serif;
                 font-size:.93rem;min-height:42px;transition:all .2s"
          onmouseover="this.style.background='rgba(39,174,96,.25)'"
          onmouseout="this.style.background='rgba(39,174,96,.15)'">
          ✓ Prêt à recevoir les cartes
        </button>` : ''}
        ${isReady ? `<div style="color:#2ecc71;font-size:.8rem;margin-top:7px;text-align:center">✓ Prêt !</div>` : ''}
      </div>`;
    } else if (p.bet > 0) {
      bet = `<div class="bet-display" style="margin-bottom:10px">
        Mise : <span class="bet-amount">${p.bet}$</span>
        ${p.isBot?'<span style="font-size:.7rem;color:var(--gold-dark)"> auto</span>':''}
      </div>`;
    }

    // Mains (avec split)
    let handsHtml = '';
    if (p.isSplit) {
      const m1Active = isActive && !p.playingSplit;
      const m2Active = isActive && p.playingSplit;
      handsHtml = `
        <div style="display:flex;gap:7px;margin-top:8px">
          <div style="flex:1;background:${m1Active?'rgba(201,168,76,.08)':'rgba(0,0,0,.15)'};
                      border:1px solid ${m1Active?'var(--gold)':'rgba(201,168,76,.18)'};
                      border-radius:9px;padding:7px;text-align:center">
            <div style="font-size:.65rem;color:var(--gold-dark);margin-bottom:3px;letter-spacing:.1em">MAIN 1 · ${p.bet}$</div>
            <div class="hand" style="min-height:60px;justify-content:center">${p.hand.map(renderCard).join('')}</div>
            <div class="hand-value" style="font-size:.78rem;margin-top:4px">${renderHandValue(p.hand, p.handTotal)}</div>
            ${p.busted?'<div style="font-size:.68rem;color:#e74c3c;margin-top:2px">Bust</div>':p.stood?'<div style="font-size:.68rem;color:#2980b9;margin-top:2px">Stand</div>':''}
          </div>
          <div style="flex:1;background:${m2Active?'rgba(201,168,76,.08)':'rgba(0,0,0,.15)'};
                      border:1px solid ${m2Active?'var(--gold)':'rgba(201,168,76,.18)'};
                      border-radius:9px;padding:7px;text-align:center">
            <div style="font-size:.65rem;color:var(--gold-dark);margin-bottom:3px;letter-spacing:.1em">MAIN 2 · ${p.splitBet}$</div>
            <div class="hand" style="min-height:60px;justify-content:center">${(p.splitHand||[]).map(renderCard).join('')}</div>
            <div class="hand-value" style="font-size:.78rem;margin-top:4px">${renderHandValue(p.splitHand||[], p.splitHandTotal)}</div>
            ${p.splitBusted?'<div style="font-size:.68rem;color:#e74c3c;margin-top:2px">Bust</div>':p.splitStood?'<div style="font-size:.68rem;color:#2980b9;margin-top:2px">Stand</div>':''}
          </div>
        </div>`;
    } else {
      handsHtml = `
        <div class="hand">${p.hand.map(renderCard).join('')}</div>
        ${p.hand.length?`<div class="hand-value">${renderHandValue(p.hand, p.handTotal)}</div>`:''}`;
    }

    // Actions inline (desktop)
    let inline = '';
    if (isActive && isMe && !p.isBot && state.phase === 'playing') {
      const hand    = p.playingSplit ? p.splitHand : p.hand;
      const curBet  = p.playingSplit ? p.splitBet  : p.bet;
      const canDbl  = hand.length === 2 && p.balance >= curBet;
      const canSpl  = !p.isSplit && !p.playingSplit && p.hand.length === 2
                      && p.hand[0]?.rank === p.hand[1]?.rank && p.balance >= p.bet;
      inline = `<div class="inline-acts">
        <button class="ia-btn ia-hit"   onclick="window.gameActions.hit()">Tirer</button>
        <button class="ia-btn ia-stand" onclick="window.gameActions.stand()">Rester</button>
        ${canDbl?`<button class="ia-btn ia-double" onclick="window.gameActions.double()">Double</button>`:''}
        ${canSpl?`<button class="ia-btn" onclick="window.gameActions.split()"
          style="background:linear-gradient(135deg,#8e44ad,#6c3483);color:white">✂ Split</button>`:''}
      </div>`;
    }

    div.innerHTML = `${badge}
      <div class="pc-name">${p.isBot?'🤖 ':''}${p.name}${isMe?' <em style="font-size:.72rem;opacity:.6">(vous)</em>':''}</div>
      <div class="pc-balance">Solde : ${p.balance}$</div>
      ${bet}${handsHtml}${inline}`;
    zone.appendChild(div);
  });
}

// ── Résultats ─────────────────────────────────────────────────
function renderResults(state, mySocketId) {
  const grid = document.getElementById('resultsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const drama  = getDrama(state);
  const banner = document.getElementById('dramaticBanner');
  if (banner) {
    if (drama) {
      banner.className = `drama-banner ${drama.cls}`;
      banner.innerHTML = `<div style="font-size:2.2rem;margin-bottom:6px">${drama.icon}</div>
        <div>${drama.text}</div>
        <div style="font-size:.82rem;opacity:.68;margin-top:5px;font-style:italic">${drama.sub}</div>`;
      banner.style.display = '';
    } else { banner.style.display = 'none'; }
  }

  state.players.filter(p => p.role === 'player').forEach((p, i) => {
    const label  = p.result==='win'?'Gagné !':p.result==='push'?'Égalité':'Perdu';
    const gain   = p.gain>0?`+${p.gain}$`:p.gain===0?'±0$':`${p.gain}$`;
    const isMe   = p.socketId === mySocketId;
    const c = document.createElement('div');
    c.className = `result-card ${p.result||''}`;
    c.style.animationDelay = `${i*.1}s`;
    c.innerHTML = `
      <div class="r-name">${p.isBot?'🤖 ':''}${p.name}${isMe?' ⭐':''}</div>
      <div style="font-size:.78rem;color:rgba(245,239,224,.42);margin-bottom:8px">
        ${p.hand.map(c=>`${c.rank}${c.suit}`).join(' ')}
      </div>
      <div class="r-outcome ${p.result||''}">${label}</div>
      <div class="r-money">${gain}</div>
      <div class="r-balance">Solde : ${p.balance}$</div>
      ${p.isSplit && p.splitResult ? `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(201,168,76,.2)">
          <div style="font-size:.68rem;color:var(--gold-dark);margin-bottom:4px;letter-spacing:.1em;text-transform:uppercase">✂ Main 2 (split)</div>
          <div style="font-size:.76rem;color:rgba(245,239,224,.42);margin-bottom:5px">
            ${(p.splitHand||[]).map(c=>`${c.rank}${c.suit}`).join(' ')}
          </div>
          <div class="r-outcome ${p.splitResult||''}" style="font-size:1.15rem">
            ${p.splitResult==='win'?'Gagné !':p.splitResult==='push'?'Égalité':'Perdu'}
          </div>
          <div class="r-money">
            ${p.splitGain>0?`+${p.splitGain}$`:p.splitGain===0?'±0$':`${p.splitGain}$`}
          </div>
        </div>` : ''}`;
    grid.appendChild(c);
  });

  const dealer = state.players[state.dealerIdx];
  const el = document.getElementById('dealerFinalScore');
  if (el && dealer) {
    const t = dealer.handTotal||0;
    el.textContent = t>21?`Bust (${t})`:String(t);
  }
  // Afficher aussi la balance du croupier
  const dealerBalEl = document.getElementById('dealerBalance');
  if (dealerBalEl && dealer) dealerBalEl.textContent = `Solde croupier : ${dealer.balance}$`;

  const me = state.players.find(p => p.socketId === mySocketId);
  const btnNR = document.getElementById('btnNewRound');
  if (btnNR) btnNR.style.display = (me?.role==='dealer'||state.hostSocketId===mySocketId)?'':'none';
}

// ── Phase banner ──────────────────────────────────────────────
function renderPhaseBanner(state) {
  const el  = document.getElementById('phaseBanner');
  if (!el) return;
  const cur = state.players[state.currentPlayerIdx];
  const map = {
    lobby:   "Salle d'attente",
    betting: 'Phase de mise — Placez vos paris',
    playing: cur ? `Tour de ${cur.name}${cur.isBot?' 🤖':''}${cur.playingSplit?' — ✂ Main 2':''}` : '',
    dealer:  'Tour du croupier',
    results: 'Fin de la manche ✦',
  };
  el.textContent = map[state.phase] || '';
}

// ── Rendu global ──────────────────────────────────────────────
function renderAll(state, mySocketId) {
  renderPhaseBanner(state);
  renderDealerZone(state, mySocketId);
  renderPlayersZone(state, mySocketId);
  updateActionBar(state, mySocketId);
  updateBetTimer(state);
}

// ── Toast ─────────────────────────────────────────────────────
let _tt;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(_tt); _tt = setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Modal invitation ──────────────────────────────────────────
function showInviteModal(code) {
  let m = document.getElementById('inviteModal');
  if (!m) { m = document.createElement('div'); m.id = 'inviteModal'; document.body.appendChild(m); }
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px';
  const link = `${location.origin}?code=${code}`;
  m.innerHTML = `<div style="background:#0b3d2e;border:1px solid rgba(201,168,76,.4);border-radius:18px;
      padding:clamp(18px,5vw,30px);max-width:370px;width:100%;text-align:center">
    <div style="font-family:'Playfair Display',serif;font-size:1.25rem;color:var(--gold);margin-bottom:5px">Inviter des amis ♠</div>
    <div style="font-family:'Playfair Display',serif;font-size:2.8rem;color:var(--gold);letter-spacing:.3em;font-weight:700;margin:14px 0">${code}</div>
    <div style="display:flex;gap:8px">
      <button onclick="navigator.clipboard.writeText('${code}').then(()=>window.UI.showToast('Code copié !'))"
        style="flex:1;background:linear-gradient(135deg,var(--gold-dark),var(--gold));border:none;border-radius:10px;
               padding:12px;color:var(--felt-dark);font-family:'Playfair Display',serif;font-size:.92rem;font-weight:700;cursor:pointer;min-height:44px">
        Copier le code</button>
      <button onclick="navigator.clipboard.writeText('${link}').then(()=>window.UI.showToast('Lien copié !'))"
        style="flex:1;background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.3);border-radius:10px;
               padding:12px;color:var(--gold);cursor:pointer;font-size:.92rem;min-height:44px">
        Copier le lien</button>
    </div>
    <button onclick="document.getElementById('inviteModal').style.display='none'"
      style="width:100%;background:none;border:none;color:rgba(245,239,224,.28);cursor:pointer;margin-top:12px;font-size:.85rem;min-height:38px">
      Fermer</button>
  </div>`;
  m.style.display = 'flex';
  m.onclick = e => { if (e.target === m) m.style.display = 'none'; };
}

// ── Export ────────────────────────────────────────────────────
window.UI = {
  renderAll, renderLobby, renderResults, renderRoomList,
  showToast, showInviteModal, showBlackjackCelebration,
  selectRoom(code, el) {
    window._selectedRoom = code;
    document.querySelectorAll('#roomList [data-code]').forEach(d => {
      d.style.background  = 'rgba(0,0,0,.2)';
      d.style.borderColor = 'rgba(201,168,76,.2)';
    });
    el.style.background  = 'rgba(201,168,76,.1)';
    el.style.borderColor = 'var(--gold)';
  },
};
