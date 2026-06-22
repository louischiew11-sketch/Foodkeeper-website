// ── FIREBASE UTILITY SETUP ──
const firebaseConfig = {
  apiKey:            "AIzaSyAVCLcRZXQvUvvDm1L20TCY_GPwlX0btfg",
  authDomain:        "food-keeper-e2b1c.firebaseapp.com",
  projectId:         "food-keeper-e2b1c",
  storageBucket:     "food-keeper-e2b1c.firebasestorage.app",
  messagingSenderId: "294763992382",
  appId:             "1:294763992382:web:694f9d846b881b3a75886f"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// ── GLOBAL INTERFACE CONSTANTS ──
const EMOJIS = {
  fridge:  ['🥛','🥚','🧀','🥩','🥦','🥕','🍅','🫐','🍓','🥬','🫒','🥒'],
  freezer: ['🍦','🥩','🐟','🥐','🍕','🧊','🦐','🥟'],
  pantry:  ['🍞','🥫','🧈','🌾','🫙','🍝','🧄','🧅','🥜','🍵','🫖','🥗']
};

const ALL_EMOJIS = [...new Set([...EMOJIS.fridge, ...EMOJIS.freezer, ...EMOJIS.pantry])];
const LOC_LABEL  = { fridge: 'Fridge', freezer: 'Freezer', pantry: 'Pantry' };
const LOC_ICON   = { fridge: '🧊', freezer: '❄️', pantry: '🗄️' };
const CAT_LABEL  = { dairy: 'Dairy', produce: 'Produce', meat: 'Meat', grain: 'Grain', other: 'Other' };
const CAT_ICON   = { dairy: '🥛', produce: '🥦', meat: '🥩', grain: '🌾', other: '📦' };

const ERROR_MAP = {
  'auth/invalid-email':           'Invalid email format',
  'auth/user-not-found':          'Account not found',
  'auth/wrong-password':          'Wrong password',
  'auth/email-already-in-use':    'Email already registered',
  'auth/weak-password':           'Password must be at least 6 characters',
  'auth/too-many-requests':       'Too many attempts, try later',
  'auth/invalid-credential':      'Email or password is incorrect',
};

// ── RUNTIME MEMORY STATE REGISTER ──
let foods       = [];
let shopItems   = [];
let wasteLog    = [];
let filter      = 'all';
let catFilter   = 'all';
let sortBy      = 'expiry';
let query       = '';
let currentView = 'pantry';
let unsubscribe = null;
let currentUser = null;
let editingId   = null;
let bulkMode    = false;
let selectedIds = new Set();
let notifDays   = 3;

// ── AUXILIARY TIME & DYNAMIC MATH UTILITIES ──
function daysLeft(expiry) {
  const today = new Date(); today.setHours(0,0,0,0);
  const exp   = new Date(expiry); exp.setHours(0,0,0,0);
  return Math.round((exp - today) / 86400000);
}

function badgeInfo(days) {
  if (days < 0)   return { cls: 'badge-red',   text: 'Expired' };
  if (days === 0) return { cls: 'badge-red',   text: 'Today!' };
  if (days <= 7)  return { cls: 'badge-amber', text: `${days}d left` };
  return { cls: 'badge-green', text: `${days}d left` };
}

function today() { 
  return new Date().toISOString().split('T')[0]; 
}

function fmtDate(d) { 
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); 
}

function fmtDateFull(d) { 
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); 
}

function toast(msg, ms = 2400) {
  const t = document.createElement('div');
  t.className = 'toast'; 
  t.textContent = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function confetti() {
  const colors = ['#6bbb3e', '#f5c96a', '#f0a0a0', '#99b4f8', '#fde68a'];
  for (let i = 0; i < 28; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.cssText = `
      left: ${Math.random() * 100}vw; 
      top: ${Math.random() * 30 + 20}vh; 
      background: ${colors[Math.floor(Math.random() * colors.length)]}; 
      animation-delay: ${Math.random() * 0.6}s; 
      animation-duration: ${1.2 + Math.random() * 0.8}s; 
      transform: rotate(${Math.random() * 360}deg);
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }
}

// ── AUTHENTICATION MANAGEMENT SYSTEM ──
let authMode = 'login';

function switchTab(mode) {
  authMode = mode;
  document.getElementById('tab-login').className    = 'auth-tab' + (mode === 'login' ? ' active' : '');
  document.getElementById('tab-register').className = 'auth-tab' + (mode === 'register' ? ' active' : '');
  document.getElementById('auth-btn').textContent   = mode === 'login' ? 'Log In' : 'Register';
  document.getElementById('confirm-field').style.display = mode === 'register' ? '' : 'none';
  document.getElementById('forgot-btn').style.display    = mode === 'login' ? '' : 'none';
  document.getElementById('auth-error').className = 'auth-error';
}

function showAuthError(msg) { 
  const el = document.getElementById('auth-error'); 
  el.textContent = msg; 
  el.className = 'auth-error show'; 
}

async function handleAuth() {
  const email   = document.getElementById('auth-email').value.trim();
  const pass    = document.getElementById('auth-password').value;
  const confirm = document.getElementById('auth-confirm').value;
  const btn     = document.getElementById('auth-btn');

  if (!email || !pass) { showAuthError('Please fill in email and password'); return; }
  if (authMode === 'register' && pass !== confirm) { showAuthError('Passwords do not match'); return; }
  
  btn.disabled = true; 
  btn.textContent = 'Please wait…';
  
  try {
    if (authMode === 'login') {
      await auth.signInWithEmailAndPassword(email, pass);
    } else {
      await auth.createUserWithEmailAndPassword(email, pass);
    }
  } catch(e) {
    showAuthError(ERROR_MAP[e.code] || e.message);
    btn.disabled = false; 
    btn.textContent = authMode === 'login' ? 'Log In' : 'Register';
  }
}

async function handleForgot() {
  const email = document.getElementById('auth-email').value.trim();
  if (!email) { showAuthError('Please fill in email first'); return; }
  try {
    await auth.sendPasswordResetEmail(email);
    const s = document.getElementById('auth-success'); 
    s.textContent = 'Reset email sent! Check your inbox.'; 
    s.className = 'auth-success show';
  } catch(e) { 
    showAuthError(ERROR_MAP[e.code] || e.message); 
  }
}

async function handleLogout() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  foods = []; shopItems = []; wasteLog = [];
  
  if (document.getElementById('recipes-list-container')) {
    document.getElementById('recipes-list-container').innerHTML = '';
  }
  await auth.signOut();
}

// ── AUTH STATE SNAPSHOT WITH INTEGRATED AUTO-PUTER SYNC ──
auth.onAuthStateChanged(async (user) => {
  const authScreen = document.getElementById('auth-screen');
  const appScreen  = document.getElementById('app');
  
  if (user) {
    currentUser = user;
    authScreen.style.display = 'none';
    appScreen.style.display  = 'block';
    document.getElementById('user-email').textContent = user.email;
    
    startListening(user.uid);
    loadLocalData();
    loadSettings();
    checkAndNotify();
    
    // AUTOMATED SIGN-IN SYNCHRONIZATION WITH PUTER CLOUD STORAGE
    if (window.puter) {
      try {
        if (!puter.auth.isSignedIn()) {
          console.log("🔄 Auto-signing into Puter AI backend...");
          await puter.auth.signIn(); 
        }
        console.log("✅ Puter AI auto-login successful!");
      } catch (puterErr) {
        console.warn("Puter AI auto-login failed, but app will still work:", puterErr);
      }
    }
  } else {
    authScreen.style.display = 'flex';
    appScreen.style.display  = 'none';
    currentUser = null;
    foods = []; shopItems = []; wasteLog = [];
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  }
});

// ── FIRESTORE SYNCHRONIZATION LEDGER ──
function startListening(uid) {
  if (unsubscribe) unsubscribe();
  unsubscribe = db.collection('users').doc(uid).collection('foods')
    .orderBy('added', 'desc')
    .onSnapshot(snap => {
      foods = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      render();
    }, err => console.error(err));
}

async function addFood(data) {
  await db.collection('users').doc(currentUser.uid).collection('foods').add({
    ...data, added: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function updateFood(docId, data) {
  await db.collection('users').doc(currentUser.uid).collection('foods').doc(docId).update(data);
}

async function deleteFood(docId) {
  await db.collection('users').doc(currentUser.uid).collection('foods').doc(docId).delete();
}

// ── LOCAL BROWSER STORAGE UTILITIES ──
function loadLocalData() {
  const uid = currentUser.uid;
  shopItems = JSON.parse(localStorage.getItem(`fk_shop_${uid}`) || '[]');
  wasteLog  = JSON.parse(localStorage.getItem(`fk_waste_${uid}`) || '[]');
  renderShopList(); 
  renderWasteLog();
}

function saveShopItems() {
  localStorage.setItem(`fk_shop_${currentUser.uid}`, JSON.stringify(shopItems));
}

function saveWasteLog() {
  localStorage.setItem(`fk_waste_${currentUser.uid}`, JSON.stringify(wasteLog));
}

function loadSettings() {
  const uid = currentUser.uid;
  notifDays = parseInt(localStorage.getItem(`fk_notifdays_${uid}`) || '3');
  document.getElementById('notif-days').value = notifDays;
  
  document.getElementById('notif-days').onchange = e => {
    notifDays = parseInt(e.target.value) || 3;
    localStorage.setItem(`fk_notifdays_${uid}`, notifDays);
    render();
  };
}

// ── CORE APPLICATION TAB VIEW MANAGER ──
function switchView(viewName) {
  currentView = viewName;
  
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  
  ['pantry', 'shopping', 'waste', 'recipes'].forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) el.style.display = (v === viewName) ? '' : 'none';
  });
  
  const statsContainer = document.querySelector('.stats');
  if (statsContainer) {
    statsContainer.style.display = (viewName === 'shopping' || viewName === 'recipes') ? 'none' : 'grid';
  }
}

// ── INTERFACE RENDERING ENGINE ──
function render() {
  updateStats();
  const container = document.getElementById('food-container');
  if (!container) return;

  let list = foods.filter(f => {
    const matchesQuery = f.name?.toLowerCase().includes(query.toLowerCase());
    const matchesLoc   = filter === 'all' || f.location === filter;
    return matchesQuery && matchesLoc;
  });

  if (sortBy === 'expiry') {
    list.sort((a,b) => new Date(a.expiry) - new Date(b.expiry));
  } else if (sortBy === 'name') {
    list.sort((a,b) => (a.name || '').localeCompare(b.name || ''));
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🧺</div>
        <p>${query ? 'No matching ingredients found' : 'No ingredients yet — click ➕ Add Item to get started!'}</p>
      </div>`;
    return;
  }

  const groups = [
    { label: '⚠️ Expired',       cls: 'expired-card', items: list.filter(f => daysLeft(f.expiry) < 0) },
    { label: 'bell Expiring Soon', cls: 'soon-card',    items: list.filter(f => { const d = daysLeft(f.expiry); return d >= 0 && d <= notifDays; }) },
    { label: '✅ Fresh',         cls: '',             items: list.filter(f => daysLeft(f.expiry) > notifDays) },
  ].filter(g => g.items.length > 0);

  container.innerHTML = groups.map(g => `
    <div class="section-label">${g.label} (${g.items.length})</div>
    <div class="food-list">${g.items.map(f => foodCardHTML(f, g.cls)).join('')}</div>
  `).join('');

  // Wire up list tracking event bindings dynamically
  container.querySelectorAll('.food-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.action-btn') || e.target.closest('.card-actions')) return;
      if (bulkMode) {
        const id = card.dataset.id;
        if (selectedIds.has(id)) {
          selectedIds.delete(id);
          card.classList.remove('selected');
          card.querySelector('.food-select').textContent = '';
        } else {
          selectedIds.add(id);
          card.classList.add('selected');
          card.querySelector('.food-select').textContent = '✓';
        }
        updateBulkBar();
      }
    });
  });
}

function foodCardHTML(f, groupClass) {
  const days = daysLeft(f.expiry);
  const badge = badgeInfo(days);
  const isSelected = selectedIds.has(f.id);

  return `
    <div class="food-card ${groupClass} ${isSelected ? 'selected' : ''}" data-id="${f.id}">
      <div class="food-select">${isSelected ? '✓' : ''}</div>
      <div class="food-emoji">${f.emoji || '🍽️'}</div>
      <div class="food-info">
        <div class="food-name-row">
          <span class="food-name">${f.name}</span>
          ${f.qty ? `<span class="food-qty">${f.qty}</span>` : ''}
        </div>
        <div class="food-meta">
          <span>${LOC_ICON[f.location] || '📍'} ${LOC_LABEL[f.location]}</span>
          <span class="dot">·</span>
          <span>Exp: ${fmtDate(f.expiry)}</span>
        </div>
        ${f.note ? `<div class="food-note">${f.note}</div>` : ''}
      </div>
      <div class="card-badge-wrap">
        <span class="badge ${badge.cls}">${badge.text}</span>
        <div class="card-actions">
          <button class="icon-btn action-btn" onclick="openEditModal('${f.id}')" title="Edit">✏️</button>
          <button class="icon-btn action-btn check" onclick="eatFood('${f.id}')" title="Mark Consumed">✓</button>
          <button class="icon-btn action-btn trash" onclick="wasteFood('${f.id}')" title="Log as Waste">🗑️</button>
        </div>
      </div>
    </div>
  `;
}

function updateStats() {
  document.getElementById('stat-total').textContent   = foods.length;
  document.getElementById('stat-expired').textContent = foods.filter(f => daysLeft(f.expiry) < 0).length;
  document.getElementById('stat-soon').textContent    = foods.filter(f => { const d = daysLeft(f.expiry); return d >= 0 && d <= notifDays; }).length;
  
  const currentMonthStr = new Date().toISOString().substring(0,7);
  const savedThisMonth = wasteLog.filter(w => w.date?.startsWith(currentMonthStr));
  document.getElementById('stat-saved').textContent = savedThisMonth.length;
}

// ── BULK MANAGEMENT INTERFACES ──
function toggleBulkMode() {
  bulkMode = !bulkMode;
  selectedIds.clear();
  document.getElementById('bulk-toggle-btn').classList.toggle('active', bulkMode);
  document.getElementById('bulk-bar').style.display = bulkMode ? 'flex' : 'none';
  document.body.classList.toggle('bulk-active', bulkMode);
  render();
}

function updateBulkBar() {
  document.getElementById('bulk-count').textContent = `${selectedIds.size} items selected`;
}

async function bulkEat() {
  if(selectedIds.size === 0) return;
  const batch = Array.from(selectedIds);
  for(let id of batch) {
    await deleteFood(id);
  }
  confetti();
  toast(`Consumed ${batch.length} tracking nodes`);
  toggleBulkMode();
}

async function bulkWaste() {
  if(selectedIds.size === 0) return;
  const batch = Array.from(selectedIds);
  batch.forEach(id => {
    const f = foods.find(x => x.id === id);
    if(f) wasteLog.unshift({ name: f.name, emoji: f.emoji || '🍽️', date: today() });
  });
  saveWasteLog();
  renderWasteLog();
  for(let id of batch) {
    await deleteFood(id);
  }
  toast(`Logged ${batch.length} nodes into structural waste matrix`);
  toggleBulkMode();
}

async function bulkDelete() {
  if(selectedIds.size === 0 || !confirm('Permanently wipe selected items?')) return;
  const batch = Array.from(selectedIds);
  for(let id of batch) {
    await deleteFood(id);
  }
  toast(`Deleted ${batch.length} records`);
  toggleBulkMode();
}

// ── INVENTORY MUTATION TRIGGERS ──
async function eatFood(id) {
  await deleteFood(id);
  confetti();
  toast('Ingredient consumed safely!');
}

async function wasteFood(id) {
  const f = foods.find(x => x.id === id);
  if (f) {
    wasteLog.unshift({ name: f.name, emoji: f.emoji || '🍽️', date: today() });
    saveWasteLog();
    renderWasteLog();
  }
  await deleteFood(id);
  toast('Item logged to waste history.');
}

// ── FILTERING & SEARCH MATRIX ──
function handleSearch(val) { query = val; render(); }
function handleLocationFilter(val) { filter = val; render(); }
function handleSort(val) { sortBy = val; render(); }

// ── WASTE VIEW LOGISTICS ──
function renderWasteLog() {
  const currentMonthStr = new Date().toISOString().substring(0,7);
  const thisMonth = wasteLog.filter(w => w.date?.startsWith(currentMonthStr));

  document.getElementById('waste-month-count').textContent = thisMonth.length;
  document.getElementById('waste-total-count').textContent = wasteLog.length;
  
  const container = document.getElementById('waste-list-container');
  if (!container) return;

  if (wasteLog.length === 0) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">🌱</div><p>No waste logged — keep it up!</p></div>';
    return;
  }

  container.innerHTML = wasteLog.map(w => `
    <div class="waste-item">
      <span class="waste-emoji">${w.emoji}</span>
      <span class="waste-name">${w.name}</span>
      <span class="waste-item-date">${fmtDateFull(w.date)}</span>
    </div>
  `).join('');
}

// ── SHOPPING MODULE ──
function renderShopList() {
  const container = document.getElementById('shop-list-container');
  if (!container) return;

  if (shopItems.length === 0) {
    container.innerHTML = '<div class="empty" style="padding:2rem 1rem;"><div class="empty-icon">🛒</div><p>Shopping list is empty</p></div>';
    return;
  }

  container.innerHTML = shopItems.map((item, i) => `
    <div class="shop-item">
      <div class="shop-check ${item.checked ? 'checked' : ''}" onclick="toggleShopCheck(${i})">${item.checked ? '✓' : ''}</div>
      <span class="shop-name ${item.checked ? 'done' : ''}">${item.name}</span>
      <button class="shop-del" onclick="removeShopItem(${i})">✕</button>
    </div>
  `).join('');
}

function addShopItem() {
  const inp = document.getElementById('shop-input');
  const val = inp.value.trim();
  if (!val) return;
  shopItems.push({ name: val, checked: false });
  saveShopItems();
  inp.value = '';
  renderShopList();
}

function toggleShopCheck(i) {
  shopItems[i].checked = !shopItems[i].checked;
  saveShopItems();
  renderShopList();
}

function removeShopItem(i) {
  shopItems.splice(i, 1);
  saveShopItems();
  renderShopList();
}

function clearChecked() {
  shopItems = shopItems.filter(x => !x.checked);
  saveShopItems();
  renderShopList();
}

function exportShopList() {
  if(shopItems.length === 0) return;
  const text = shopItems.map(x => `${x.checked ? '[x]' : '[ ]'} ${x.name}`).join('\n');
  navigator.clipboard.writeText(text);
  toast('Shopping list copied to clipboard!');
}

// ── INTERACTIVE MODAL OVERLAYS ──
function buildEmojiPicker(selectedEmoji) {
  const container = document.getElementById('emoji-picker');
  container.innerHTML = ALL_EMOJIS.map(e => `
    <span class="emoji-opt ${e === selectedEmoji ? 'sel' : ''}" onclick="selectEmoji(this, '${e}')">${e}</span>
  `).join('');
}

function selectEmoji(el, e) {
  document.querySelectorAll('.emoji-opt').forEach(x => x.classList.remove('sel'));
  el.classList.add('sel');
}

function getSelectedEmoji() {
  const sel = document.querySelector('.emoji-opt.sel');
  return sel ? sel.textContent : '🍽️';
}

function openModal() {
  editingId = null;
  document.getElementById('modal-title').textContent = '✏️ Add Ingredient';
  document.getElementById('input-name').value = '';
  document.getElementById('input-qty').value  = '';
  document.getElementById('input-note').value = '';
  document.getElementById('input-location').value = 'fridge';
  document.getElementById('input-category').value = 'other';
  document.getElementById('input-expiry').value = today();
  document.getElementById('save-btn').textContent = 'Save';
  buildEmojiPicker('🥬');
  document.getElementById('overlay').classList.add('open');
  setTimeout(() => document.getElementById('input-name').focus(), 80);
}

function openEditModal(id) {
  const f = foods.find(x => x.id === id);
  if (!f) return;
  editingId = id;
  document.getElementById('modal-title').textContent = '✏️ Edit Ingredient';
  document.getElementById('input-name').value = f.name;
  document.getElementById('input-qty').value  = f.qty || '';
  document.getElementById('input-note').value = f.note || '';
  document.getElementById('input-location').value = f.location || 'fridge';
  document.getElementById('input-category').value = f.category || 'other';
  document.getElementById('input-expiry').value = f.expiry;
  document.getElementById('save-btn').textContent = 'Update';
  buildEmojiPicker(f.emoji || '🥬');
  document.getElementById('overlay').classList.add('open');
}

function closeModal() { 
  document.getElementById('overlay').classList.remove('open'); 
}

function openPanel() { 
  document.getElementById('panel-overlay').classList.add('open'); 
}

function closePanel() { 
  document.getElementById('panel-overlay').classList.remove('open'); 
}

async function saveFood() {
  const name = document.getElementById('input-name').value.trim();
  const expiry = document.getElementById('input-expiry').value;
  if (!name || !expiry) { alert('Name and Expiration are mandatory fields'); return; }

  const payload = {
    name, expiry,
    emoji:    getSelectedEmoji(),
    qty:      document.getElementById('input-qty').value.trim(),
    note:     document.getElementById('input-note').value.trim(),
    location: document.getElementById('input-location').value,
    category: document.getElementById('input-category').value
  };

  if (editingId) {
    await updateFood(editingId, payload);
    toast('Ingredient updated successfully!');
  } else {
    await addFood(payload);
    toast('Ingredient added!');
  }
  closeModal();
}

function exportCSV() {
  const header = ['Name','Category','Location','Expiry','Quantity','Notes','Days Left'];
  const rows = foods.map(f => [
    `"${f.name || ''}"`,
    `"${CAT_LABEL[f.category || 'other']}"`,
    `"${LOC_LABEL[f.location]}"`,
    f.expiry,
    `"${f.qty || ''}"`,
    `"${f.note || ''}"`,
    daysLeft(f.expiry)
  ]);
  const csv = [header, ...rows].map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'food-keeper-export.csv';
  a.click();
  toast('CSV exported!');
}

// ── PUSH NOTIFICATIONS ENGINE ──
const NOTIF_KEY = 'foodkeeper_notif_date';

function sendNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  
  const expired = foods.filter(f => daysLeft(f.expiry) < 0);
  const today_  = foods.filter(f => daysLeft(f.expiry) === 0);
  const soon_   = foods.filter(f => { const d = daysLeft(f.expiry); return d > 0 && d <= notifDays; });

  if (expired.length === 0 && today_.length === 0 && soon_.length === 0) return;

  const lastSent = localStorage.getItem(NOTIF_KEY);
  if (lastSent === today()) return; 

  let title = "Food Keeper Status Alert";
  let body  = "";
  if (expired.length) body += `⚠️ ${expired.length} items expired! `;
  if (today_.length)  body += `🔔 ${today_.length} expiring today! `;
  if (soon_.length)   body += `⏳ ${soon_.length} nearing baseline limits.`;

  new Notification(title, { body, icon: 'data:image/svg+xml,...' });
  localStorage.setItem(NOTIF_KEY, today());
}

function checkAndNotify() {
  if (!('Notification' in window)) return;
  const t = document.getElementById('notif-toggle');
  if (!t) return;

  if (Notification.permission === 'granted') {
    t.className = 'toggle on';
    setTimeout(sendNotifications, 1500);
  } else {
    t.className = 'toggle off';
  }
}

async function toggleNotif() {
  if (!('Notification' in window)) { alert('System notifications unsupported in browser environment'); return; }
  const t = document.getElementById('notif-toggle');
  
  if (Notification.permission === 'default') {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      t.className = 'toggle on';
      sendNotifications();
    }
  } else if (Notification.permission === 'granted') {
    toast('To completely turn off notifications, alter configuration permissions within browser address bar settings.');
  } else {
    alert('Notifications blocked. Reset system tracking permissions via site preferences.');
  }
}

// ── EXPIRED RESOURCE INGESTION: PUTER AI ENGINE INTEGRATION ──
async function generateAICustomMenu() {
  const outputDiv = document.getElementById('recipes-list-container');
  if (outputDiv) {
    outputDiv.innerHTML = '<div class="loading">🧠 Puter AI engine analyzing ingredient matrices... Please wait...</div>';
  }

  try {
    const currentInventoryItems = [...foods];
    if (currentInventoryItems.length === 0) {
      if (outputDiv) outputDiv.innerHTML = '<div class="empty">🧺 Add active inventory nodes before calling the AI compiler.</div>';
      return;
    }

    const calcDaysLeft = (dateStr) => {
      if (!dateStr) return 999;
      const diff = new Date(dateStr) - new Date();
      return Math.ceil(diff / (1000 * 60 * 60 * 24));
    };

    // Pull ingredients with <= 7 days left to minimize structural waste
    const expiringIngredients = currentInventoryItems.filter(f => calcDaysLeft(f.expiry) <= 7);
    const ingredientsToUse = expiringIngredients.length > 0 ? expiringIngredients : currentInventoryItems;
    const ingredientTextList = ingredientsToUse.map(i => `- ${i.name} (Qty: ${i.qty || 'N/A'}, Location: ${i.location})`).join('\n');

    const prompt = `You are a professional Michelin-star zero-waste chef.
Generate a creative, highly optimized menu plan incorporating the following active user ingredients:
${ingredientTextList}

Requirements:
- Propose 2 balanced recipes maximizing resource utilization.
- Output directly as clean HTML text layout wrappers without any generic backtick string identifiers.
- Use explicit visual layout blocks with specific headings.
- Format with an <h3> tag for each recipe name (with a fitting food emoji).
- Provide a <ul> list for ingredients.
- Provide an <ol> list for step-by-step directions.`;

    const response = await puter.ai.chat(prompt);
    
    if (outputDiv) {
      outputDiv.innerHTML = `
        <div class="recipe-card" style="background: var(--surface); padding: 24px; border-radius: 12px; border: 1px solid var(--border2); margin-top: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
          <span style="background: var(--accent); color: white; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; display: inline-block; margin-bottom: 15px;">Puter AI Custom Menu</span>
          <div class="ai-generated-html" style="color: var(--text); font-size: 0.95rem; line-height: 1.6;">
            ${response.toString()}
          </div>
        </div>
      `;
    }
  } catch (error) {
    console.error("AI Generation Failed:", error);
    if (outputDiv) {
      outputDiv.innerHTML = `<div style="background: var(--red-bg); color: var(--red-text); padding: 12px; border-radius: 8px;">⚠️ Failed to process recipes via Puter engine network node.</div>`;
    }
  }
}