// Local, decorative movement only; the quiz server remains the source of membership.
export const TILE = 40;
export const ACTIONS = [
  "wave",
  "dance",
  "read",
  "stretch",
  "idle",
  "slip",
  "hop",
];
export const SOCIAL_ACTIONS = ["highfive", "hug"];
export function playerSeed(id) {
  return Array.from(id).reduce(
    (n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0,
    0,
  );
}

export function createGarden(cols = 18, rows = 12) {
  const cx = Math.floor(cols / 2),
    cy = Math.floor(rows / 2);
  const blocked = new Set([
    `${cx},${cy}`,
    `${cx - 1},${cy}`,
    `${cx},${cy - 1}`,
    `${cx - 1},${cy - 1}`,
  ]);
  const benches = [
    [1, 3],
    [cols - 2, rows - 3],
  ];
  benches.forEach(([x, y]) => blocked.add(`${x},${y}`));
  const cells = [];
  for (let y = 2; y < rows - 1; y++)
    for (let x = 1; x < cols - 1; x++) {
      if (!blocked.has(`${x},${y}`)) cells.push({ x, y, key: `${x},${y}` });
    }
  return {
    cols,
    rows,
    cx,
    cy,
    benches,
    cells,
    walkable: new Set(cells.map((c) => c.key)),
  };
}

/** @typedef {{id:string, cell:string, next:string|null, path:string[], x:number, y:number, fromX:number, fromY:number, started:number, duration:number, until:number, action:string, actionStarted:number, partner:string|null, socialAfter:number, direction:string, random:number}} Agent */
/** @param {Agent} agent */
function random(agent) {
  agent.random = (Math.imul(agent.random, 1664525) + 1013904223) >>> 0;
  return agent.random / 4294967296;
}
function point(key) {
  return key.split(",").map(Number);
}
function neighbors(key) {
  const [x, y] = point(key);
  return [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`];
}

export class LobbyWorld {
  /** @type {Map<string, Agent>} */
  agents = new Map();
  time = 0;
  constructor(garden = createGarden()) {
    this.garden = garden;
  }

  /** Keep existing actors when the server sends a fresh roster object. */
  sync(ids) {
    const active = new Set(ids);
    for (const id of this.agents.keys())
      if (!active.has(id)) this.agents.delete(id);
    for (const a of this.agents.values())
      if (a.partner && !this.agents.has(a.partner)) this.finishSocial(a);
    const taken = this.occupied();
    for (const id of ids) {
      if (this.agents.has(id)) continue;
      const seed = playerSeed(id);
      const free = this.garden.cells.filter((c) => !taken.has(c.key));
      const cell = free[seed % free.length];
      if (!cell) continue;
      taken.add(cell.key);
      this.agents.set(id, {
        id,
        cell: cell.key,
        next: null,
        path: [],
        x: (cell.x + 0.5) * TILE,
        y: (cell.y + 0.5) * TILE,
        fromX: 0,
        fromY: 0,
        started: 0,
        duration: 0,
        until: this.time + 0.3 + (seed % 20) / 10,
        action: "idle",
        actionStarted: this.time,
        partner: null,
        socialAfter: this.time + 2,
        direction: "down",
        random: seed,
      });
    }
  }

  occupied(except) {
    const cells = new Set();
    for (const a of this.agents.values())
      if (a.id !== except) {
        cells.add(a.cell);
        if (a.next) cells.add(a.next);
      }
    return cells;
  }

  route(agent, occupied) {
    const visited = new Set([agent.cell]),
      queue = [[agent.cell]];
    const choices = [];
    for (let i = 0; i < queue.length; i++) {
      const path = queue[i],
        last = path[path.length - 1];
      if (path.length > 2) choices.push(path.slice(1));
      if (path.length >= 8) continue;
      for (const key of neighbors(last)) {
        if (
          !visited.has(key) &&
          this.garden.walkable.has(key) &&
          !occupied.has(key)
        ) {
          visited.add(key);
          queue.push([...path, key]);
        }
      }
    }
    return choices.length
      ? choices[Math.floor(random(agent) * choices.length)]
      : [];
  }

  /** Both participants keep their own tiles reserved throughout the greeting. */
  trySocial(a) {
    if (
      a.partner ||
      a.next ||
      a.path.length ||
      this.time < a.socialAfter ||
      random(a) > 0.45
    )
      return false;
    const b = [...this.agents.values()].find(
      (b) =>
        b.id !== a.id &&
        !b.partner &&
        !b.next &&
        !b.path.length &&
        this.time >= b.socialAfter &&
        !["slip", "hop"].includes(b.action) &&
        b.y === a.y &&
        Math.abs(b.x - a.x) === TILE,
    );
    if (!b) return false;
    const action =
      SOCIAL_ACTIONS[Math.floor(random(a) * SOCIAL_ACTIONS.length)];
    for (const [actor, partner] of [
      [a, b],
      [b, a],
    ]) {
      actor.partner = partner.id;
      actor.action = action;
      actor.actionStarted = this.time;
      actor.until = this.time + 3.6;
      actor.direction = partner.x > actor.x ? "right" : "left";
      actor.path = [];
    }
    return true;
  }

  finishSocial(a) {
    const b = this.agents.get(a.partner);
    for (const actor of [a, b])
      if (actor) {
        actor.partner = null;
        actor.action = "idle";
        actor.actionStarted = this.time;
        actor.until = this.time + 0.4;
        actor.socialAfter = this.time + 8 + random(actor) * 8;
      }
  }

  /** Advance in seconds. Clamping prevents a background tab from jumping ahead. */
  step(delta) {
    this.time += Math.max(0, Math.min(delta, 0.1));
    for (const a of this.agents.values())
      if (a.partner && (this.time >= a.until || !this.agents.has(a.partner)))
        this.finishSocial(a);
    for (const a of this.agents.values()) {
      if (a.partner) continue;
      if (a.next) {
        const progress = Math.min(1, (this.time - a.started) / a.duration);
        const [x, y] = point(a.next);
        a.x = a.fromX + ((x + 0.5) * TILE - a.fromX) * progress;
        a.y = a.fromY + ((y + 0.5) * TILE - a.fromY) * progress;
        if (progress < 1) continue;
        a.cell = a.next;
        a.next = null;
      }
      if (this.time < a.until) continue;
      if (this.trySocial(a)) continue;
      const occupied = this.occupied(a.id);
      if (!a.path.length && a.action !== "walk")
        a.path = this.route(a, occupied);
      const next = a.path[0];
      if (next && !occupied.has(next)) {
        a.path.shift();
        a.next = next;
        a.fromX = a.x;
        a.fromY = a.y;
        a.started = this.time;
        a.duration = 0.65 + random(a) * 0.3;
        const [x, y] = point(next),
          [px, py] = point(a.cell);
        a.direction =
          x > px ? "right" : x < px ? "left" : y > py ? "down" : "up";
        a.action = "walk";
        a.actionStarted = this.time;
      } else {
        a.path = [];
        a.action = ACTIONS[Math.floor(random(a) * ACTIONS.length)];
        a.actionStarted = this.time;
        a.direction = "down";
        a.until =
          this.time +
          (["slip", "hop"].includes(a.action) ? 3.6 : 1.8 + random(a) * 3.5);
      }
    }
  }
}
