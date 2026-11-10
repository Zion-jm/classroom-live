import test from "node:test";
import assert from "node:assert/strict";
import {
  createGarden,
  LobbyWorld,
  ACTIONS,
  SOCIAL_ACTIONS,
  TILE,
} from "../lib/lobby-world.mjs";

const ids = Array.from({ length: 50 }, (_, i) => `student-${i}`);
function checkWorld(world) {
  const reserved = new Set();
  for (const a of world.agents.values()) {
    for (const cell of [a.cell, a.next].filter(Boolean)) {
      assert.ok(
        world.garden.walkable.has(cell),
        "A student entered scenery or left the courtyard",
      );
      assert.ok(
        !reserved.has(cell),
        "Two students occupied or reserved the same space",
      );
      reserved.add(cell);
    }
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
    if (a.partner) {
      const b = world.agents.get(a.partner);
      assert.equal(b.partner, a.id);
      assert.equal(a.action, b.action);
      assert.equal(a.actionStarted, b.actionStarted);
      assert.equal(a.until, b.until);
      assert.equal(a.next, null);
      assert.equal(a.path.length, 0);
      assert.equal(a.y, b.y);
      assert.equal(Math.abs(a.x - b.x), TILE);
    }
  }
}

test("a full class stays inside paths and avoids other students while roaming", () => {
  for (const cols of [9, 12, 18]) {
    const world = new LobbyWorld(createGarden(cols, cols < 12 ? 14 : 12));
    world.sync(ids);
    assert.equal(world.agents.size, 50);
    const origins = new Map(
      [...world.agents].map(([id, a]) => [id, [a.x, a.y]]),
    );
    const moved = new Set(),
      actions = new Set();
    for (let i = 0; i < 3600; i++) {
      world.step(0.1);
      checkWorld(world);
      for (const a of world.agents.values()) {
        const [x, y] = origins.get(a.id);
        if (Math.hypot(x - a.x, y - a.y) > TILE) moved.add(a.id);
        actions.add(a.action);
      }
    }
    assert.equal(moved.size, 50, "Every student should get a chance to walk");
    for (const action of [...ACTIONS, ...SOCIAL_ACTIONS])
      assert.ok(actions.has(action), `Missing ${action}`);
  }
});

function adjacentPair() {
  const world = new LobbyWorld();
  world.sync(["left", "right", "third"]);
  const a = world.agents.get("left"),
    b = world.agents.get("right");
  for (const [actor, x] of [
    [a, 3],
    [b, 4],
  ]) {
    actor.cell = `${x},3`;
    actor.x = (x + 0.5) * TILE;
    actor.y = 3.5 * TILE;
    actor.socialAfter = 0;
    actor.until = 0;
  }
  return { world, a, b };
}

test("paired actions share a clock, finish together, and keep their cells", () => {
  for (const action of SOCIAL_ACTIONS) {
    const { world, a, b } = adjacentPair();
    for (let seed = 0; seed < 1000; seed++) {
      a.random = seed;
      if (world.trySocial(a)) {
        if (a.action === action) break;
        world.finishSocial(a);
        a.socialAfter = b.socialAfter = 0;
      }
    }
    assert.equal(a.action, action);
    const cells = [a.cell, b.cell];
    for (let i = 0; i < 30; i++) {
      world.step(0.1);
      checkWorld(world);
    }
    assert.deepEqual([a.cell, b.cell], cells);
    assert.equal(a.partner, b.id);
    for (let i = 0; i < 8; i++) world.step(0.1);
    assert.equal(a.partner, null);
    assert.equal(b.partner, null);
    assert.equal(a.action, "idle");
    assert.equal(b.action, "idle");
    assert.ok(
      a.socialAfter > world.time,
      "Allow time to walk between greetings",
    );
  }
});

test("leaving during a greeting releases the remaining student and allows walking", () => {
  const { world, a, b } = adjacentPair();
  while (!world.trySocial(a)) {}
  world.step(0.1);
  world.sync([a.id]);
  assert.equal(a.partner, null);
  assert.equal(a.action, "idle");
  assert.ok(!world.agents.has(b.id));
  const origin = [a.x, a.y];
  for (let i = 0; i < 100; i++) {
    world.step(0.1);
    checkWorld(world);
  }
  assert.notDeepEqual([a.x, a.y], origin);
});

test("server roster refreshes keep positions and removal frees reserved spaces", () => {
  const world = new LobbyWorld();
  world.sync(ids.slice(0, 12));
  for (let i = 0; i < 40; i++) world.step(0.1);
  const actor = world.agents.get(ids[0]),
    x = actor.x;
  world.sync([...ids.slice(0, 12)]);
  assert.equal(world.agents.get(ids[0]), actor);
  assert.equal(actor.x, x);
  world.sync(ids.slice(1, 13));
  assert.ok(!world.agents.has(ids[0]));
  assert.ok(world.agents.has(ids[12]));
  checkWorld(world);
  world.sync([]);
  assert.equal(world.occupied().size, 0);
});

test("movement speed is independent of frame rate and background gaps are bounded", () => {
  const a = new LobbyWorld(),
    b = new LobbyWorld();
  a.sync(["one"]);
  b.sync(["one"]);
  for (let i = 0; i < 600; i++) a.step(1 / 60);
  for (let i = 0; i < 300; i++) b.step(1 / 30);
  assert.ok(Math.abs(a.time - b.time) < 0.01);
  const before = a.time;
  a.step(300);
  assert.ok(a.time - before <= 0.10001);
  const actor = a.agents.get("one");
  assert.ok(actor.x >= TILE && actor.x < a.garden.cols * TILE);
});
