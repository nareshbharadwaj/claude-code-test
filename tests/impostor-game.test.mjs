// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { newGame, addPlayer, apply, viewFor, NO_IMPOSTOR } from "../site/impostor/game.js";

function seeded(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

function table(n, settings = {}, seed = 1) {
  const rng = seeded(seed);
  const s = newGame("ABCD", "p0", "Mummy");
  for (let i = 1; i < n; i++) addPlayer(s, `p${i}`, `P${i}`);
  assert.equal(apply(s, "p0", { type: "settings", settings }), null);
  assert.equal(apply(s, "p0", { type: "start" }, rng), null);
  return { s, rng };
}

function playToVote(s) {
  s.round.order.forEach((id) => apply(s, id, { type: "ready" }));
  assert.equal(s.phase, "clues");
  while (s.phase === "clues") apply(s, s.round.order[s.round.turn], { type: "clueDone" });
  assert.equal(s.phase, "discuss");
  apply(s, "p0", { type: "startVote" });
}

const impostors = (s) => Object.keys(s.round.roles).filter((id) => s.round.roles[id] === "impostor");

test("civilians see the word, the impostor does not", () => {
  const { s } = table(4);
  const [imp] = impostors(s);
  for (const id of s.round.order) {
    const v = viewFor(s, id);
    const json = JSON.stringify(v);
    if (id === imp) {
      assert.equal(v.card.role, "impostor");
      assert.ok(!json.includes(s.round.word), "impostor view leaks the word");
    } else {
      assert.equal(v.card.word, s.round.word);
      assert.ok(!json.includes('"impostor"'), "civilian view leaks roles");
    }
  }
  assert.notEqual(s.round.roles[s.round.order[0]], "impostor");
});

test("catching the impostor scores the family and offers a last guess", () => {
  const { s } = table(4);
  playToVote(s);
  const [imp] = impostors(s);
  const others = s.round.order.filter((id) => id !== imp);
  others.forEach((id) => apply(s, id, { type: "vote", target: imp }));
  apply(s, imp, { type: "vote", target: others[0] });
  assert.equal(s.phase, "guess");
  assert.ok(viewFor(s, imp).round.guessOptions.includes(s.round.word));
  apply(s, imp, { type: "guess", word: s.round.word });
  assert.equal(s.phase, "results");
  assert.equal(s.players.find((p) => p.id === imp).score, 2);
  others.forEach((id) => assert.equal(s.players.find((p) => p.id === id).score, 3));
});

test("two impostors: catching one triggers another vote", () => {
  const { s } = table(6, { twoImpostors: true, lastChance: false });
  const [a, b] = impostors(s);
  assert.ok(b, "two impostors dealt");
  playToVote(s);
  s.round.order.forEach((id) => apply(s, id, { type: "vote", target: id === a ? b : a }));
  assert.equal(s.phase, "vote");
  assert.deepEqual(s.round.eliminated, [a]);
  assert.ok(!viewFor(s, a).round.candidates.length, "eliminated player cannot vote");
  s.round.order.filter((id) => id !== a).forEach((id) => apply(s, id, { type: "vote", target: id === b ? s.round.order.find((x) => x !== a && x !== b) : b }));
  assert.equal(s.phase, "results");
  assert.match(s.round.summary.join(" "), /All impostors caught/);
});

test("optional roles are dealt and the accomplice knows the impostor", () => {
  const { s } = table(6, { accomplice: true, jester: true, detective: true });
  const roles = Object.values(s.round.roles).sort();
  assert.deepEqual(roles, ["accomplice", "civilian", "civilian", "detective", "impostor", "jester"]);
  const acc = Object.keys(s.round.roles).find((id) => s.round.roles[id] === "accomplice");
  assert.deepEqual(viewFor(s, acc).card.impostors, impostors(s));
  const det = Object.keys(s.round.roles).find((id) => s.round.roles[id] === "detective");
  s.round.order.forEach((id) => apply(s, id, { type: "ready" }));
  assert.equal(apply(s, det, { type: "ask", target: impostors(s)[0] }), null);
  assert.equal(viewFor(s, det).card.detective.answer, true);
  assert.notEqual(apply(s, det, { type: "ask", target: acc }), null, "only one question");
});

test("jester wins when voted out", () => {
  const { s } = table(5, { jester: true });
  const jester = Object.keys(s.round.roles).find((id) => s.round.roles[id] === "jester");
  playToVote(s);
  s.round.order.forEach((id) => apply(s, id, { type: "vote", target: id === jester ? s.round.order.find((x) => x !== jester) : jester }));
  assert.equal(s.phase, "results");
  assert.equal(s.players.find((p) => p.id === jester).score, 3);
});

test("no-impostor rounds happen and voting 'none' scores", () => {
  let found = false;
  for (let seed = 1; seed < 200 && !found; seed++) {
    const { s } = table(4, { noImpostor: true }, seed);
    if (impostors(s).length) continue;
    found = true;
    playToVote(s);
    s.round.order.forEach((id) => apply(s, id, { type: "vote", target: NO_IMPOSTOR }));
    assert.equal(s.phase, "results");
    s.players.forEach((p) => assert.equal(p.score, 2));
  }
  assert.ok(found);
});

test("decoy mode gives the impostor a different word without telling them", () => {
  const { s } = table(4, { hint: "decoy" });
  const card = viewFor(s, impostors(s)[0]).card;
  assert.equal(card.role, "civilian");
  assert.notEqual(card.word, s.round.word);
});

test("an away player is still dealt in, and the vote waits for them", () => {
  const rng = seeded(3);
  const s = newGame("ABCD", "p0", "Host");
  ["p1", "p2", "p3"].forEach((id) => addPlayer(s, id, id));
  s.players.find((p) => p.id === "p3").connected = false;
  assert.equal(apply(s, "p0", { type: "start", lastChance: false }, rng), null);
  assert.ok(s.round.order.includes("p3"), "away player dealt in");
  assert.ok(viewFor(s, "p3").card.role !== "waiting");

  s.settings.lastChance = false;
  playToVote(s);
  const [imp] = impostors(s);
  const innocent = s.round.order.find((id) => id !== imp);
  s.round.order.filter((id) => id !== "p3").forEach((id) => apply(s, id, { type: "vote", target: id === imp ? innocent : imp }));
  assert.equal(s.phase, "vote", "still waiting on the away player");
  assert.ok(apply(s, "p1", { type: "closeVote" }), "only the host can count early");
  assert.equal(apply(s, "p0", { type: "closeVote" }), null);
  assert.equal(s.phase, "results");
});

test("an away player can still vote when they come back", () => {
  const { s } = table(4, { lastChance: false });
  playToVote(s);
  const [imp] = impostors(s);
  const late = s.round.order.find((id) => id !== imp);
  s.players.find((p) => p.id === late).connected = false;
  const innocent = s.round.order.find((id) => id !== imp && id !== late);
  s.round.order.filter((id) => id !== late).forEach((id) => apply(s, id, { type: "vote", target: id === imp ? innocent : imp }));
  assert.equal(s.phase, "vote");
  s.players.find((p) => p.id === late).connected = true;
  assert.equal(apply(s, late, { type: "vote", target: imp }), null);
  assert.equal(s.phase, "results");
});

test("the reveal waits for everyone unless the host starts clues", () => {
  const { s } = table(4);
  const [first, ...rest] = s.round.order;
  rest.forEach((id) => apply(s, id, { type: "ready" }));
  assert.equal(s.phase, "reveal");
  assert.ok(apply(s, rest[0] === "p0" ? rest[1] : rest[0], { type: "forceStart" }));
  assert.equal(apply(s, "p0", { type: "forceStart" }), null);
  assert.equal(s.phase, "clues");
  assert.equal(viewFor(s, first).card.role === "waiting", false);
});

test("only the host can change settings or start", () => {
  const s = newGame("ABCD", "p0", "Host");
  addPlayer(s, "p1", "A");
  addPlayer(s, "p2", "B");
  assert.notEqual(apply(s, "p1", { type: "start" }), null);
  assert.notEqual(apply(s, "p1", { type: "settings", settings: { jester: true } }), null);
  assert.equal(s.settings.jester, false);
});

test("a repeated Done can't skip the next player's turn", () => {
  const { s } = table(4);
  s.round.order.forEach((id) => apply(s, id, { type: "ready" }));
  const key = viewFor(s, "p0").round.turnKey;
  const [first, second] = s.round.order;
  assert.equal(apply(s, first, { type: "clueDone", turn: key }), null);
  assert.ok(apply(s, first, { type: "clueDone", turn: key }), "resent tap rejected");
  assert.ok(apply(s, "p0", { type: "clueDone", turn: key }), "host's stale skip rejected");
  assert.equal(s.round.order[s.round.turn], second);
});

test("a tap from an earlier moment is ignored", () => {
  const { s, rng } = table(4, { lastChance: false });
  const late = s.round.order.find((id) => id !== "p0");
  const readyMoment = viewFor(s, late).moment;
  apply(s, "p0", { type: "forceStart" });
  playToVote(s);
  apply(s, "p0", { type: "closeVote" }, rng);
  apply(s, "p0", { type: "next" }, rng);
  assert.ok(apply(s, late, { type: "ready", moment: readyMoment }), "last round's Ready rejected");
  assert.equal(s.round.ready[late], undefined);
  assert.equal(apply(s, late, { type: "ready", moment: viewFor(s, late).moment }), null);
});
