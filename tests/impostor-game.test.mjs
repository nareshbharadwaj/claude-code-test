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

test("a disconnected player does not block voting", () => {
  const { s } = table(4, { lastChance: false });
  playToVote(s);
  const [imp] = impostors(s);
  const gone = s.round.order.find((id) => id !== imp && id !== "p0");
  s.players.find((p) => p.id === gone).connected = false;
  const innocent = s.round.order.find((id) => id !== imp);
  s.round.order.filter((id) => id !== gone).forEach((id) => apply(s, id, { type: "vote", target: id === imp ? innocent : imp }));
  assert.equal(s.phase, "results");
});

test("only the host can change settings or start", () => {
  const s = newGame("ABCD", "p0", "Host");
  addPlayer(s, "p1", "A");
  addPlayer(s, "p2", "B");
  assert.notEqual(apply(s, "p1", { type: "start" }), null);
  assert.notEqual(apply(s, "p1", { type: "settings", settings: { jester: true } }), null);
  assert.equal(s.settings.jester, false);
});
