// Screens and networking. The phone that creates the room is the "server":
// it holds the full game state, applies everyone's actions with game.js and
// sends each phone only its own view. PeerJS connects the phones directly;
// its public broker is used only to introduce them.
import { PACKS } from "./words.js";
import * as Game from "./game.js";

const PEER_PREFIX = "kaun-impostor-v1-";
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const PING_MS = 4000;
const STALE_MS = 13000;
const SESSION_KEY = "impostor.session";
const HOST_KEY = "impostor.hostState";
const NAME_KEY = "impostor.name";
const ID_KEY = "impostor.playerId";

const app = document.getElementById("app");
const params = new URLSearchParams(location.search);

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};

const playerId = store.get(ID_KEY) || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
store.set(ID_KEY, playerId);

// Everything the screens need. `view` is what game.js says this phone may see.
const ui = {
  screen: "home", // home | connecting | game
  error: "",
  status: "",
  connected: false,
  view: null,
  revealed: false,
  lastPhase: null,
  lastTurnKey: null,
  open: new Set(), // <details> panels the person has expanded
};

let net = null; // the running Host or Client

// ---------- Networking ----------

function peerOptions() {
  // ?peerhost=… lets you use your own PeerJS server instead of the public one.
  const host = params.get("peerhost");
  if (!host) return { debug: 1 };
  return {
    host,
    port: Number(params.get("peerport") || 443),
    path: params.get("peerpath") || "/",
    secure: params.get("peersecure") !== "0",
    debug: 1,
  };
}

function newCode() {
  let c = "";
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

class Host {
  constructor(name, saved) {
    this.conns = new Map(); // playerId -> { conn, seen }
    this.state = saved || null;
    // Everyone else is away until their phone reconnects.
    this.state?.players.forEach((p) => (p.connected = p.id === playerId));
    this.code = saved ? saved.code : newCode();
    this.name = name;
    this.attempts = 0;
    this.open();
    this.timer = setInterval(() => this.sweep(), PING_MS);
  }

  open() {
    ui.status = this.state ? "Reopening your room…" : "Creating room…";
    render();
    this.peer = new Peer(PEER_PREFIX + this.code, peerOptions());
    this.peer.on("open", () => {
      this.attempts = 0;
      if (!this.state) this.state = Game.newGame(this.code, playerId, this.name);
      Game.setConnected(this.state, playerId, true);
      ui.connected = true;
      ui.screen = "game";
      remember({ role: "host", code: this.code, name: this.name });
      setRoomInUrl(this.code);
      this.publish();
    });
    this.peer.on("connection", (conn) => this.accept(conn));
    this.peer.on("disconnected", () => {
      if (!this.peer.destroyed) setTimeout(() => !this.peer.destroyed && this.peer.reconnect(), 1500);
    });
    this.peer.on("error", (err) => {
      if (err.type === "unavailable-id") {
        this.peer.destroy();
        // A fresh room just takes another code. A resumed room waits for the
        // broker to forget the old connection, which takes a few seconds.
        if (!this.state) this.code = newCode();
        if (++this.attempts > 20) return fail("Couldn't reopen the room. Start a new game.");
        setTimeout(() => this.open(), this.state ? 3000 : 0);
      } else if (["network", "server-error", "socket-error", "socket-closed"].includes(err.type)) {
        ui.connected = false;
        render();
      }
    });
  }

  accept(conn) {
    let pid = null;
    conn.on("data", (msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.t === "hello" && typeof msg.playerId === "string") {
        pid = msg.playerId.slice(0, 64);
        const old = this.conns.get(pid);
        if (old && old.conn !== conn) old.conn.close();
        this.conns.set(pid, { conn, seen: Date.now() });
        Game.addPlayer(this.state, pid, msg.name);
        Game.recheck(this.state);
        this.publish();
        return;
      }
      if (!pid) return;
      const entry = this.conns.get(pid);
      if (entry && entry.conn === conn) entry.seen = Date.now();
      if (msg.t === "action") this.dispatch(pid, msg.action);
    });
    conn.on("close", () => {
      const entry = pid && this.conns.get(pid);
      if (entry && entry.conn === conn) this.drop(pid);
    });
  }

  drop(pid) {
    this.conns.delete(pid);
    Game.setConnected(this.state, pid, false);
    Game.recheck(this.state);
    this.publish();
  }

  // Phones ping every few seconds; one that goes quiet (locked screen, lost
  // Wi-Fi) is marked away so nobody waits on it.
  sweep() {
    const now = Date.now();
    for (const [pid, entry] of this.conns) {
      if (now - entry.seen > STALE_MS) {
        entry.conn.close();
        this.drop(pid);
      } else if (entry.conn.open) {
        entry.conn.send({ t: "ping" });
      }
    }
    if (this.peer.disconnected && !this.peer.destroyed) this.peer.reconnect();
  }

  dispatch(pid, action) {
    if (!this.state) return;
    const error = Game.apply(this.state, pid, action);
    if (error) {
      if (pid === playerId) toast(error);
      else this.conns.get(pid)?.conn.send({ t: "error", message: error });
      return;
    }
    if (action.type === "kick") {
      const entry = this.conns.get(action.id);
      this.conns.delete(action.id);
      entry?.conn.send({ t: "bye", message: "The host removed you from the game." });
      setTimeout(() => entry?.conn.close(), 300);
    }
    this.publish();
  }

  publish() {
    store.set(HOST_KEY, { savedAt: Date.now(), state: this.state });
    for (const [pid, { conn }] of this.conns) {
      if (conn.open) conn.send({ t: "state", view: Game.viewFor(this.state, pid) });
    }
    setView(Game.viewFor(this.state, playerId));
  }

  leave() {
    clearInterval(this.timer);
    store.remove(HOST_KEY);
    for (const { conn } of this.conns.values()) if (conn.open) conn.send({ t: "bye", message: "The host ended the game." });
    // Give the goodbye messages a moment to go out.
    setTimeout(() => this.peer.destroy(), 300);
  }
}

class Client {
  constructor(code, name) {
    this.code = code;
    this.name = name;
    this.gotState = false;
    this.seen = Date.now();
    ui.status = "Joining room " + code + "…";
    render();
    this.peer = new Peer(peerOptions());
    this.peer.on("open", () => this.connect());
    this.peer.on("disconnected", () => {
      if (!this.peer.destroyed) setTimeout(() => !this.peer.destroyed && this.peer.reconnect(), 1500);
    });
    this.peer.on("error", (err) => {
      if (err.type === "peer-unavailable") {
        if (!this.gotState) return fail(`No game found with code ${code}. Check the code with the host.`);
        this.retry();
      } else if (["network", "server-error", "socket-error", "socket-closed"].includes(err.type)) {
        this.retry();
      }
    });
    this.timer = setInterval(() => this.tick(), PING_MS);
  }

  connect() {
    if (this.peer.destroyed) return;
    if (this.peer.disconnected) {
      this.peer.reconnect();
      return this.retry();
    }
    if (this.conn) this.conn.close();
    const conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true });
    this.conn = conn;
    conn.on("open", () => {
      this.seen = Date.now();
      conn.send({ t: "hello", playerId, name: this.name });
    });
    conn.on("data", (msg) => {
      this.seen = Date.now();
      if (msg.t === "state") {
        this.gotState = true;
        ui.connected = true;
        ui.screen = "game";
        remember({ role: "client", code: this.code, name: this.name });
        setRoomInUrl(this.code);
        setView(msg.view);
      } else if (msg.t === "error") {
        toast(msg.message);
      } else if (msg.t === "bye") {
        fail(msg.message);
      }
    });
    conn.on("close", () => {
      if (this.conn === conn) this.lost();
    });
  }

  lost() {
    if (ui.connected) {
      ui.connected = false;
      render();
    }
    this.retry();
  }

  retry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), 2000);
  }

  tick() {
    if (this.conn?.open) this.conn.send({ t: "ping" });
    if (this.gotState && Date.now() - this.seen > STALE_MS) {
      this.seen = Date.now();
      this.lost();
    }
  }

  send(action) {
    if (this.conn?.open) this.conn.send({ t: "action", action });
    else toast("Reconnecting… try again in a moment");
  }

  leave() {
    clearInterval(this.timer);
    clearTimeout(this.retryTimer);
    this.peer.destroy();
  }
}

function act(action) {
  if (net instanceof Host) net.dispatch(playerId, action);
  else if (net) net.send(action);
}

function remember(session) {
  store.set(SESSION_KEY, { ...session, at: Date.now() });
}

function setRoomInUrl(code) {
  const url = new URL(location.href);
  url.searchParams.set("room", code);
  history.replaceState(null, "", url);
}

function fail(message) {
  net?.leave();
  net = null;
  store.remove(SESSION_KEY);
  ui.screen = "home";
  ui.error = message;
  ui.view = null;
  render();
}

function leaveGame() {
  if (net instanceof Host && !confirm("End the game for everyone?")) return;
  net?.leave();
  net = null;
  store.remove(SESSION_KEY);
  const url = new URL(location.href);
  url.searchParams.delete("room");
  history.replaceState(null, "", url);
  ui.screen = "home";
  ui.view = null;
  ui.error = "";
  render();
}

function startHost(name, saved) {
  store.set(NAME_KEY, name);
  ui.screen = "connecting";
  ui.error = "";
  keepAwake();
  net = new Host(name, saved);
}

function startClient(code, name) {
  store.set(NAME_KEY, name);
  ui.screen = "connecting";
  ui.error = "";
  keepAwake();
  net = new Client(code, name);
}

// Keep screens on during the game, so phones don't drop out mid-round.
let wakeLock = null;
async function keepAwake() {
  try {
    if ("wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    }
  } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !net) return;
  keepAwake();
  if (net instanceof Client && !net.conn?.open) net.connect();
});

// ---------- Rendering ----------

function setView(view) {
  const turnKey = view.round ? `${view.round.number}-${view.round.clueRound}-${view.round.turn}` : null;
  if (view.phase !== ui.lastPhase || view.round?.number !== ui.view?.round?.number) {
    ui.revealed = false;
    ui.open.clear();
  }
  if (view.phase === "clues" && turnKey !== ui.lastTurnKey && view.round.order[view.round.turn] === view.me) {
    navigator.vibrate?.(200);
  }
  ui.lastPhase = view.phase;
  ui.lastTurnKey = turnKey;
  ui.view = view;
  render();
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function nameOf(id) {
  return ui.view?.players.find((p) => p.id === id)?.name || "Someone";
}

function render() {
  // Re-rendering replaces the DOM, so keep whatever field the person is typing in.
  const active = document.activeElement;
  const keep = active && active.id && app.contains(active)
    ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd }
    : null;

  app.innerHTML = ui.screen === "home" ? homeScreen() : ui.screen === "connecting" || !ui.view ? connectingScreen() : gameScreen();

  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      if ("value" in el && keep.value !== undefined) el.value = keep.value;
      el.focus();
      try { el.setSelectionRange(keep.start, keep.end); } catch {}
    }
  }
}

function homeScreen() {
  const name = store.get(NAME_KEY) || "";
  const room = (params.get("room") || "").toUpperCase();
  const session = store.get(SESSION_KEY);
  const fresh = session && Date.now() - session.at < 12 * 3600 * 1000;
  const savedHost = store.get(HOST_KEY);
  const canResume = fresh && (session.role === "client" || savedHost);
  return `
    <div class="hero">
      <div class="mask" aria-hidden="true">🕵️</div>
      <h1>Kaun Hai Impostor?</h1>
      <p class="muted">Everyone gets the secret word except the impostor. Give clues, argue, vote, and catch the chor!</p>
    </div>
    ${ui.error ? `<p class="banner" role="alert">${esc(ui.error)}</p><div class="spacer"></div>` : ""}
    ${canResume ? `
      <div class="panel stack">
        <p>You were in room <b>${esc(session.code)}</b>${session.role === "host" ? " as the host" : ""}.</p>
        <button class="btn" data-action="resume">Rejoin room ${esc(session.code)}</button>
        <button class="link" data-action="forget">Forget it</button>
      </div>
      <div class="spacer"></div>` : ""}
    <div class="panel stack">
      <div>
        <label class="lbl" for="name">Your name</label>
        <input class="field" id="name" maxlength="20" autocomplete="nickname" placeholder="e.g. Nani" value="${esc(name)}">
      </div>
      <div>
        <label class="lbl" for="code">Room code</label>
        <input class="field code-input" id="code" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD" value="${esc(room)}">
      </div>
      <button class="btn" data-action="join">Join game</button>
      <p class="or">or</p>
      <button class="btn secondary" data-action="create">Create a new game</button>
    </div>
    <p class="muted small center" style="margin-top:18px">One phone per person. Everyone plays in the same room, out loud.</p>`;
}

function connectingScreen() {
  return `
    <div class="hero">
      <div class="mask" aria-hidden="true">⏳</div>
      <h2>${esc(ui.status || "Connecting…")}</h2>
      <p class="muted">This usually takes a few seconds.</p>
    </div>
    <button class="btn quiet" data-action="leave">Cancel</button>`;
}

function topBar(v) {
  return `
    <div class="bar">
      <span class="room"><span class="dot ${ui.connected ? "" : "off"}" title="${ui.connected ? "Connected" : "Reconnecting"}"></span>ROOM ${esc(v.code)}</span>
      <button class="link" data-action="leave">${v.isHost ? "End game" : "Leave"}</button>
    </div>
    ${ui.connected ? "" : `<p class="banner small">Reconnecting… keep this page open.</p><div class="spacer"></div>`}`;
}

function gameScreen() {
  const v = ui.view;
  const screens = { lobby, reveal, clues, discuss, vote, guess, results };
  return topBar(v) + `<div class="stack">${screens[v.phase](v)}</div>`;
}

// ---- Lobby ----

const EXTRAS = [
  { key: "twoImpostors", title: "Two impostors", desc: "Two impostors who don't know about each other. Catch one and you vote again." },
  { key: "accomplice", title: "Spy", desc: "One player secretly works for the impostor. The Spy knows the word and who the impostor is, and wins if the impostor escapes." },
  { key: "jester", title: "Jester", desc: "Knows the word, but wins only by getting voted out." },
  { key: "detective", title: "Detective", desc: "Once per round, can secretly check whether one player is the impostor." },
  { key: "noImpostor", title: "Maybe no impostor", desc: "Some rounds secretly have no impostor. You can vote \"No impostor\"." },
];

function lobby(v) {
  const s = v.settings;
  const link = `${location.origin}${location.pathname}?room=${v.code}`;
  const players = v.players.map((p) => `
    <li>
      <span class="name">${esc(p.name)}${p.id === v.me ? " (you)" : ""}</span>
      ${p.isHost ? `<span class="tag">Host</span>` : ""}
      ${p.connected ? "" : `<span class="tag plum">Away</span>`}
      <span class="muted small">${p.score} pts</span>
      ${v.isHost && !p.isHost ? `<button class="x" aria-label="Remove ${esc(p.name)}" data-action="kick" data-id="${esc(p.id)}">×</button>` : ""}
    </li>`).join("");
  const count = v.players.filter((p) => p.connected).length;

  const settings = v.isHost ? `
    <div class="panel stack">
      <h3>Word packs</h3>
      <div class="chips">
        ${PACKS.map((p) => `<button class="chip ${s.packs.includes(p.id) ? "on" : ""}" data-action="pack" data-id="${p.id}" aria-pressed="${s.packs.includes(p.id)}">${esc(p.name)}</button>`).join("")}
      </div>
      <div>
        <label class="lbl" for="custom">Our family words <span class="muted small">(optional, one per line or comma separated)</span></label>
        <textarea class="field" id="custom" placeholder="Chintu's scooter&#10;Goa trip 2019&#10;Masi's rajma">${esc(s.customWords.join("\n"))}</textarea>
      </div>
    </div>
    <div class="panel stack">
      <h3>What the impostor sees</h3>
      <div class="seg" role="group" aria-label="Impostor hint">
        ${[["none", "Nothing"], ["category", "Category"], ["decoy", "Decoy word"]].map(([k, t]) => `<button class="${s.hint === k ? "on" : ""}" data-action="hint" data-id="${k}">${t}</button>`).join("")}
      </div>
      <p class="muted small">${{ none: "The impostor gets no clue at all. Hardest for them.", category: "The impostor is told the category, like \"Bollywood movies\".", decoy: "The impostor gets a similar word and doesn't know they're the impostor!" }[s.hint]}</p>
      <h3>Clue rounds</h3>
      <div class="seg" role="group" aria-label="Clue rounds">
        ${[1, 2, 3].map((n) => `<button class="${s.clueRounds === n ? "on" : ""}" data-action="clueRounds" data-id="${n}">${n} ${n === 1 ? "round" : "rounds"}</button>`).join("")}
      </div>
    </div>
    <div class="panel">
      <h3>Optional twists</h3>
      ${EXTRAS.map((x) => {
        const min = Game.ROLE_MIN_PLAYERS[x.key];
        return `<label class="opt"><input type="checkbox" data-setting="${x.key}" ${s[x.key] ? "checked" : ""}>
          <span><span class="t">${x.title}</span><br><span class="d">${x.desc}${min ? ` Needs ${min}+ players.` : ""}</span></span></label>`;
      }).join("")}
      <label class="opt"><input type="checkbox" data-setting="clueStyles" ${s.clueStyles ? "checked" : ""}>
        <span><span class="t">Clue styles</span><br><span class="d">Each round has a rule: act it out, make a sound, say it filmy-style, and more.</span></span></label>
      <label class="opt"><input type="checkbox" data-setting="lastChance" ${s.lastChance ? "checked" : ""}>
        <span><span class="t">Last-chance guess</span><br><span class="d">A caught impostor can still steal points by guessing the word.</span></span></label>
    </div>
    <button class="btn" data-action="start" ${v.canStart ? "" : "disabled"}>${v.canStart ? "Start round" : `Waiting for ${Game.MIN_PLAYERS - count} more`}</button>
    ${v.players.some((p) => p.score) ? `<button class="link" data-action="resetScores">Reset scores</button>` : ""}`
  : `
    <div class="panel stack">
      <h3>Twists on</h3>
      <p class="muted">${[...EXTRAS, { key: "clueStyles", title: "Clue styles" }, { key: "lastChance", title: "Last-chance guess" }].filter((x) => s[x.key]).map((x) => x.title).join(", ") || "None, a classic game"}</p>
    </div>
    <p class="muted center">Waiting for the host to start…</p>`;

  return `
    <div class="panel stack center">
      <p class="muted">Room code</p>
      <div class="code-big">${esc(v.code)}</div>
      <button class="btn secondary" data-action="share" data-link="${esc(link)}">Invite family</button>
    </div>
    <div class="panel">
      <h3>Players (${count})</h3>
      <ul class="players">${players}</ul>
    </div>
    ${settings}`;
}

// ---- Secret card ----

function secretCard(v, opts = {}) {
  const c = v.card;
  if (c.role === "waiting") {
    return `<div class="panel center"><h3>You joined mid-round</h3><p class="muted">Sit this one out. You'll be dealt in next round.</p></div>`;
  }
  if (!ui.revealed) {
    return `<div class="card hidden" data-action="flip" role="button" tabindex="0">
      <div class="role">Secret card</div>
      <div class="word">Tap to look</div>
      <div class="hint">Make sure nobody is peeking!</div>
    </div>`;
  }
  let body;
  if (c.role === "impostor") {
    body = `<div class="role">You are the</div><div class="word">IMPOSTOR</div>
      <div class="note">${c.category ? `Category: <b>${esc(c.category)}</b>` : "No hint this time. Listen carefully!"}</div>
      <div class="note">Blend in and don't get caught.${c.partners ? " There's a second impostor too, but you don't know who." : ""}</div>`;
  } else {
    const extra = {
      civilian: "Give clues that prove you know it, without giving it away.",
      detective: "You're the <b>Detective</b>. Once this round, secretly check one player.",
      jester: "You're the <b>Jester</b>! Win by getting yourself voted out. Act a bit suspicious, but not too much.",
      accomplice: `You're the <b>Spy</b>. The impostor is <b>${esc((c.impostors || []).map(nameOf).join(" and "))}</b>. Help them escape!`,
    }[c.role];
    body = `<div class="role">Your word</div><div class="word">${esc(c.word)}</div><div class="note">${extra}</div>`;
  }
  return `<div class="card ${c.role === "impostor" ? "impostor" : ""}" data-action="flip" role="button" tabindex="0">${body}<div class="hint">Tap to hide</div></div>
    ${opts.after || ""}`;
}

function detectivePanel(v) {
  const c = v.card;
  if (c.role !== "detective") return "";
  const d = c.detective;
  if (d.used) {
    return `<div class="banner"><b>Detective:</b> ${esc(nameOf(d.target))} is ${d.answer ? "<b>the impostor!</b>" : "not the impostor."}</div>`;
  }
  const others = v.round.order.filter((id) => id !== v.me);
  return `<details class="panel" id="det" ${ui.open.has("det") ? "open" : ""}><summary>Detective: check one player</summary>
    <div class="spacer"></div>
    <p class="muted small">You get one check per round. Do it secretly!</p>
    <div class="spacer"></div>
    <div class="votes">${others.map((id) => `<button class="vote-btn" data-action="ask" data-id="${esc(id)}">${esc(nameOf(id))}</button>`).join("")}</div>
  </details>`;
}

function styleCard(v) {
  const st = v.round.style;
  return st ? `<div class="style-card"><h3>Clue style: ${esc(st.title)}</h3><p>${esc(st.text)}</p></div>` : "";
}

// ---- Round screens ----

function reveal(v) {
  const me = v.players.find((p) => p.id === v.me);
  const waiting = v.players.filter((p) => p.inRound && p.connected && !p.ready).map((p) => p.name);
  if (v.card.role === "waiting") return secretCard(v);
  return `
    <h2>Round ${v.round.number}: check your card</h2>
    ${secretCard(v)}
    ${styleCard(v)}
    ${me.ready
      ? `<p class="muted center">Waiting for ${esc(waiting.join(", ")) || "everyone"}…</p>`
      : `<button class="btn" data-action="ready">Got it, I'm ready</button>`}
    ${v.isHost && waiting.length ? `<button class="btn quiet" data-action="forceStart">Start clues without waiting</button>` : ""}`;
}

function orderList(v) {
  const r = v.round;
  return `<ol class="order">${r.order.map((id, i) => `<li class="${i === r.turn ? "now" : i < r.turn ? "done" : ""}">${esc(nameOf(id))}${id === v.me ? " (you)" : ""}</li>`).join("")}</ol>`;
}

function peek(v) {
  return `<details class="panel" id="peek" ${ui.open.has("peek") ? "open" : ""}><summary>Peek at my card</summary><div class="spacer"></div>${secretCard(v)}</details>`;
}

function clues(v) {
  const r = v.round;
  const speaker = r.order[r.turn];
  const mine = speaker === v.me;
  return `
    <div class="big-turn">
      <p class="muted">Clue round ${r.clueRound} of ${r.clueRounds}</p>
      <div class="who">${mine ? "Your turn!" : esc(nameOf(speaker))}</div>
      <p class="muted">${mine ? "Say your clue out loud, then tap Done." : "is giving a clue"}</p>
    </div>
    ${mine ? `<button class="btn" data-action="clueDone">Done</button>` : v.isHost ? `<button class="btn quiet" data-action="clueDone">Skip to next player</button>` : ""}
    ${styleCard(v)}
    <div class="panel">${orderList(v)}</div>
    ${detectivePanel(v)}
    ${peek(v)}`;
}

function discuss(v) {
  return `
    <div class="big-turn">
      <div class="who">Charcha time!</div>
      <p class="muted">Discuss who seemed suspicious. When you're ready, the host opens the vote.</p>
    </div>
    ${v.isHost ? `<button class="btn" data-action="startVote">Start the vote</button>` : ""}
    ${detectivePanel(v)}
    ${peek(v)}`;
}

function vote(v) {
  const r = v.round;
  const notice = r.notice?.more
    ? `<div class="banner"><b>${esc(nameOf(r.notice.out))} was an impostor!</b> But there's another one hiding. Vote again.</div>`
    : "";
  const out = r.eliminated.includes(v.me);
  const waiting = v.players.filter((p) => p.inRound && p.connected && !p.out && !p.voted).map((p) => p.name);
  let body;
  if (out || v.card.role === "waiting") {
    body = `<p class="muted center">You're sitting this vote out.</p>`;
  } else {
    body = `
      <p class="muted">Tap who you think the impostor is. You can change your vote until everyone has voted.</p>
      <div class="votes">
        ${r.candidates.map((id) => `<button class="vote-btn ${r.myVote === id ? "on" : ""}" data-action="vote" data-id="${esc(id)}">${esc(nameOf(id))}${r.myVote === id ? "<span>✓</span>" : ""}</button>`).join("")}
        ${r.canVoteNone ? `<button class="vote-btn none ${r.myVote === Game.NO_IMPOSTOR ? "on" : ""}" data-action="vote" data-id="${Game.NO_IMPOSTOR}">No impostor this round${r.myVote === Game.NO_IMPOSTOR ? "<span>✓</span>" : ""}</button>` : ""}
      </div>`;
  }
  return `
    <h2>Vote${r.voteRound > 1 ? ` again` : ""}</h2>
    ${notice}
    ${body}
    <p class="muted small center">${waiting.length ? `Still voting: ${esc(waiting.join(", "))}` : "Counting…"}</p>
    ${v.isHost ? `<button class="btn quiet" data-action="closeVote">Close the vote now</button>` : ""}
    ${detectivePanel(v)}`;
}

function guess(v) {
  const r = v.round;
  if (r.guessOptions) {
    return `
      <h2>Caught! Last chance</h2>
      <p>You were the impostor. Guess the secret word to steal 2 points.</p>
      <div class="votes">${r.guessOptions.map((w) => `<button class="vote-btn" data-action="guess" data-id="${esc(w)}">${esc(w)}</button>`).join("")}</div>`;
  }
  const who = r.guessers.filter((id) => !r.guessed.includes(id)).map(nameOf);
  return `
    <div class="big-turn">
      <div class="who">Pakda gaya!</div>
      <p class="muted">${esc(r.guessers.map(nameOf).join(" and "))} ${r.guessers.length > 1 ? "were" : "was"} the impostor. ${who.length ? `${esc(who.join(" and "))} is now guessing the word…` : ""}</p>
    </div>
    ${v.isHost ? `<button class="btn quiet" data-action="skipGuess">Skip the guess</button>` : ""}`;
}

const ROLE_NAMES = { civilian: "Family", impostor: "Impostor", detective: "Detective", jester: "Jester", accomplice: "Spy" };

function results(v) {
  const x = v.reveal;
  const rows = Object.keys(x.roles)
    .sort((a, b) => (x.roles[a] === "impostor" ? -1 : 0) - (x.roles[b] === "impostor" ? -1 : 0))
    .map((id) => `<tr><td>${esc(nameOf(id))}</td><td>${ROLE_NAMES[x.roles[id]]}</td><td class="pts">${x.deltas[id] ? `<span class="plus">+${x.deltas[id]}</span>` : "0"}</td></tr>`)
    .join("");
  const voteRows = x.voteHistory.map((h, i) => {
    const counts = Object.entries(h.counts).sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t === Game.NO_IMPOSTOR ? "No impostor" : esc(nameOf(t))} ${n}`).join(", ");
    return `<li>${x.voteHistory.length > 1 ? `Vote ${i + 1}: ` : ""}${counts || "No votes"}</li>`;
  }).join("");
  const board = v.players.slice().sort((a, b) => b.score - a.score)
    .map((p) => `<tr><td>${esc(p.name)}</td><td class="pts">${p.score}</td></tr>`).join("");
  return `
    <div class="card">
      <div class="role">The word was</div>
      <div class="word">${esc(x.word)}</div>
      <div class="note">${esc(x.category)}${x.decoy ? ` · Impostor's decoy: <b>${esc(x.decoy)}</b>` : ""}</div>
    </div>
    <div class="panel"><ul class="summary">${x.summary.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>
    <div class="panel stack">
      <h3>Who was who</h3>
      <table class="roles"><thead><tr><th>Player</th><th>Role</th><th class="pts">Points</th></tr></thead><tbody>${rows}</tbody></table>
      ${voteRows ? `<h3>Votes</h3><ul class="summary small">${voteRows}</ul>` : ""}
      ${x.detective.used ? `<p class="muted small">The detective checked ${esc(nameOf(x.detective.target))}.</p>` : ""}
    </div>
    <div class="panel stack">
      <h3>Scoreboard</h3>
      <table class="roles"><tbody>${board}</tbody></table>
    </div>
    ${v.isHost ? `
      <button class="btn" data-action="next" ${v.canStart ? "" : "disabled"}>Next round</button>
      <button class="btn quiet" data-action="lobby">Change settings</button>` : `<p class="muted center">Waiting for the host to start the next round…</p>`}`;
}

// ---------- Events ----------

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2800);
}

function readName() {
  const name = document.getElementById("name").value.trim();
  if (!name) {
    toast("Enter your name first");
    document.getElementById("name").focus();
  }
  return name;
}

function parseWords(text) {
  return text.split(/[\n,]/).map((w) => w.trim()).filter(Boolean);
}

app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const id = el.dataset.id;
  const s = ui.view?.settings;
  switch (el.dataset.action) {
    case "create": {
      const name = readName();
      if (name) startHost(name, null);
      break;
    }
    case "join": {
      const name = readName();
      const code = document.getElementById("code").value.trim().toUpperCase();
      if (!name) break;
      if (!/^[A-Z]{4}$/.test(code)) {
        toast("Enter the 4-letter room code");
        break;
      }
      startClient(code, name);
      break;
    }
    case "resume": {
      const session = store.get(SESSION_KEY);
      const saved = store.get(HOST_KEY);
      if (session.role === "host" && saved) startHost(session.name, saved.state);
      else startClient(session.code, session.name);
      break;
    }
    case "forget":
      store.remove(SESSION_KEY);
      store.remove(HOST_KEY);
      render();
      break;
    case "leave":
      leaveGame();
      break;
    case "share": {
      const link = el.dataset.link;
      const text = `Join our Impostor game! Room code ${ui.view.code}`;
      if (navigator.share) navigator.share({ title: "Kaun Hai Impostor?", text, url: link }).catch(() => {});
      else navigator.clipboard?.writeText(link).then(() => toast("Link copied"), () => toast(link));
      break;
    }
    case "pack": {
      const packs = s.packs.includes(id) ? s.packs.filter((p) => p !== id) : [...s.packs, id];
      act({ type: "settings", settings: { packs } });
      break;
    }
    case "hint":
      act({ type: "settings", settings: { hint: id } });
      break;
    case "clueRounds":
      act({ type: "settings", settings: { clueRounds: Number(id) } });
      break;
    case "start":
    case "next": {
      // Pick up family words typed but not yet saved.
      const custom = document.getElementById("custom");
      if (custom) act({ type: "settings", settings: { customWords: parseWords(custom.value) } });
      if (s && !s.packs.length && parseWords(custom?.value || "").length < 2 && el.dataset.action === "start") {
        toast("No packs picked, so using all of them");
      }
      act({ type: el.dataset.action });
      break;
    }
    case "flip":
      ui.revealed = !ui.revealed;
      render();
      break;
    case "kick":
    case "ask":
    case "vote":
      act({ type: el.dataset.action, id, target: id });
      break;
    case "guess":
      act({ type: "guess", word: id });
      break;
    default:
      act({ type: el.dataset.action });
  }
});

app.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.setting) act({ type: "settings", settings: { [el.dataset.setting]: el.checked } });
  if (el.id === "custom") act({ type: "settings", settings: { customWords: parseWords(el.value) } });
});

// "toggle" doesn't bubble, so listen in the capture phase.
app.addEventListener("toggle", (e) => {
  if (e.target.tagName !== "DETAILS" || !e.target.id) return;
  if (e.target.open) ui.open.add(e.target.id);
  else ui.open.delete(e.target.id);
}, true);

app.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches('[data-action="flip"]')) {
    e.preventDefault();
    e.target.click();
  }
  if (e.key === "Enter" && ui.screen === "home" && document.getElementById("code")?.value.trim()) {
    app.querySelector('[data-action="join"]').click();
  }
});

// ---------- Start ----------

if (typeof Peer === "undefined") {
  ui.error = "Couldn't load the connection library. Check your internet and reload.";
}
render();

// Coming back to the page (reload, or reopening the tab) rejoins automatically.
{
  const session = store.get(SESSION_KEY);
  const room = (params.get("room") || "").toUpperCase();
  const fresh = session && Date.now() - session.at < 12 * 3600 * 1000;
  if (fresh && session.code === room && typeof Peer !== "undefined") {
    const saved = store.get(HOST_KEY);
    if (session.role === "host" && saved) startHost(session.name, saved.state);
    else if (session.role === "client") startClient(session.code, session.name);
  }
}
