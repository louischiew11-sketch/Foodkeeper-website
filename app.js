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

const EMOJIS = {
  fridge:  ['🥛','🥚','🧀','🥩','🥦','🥕','🍅','🫐','🍓','🥬','🫒','🥒'],
  freezer: ['🍦','🥩','🐟','🥐','🍕','🧊','🦐','🥟'],
  pantry:  ['🍞','🥫','🧈','🌾','🫙','🍝','🧄','🧅','🥜','🍵','🫖','🥗']
};
const ALL_EMOJIS = [...new Set([...EMOJIS.fridge,...EMOJIS.freezer,...EMOJIS.pantry])];
const LOC_LABEL = { fridge:'Fridge', freezer:'Freezer', pantry:'Pantry' };
const LOC_ICON  = { fridge:'🧊', freezer:'❄️', pantry:'🗄️' };
const CAT_LABEL = { dairy:'Dairy', produce:'Produce', meat:'Meat', grain:'Grain', other:'Other' };
const CAT_ICON  = { dairy:'🥛', produce:'🥦', meat:'🥩', grain:'🌾', other:'📦' };
const ERROR_MAP = {
  'auth/invalid-email':'Invalid email format','auth/user-not-found':'Account not found',
  'auth/wrong-password':'Wrong password','auth/email-already-in-use':'Email already registered',
  'auth/weak-password':'Password must be at least 6 characters','auth/too-many-requests':'Too many attempts, try later',
  'auth/invalid-credential':'Email or password is incorrect',
};

let foods      = [];
let shopItems  = [];
let wasteLog   = [];
let filter     = 'all';
let catFilter  = 'all';
let sortBy     = 'expiry';
let query      = '';
let currentView = 'pantry';
let unsubscribe = null;
let currentUser = null;
let editingId   = null;
let bulkMode    = false;
let selectedIds = new Set();
let notifDays   = 3;

function daysLeft(expiry) {
  const today = new Date(); today.setHours(0,0,0,0);
  const exp   = new Date(expiry); exp.setHours(0,0,0,0);
  return Math.round((exp - today) / 86400000);
}
function badgeInfo(days) {
  if (days < 0)   return { cls:'badge-red',   text:'Expired' };
  if (days === 0) return { cls:'badge-red',   text:'Today!' };
  if (days <= 7)  return { cls:'badge-amber', text:`${days}d left` };
  return { cls:'badge-green', text:`${days}d left` };
}
function today() { return new Date().toISOString().split('T')[0]; }
function fmtDate(d) { return new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short'}); }
function fmtDateFull(d) { return new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); }

function toast(msg, ms=2400) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function confetti() {
  const colors = ['#6bbb3e','#f5c96a','#f0a0a0','#99b4f8','#fde68a'];
  for (let i=0; i<28; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.cssText = `left:${Math.random()*100}vw; top:${Math.random()*30+20}vh; background:${colors[Math.floor(Math.random()*colors.length)]}; animation-delay:${Math.random()*0.6}s; animation-duration:${1.2+Math.random()*0.8}s; transform:rotate(${Math.random()*360}deg);`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }
}

// ── Auth ──
let authMode = 'login';
function switchTab(mode) {
  authMode = mode;
  document.getElementById('tab-login').className    = 'auth-tab' + (mode==='login'?' active':'');
  document.getElementById('tab-register').className = 'auth-tab' + (mode==='register'?' active':'');
  document.getElementById('auth-btn').textContent   = mode==='login' ? 'Log In' : 'Register';
  document.getElementById('confirm-field').style.display = mode==='register' ? '' : 'none';
  document.getElementById('forgot-btn').style.display    = mode==='login'    ? '' : 'none';
  document.getElementById('auth-error').className = 'auth-error';
}
function showAuthError(msg) { const el=document.getElementById('auth-error'); el.textContent=msg; el.className='auth-error show'; }
async function handleAuth() {
  const email=document.getElementById('auth-email').value.trim();
  const pass=document.getElementById('auth-password').value;
  const confirm=document.getElementById('auth-confirm').value;
  const btn=document.getElementById('auth-btn');
  if (!email||!pass) { showAuthError('Please fill in email and password'); return; }
  if (authMode==='register'&&pass!==confirm) { showAuthError('Passwords do not match'); return; }
  btn.disabled=true; btn.textContent='Please wait…';
  try {
    if (authMode==='login') await auth.signInWithEmailAndPassword(email,pass);
    else await auth.createUserWithEmailAndPassword(email,pass);
  } catch(e) {
    showAuthError(ERROR_MAP[e.code]||e.message);
    btn.disabled=false; btn.textContent=authMode==='login'?'Log In':'Register';
  }
}
async function handleForgot() {
  const email=document.getElementById('auth-email').value.trim();
  if (!email) { showAuthError('Please fill in email first'); return; }
  try {
    await auth.sendPasswordResetEmail(email);
    const s=document.getElementById('auth-success'); s.textContent='Reset email sent! Check your inbox.'; s.className='auth-success show';
  } catch(e) { showAuthError(ERROR_MAP[e.code]||e.message); }
}
async function handleLogout() {
  if (unsubscribe) { unsubscribe(); unsubscribe=null; }
  foods=[]; shopItems=[]; wasteLog=[];
  
  // Re-render the empty placeholder view
  if(document.getElementById('recipes-list-container')) {
    document.getElementById('recipes-list-container').innerHTML = '';
  }
  
  await auth.signOut();
}

auth.onAuthStateChanged(user => {
  currentUser = user;
  if (user) {
    document.getElementById('auth-screen').style.display='none';
    document.getElementById('app').style.display='block';
    document.getElementById('user-email').textContent=user.email;
    startListening(user.uid);
    loadLocalData();
    checkAndNotify();
    loadSettings();
  } else {
    document.getElementById('auth-screen').style.display='flex';
    document.getElementById('app').style.display='none';
    if (unsubscribe) { unsubscribe(); unsubscribe=null; }
    foods=[];
    // FIX #9 (continued): Also re-render cleared lists on auth screen shown
    renderShopList();
    renderWasteLog();
    render();
  }
});

// ── Firestore ──
function startListening(uid) {
  if (unsubscribe) unsubscribe();
  unsubscribe = db.collection('users').doc(uid).collection('foods')
    .orderBy('added','desc')
    .onSnapshot(snap => {
      foods = snap.docs.map(d=>({id:d.id,...d.data()}));
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

// ── Local data ──
function loadLocalData() {
  const uid = currentUser.uid;
  shopItems = JSON.parse(localStorage.getItem(`fk_shop_${uid}`)||'[]');
  wasteLog  = JSON.parse(localStorage.getItem(`fk_waste_${uid}`)||'[]');
  renderShopList(); renderWasteLog();
}
function saveShopItems() {
  localStorage.setItem(`fk_shop_${currentUser.uid}`, JSON.stringify(shopItems));
}
function saveWasteLog() {
  localStorage.setItem(`fk_waste_${currentUser.uid}`, JSON.stringify(wasteLog));
}

function loadSettings() {
  const uid = currentUser.uid;
  notifDays = parseInt(localStorage.getItem(`fk_notifdays_${uid}`)||'3');
  document.getElementById('notif-days').value = notifDays;
  // FIX #3: Use .onchange instead of .addEventListener to avoid stacking listeners on re-login
  document.getElementById('notif-days').onchange = e => {
    notifDays = parseInt(e.target.value)||3;
    localStorage.setItem(`fk_notifdays_${uid}`, notifDays);
  };
}

// ── Views ──
document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    
    ['pantry','shopping','waste','recipes'].forEach(v => {
      const el = document.getElementById('view-'+v);
      if (el) el.style.display = v===currentView ? '' : 'none';
    });
    
    // Explicitly hide or show the stats bar container right when clicking tabs
    const statsContainer = document.querySelector('.stats');
    if (statsContainer) {
      statsContainer.style.setProperty('display', currentView === 'pantry' ? 'grid' : 'none', 'important');
    }
    
    if (currentView==='waste') renderWasteLog();
    if (currentView==='shopping') renderShopList();
    if (currentView==='recipes') renderRecipes();
  });
});

// ── Recipes For You Logic ──
function renderRecipes() {
  const container = document.getElementById('recipes-list-container');
  if (!container) return;

  // 1. Find ingredients expiring in 7 days or less (including already expired)
  const expiringIngredients = foods.filter(f => daysLeft(f.expiry) <= 7);

  // If nothing is expiring soon, look at ALL fresh ingredients as a fallback
  const ingredientsToUse = expiringIngredients.length > 0 ? expiringIngredients : foods;

  if (ingredientsToUse.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🍳</div>
        <p>Your pantry is empty! Add some ingredients first to get recipe matches.</p>
      </div>
    `;
    return;
  }

  // 2. Extract lowercase clean names of the ingredients we need to rescue
  const availableNames = ingredientsToUse.map(f => (f.name || '').toLowerCase().trim());

  // 3. Define a local database of versatile, common household recipes
  const RECIPE_DATABASE = [
    {
      name: "Ultimate Pantry Fried Rice",
      keywords: ["rice", "egg", "carrot", "garlic", "onion", "meat", "chicken", "broccoli", "produce"],
      emoji: "🍛",
      instructions: "Sauté garlic and onions, toss in chopped proteins/veggies, add cooked rice and a splash of soy sauce, then scramble an egg right into the pan."
    },
    {
      name: "Rescue-Mission Omelette",
      keywords: ["egg", "cheese", "milk", "tomato", "spinach", "onion", "mushroom", "meat", "dairy"],
      emoji: "🍳",
      instructions: "Whisk your eggs with a splash of milk, pour into a hot buttery skillet, and fold in any expiring cheeses, meats, or vegetables."
    },
    {
      name: "Clear-The-Fridge Vegetable Soup",
      keywords: ["carrot", "tomato", "broccoli", "onion", "garlic", "potato", "celery", "cabbage", "produce"],
      emoji: "🥣",
      instructions: "Chop all remaining vegetables. Simmer them in a pot with water or broth and household seasonings until everything is tender."
    },
    {
      name: "Crispy Sheet-Pan Stir Fry / Hash",
      keywords: ["meat", "beef", "chicken", "broccoli", "carrot", "potato", "onion", "produce"],
      emoji: "Ⓥ",
      instructions: "Dice your meat and hardy veggies, toss in oil and spices, and roast on a baking sheet at 200°C until crispy and golden."
    },
    {
      name: "Pantry Pasta Aglio e Olio / Marinara",
      keywords: ["pasta", "spaghetti", "garlic", "tomato", "cheese", "onion"],
      emoji: "🍝",
      instructions: "Boil pasta. Sauté garlic in plenty of olive oil (or simmer chopped tomatoes down into a sauce), mix together, and top with cheese."
    }
  ];

  // 4. Score recipes based on how many expiring items match their keywords
  const scoredRecipes = RECIPE_DATABASE.map(recipe => {
    // Count how many expiring ingredients match this recipe's keywords
    const matches = availableNames.filter(foodName => 
      recipe.keywords.some(keyword => foodName.includes(keyword))
    );
    return { ...recipe, matchCount: matches.length, matchedIngredients: matches };
  });

  // 5. Sort to put the recipes with the highest match counts at the top
  scoredRecipes.sort((a, b) => b.matchCount - a.matchCount);

  // 6. Generate the HTML layout
  const titleHtml = expiringIngredients.length > 0 
    ? `<div class="recipe-status-alert">⚠️ Prioritizing recipes using <strong>${expiringIngredients.length} expiring item(s)</strong>!</div>`
    : `<div class="recipe-status-alert fresh">💡 Everything is fresh! Here are recipes matching your general pantry:</div>`;

  const cardsHtml = scoredRecipes.map(r => {
    // Create tags showcasing what expiring food is being successfully rescued
    const matchTags = r.matchCount > 0 
      ? `<div class="recipe-matches">✨ Uses your: ${r.matchedIngredients.map(m => `<span class="match-tag">${m}</span>`).join('')}</div>`
      : `<div class="recipe-matches none">No direct matches, but great for staples!</div>`;

    return `
      <div class="recipe-card">
        <div class="recipe-header">
          <span class="recipe-emoji">${r.emoji}</span>
          <div class="recipe-title-block">
            <h4 class="recipe-name">${r.name}</h4>
          </div>
        </div>
        ${matchTags}
        <p class="recipe-instructions"><strong>How to cook:</strong> ${r.instructions}</p>
      </div>
    `;
  }).join('');

  container.innerHTML = titleHtml + `<div class="recipes-grid">${cardsHtml}</div>`;
}

// ── Main Render ──
function render() {
  const expired = foods.filter(f=>daysLeft(f.expiry)<0).length;
  const soon    = foods.filter(f=>{const d=daysLeft(f.expiry);return d>=0&&d<=notifDays;}).length;
  const wasted  = wasteLog.length;
  
  // Update numerical text contents safely
  if (document.getElementById('stat-total')) document.getElementById('stat-total').textContent = foods.length;
  if (document.getElementById('stat-expired')) document.getElementById('stat-expired').textContent = expired;
  if (document.getElementById('stat-soon')) document.getElementById('stat-soon').textContent = soon;
  if (document.getElementById('stat-wasted')) document.getElementById('stat-wasted').textContent = wasted;

  // SAFETY FIX: Prevents incoming database syncs from forcing the stats boxes back into view on other tabs
  const statsContainer = document.querySelector('.stats');
  if (statsContainer) {
    statsContainer.style.setProperty('display', currentView === 'pantry' ? 'grid' : 'none', 'important');
  }

  let list = foods.filter(f => {
    const matchLoc = filter==='all'||f.location===filter;
    const matchCat = catFilter==='all'||(f.category||'other')===catFilter;
    // FIX #5: Guard against missing name/note fields to avoid toLowerCase() crash
    const matchQ   = (f.name||'').toLowerCase().includes(query.toLowerCase())||(f.note||'').toLowerCase().includes(query.toLowerCase());
    return matchLoc && matchCat && matchQ;
  });

  if (sortBy==='expiry') list.sort((a,b)=>daysLeft(a.expiry)-daysLeft(b.expiry));
  else if (sortBy==='name') list.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  else list.sort((a,b)=>{
    const ta = a.added?.toDate?.()?.getTime()||0;
    const tb = b.added?.toDate?.()?.getTime()||0;
    return tb-ta;
  });

  const container = document.getElementById('food-container');
  if (list.length===0) {
    container.innerHTML=`<div class="empty"><div class="empty-icon">🧺</div><p>${query?'No matching ingredients found':'No ingredients yet — click ＋ Add to get started!'}</p></div>`;
    return;
  }

  const groups = [
    { label:'⚠️ Expired', cls:'expired-card', items: list.filter(f=>daysLeft(f.expiry)<0) },
    { label:'🔔 Expiring Soon', cls:'soon-card', items: list.filter(f=>{const d=daysLeft(f.expiry);return d>=0&&d<=notifDays;}) },
    { label:'✅ Fresh', cls:'', items: list.filter(f=>daysLeft(f.expiry)>notifDays) },
  ].filter(g=>g.items.length>0);

  container.innerHTML = groups.map(g=>`
    <div class="section-label">${g.label} (${g.items.length})</div>
    <div class="food-list">${g.items.map(f=>foodCardHTML(f,g.cls)).join('')}</div>
  `).join('');

  container.querySelectorAll('.food-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.action-btn')) return;
      if (bulkMode) {
        const id = card.dataset.id;
        if (selectedIds.has(id)) { selectedIds.delete(id); card.classList.remove('selected'); card.querySelector('.food-select').textContent=''; }
        else { selectedIds.add(id); card.classList.add('selected'); card.querySelector('.food-select').textContent='✓'; }
        updateBulkBar();
      }
    });
  });
  container.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', async e => { e.stopPropagation();
      if (confirm(`Delete "${btn.dataset.name}"?`)) { await deleteFood(btn.dataset.id); toast('Deleted'); }
    });
  });
  container.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openEditModal(btn.dataset.id); });
  });
  container.querySelectorAll('.used-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); markUsed(btn.dataset.id, btn.dataset.name, btn.dataset.emoji); });
  });
  container.querySelectorAll('.waste-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); logWasteItem(btn.dataset.id, btn.dataset.name, btn.dataset.emoji); });
  });

  if (bulkMode) {
    container.querySelectorAll('.food-card').forEach(card => {
      if (selectedIds.has(card.dataset.id)) {
        card.classList.add('selected');
        card.querySelector('.food-select').textContent='✓';
      }
    });
  }
}

function foodCardHTML(f, extraCls='') {
  const days  = daysLeft(f.expiry);
  const badge = badgeInfo(days);
  const cat   = f.category||'other';
  const meta  = [LOC_ICON[f.location]+' '+LOC_LABEL[f.location], f.note].filter(Boolean).join(' · ');
  const selectHtml = bulkMode ? `<div class="food-select"></div>` : `<div class="food-select-hidden"></div>`;
  const qtyHtml = f.qty ? `<span class="qty-badge">${f.qty}</span>` : '';
  return `<div class="food-card ${extraCls}" data-id="${f.id}">
    ${selectHtml}
    <div class="food-emoji">${f.emoji||'🍽'}</div>
    <div class="food-info">
      <div class="food-name">${f.name||'Unnamed'}</div>
      <div class="food-meta">
        <span>${meta}</span>
        <span class="food-cat-tag">${CAT_ICON[cat]} ${CAT_LABEL[cat]}</span>
        <span>Exp: ${fmtDate(f.expiry)}</span>
      </div>
    </div>
    <div class="food-right">
      <span class="badge ${badge.cls}">${badge.text}</span>
      ${qtyHtml}
      <div class="food-actions">
        <button class="action-btn used-btn" data-id="${f.id}" data-name="${f.name||''}" data-emoji="${f.emoji||'🍽'}" title="Mark as used ✓">✓</button>
        <button class="action-btn waste-btn" data-id="${f.id}" data-name="${f.name||''}" data-emoji="${f.emoji||'🍽'}" title="Log as wasted">🗑</button>
        <button class="action-btn edit-btn" data-id="${f.id}" title="Edit">✏️</button>
        <button class="action-btn del-btn" data-id="${f.id}" data-name="${f.name||''}" title="Delete">✕</button>
      </div>
    </div>
  </div>`;
}

async function markUsed(id, name, emoji) {
  await deleteFood(id);
  confetti();
  toast(`${emoji} ${name} — used up! Great job! 🎉`);
}

// ── Waste ──
async function logWasteItem(id, name, emoji) {
  if (!confirm(`Log "${name}" as wasted?`)) return;
  wasteLog.unshift({ name, emoji, date: new Date().toISOString() });
  saveWasteLog();
  await deleteFood(id);
  document.getElementById('stat-wasted').textContent = wasteLog.length;
  // FIX #6: Re-render waste log immediately so it updates even if waste tab is visible
  renderWasteLog();
  toast(`Logged ${name} as wasted`);
}

function renderWasteLog() {
  const now = new Date();
  const thisMonth = wasteLog.filter(w => {
    const d = new Date(w.date);
    return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
  });
  document.getElementById('waste-month-count').textContent = thisMonth.length;
  document.getElementById('waste-total-count').textContent = wasteLog.length;

  const container = document.getElementById('waste-list-container');
  if (wasteLog.length===0) {
    container.innerHTML='<div class="empty"><div class="empty-icon">🌱</div><p>No waste logged — keep it up!</p></div>';
    return;
  }
  container.innerHTML = wasteLog.map((w) => `
    <div class="waste-item">
      <span>${w.emoji}</span>
      <span>${w.name}</span>
      <span class="waste-item-date">${fmtDateFull(w.date)}</span>
    </div>
  `).join('');
}

// ── Shopping list ──
function renderShopList() {
  const container = document.getElementById('shop-list-container');
  if (shopItems.length===0) {
    container.innerHTML='<div class="empty" style="padding:2rem 1rem;"><div class="empty-icon">🛒</div><p>Shopping list is empty</p></div>';
    return;
  }
  container.innerHTML = shopItems.map((item,i) => `
    <div class="shop-item">
      <div class="shop-check ${item.checked?'checked':''}" onclick="toggleShopCheck(${i})">${item.checked?'✓':''}</div>
      <span class="shop-name ${item.checked?'done':''}">${item.name}</span>
      <button class="shop-del" onclick="removeShopItem(${i})">✕</button>
    </div>
  `).join('');
}
function addShopItem() {
  const inp = document.getElementById('shop-input');
  const val = inp.value.trim();
  if (!val) return;
  shopItems.push({ name:val, checked:false });
  saveShopItems(); inp.value='';
  renderShopList();
}
function toggleShopCheck(i) {
  shopItems[i].checked = !shopItems[i].checked;
  saveShopItems(); renderShopList();
}
function removeShopItem(i) {
  shopItems.splice(i,1);
  saveShopItems(); renderShopList();
}
function clearChecked() {
  shopItems = shopItems.filter(i=>!i.checked);
  saveShopItems(); renderShopList(); toast('Cleared checked items');
}
function exportShopList() {
  const text = shopItems.map(i=>(i.checked?'[✓] ':' - ')+i.name).join('\n');
  // FIX #7: Clipboard API fallback for non-HTTPS environments
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text)
      .then(()=>toast('Shopping list copied!'))
      .catch(()=>fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); toast('Shopping list copied!'); }
  catch(e) { toast('Could not copy — try HTTPS'); }
  document.body.removeChild(ta);
}
document.getElementById('shop-input').addEventListener('keydown', e => { if(e.key==='Enter') addShopItem(); });

// ── Bulk mode ──
function toggleBulkMode() {
  bulkMode = !bulkMode;
  selectedIds.clear();
  const btn = document.getElementById('bulk-toggle-btn');
  btn.classList.toggle('active', bulkMode);
  btn.textContent = bulkMode ? '✕ Cancel' : '☑️ Select';
  document.getElementById('bulk-bar').classList.toggle('show', false);
  render();
}
function updateBulkBar() {
  const bar = document.getElementById('bulk-bar');
  const label = document.getElementById('bulk-label');
  if (selectedIds.size>0) { bar.classList.add('show'); label.textContent=`${selectedIds.size} selected`; }
  else { bar.classList.remove('show'); }
}
async function bulkDelete() {
  if (!selectedIds.size) return;
  if (!confirm(`Delete ${selectedIds.size} items?`)) return;
  await Promise.all([...selectedIds].map(id=>deleteFood(id)));
  toast(`Deleted ${selectedIds.size} items`);
  selectedIds.clear(); toggleBulkMode();
}
async function bulkMove(location) {
  if (!selectedIds.size) return;
  await Promise.all([...selectedIds].map(id=>updateFood(id,{location})));
  toast(`Moved ${selectedIds.size} items to ${LOC_LABEL[location]}`);
  selectedIds.clear(); toggleBulkMode();
}
async function bulkWaste() {
  if (!selectedIds.size) return;
  if (!confirm(`Log ${selectedIds.size} items as wasted?`)) return;
  const items = foods.filter(f=>selectedIds.has(f.id));
  items.forEach(f => wasteLog.unshift({ name:f.name, emoji:f.emoji||'🍽', date:new Date().toISOString() }));
  saveWasteLog();
  await Promise.all([...selectedIds].map(id=>deleteFood(id)));
  toast(`Logged ${selectedIds.size} items as wasted`);
  selectedIds.clear(); toggleBulkMode(); renderWasteLog();
}

// ── Modal ──
function buildEmojiPicker(selected) {
  document.getElementById('emoji-picker').innerHTML = ALL_EMOJIS.map(e=>`
    <button type="button" class="emoji-opt ${e===selected?'sel':''}" onclick="selectEmoji('${e}')">${e}</button>
  `).join('');
}
function selectEmoji(e) {
  document.querySelectorAll('.emoji-opt').forEach(b=>b.classList.toggle('sel', b.textContent===e));
}
function getSelectedEmoji() {
  const sel = document.querySelector('.emoji-opt.sel');
  return sel ? sel.textContent : '🍽';
}

function openModal() {
  editingId = null;
  document.getElementById('modal-title').textContent = '✏️ Add Ingredient';
  document.getElementById('input-name').value = '';
  document.getElementById('input-qty').value  = '';
  document.getElementById('input-note').value = '';
  document.getElementById('input-location').value  = 'fridge';
  document.getElementById('input-category').value  = 'other';
  document.getElementById('input-expiry').value    = today();
  // FIX #1: Removed references to non-existent #ai-expiry-suggest element
  document.getElementById('save-btn').textContent='Save';
  buildEmojiPicker('🥬');
  document.getElementById('overlay').classList.add('open');
  setTimeout(()=>document.getElementById('input-name').focus(),80);
}
function openEditModal(id) {
  const f = foods.find(x=>x.id===id);
  if (!f) return;
  editingId = id;
  document.getElementById('modal-title').textContent = '✏️ Edit Ingredient';
  document.getElementById('input-name').value     = f.name;
  document.getElementById('input-qty').value      = f.qty||'';
  document.getElementById('input-note').value     = f.note||'';
  document.getElementById('input-location').value = f.location||'fridge';
  document.getElementById('input-category').value = f.category||'other';
  document.getElementById('input-expiry').value   = f.expiry;
  // FIX #1: Removed references to non-existent #ai-expiry-suggest element
  document.getElementById('save-btn').textContent='Update';
  buildEmojiPicker(f.emoji||'🥬');
  document.getElementById('overlay').classList.add('open');
  setTimeout(()=>document.getElementById('input-name').focus(),80);
}
function closeModal() { document.getElementById('overlay').classList.remove('open'); }

document.getElementById('open-modal').addEventListener('click', openModal);
document.getElementById('close-modal').addEventListener('click', closeModal);
document.getElementById('close-modal-2').addEventListener('click', closeModal);
document.getElementById('overlay').addEventListener('click', e => { if(e.target===document.getElementById('overlay')) closeModal(); });
document.addEventListener('keydown', e => { if(e.key==='Escape') { closeModal(); closePanel(); } });

document.getElementById('save-btn').addEventListener('click', async () => {
  const name     = document.getElementById('input-name').value.trim();
  const expiry   = document.getElementById('input-expiry').value;
  const location = document.getElementById('input-location').value;
  const category = document.getElementById('input-category').value;
  const qty      = document.getElementById('input-qty').value.trim();
  const note     = document.getElementById('input-note').value.trim();
  const emoji    = getSelectedEmoji();
  if (!name)   { toast('Please enter a food name'); return; }
  if (!expiry) { toast('Please select an expiry date'); return; }
  const btn = document.getElementById('save-btn');
  btn.disabled=true; btn.textContent='Saving…';
  try {
    if (editingId) {
      await updateFood(editingId, { name, location, category, expiry, qty, note, emoji });
      toast('Updated!');
    } else {
      await addFood({ name, location, category, expiry, qty, note, emoji });
      toast('Added!');
    }
    closeModal();
  } catch(e) { toast('Save failed: '+e.message); }
  btn.disabled=false; btn.textContent=editingId?'Update':'Save';
});

// ── Filter tabs ──
document.getElementById('filter-tabs').addEventListener('click', e => {
  const t = e.target.closest('[data-filter]');
  if (!t) return;
  filter = t.dataset.filter;
  document.querySelectorAll('.ftab').forEach(b=>b.classList.remove('active'));
  t.classList.add('active');
  render();
});
document.getElementById('cat-pills').addEventListener('click', e => {
  const t = e.target.closest('[data-cat]');
  if (!t) return;
  catFilter = t.dataset.cat;
  document.querySelectorAll('.cat-pill').forEach(b=>b.classList.remove('active'));
  t.classList.add('active');
  render();
});
document.getElementById('search').addEventListener('input', e => { query=e.target.value.trim(); render(); });
document.getElementById('sort-select').addEventListener('change', e => { sortBy=e.target.value; render(); });

// ── Panels ──
function openPanel(name) {
  document.getElementById('panel-overlay').classList.add('open');
  document.getElementById('panel-'+name).classList.add('open');
}
function closePanel() {
  document.getElementById('panel-overlay').classList.remove('open');
  document.querySelectorAll('.side-panel').forEach(p=>p.classList.remove('open'));
}

// ── Settings ──
function toggleNotif() {
  const t = document.getElementById('notif-toggle');
  const isOn = t.classList.contains('on');
  if (!isOn) {
    if (!('Notification' in window)) { toast('Notifications not supported in this browser'); return; }
    Notification.requestPermission().then(r => {
      if (r==='granted') { t.classList.add('on'); t.classList.remove('off'); toast('Notifications enabled!'); }
      else { toast('Permission denied'); }
    });
  } else { t.classList.remove('on'); t.classList.add('off'); }
}

function exportCSV() {
  const header = ['Name','Category','Location','Expiry','Quantity','Notes','Days Left'];
  const rows = foods.map(f=>[
    `"${f.name||''}"`,`"${CAT_LABEL[f.category||'other']}"`,`"${LOC_LABEL[f.location]}"`,
    f.expiry,`"${f.qty||''}"`,`"${f.note||''}"`,daysLeft(f.expiry)
  ]);
  const csv = [header,...rows].map(r=>r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download = 'food-keeper-export.csv';
  a.click();
  toast('CSV exported!');
}

// ── Notifications ──
const NOTIF_KEY = 'foodkeeper_notif_date';
function sendNotifications() {
  // FIX #4: Guard permission before creating Notification objects
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const expired = foods.filter(f=>daysLeft(f.expiry)<0);
  const today_  = foods.filter(f=>daysLeft(f.expiry)===0);
  const soon_   = foods.filter(f=>{const d=daysLeft(f.expiry);return d>0&&d<=notifDays;});
  try {
    if (expired.length) new Notification('🗑️ Food Keeper — Expired',{body:expired.map(f=>f.emoji+' '+f.name).join(', ')+' has expired!'});
    if (today_.length)  new Notification('⚠️ Food Keeper — Expiring Today',{body:today_.map(f=>f.emoji+' '+f.name).join(', ')+' expires today!'});
    if (soon_.length)   new Notification('🔔 Food Keeper — Expiring Soon',{body:soon_.map(f=>f.emoji+' '+f.name).join(', ')+' expiring soon!'});
    localStorage.setItem(NOTIF_KEY, new Date().toDateString());
  } catch(e) { console.warn('Notification error:', e); }
}
function checkAndNotify() {
  if (!('Notification' in window)) return;
  const perm = Notification.permission;
  const alreadyToday = localStorage.getItem(NOTIF_KEY)===new Date().toDateString();
  const notifToggle = document.getElementById('notif-toggle');
  if (perm==='granted') {
    notifToggle.classList.add('on'); notifToggle.classList.remove('off');
    if (!alreadyToday) setTimeout(sendNotifications, 2000);
  } else if (perm==='default') {
    const banner=document.getElementById('notif-banner');
    const text=document.getElementById('notif-text');
    const btn=document.getElementById('notif-action-btn');
    banner.className='notif-banner show';
    text.innerHTML='Enable notifications to be alerted when ingredients are expiring.';
    btn.textContent='Enable'; btn.style.display='';
    btn.onclick=async()=>{
      const r=await Notification.requestPermission();
      if (r==='granted') {
        banner.className='notif-banner show granted';
        document.getElementById('notif-icon').textContent='✅';
        text.innerHTML='<strong>Notifications enabled!</strong>';
        btn.style.display='none';
        notifToggle.classList.add('on'); notifToggle.classList.remove('off');
        sendNotifications();
      } else {
        banner.className='notif-banner show denied';
        document.getElementById('notif-icon').textContent='🔕';
        text.innerHTML='Notifications denied. Enable in browser settings.';
        btn.style.display='none';
      }
    };
  }
}
document.getElementById('notif-close').addEventListener('click',()=>{
  document.getElementById('notif-banner').className='notif-banner';
});

['auth-email','auth-password','auth-confirm'].forEach(id=>{
  document.getElementById(id).addEventListener('keydown',e=>{if(e.key==='Enter')handleAuth();});
});
