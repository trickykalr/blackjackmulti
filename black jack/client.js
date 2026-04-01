// ═══════════════════════════════════════════════════════════
//  clients.js — Pont entre Socket.io et l'interface visuelle
// ═══════════════════════════════════════════════════════════

const socket = io();
let mySocketId   = null;
let currentState = null;

// ── Connexion ─────────────────────────────────────────────────
socket.on('connect', () => {
  mySocketId = socket.id;
  console.log('Connecté :', mySocketId);

  // Invitation via URL ?code=XXXXX
  const params     = new URLSearchParams(window.location.search);
  const inviteCode = params.get('code');
  if (inviteCode) {
    document.querySelector('[name=action][value=join]').checked = true;
    window._selectedRoom = inviteCode.toUpperCase();
    const errEl = document.getElementById('joinError');
    if (errEl) {
      errEl.style.color = 'var(--gold)';
      errEl.textContent = `Invitation : salle ${inviteCode.toUpperCase()} — Entrez votre nom et cliquez Entrer`;
    }
    socket.emit('getRooms', null, ({ rooms }) => UI.renderRoomList(rooms));
  }
});

// ── État ──────────────────────────────────────────────────────
socket.on('state', (state) => {
  currentState = state;
  syncScreens(state);
});

socket.on('toast', msg => UI.showToast(msg));

socket.on('kicked', ({ reason }) => {
  UI.showToast(reason || 'Vous avez été expulsé');
  setTimeout(() => {
    ['screenLobby', 'screenGame'].forEach(id =>
      document.getElementById(id).style.display = 'none'
    );
    document.getElementById('screenJoin').style.display = 'flex';
    currentState = null;
  }, 1500);
});

// ── Écrans ────────────────────────────────────────────────────
function syncScreens(state) {
  document.getElementById('screenJoin').style.display = 'none';

  const screens = {
    lobby:   document.getElementById('screenLobby'),
    game:    document.getElementById('screenGame'),
    results: document.getElementById('screenResults'),
  };
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

// ── Actions ───────────────────────────────────────────────────
window.gameActions = {

  placeBet(amount) {
    socket.emit('placeBet', { amount }, res => {
      if (!res?.ok) UI.showToast(res?.error || 'Erreur mise');
    });
  },

  clearBet() { socket.emit('clearBet'); },

  dealCards() {
    socket.emit('dealCards', null, res => {
      if (!res?.ok) UI.showToast(res?.error || 'Impossible de distribuer');
    });
  },

  dealerReveal() {
    socket.emit('dealerReveal', null, res => {
      if (!res?.ok) UI.showToast(res?.error || 'Erreur révélation');
    });
  },

  hit()    { socket.emit('hit',   null, res => { if (!res?.ok) UI.showToast(res?.error || 'Erreur'); }); },
  stand()  { socket.emit('stand', null, res => { if (!res?.ok) UI.showToast(res?.error || 'Erreur'); }); },
  double() { socket.emit('double',null, res => { if (!res?.ok) UI.showToast(res?.error || 'Erreur double'); }); },

  newRound() {
    socket.emit('newRound', null, res => {
      if (!res?.ok) UI.showToast(res?.error || 'Erreur');
    });
  },

  leaveRoom() {
    socket.emit('leaveRoom', null, () => {
      ['screenLobby', 'screenGame'].forEach(id =>
        document.getElementById(id).style.display = 'none'
      );
      document.getElementById('screenJoin').style.display = 'flex';
      window._selectedRoom = null;
      currentState = null;
      window.history.replaceState({}, '', '/');
    });
  },

  kickPlayer(targetSocketId) {
    socket.emit('kickPlayer', { targetSocketId }, res => {
      if (!res?.ok) UI.showToast(res?.error || 'Impossible d\'expulser');
    });
  },

  addBot() {
    socket.emit('addBot', null, res => {
      if (!res?.ok) UI.showToast(res?.error || 'Impossible d\'ajouter un bot');
    });
  },

  removeBot(botSocketId) {
    socket.emit('removeBot', { botSocketId }, res => {
      if (!res?.ok) UI.showToast(res?.error || 'Erreur');
    });
  },

  showInvite() {
    socket.emit('getInviteCode', null, res => {
      if (res?.ok) UI.showInviteModal(res.code);
    });
  },

  backToLobby() { window.location.reload(); },
};

// ── Formulaire accueil ────────────────────────────────────────
document.getElementById('formJoin')?.addEventListener('submit', e => {
  e.preventDefault();
  const name   = document.getElementById('inputName').value.trim();
  const role   = document.getElementById('selectRole').value;
  const action = document.querySelector('[name=action]:checked')?.value || 'create';
  const errEl  = document.getElementById('joinError');

  if (!name) { errEl.textContent = 'Entrez votre nom.'; return; }
  errEl.textContent = '';
  errEl.style.color = '#e74c3c';

  if (action === 'create') {
    socket.emit('createRoom', { name, role }, res => {
      if (!res.ok) { errEl.textContent = res.error; return; }
      document.getElementById('roomCodeDisplay').textContent = res.code;
      document.getElementById('roomCodeBanner').style.display = '';
    });
  } else {
    const code = window._selectedRoom;
    if (!code) { errEl.textContent = 'Sélectionnez une salle dans la liste.'; return; }
    socket.emit('joinRoom', { code, name, role }, res => {
      if (!res.ok) { errEl.textContent = res.error; return; }
    });
  }
});

// ── Toggle rejoindre → charger les rooms ──────────────────────
document.querySelectorAll('[name=action]').forEach(radio => {
  radio.addEventListener('change', () => {
    const isJoin    = radio.value === 'join';
    const codeField = document.getElementById('codeField');
    if (codeField) codeField.style.display = 'none';

    if (isJoin) {
      socket.emit('getRooms', null, ({ rooms }) => UI.renderRoomList(rooms));
    } else {
      const roomList = document.getElementById('roomList');
      if (roomList) roomList.style.display = 'none';
      window._selectedRoom = null;
    }
  });
});

// ── Bouton démarrer ───────────────────────────────────────────
document.getElementById('btnStart')?.addEventListener('click', () => {
  socket.emit('startGame', null, res => {
    if (!res?.ok) UI.showToast(res?.error || 'Impossible de démarrer');
  });
});