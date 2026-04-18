// =============================================
// WORDVAULT — app.js
// Klistra in dina Supabase-uppgifter här:
// =============================================
const SUPABASE_URL = "PASTE_YOUR_SUPABASE_URL_HERE";
const SUPABASE_ANON_KEY = "PASTE_YOUR_SUPABASE_ANON_KEY_HERE";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =============================================
// State
// =============================================
let currentUser = null; // { id, username } or null = guest

// =============================================
// Init
// =============================================
document.addEventListener("DOMContentLoaded", () => {
  const saved = localStorage.getItem("wv_user");
  if (saved) {
    try { currentUser = JSON.parse(saved); } catch {}
  }

  updateAuthUI();
  loadHeaderStats();

  if (!currentUser && !localStorage.getItem("wv_guest_ok")) {
    openAuthModal();
  }

  document.getElementById("wordInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitWord();
  });
});

// =============================================
// Auth UI
// =============================================
function updateAuthUI() {
  const area = document.getElementById("authArea");
  if (currentUser) {
    area.innerHTML = `
      <div class="user-info">
        <span class="user-name">👤 ${escapeHtml(currentUser.username)}</span>
        <button class="auth-btn secondary" onclick="logoutUser()">Log out</button>
      </div>`;
    loadCloudTrophies();
  } else {
    area.innerHTML = `<button class="auth-btn" onclick="openAuthModal()">Log in / Sign up</button>`;
  }
}

// =============================================
// Auth modal
// =============================================
function openAuthModal() {
  document.getElementById("authModal").classList.add("open");
}

function closeAuthModal() {
  document.getElementById("authModal").classList.remove("open");
}

function switchTab(tab) {
  document.getElementById("loginForm").style.display = tab === "login" ? "block" : "none";
  document.getElementById("registerForm").style.display = tab === "register" ? "block" : "none";
  document.getElementById("tabLogin").classList.toggle("active", tab === "login");
  document.getElementById("tabRegister").classList.toggle("active", tab === "register");
  document.getElementById("loginError").textContent = "";
  document.getElementById("registerError").textContent = "";
}

function continueAsGuest() {
  localStorage.setItem("wv_guest_ok", "1");
  closeAuthModal();
  renderLocalTrophies();
}

// =============================================
// Register
// =============================================
async function registerUser() {
  const username = document.getElementById("regUsername").value.trim();
  const password = document.getElementById("regPassword").value;
  const password2 = document.getElementById("regPassword2").value;
  const errEl = document.getElementById("registerError");

  if (!username || !password) { errEl.textContent = "Fill in all fields."; return; }
  if (password !== password2) { errEl.textContent = "Passwords don't match."; return; }
  if (password.length < 6) { errEl.textContent = "Password must be at least 6 characters."; return; }

  errEl.textContent = "Creating account...";

  const { data, error } = await db.rpc("register_user", {
    p_username: username,
    p_password: password
  });

  if (error || data?.error) {
    errEl.textContent = data?.error || "Something went wrong.";
    return;
  }

  currentUser = { id: data.id, username: data.username };
  localStorage.setItem("wv_user", JSON.stringify(currentUser));
  localStorage.removeItem("wv_guest_ok");

  await migrateGuestTrophies();
  updateAuthUI();
  closeAuthModal();
}

// =============================================
// Login
// =============================================
async function loginUser() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");

  if (!username || !password) { errEl.textContent = "Fill in all fields."; return; }

  errEl.textContent = "Logging in...";

  const { data, error } = await db.rpc("login_user", {
    p_username: username,
    p_password: password
  });

  if (error || data?.error) {
    errEl.textContent = data?.error || "Something went wrong.";
    return;
  }

  currentUser = { id: data.id, username: data.username };
  localStorage.setItem("wv_user", JSON.stringify(currentUser));
  localStorage.removeItem("wv_guest_ok");

  await migrateGuestTrophies();
  updateAuthUI();
  closeAuthModal();
}

// =============================================
// Logout
// =============================================
function logoutUser() {
  currentUser = null;
  localStorage.removeItem("wv_user");
  localStorage.setItem("wv_guest_ok", "1");
  updateAuthUI();
  renderTrophies([]);
  updateTrophyBadge(0);
}

// =============================================
// Migrate guest trophies to account on login/register
// =============================================
async function migrateGuestTrophies() {
  const local = JSON.parse(localStorage.getItem("wv_trophies") || "[]");
  if (!local.length || !currentUser) return;

  for (const t of local) {
    await db.rpc("add_trophy", { p_profile_id: currentUser.id, p_word: t.word });
  }
  localStorage.removeItem("wv_trophies");
}

// =============================================
// Submit word
// =============================================
async function submitWord() {
  const input = document.getElementById("wordInput");
  const btn = document.getElementById("submitBtn");
  const word = input.value.trim().toLowerCase();

  if (!word) return;

  if (!/^[a-z]+$/.test(word)) {
    showResult("error", "Only letters please, no spaces or numbers.", "");
    return;
  }

  btn.disabled = true;
  input.disabled = true;
  showLoading();

  try {
    const isReal = await checkRealWord(word);
    if (!isReal) {
      showResult("error", `"${word}" is not a valid English word.`, "Try another word!");
      return;
    }

    const count = await recordWord(word);

    if (count === 0) {
      showResult("first", `You were the first person to write "${word}"! 🏆`, "A trophy has been added to your Trophy Room.");
      await addTrophy(word);
    } else if (count === 1) {
      showResult("nth", `One person wrote "${word}" before you.`, "So close — keep looking for unclaimed words!");
    } else {
      showResult("nth", `${count.toLocaleString()} people wrote "${word}" before you.`, "Keep hunting for unclaimed words!");
    }

    input.value = "";
    loadHeaderStats();
  } catch (err) {
    showResult("error", "Something went wrong. Please try again.", err.message || "");
    console.error(err);
  } finally {
    btn.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

// =============================================
// Dictionary check
// =============================================
async function checkRealWord(word) {
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    return res.ok;
  } catch {
    return true;
  }
}

// =============================================
// Record word
// =============================================
async function recordWord(word) {
  const { data, error } = await db.rpc("submit_word", { p_word: word });
  if (error) throw new Error(error.message);
  return data;
}

// =============================================
// Trophies
// =============================================
async function addTrophy(word) {
  if (currentUser) {
    await db.rpc("add_trophy", { p_profile_id: currentUser.id, p_word: word });
    await loadCloudTrophies();
  } else {
    const local = JSON.parse(localStorage.getItem("wv_trophies") || "[]");
    if (!local.find(t => t.word === word)) {
      local.unshift({
        word,
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      });
      localStorage.setItem("wv_trophies", JSON.stringify(local));
    }
    renderLocalTrophies();
  }
}

async function loadCloudTrophies() {
  if (!currentUser) return;
  const { data } = await db
    .from("user_trophies")
    .select("word, created_at")
    .eq("profile_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (!data) return;
  const trophies = data.map(t => ({
    word: t.word,
    date: new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  }));
  renderTrophies(trophies);
  updateTrophyBadge(trophies.length);
  document.getElementById("trophyDesc").textContent = "Words you discovered first.";
}

function renderLocalTrophies() {
  const local = JSON.parse(localStorage.getItem("wv_trophies") || "[]");
  renderTrophies(local);
  updateTrophyBadge(local.length);
  if (local.length > 0) {
    document.getElementById("trophyDesc").innerHTML =
      `Words you discovered first. <span style="color:var(--gold);font-size:12px;">Log in to save permanently!</span>`;
  }
}

function renderTrophies(trophies) {
  const grid = document.getElementById("trophiesGrid");
  if (!trophies || trophies.length === 0) {
    grid.innerHTML = '<p class="empty-msg">No trophies yet — be the first to submit a new word!</p>';
    return;
  }
  grid.innerHTML = trophies.map(t => `
    <div class="trophy-card">
      <span class="t-icon">🏆</span>
      <span class="t-word">${escapeHtml(t.word)}</span>
      <span class="t-date">${t.date}</span>
    </div>
  `).join("");
}

function updateTrophyBadge(count) {
  document.getElementById("trophyBadge").textContent = count;
}

// =============================================
// Leaderboard
// =============================================
async function openLeaderboard() {
  document.getElementById("leaderboardPanel").classList.add("open");
  document.getElementById("overlay").classList.add("open");

  const { data } = await db
    .from("leaderboard")
    .select("username, trophy_count")
    .order("trophy_count", { ascending: false })
    .limit(20);

  const list = document.getElementById("leaderboardList");
  if (!data || data.length === 0) {
    list.innerHTML = '<p class="empty-msg">No entries yet — be the first!</p>';
    return;
  }

  list.innerHTML = data.map((row, i) => `
    <div class="lb-row ${currentUser?.username === row.username ? "lb-me" : ""}">
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${escapeHtml(row.username)}</span>
      <span class="lb-count">🏆 ${row.trophy_count}</span>
    </div>
  `).join("");
}

// =============================================
// Stats bar (header numbers)
// =============================================
async function loadHeaderStats() {
  try {
    const { data } = await db.rpc("get_stats");
    if (!data) return;
    document.getElementById("statWords").textContent = Number(data.unique_words).toLocaleString();
    document.getElementById("statSubmissions").textContent = Number(data.total_submissions).toLocaleString();
  } catch {}
}

// =============================================
// Panels
// =============================================
function openTrophyRoom() {
  if (!currentUser) renderLocalTrophies();
  document.getElementById("trophyRoom").classList.add("open");
  document.getElementById("overlay").classList.add("open");
}

function closeAll() {
  document.getElementById("trophyRoom").classList.remove("open");
  document.getElementById("leaderboardPanel").classList.remove("open");
  document.getElementById("statsPanel").classList.remove("open");
  document.getElementById("overlay").classList.remove("open");
}

// =============================================
// Stats panel
// =============================================
async function openStats() {
  document.getElementById("statsPanel").classList.add("open");
  document.getElementById("overlay").classList.add("open");

  // Top 10 most submitted words
  const { data: topWords } = await db
    .from("words")
    .select("word, count")
    .order("count", { ascending: false })
    .limit(10);

  const topEl = document.getElementById("topWordsList");
  if (!topWords || topWords.length === 0) {
    topEl.innerHTML = '<p class="empty-msg">No data yet.</p>';
  } else {
    const max = topWords[0].count;
    topEl.innerHTML = topWords.map((row, i) => `
      <div class="stats-row">
        <span class="stats-rank">${i + 1}</span>
        <div class="stats-word-wrap">
          <div class="stats-word-top">
            <span class="stats-word">${escapeHtml(row.word)}</span>
            <span class="stats-count">${Number(row.count).toLocaleString()}x</span>
          </div>
          <div class="stats-bar-bg">
            <div class="stats-bar-fill" style="width:${Math.round((row.count / max) * 100)}%"></div>
          </div>
        </div>
      </div>
    `).join("");
  }

  // Latest first discoveries (words with count = 1, newest first)
  const { data: latest } = await db
    .from("words")
    .select("word, created_at")
    .eq("count", 1)
    .order("created_at", { ascending: false })
    .limit(10);

  const latestEl = document.getElementById("latestFirstsList");
  if (!latest || latest.length === 0) {
    latestEl.innerHTML = '<p class="empty-msg">No first discoveries yet.</p>';
  } else {
    latestEl.innerHTML = latest.map(row => `
      <div class="stats-row">
        <span class="stats-word">${escapeHtml(row.word)}</span>
        <span class="stats-time">${timeAgo(row.created_at)}</span>
      </div>
    `).join("");
  }
}

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// =============================================
// Result display
// =============================================
function showLoading() {
  const area = document.getElementById("resultArea");
  area.innerHTML = `<div class="result-box loading"><div class="result-main loading-dots">Checking<span>.</span><span>.</span><span>.</span></div></div>`;
  area.classList.add("visible");
}

function showResult(type, main, sub) {
  const area = document.getElementById("resultArea");
  area.innerHTML = `
    <div class="result-box ${type}">
      <div class="result-main">${escapeHtml(main)}</div>
      ${sub ? `<div class="result-sub">${escapeHtml(sub)}</div>` : ""}
    </div>`;
  area.classList.add("visible");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
