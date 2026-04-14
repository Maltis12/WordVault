// =============================================
// WORDVAULT — app.js
// Byt ut dessa två rader mot dina egna Supabase-uppgifter
// =============================================
const SUPABASE_URL = "https://phqoafevszhkuxhfjdqi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBocW9hZmV2c3poa3V4aGZqZHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMTgwMzcsImV4cCI6MjA5MTY5NDAzN30.xrvR8jFxpJ9nzuhXMgxyJgKnZC_jhg6MQ6ddZSmpOJc";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =============================================
// State
// =============================================
let myTrophies = JSON.parse(localStorage.getItem("wv_trophies") || "[]");

// =============================================
// Init
// =============================================
document.addEventListener("DOMContentLoaded", () => {
  renderTrophies();
  updateTrophyBadge();
  loadStats();

  document.getElementById("wordInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitWord();
  });
});

// =============================================
// Submit word
// =============================================
async function submitWord() {
  const input = document.getElementById("wordInput");
  const btn = document.getElementById("submitBtn");
  const word = input.value.trim().toLowerCase();

  if (!word) return;

  // Basic validation — only letters
  if (!/^[a-z]+$/.test(word)) {
    showResult("error", "Only letters please, no spaces or numbers.", "");
    return;
  }

  // Disable UI while loading
  btn.disabled = true;
  input.disabled = true;
  showLoading();

  try {
    // Step 1: Check if it's a real English word
    const isReal = await checkRealWord(word);
    if (!isReal) {
      showResult("error", `"${word}" is not a valid English word.`, "Try another word!");
      return;
    }

    // Step 2: Submit to Supabase and get count
    const count = await recordWord(word);

    if (count === 0) {
      // First person!
      showResult("first", `You were the first person to write "${word}"! 🏆`, "A trophy has been added to your Trophy Room.");
      addTrophy(word);
    } else if (count === 1) {
      showResult("nth", `One person wrote "${word}" before you.`, "So close — keep looking for unclaimed words!");
    } else {
      showResult("nth", `${count.toLocaleString()} ${count === 1 ? "person" : "people"} wrote "${word}" before you.`, "Keep hunting for unclaimed words!");
    }

    input.value = "";
    loadStats(); // refresh stats
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
// Check real English word via Free Dictionary API
// =============================================
async function checkRealWord(word) {
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    return res.ok; // 200 = real word, 404 = not found
  } catch {
    // If the API is down, let it through (fail open)
    return true;
  }
}

// =============================================
// Record word in Supabase, return count BEFORE this submission
// Uses a Postgres RPC function to atomically increment
// =============================================
async function recordWord(word) {
  const { data, error } = await db.rpc("submit_word", { p_word: word });
  if (error) throw new Error(error.message);
  return data; // returns the count BEFORE this submission (0 = first)
}

// =============================================
// Load global stats
// =============================================
async function loadStats() {
  try {
    const { data, error } = await db.rpc("get_stats");
    if (error || !data) return;
    document.getElementById("statWords").textContent = Number(data.unique_words).toLocaleString();
    document.getElementById("statSubmissions").textContent = Number(data.total_submissions).toLocaleString();
    document.getElementById("statFirsts").textContent = Number(data.unclaimed_words).toLocaleString();
  } catch {}
}

// =============================================
// Trophy helpers
// =============================================
function addTrophy(word) {
  const alreadyHave = myTrophies.find(t => t.word === word);
  if (alreadyHave) return;

  const trophy = {
    word,
    date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  };
  myTrophies.unshift(trophy);
  localStorage.setItem("wv_trophies", JSON.stringify(myTrophies));
  renderTrophies();
  updateTrophyBadge();
}

function renderTrophies() {
  const grid = document.getElementById("trophiesGrid");
  if (myTrophies.length === 0) {
    grid.innerHTML = '<p class="empty-msg">No trophies yet — be the first to submit a new word!</p>';
    return;
  }
  grid.innerHTML = myTrophies.map(t => `
    <div class="trophy-card">
      <span class="t-icon">🏆</span>
      <span class="t-word">${escapeHtml(t.word)}</span>
      <span class="t-date">${t.date}</span>
    </div>
  `).join("");
}

function updateTrophyBadge() {
  document.getElementById("trophyBadge").textContent = myTrophies.length;
}

// =============================================
// Trophy room open/close
// =============================================
function openTrophyRoom() {
  document.getElementById("trophyRoom").classList.add("open");
  document.getElementById("overlay").classList.add("open");
}

function closeTrophyRoom() {
  document.getElementById("trophyRoom").classList.remove("open");
  document.getElementById("overlay").classList.remove("open");
}

// =============================================
// Result display
// =============================================
function showLoading() {
  const area = document.getElementById("resultArea");
  area.innerHTML = `
    <div class="result-box loading">
      <div class="result-main loading-dots">Checking<span>.</span><span>.</span><span>.</span></div>
    </div>
  `;
  area.classList.add("visible");
}

function showResult(type, main, sub) {
  const area = document.getElementById("resultArea");
  area.innerHTML = `
    <div class="result-box ${type}">
      <div class="result-main">${escapeHtml(main)}</div>
      ${sub ? `<div class="result-sub">${escapeHtml(sub)}</div>` : ""}
    </div>
  `;
  area.classList.add("visible");
}

// =============================================
// Escape HTML to prevent XSS
// =============================================
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
