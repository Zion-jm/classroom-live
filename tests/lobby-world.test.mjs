import test from "node:test";
import assert from "node:assert/strict";
import {
  createGarden,
  LobbyWorld,
  ACTIONS,
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
    for (const action of ACTIONS)
      assert.ok(actions.has(action), `Missing ${action}`);
  }
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
