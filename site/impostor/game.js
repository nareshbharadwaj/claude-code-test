// Game rules. Pure functions over a plain state object, so the host phone can
// run them and they can be tested without a browser. The host is the only
// phone holding the full state; everyone else gets viewFor(state, theirId).
import { PACKS, CLUE_STYLES } from "./words.js";

export const MIN_PLAYERS = 3;
export const NO_IMPOSTOR = "none";
const NO_IMPOSTOR_CHANCE = 0.2;
const GUESS_CHOICES = 8;

export const DEFAULT_SETTINGS = {
  packs: PACKS.map((p) => p.id),
  customWords: [],
  hint: "category", // what the impostor sees: "none" | "category" | "decoy"
  clueRounds: 2,
  lastChance: true,
  clueStyles: false,
  twoImpostors: false,
  accomplice: false,
  jester: false,
  detective: false,
  noImpostor: false,
};

// Smallest table at which each optional role is dealt.
export const ROLE_MIN_PLAYERS = { twoImpostors: 5, accomplice: 5, jester: 4, detective: 4 };

export function newGame(code, hostId, hostName) {
  return {
    code,
    hostId,
    phase: "lobby",
    players: [{ id: hostId, name: hostName, score: 0, connected: true }],
    settings: { ...DEFAULT_SETTINGS },
    round: null,
    roundNumber: 0,
    usedWords: [],
  };
}

export function addPlayer(state, id, name) {
  const existing = state.players.find((p) => p.id === id);
  if (existing) {
    existing.connected = true;
    if (name) existing.name = cleanName(name);
    return existing;
  }
  const player = { id, name: cleanName(name), score: 0, connected: true };
  state.players.push(player);
  return player;
}

export function setConnected(state, id, connected) {
  const p = state.players.find((p) => p.id === id);
  if (p) p.connected = connected;
}

function cleanName(name) {
  return String(name || "").trim().slice(0, 20) || "Player";
}

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

// The packs in play, with the family's own words as one more pack.
function activePacks(settings) {
  const packs = PACKS.filter((p) => settings.packs.includes(p.id));
  if (settings.customWords.length >= 2) {
    packs.push({ id: "custom", name: "Our family words", category: "Our family words", words: settings.customWords });
  }
  return packs.length ? packs : PACKS;
}

function chooseWord(state, rng) {
  const packs = activePacks(state.settings);
  const all = packs.flatMap((p) => p.words.map((w) => ({ pack: p, word: w })));
  let fresh = all.filter((x) => !state.usedWords.includes(x.word));
  if (!fresh.length) {
    state.usedWords = [];
    fresh = all;
  }
  const choice = pick(fresh, rng);
  state.usedWords.push(choice.word);
  const decoy = pick(choice.pack.words.filter((w) => w !== choice.word), rng) || choice.word;
  return { pack: choice.pack, word: choice.word, decoy };
}

export function canStart(state) {
  return state.players.length >= MIN_PLAYERS;
}

export function startRound(state, rng = Math.random) {
  const s = state.settings;
  // Everyone at the table is dealt in, even if their phone is briefly away;
  // they see their card when it reconnects. The host removes anyone who left.
  const ids = state.players.map((p) => p.id);
  const n = ids.length;
  const { pack, word, decoy } = chooseWord(state, rng);
  const noImpostorRound = s.noImpostor && rng() < NO_IMPOSTOR_CHANCE;
  const impostorCount = noImpostorRound ? 0 : s.twoImpostors && n >= ROLE_MIN_PLAYERS.twoImpostors ? 2 : 1;

  const dealt = shuffle(ids, rng);
  const roles = {};
  dealt.slice(0, impostorCount).forEach((id) => (roles[id] = "impostor"));
  const rest = dealt.slice(impostorCount);
  // Keep at least one plain civilian, so special roles never fill the table.
  const deal = (role, wanted) => {
    if (wanted && n >= ROLE_MIN_PLAYERS[role] && rest.length > 1) roles[rest.shift()] = role;
  };
  deal("detective", s.detective);
  deal("jester", s.jester);
  deal("accomplice", s.accomplice && impostorCount > 0);
  rest.forEach((id) => (roles[id] = "civilian"));

  // Random speaking order, but an impostor never has to go first.
  let order = shuffle(ids, rng);
  const firstSafe = order.findIndex((id) => roles[id] !== "impostor");
  order = order.slice(firstSafe).concat(order.slice(0, firstSafe));

  state.roundNumber += 1;
  state.round = {
    number: state.roundNumber,
    packId: pack.id,
    category: pack.category,
    word,
    decoy,
    roles,
    order,
    turn: 0,
    clueRound: 1,
    style: s.clueStyles ? pick(CLUE_STYLES, rng) : null,
    ready: {},
    detective: { used: false, target: null, answer: null },
    votes: {},
    voteHistory: [],
    eliminated: [],
    notice: null,
    guessOptions: [],
    guesses: {},
    summary: [],
    deltas: {},
  };
  state.phase = "reveal";
}

const impostorsOf = (round) => Object.keys(round.roles).filter((id) => round.roles[id] === "impostor");
const inRound = (round, id) => Boolean(round && round.roles[id]);

function voters(state) {
  const r = state.round;
  return r.order.filter((id) => !r.eliminated.includes(id));
}

export function voteCandidates(state, voterId) {
  return voters(state).filter((id) => id !== voterId);
}

// Applies one action from a player. Returns an error string, or null when the
// action was applied. Invalid or out-of-turn actions leave state untouched.
export function apply(state, pid, action, rng = Math.random) {
  const isHost = pid === state.hostId;
  const r = state.round;
  const type = action && action.type;

  switch (type) {
    case "settings": {
      if (!isHost || state.phase !== "lobby") return "Only the host can change settings in the lobby";
      updateSettings(state.settings, action.settings || {});
      return null;
    }
    case "kick": {
      if (!isHost || action.id === state.hostId) return "Not allowed";
      if (state.phase !== "lobby" && state.phase !== "results") return "Remove players between rounds";
      state.players = state.players.filter((p) => p.id !== action.id);
      return null;
    }
    case "start":
    case "next": {
      if (!isHost) return "Only the host can start a round";
      if (state.phase !== "lobby" && state.phase !== "results") return "A round is in progress";
      if (!canStart(state)) return `Need at least ${MIN_PLAYERS} players`;
      startRound(state, rng);
      return null;
    }
    case "lobby": {
      if (!isHost) return "Only the host can end the game";
      state.phase = "lobby";
      state.round = null;
      return null;
    }
    case "resetScores": {
      if (!isHost || state.phase !== "lobby") return "Not allowed";
      state.players.forEach((p) => (p.score = 0));
      return null;
    }
    case "ready": {
      if (state.phase !== "reveal" || !inRound(r, pid)) return "Not now";
      r.ready[pid] = true;
      maybeFinishReveal(state);
      return null;
    }
    case "forceStart": {
      if (!isHost || state.phase !== "reveal") return "Not now";
      state.phase = "clues";
      return null;
    }
    case "clueDone": {
      if (state.phase !== "clues") return "Not now";
      if (!isHost && r.order[r.turn] !== pid) return "Not your turn";
      r.turn += 1;
      if (r.turn >= r.order.length) {
        if (r.clueRound < state.settings.clueRounds) {
          r.clueRound += 1;
          r.turn = 0;
        } else {
          state.phase = "discuss";
        }
      }
      return null;
    }
    case "startVote": {
      if (!isHost || (state.phase !== "discuss" && state.phase !== "clues")) return "Not now";
      state.phase = "vote";
      r.votes = {};
      return null;
    }
    case "ask": {
      if (r?.roles[pid] !== "detective" || r.detective.used) return "Not allowed";
      if (!["clues", "discuss", "vote"].includes(state.phase)) return "Not now";
      if (action.target === pid || !inRound(r, action.target)) return "Pick another player";
      r.detective = { used: true, target: action.target, answer: r.roles[action.target] === "impostor" };
      return null;
    }
    case "vote": {
      if (state.phase !== "vote" || !voters(state).includes(pid)) return "You can't vote now";
      const valid =
        voteCandidates(state, pid).includes(action.target) ||
        (action.target === NO_IMPOSTOR && state.settings.noImpostor && r.voteHistory.length === 0);
      if (!valid) return "Pick someone else";
      r.votes[pid] = action.target;
      if (voters(state).every((id) => r.votes[id])) tally(state, rng);
      return null;
    }
    case "closeVote": {
      if (!isHost || state.phase !== "vote") return "Not now";
      tally(state, rng);
      return null;
    }
    case "guess": {
      if (state.phase !== "guess" || !r.eliminated.includes(pid) || r.roles[pid] !== "impostor") return "Not allowed";
      if (r.guesses[pid] || !r.guessOptions.includes(action.word)) return "Not allowed";
      r.guesses[pid] = action.word;
      const caught = r.eliminated.filter((id) => r.roles[id] === "impostor");
      if (caught.every((id) => r.guesses[id])) finishRound(state);
      return null;
    }
    case "skipGuess": {
      if (!isHost || state.phase !== "guess") return "Not now";
      finishRound(state);
      return null;
    }
    default:
      return "Unknown action";
  }
}

function updateSettings(s, patch) {
  for (const key of ["lastChance", "clueStyles", "twoImpostors", "accomplice", "jester", "detective", "noImpostor"]) {
    if (key in patch) s[key] = Boolean(patch[key]);
  }
  if (["none", "category", "decoy"].includes(patch.hint)) s.hint = patch.hint;
  if ([1, 2, 3].includes(patch.clueRounds)) s.clueRounds = patch.clueRounds;
  if (Array.isArray(patch.packs)) s.packs = PACKS.map((p) => p.id).filter((id) => patch.packs.includes(id));
  if (Array.isArray(patch.customWords)) {
    s.customWords = [...new Set(patch.customWords.map((w) => String(w).trim().slice(0, 40)).filter(Boolean))].slice(0, 200);
  }
}

// The game waits for every player, connected or not. A phone that drops out
// never loses its turn, card or vote; the host decides when to stop waiting.
function maybeFinishReveal(state) {
  const r = state.round;
  if (r.order.every((id) => r.ready[id])) state.phase = "clues";
}

function tally(state, rng) {
  const r = state.round;
  const counts = {};
  Object.values(r.votes).forEach((t) => (counts[t] = (counts[t] || 0) + 1));
  const max = Math.max(0, ...Object.values(counts));
  const top = Object.keys(counts).filter((t) => counts[t] === max);
  const out = max > 0 && top.length === 1 ? top[0] : null;
  r.voteHistory.push({ votes: { ...r.votes }, counts, out });
  r.votes = {};

  if (out && out !== NO_IMPOSTOR) {
    r.eliminated.push(out);
    const left = impostorsOf(r).filter((id) => !r.eliminated.includes(id));
    if (r.roles[out] === "impostor" && left.length) {
      r.notice = { out, impostor: true, more: true };
      state.phase = "vote";
      return;
    }
  }
  endVoting(state, rng);
}

function endVoting(state, rng) {
  const r = state.round;
  const caught = r.eliminated.filter((id) => r.roles[id] === "impostor");
  if (state.settings.lastChance && caught.length) {
    const pack = activePacks(state.settings).find((p) => p.id === r.packId) || { words: [r.word] };
    const others = shuffle(pack.words.filter((w) => w !== r.word), rng).slice(0, GUESS_CHOICES - 1);
    r.guessOptions = shuffle([r.word, ...others], rng);
    state.phase = "guess";
    return;
  }
  finishRound(state);
}

// Scores the round and writes the plain-language summary everyone sees.
function finishRound(state) {
  const r = state.round;
  const name = (id) => state.players.find((p) => p.id === id)?.name || "Someone";
  const names = (ids) => ids.map(name).join(" and ");
  const impostors = impostorsOf(r);
  const caught = r.eliminated.filter((id) => r.roles[id] === "impostor");
  const free = impostors.filter((id) => !caught.includes(id));
  const jester = Object.keys(r.roles).find((id) => r.roles[id] === "jester");
  const accomplice = Object.keys(r.roles).find((id) => r.roles[id] === "accomplice");
  const team = Object.keys(r.roles).filter((id) => ["civilian", "detective"].includes(r.roles[id]));
  const firstVote = r.voteHistory[0];
  const lastOut = r.voteHistory.length ? r.voteHistory[r.voteHistory.length - 1].out : null;
  const deltas = {};
  const add = (id, pts) => (deltas[id] = (deltas[id] || 0) + pts);
  const summary = [];

  if (!impostors.length) {
    summary.push("There was no impostor this round!");
    if (lastOut === NO_IMPOSTOR) summary.push("The family figured it out. Everyone who voted \"No impostor\" gets 2 points.");
    else if (lastOut) summary.push(`${name(lastOut)} was voted out for nothing.`);
    else summary.push("The vote was tied, so nobody was voted out.");
    if (firstVote) Object.entries(firstVote.votes).forEach(([id, t]) => t === NO_IMPOSTOR && add(id, 2));
  } else {
    r.voteHistory.forEach((v) =>
      Object.entries(v.votes).forEach(([id, t]) => team.includes(id) && impostors.includes(t) && add(id, 1))
    );
    if (caught.length) summary.push(`Caught: ${names(caught)}.`);
    if (lastOut === null && r.voteHistory.length) summary.push("The vote was tied, so nobody was voted out.");
    if (lastOut === NO_IMPOSTOR) summary.push("The family voted \"No impostor\", but there was one!");
    if (lastOut && lastOut !== NO_IMPOSTOR && r.roles[lastOut] !== "impostor") {
      summary.push(`${name(lastOut)} was voted out, but was innocent.`);
    }
    if (free.length) {
      summary.push(`${names(free)} got away as the impostor. +3`);
      free.forEach((id) => add(id, 3));
    } else {
      summary.push("All impostors caught! Everyone on the family's side gets 2 points.");
      team.forEach((id) => add(id, 2));
    }
    caught.forEach((id) => {
      const g = r.guesses[id];
      if (g === r.word) {
        summary.push(`${name(id)} guessed the word "${r.word}" and steals 2 points!`);
        add(id, 2);
      } else if (g) {
        summary.push(`${name(id)} guessed "${g}". Wrong!`);
      }
    });
    if (accomplice && free.length) {
      summary.push(`${name(accomplice)} was the Spy and helped the impostor escape. +2`);
      add(accomplice, 2);
    }
  }
  if (jester && r.eliminated.includes(jester)) {
    summary.push(`${name(jester)} was the Jester and wanted to be voted out. Jester wins! +3`);
    add(jester, 3);
  }

  Object.entries(deltas).forEach(([id, pts]) => {
    const p = state.players.find((p) => p.id === id);
    if (p) p.score += pts;
  });
  r.summary = summary;
  r.deltas = deltas;
  state.phase = "results";
}

// What one player is allowed to see. Secrets (the word, other people's roles)
// only appear here for players entitled to them, until the results screen.
export function viewFor(state, pid) {
  const r = state.round;
  const view = {
    code: state.code,
    phase: state.phase,
    me: pid,
    isHost: pid === state.hostId,
    settings: state.settings,
    canStart: canStart(state),
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      connected: p.connected,
      isHost: p.id === state.hostId,
      inRound: inRound(r, p.id),
      ready: Boolean(r?.ready[p.id]),
      voted: Boolean(r?.votes[p.id]),
      out: Boolean(r?.eliminated.includes(p.id)),
    })),
  };
  if (!r) return view;

  view.round = {
    number: r.number,
    order: r.order,
    turn: r.turn,
    clueRound: r.clueRound,
    clueRounds: state.settings.clueRounds,
    style: r.style,
    voteRound: r.voteHistory.length + 1,
    eliminated: r.eliminated,
    notice: r.notice,
    myVote: r.votes[pid] || null,
    candidates: state.phase === "vote" && voters(state).includes(pid) ? voteCandidates(state, pid) : [],
    canVoteNone: state.settings.noImpostor && r.voteHistory.length === 0,
    guessed: Object.keys(r.guesses),
  };
  view.card = cardFor(state, pid);

  if (state.phase === "guess" && r.roles[pid] === "impostor" && r.eliminated.includes(pid) && !r.guesses[pid]) {
    view.round.guessOptions = r.guessOptions;
  }
  if (state.phase === "guess") {
    view.round.guessers = r.eliminated.filter((id) => r.roles[id] === "impostor");
  }
  if (state.phase === "results") {
    view.reveal = {
      word: r.word,
      decoy: state.settings.hint === "decoy" ? r.decoy : null,
      category: r.category,
      roles: r.roles,
      voteHistory: r.voteHistory,
      guesses: r.guesses,
      summary: r.summary,
      deltas: r.deltas,
      detective: r.detective,
    };
  }
  return view;
}

function cardFor(state, pid) {
  const r = state.round;
  const role = r.roles[pid];
  if (!role) return { role: "waiting" };
  const hint = state.settings.hint;
  if (role === "impostor") {
    // In decoy mode the impostor gets a near-miss word and isn't told.
    if (hint === "decoy") return { role: "civilian", word: r.decoy };
    return { role, category: hint === "category" ? r.category : null, partners: impostorsOf(r).length > 1 };
  }
  const card = { role, word: r.word };
  if (role === "accomplice") card.impostors = impostorsOf(r);
  if (role === "detective") card.detective = r.detective;
  return card;
}
