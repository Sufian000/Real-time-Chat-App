let socket;
let currentRoom = "lobby";
let username = localStorage.getItem("p3_username") || "anon";

function initSocket() {
  socket = io();

  socket.on("room:history", (msgs) => {
    const list = document.getElementById("messages");
    list.innerHTML = "";
    msgs.forEach(appendMessage);
    list.scrollTop = list.scrollHeight;
  });

  socket.on("chat:message", (m) => {
    appendMessage(m);
  });

  socket.on("room:roster", (names) => {
    const count = document.getElementById("presence-count");
    count.textContent = `${names.length} online`;
  });
}

function join(room) {
  currentRoom = room;
  setActiveRoomChip(room);
  document.getElementById("room-chip").textContent = `#${room}`;
  socket.emit("room:join", { username, room });
  localStorage.setItem("p3_room", room);
}

function appendMessage({ user, text, ts }) {
  const list = document.getElementById("messages");
  const li = document.createElement("li");
  const mine = user === username;

  if (user === "system") {
    li.className = "bubble system";
    li.textContent = `[${fmtTime(ts)}] ${text}`;
  } else {
    li.className = "bubble " + (mine ? "me" : "other");
    li.innerHTML = `
      <div class="meta">${escapeHtml(user)} · ${fmtTime(ts)}</div>
      <div class="text">${linkify(escapeHtml(text))}</div>
    `;
  }
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))
}

function linkify(text){
  const urlRegex = /https?:\/\/[^\s)]+/g;
  return text.replace(urlRegex, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

function setAvatar(name){
  const init = (name.trim()[0] || "A").toUpperCase();
  document.getElementById("user-avatar").textContent = init;
  document.getElementById("user-name").textContent = name;
}

function setActiveRoomChip(room){
  document.querySelectorAll(".room-chip-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.room === room);
  });
}

async function loadRooms(){
  const res = await fetch("/api/rooms");
  const rooms = await res.json();
  const list = document.getElementById("room-list");
  list.innerHTML = "";
  rooms.forEach(r => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "room-chip-btn";
    btn.dataset.room = r;
    btn.textContent = `#${r}`;
    btn.addEventListener("click", () => join(r));
    li.appendChild(btn);
    list.appendChild(li);
  });
  setActiveRoomChip(currentRoom);
}

async function exportRoom(){
  const url = `/api/export?room=${encodeURIComponent(currentRoom)}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = `${currentRoom}-history.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

document.addEventListener("DOMContentLoaded", async () => {
  // Username and avatar
  setAvatar(username);

  // Change name flow
  document.getElementById("change-name").addEventListener("click", () => {
    const dlg = document.getElementById("name-modal");
    document.getElementById("name-input").value = username;
    dlg.showModal();
  });
  document.getElementById("name-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const newName = document.getElementById("name-input").value.trim() || "anon";
    username = newName;
    localStorage.setItem("p3_username", username);
    setAvatar(username);
    document.getElementById("name-modal").close();
    join(currentRoom);
  });

  // Rooms list & create/join
  await loadRooms();
  document.getElementById("new-room-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = document.getElementById("new-room-input").value.trim().toLowerCase();
    if (!v) return;
    join(v);
    document.getElementById("new-room-input").value = "";
  });

  // Export
  document.getElementById("export-btn").addEventListener("click", exportRoom);

  // Socket + join last room
  initSocket();
  const lastRoom = localStorage.getItem("p3_room") || "lobby";
  join(lastRoom);

  // Send message
  const form = document.getElementById("message-form");
  const input = document.getElementById("message-input");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    socket.emit("chat:send", { text });
    input.value = "";
    input.focus();
  });
});
