// ═══════════════════════════════════════════════════════════
//  client.js
// ═══════════════════════════════════════════════════════════

const socket = io();
let mySocketId = null, currentState = null;

// CORRIGÉ : fonction extraite pour éviter la duplication (3 occurrences → 1)
function goToJoinScreen() {
  ['screenLobby', 'screenGame', 'screenResults'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  document.getElementById('screenJoin').style.display = 'flex';
  document.getElementById('actionBar').classList.remove('show');
  window._selectedRoom = null;
  currentState = null;
}

socket.on('connect', () => {
  mySocketId = socket.id;
  const code = new URLSearchParams(location.search).get('code');
  if (code) {
    document.querySelector('[name=action][value=join]').checked = true;
    window._selectedRoom = code.toUpperCase();
    const e = document.getElementById('joinError');
    if (e) { e.style.color = 'var(--gold)'; e.textContent = `Invitation : salle ${code.toUpperCase()} — Entrez votre nom`; }
    // CORRIGÉ : vérification de res?.ok avant d'appeler renderRoomList
    socket.emit('getRooms', null, res => { if (res?.ok) UI.renderRoomList(res.rooms); });
  }
});

socket.on('state',     state          => { currentState = state; syncScreens(state); });
socket.on('toast',     msg            => UI.showToast(msg));
socket.on('blackjack', ({ name })     => UI.showBlackjackCelebration(name));
socket.on('kicked',    ({ reason })   => {
  UI.showToast(reason || 'Vous avez été expulsé');
  setTimeout(goToJoinScreen, 1500);
});

function syncScreens(state) {
  document.getElementById('screenJoin').style.display = 'none';
  ['screenLobby', 'screenGame', 'screenResults'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  document.getElementById('actionBar').classList.remove('show');

  if (state.phase === 'lobby') {
    document.getElementById('screenLobby').style.display = 'flex';
    UI.renderLobby(state, mySocketId);
  } else if (state.phase === 'results') {
    document.getElementById('screenResults').style.display = 'block';
    UI.renderResults(state, mySocketId);
  } else {
    document.getElementById('screenGame').style.display = 'block';
    UI.renderAll(state, mySocketId);
  }
}

window.gameActions = {
  placeBet(a)    { socket.emit('placeBet',     { amount: a },          r => { if (!r?.ok) UI.showToast(r?.error || 'Erreur mise'); }); },
  clearBet()     { socket.emit('clearBet'); },
  playerReady()  { socket.emit('playerReady',  null,                   r => { if (!r?.ok) UI.showToast(r?.error || "Misez d'abord !"); }); },
  dealCards()    { socket.emit('dealCards',    null,                   r => { if (!r?.ok) UI.showToast(r?.error || 'Impossible de distribuer'); }); },
  dealerReveal() { socket.emit('dealerReveal', null,                   r => { if (!r?.ok) UI.showToast(r?.error || 'Erreur'); }); },
  hit()          { socket.emit('hit',          null,                   r => { if (!r?.ok) UI.showToast(r?.error || 'Erreur'); }); },
  stand()        { socket.emit('stand',        null,                   r => { if (!r?.ok) UI.showToast(r?.error || 'Erreur'); }); },
  double()       { socket.emit('double',       null,                   r => { if (!r?.ok) UI.showToast(r?.error || 'Erreur double'); }); },
  split()        { socket.emit('split',        null,                   r => { if (!r?.ok) UI.showToast(r?.error || 'Split impossible'); }); },
  newRound()     { socket.emit('newRound',     null,                   r => { if (!r?.ok) UI.showToast(r?.error || 'Erreur'); }); },
  addBot()       { socket.emit('addBot',       null,                   r => { if (!r?.ok) UI.showToast(r?.error || 'Impossible'); }); },
  removeBot(id)  { socket.emit('removeBot',    { botSocketId: id },    r => { if (!r?.ok) UI.showToast(r?.error || 'Erreur'); }); },
  kickPlayer(id) { socket.emit('kickPlayer',   { targetSocketId: id }, r => { if (!r?.ok) UI.showToast(r?.error || 'Impossible'); }); },
  showInvite()   { socket.emit('getInviteCode', null, r => { if (r?.ok) UI.showInviteModal(r.code); }); },

  takeInsurance(amount) {
    socket.emit('takeInsurance', { amount }, r => {
      if (!r?.ok) UI.showToast(r?.error || 'Assurance impossible');
    });
  },
  declineInsurance() {
    socket.emit('declineInsurance', null, r => {
      if (!r?.ok) UI.showToast(r?.error || 'Erreur');
    });
  },

  setOptions() {
    const numDecks    = parseInt(document.getElementById('optNumDecks')?.value    || 2);
    const bjPayout    = parseFloat(document.getElementById('optBjPayout')?.value  || 1.5);
    const betTimerSec = parseInt(document.getElementById('optBetTimer')?.value    || 45);
    const maxBet      = parseInt(document.getElementById('optMaxBet')?.value      || 500);
    const maxSplits   = parseInt(document.getElementById('optMaxSplits')?.value   || 1);
    socket.emit('setOptions', { numDecks, bjPayout, betTimerSec, maxBet, maxSplits }, r => {
      if (!r?.ok) UI.showToast(r?.error || 'Erreur options');
      else        UI.showToast('Options mises à jour ✓');
    });
  },

  // CORRIGÉ : utilise goToJoinScreen() + history.replaceState
  leaveRoom() {
    socket.emit('leaveRoom', null, () => {
      goToJoinScreen();
      history.replaceState({}, '', '/');
    });
  },
};

document.getElementById('formJoin')?.addEventListener('submit', e => {
  e.preventDefault();
  const name   = document.getElementById('inputName').value.trim();
  const role   = document.getElementById('selectRole').value;
  const action = document.querySelector('[name=action]:checked')?.value || 'create';
  const err    = document.getElementById('joinError');
  if (!name) { err.textContent = 'Entrez votre nom.'; return; }
  err.textContent = ''; err.style.color = '#e74c3c';

  if (action === 'create') {
    socket.emit('createRoom', { name, role }, res => {
      if (!res.ok) { err.textContent = res.error; return; }
      document.getElementById('roomCodeDisplay').textContent = res.code;
      // CORRIGÉ : display = 'block' au lieu de '' (qui revenait au CSS display:none)
      document.getElementById('roomCodeBanner').style.display = 'block';
    });
  } else {
    const code = window._selectedRoom;
    if (!code) { err.textContent = 'Sélectionnez une salle dans la liste.'; return; }
    socket.emit('joinRoom', { code, name, role }, res => { if (!res.ok) err.textContent = res.error; });
  }
});

document.querySelectorAll('[name=action]').forEach(r => {
  r.addEventListener('change', () => {
    if (r.value === 'join') {
      // CORRIGÉ : vérification de res?.ok
      socket.emit('getRooms', null, res => { if (res?.ok) UI.renderRoomList(res.rooms); });
    } else {
      const el = document.getElementById('roomList');
      if (el) el.style.display = 'none';
      window._selectedRoom = null;
    }
  });
});

document.getElementById('btnStart')?.addEventListener('click', () => {
  socket.emit('startGame', null, r => { if (!r?.ok) UI.showToast(r?.error || 'Impossible de démarrer'); });
});
