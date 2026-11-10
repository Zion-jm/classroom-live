"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createGarden,
  LobbyWorld,
  playerSeed,
  TILE,
} from "../../lib/lobby-world.mjs";

type Player = { id: string; name: string };
const shirts = [
  "#e7ad73",
  "#8bbac7",
  "#b09ccc",
  "#ca8085",
  "#8ba76c",
  "#e5c46e",
];
const skins = ["#f0c9a0", "#c68c62", "#8f5e46", "#e6ad86"];
const hair = ["#443b37", "#86563d", "#d4ad65", "#353d48"];

function Tree({
  x,
  y,
  small = false,
}: {
  x: number;
  y: number;
  small?: boolean;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${small ? 0.7 : 1})`}>
      <ellipse cy="15" rx="23" ry="8" fill="#436a4b" opacity=".16" />
      <path d="M-4-5H4V17H-4Z" fill="#8b6d4b" />
      <path d="M0-3H4V17H0Z" fill="#6f563e" />
      <path
        d="M-24-32H-18V-44H-8V-50H10V-44H20V-34H26V-12H18V-4H-18V-10H-26V-27H-24Z"
        fill="#507e58"
      />
      <path
        d="M-22-32H-16V-42H-6V-47H9V-41H17V-31H22V-20H14V-13H-12V-18H-22Z"
        fill="#719b63"
      />
      <path d="M-13-33H-8V-41H3V-34H10V-26H-2V-22H-13Z" fill="#91b778" />
      <path d="M-19-11H-7V-7H-19ZM14-22H22V-15H14Z" fill="#3e684b" />
    </g>
  );
}

function Character({ seed }: { seed: number }) {
  const skin = skins[seed % skins.length],
    shirt = shirts[seed % shirts.length];
  return (
    <g className="garden-sprite" shapeRendering="crispEdges">
      <g className="garden-sprite-body">
        <g className="garden-leg garden-leg-left">
          <path d="M-8-13H-1V-3H-9V0H-12V-5H-8Z" fill="#3f5364" />
          <path d="M-12-4H-1V0H-12Z" fill="#354048" />
        </g>
        <g className="garden-leg garden-leg-right">
          <path d="M2-13H9V-4H12V0H2Z" fill="#52677a" />
          <path d="M2-4H13V0H2Z" fill="#354048" />
        </g>
        <path d="M-9-26H9V-13H-9Z" fill={shirt} />
        <path d="M-9-16H9V-12H-9Z" fill="#354048" opacity=".2" />
        <g className="garden-hand garden-hand-left">
          <path d="M-13-25H-8V-14H-13Z" fill={shirt} />
          <path d="M-13-18H-9V-13H-13Z" fill={skin} />
        </g>
        <g className="garden-hand garden-hand-right">
          <path d="M8-25H13V-14H8Z" fill={shirt} />
          <path d="M9-18H13V-13H9Z" fill={skin} />
        </g>
        <path d="M-3-28H4V-23H-3Z" fill={skin} />
        <path d="M-10-40H9V-36H12V-28H8V-24H-8V-28H-12V-36H-10Z" fill={skin} />
        <path
          d="M-11-39H-7V-44H7V-41H11V-34H7V-38H-5V-34H-11Z"
          fill={hair[seed % hair.length]}
        />
        {seed % 3 === 0 && (
          <path d="M-10-43H9V-40H14V-37H-12V-40H-10Z" fill={shirt} />
        )}
        <g className="garden-face">
          <path d="M-6-32H-3V-29H-6ZM4-32H7V-29H4Z" fill="#3e3938" />
          <path d="M-2-26H4V-25H-2Z" fill="#ac6c5a" />
        </g>
        <path
          className="garden-back-hair"
          d="M-10-39H10V-27H7V-25H-7V-28H-10Z"
          fill={hair[seed % hair.length]}
        />
        <g className="garden-book">
          <path
            d="M-12-23L0-20L12-23V-12L0-9L-12-12Z"
            fill="#fff5d7"
            stroke="#8a6748"
            strokeWidth="1.5"
          />
          <path d="M0-20V-9" stroke="#8a6748" />
        </g>
        <g className="garden-five-palm garden-five-palm-right">
          <path
            d="M10-24L12-34L14-44"
            stroke={skin}
            strokeWidth="5"
            fill="none"
          />
          <path d="M11-48H17V-42H11Z" fill={skin} />
        </g>
        <g className="garden-five-palm garden-five-palm-left">
          <path
            d="M-10-24L-12-34L-14-44"
            stroke={skin}
            strokeWidth="5"
            fill="none"
          />
          <path d="M-17-48H-11V-42H-17Z" fill={skin} />
        </g>
      </g>
    </g>
  );
}

export default function LobbyCrowd({
  players,
  playerId,
  onRemove,
}: {
  players: Player[];
  playerId?: string | null;
  onRemove?: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const actors = useRef(new Map<string, SVGGElement>());
  const [cols, setCols] = useState(18),
    [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const rows = cols < 12 ? 14 : 12;
  const world = useMemo(
    () => new LobbyWorld(createGarden(cols, rows)),
    [cols, rows],
  );
  const ids = JSON.stringify(players.map((p) => p.id));
  const width = cols * TILE,
    height = rows * TILE;
  const picked = players.find((p) => p.id === selected);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setCols(
        Math.max(9, Math.min(18, Math.floor(entry.contentRect.width / 40))),
      ),
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    world.sync(JSON.parse(ids));
  }, [world, ids]);
  useEffect(() => {
    let frame = 0,
      last = 0,
      painted = 0,
      visible = true,
      disposed = false;
    const paint = () => {
      const agents = [...world.agents.values()];
      for (const [index, a] of agents.entries()) {
        const el = actors.current.get(a.id);
        if (!el) continue;
        el.setAttribute(
          "transform",
          `translate(${a.x.toFixed(2)} ${a.y.toFixed(2)})`,
        );
        el.dataset.action = a.action;
        el.dataset.direction = a.direction;
        el.dataset.partner = a.partner || "";
        el.style.setProperty(
          "--action-delay",
          `${-(world.time - a.actionStarted)}s`,
        );
        el.style.setProperty(
          "--social-side",
          a.direction === "right" ? "1" : "-1",
        );
        const emote = el.querySelector(".garden-emote text");
        const symbol =
          a.action === "hug"
            ? "♥"
            : a.action === "highfive"
              ? "✦"
              : a.action === "slip"
                ? "?!"
                : "♪";
        if (emote && emote.textContent !== symbol) emote.textContent = symbol;
        // Keep labels clear of neighboring bodies and of each other in a full class.
        el.dataset.label = agents.some(
          (b, j) =>
            b.id !== a.id &&
            ((Math.abs(b.x - a.x) < 42 &&
              b.y > a.y + 5 &&
              b.y - 44 < a.y + 20) ||
              (j < index &&
                Math.abs(b.x - a.x) < 55 &&
                Math.abs(b.y - a.y) < 15)),
        )
          ? "hidden"
          : "visible";
      }
    };
    const tick = (now: number) => {
      if (disposed) return;
      if (last) world.step((now - last) / 1000);
      last = now;
      if (now - painted >= 32) {
        paint();
        painted = now;
      }
      frame = requestAnimationFrame(tick);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      last = 0;
      if (!disposed && !paused && !reduced && visible && !document.hidden)
        frame = requestAnimationFrame(tick);
      paint();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      schedule();
    });
    if (container.current) observer.observe(container.current);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [world, ids, paused, reduced]);

  return (
    <div
      className="garden-lobby"
      ref={container}
      data-paused={paused || reduced}
    >
      <div className="garden-toolbar">
        <div>
          <span className="garden-live-dot" />
          <strong>The gathering garden</strong>
          <small>A little room to wander.</small>
        </div>
        <button
          type="button"
          className="garden-pause"
          aria-pressed={paused || reduced}
          disabled={reduced}
          onClick={() => setPaused(!paused)}
        >
          {paused || reduced ? "▶ Play" : "Ⅱ Pause"}
          <span className="garden-sr-only"> character movement</span>
        </button>
      </div>
      <div className="garden-map-wrap">
        <svg
          className="garden-map"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Garden with ${players.length} waiting students. Characters wander and perform playful actions.`}
        >
          <defs>
            <pattern
              id="garden-grass"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <rect width="40" height="40" fill="#a9c58a" />
              <path
                d="M6 14H9V12M29 32H32V30M18 5H20"
                fill="none"
                stroke="#8eaf72"
                strokeWidth="2"
              />
              <path d="M22 21H25" stroke="#c1d69c" strokeWidth="2" />
            </pattern>
            <pattern
              id="garden-paving"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <rect width="40" height="40" fill="#e8dcb9" />
              <path
                d="M0 0H40V40H0Z"
                fill="none"
                stroke="#d7cba9"
                strokeWidth="1"
              />
              <path d="M3 3H18M24 37H37" stroke="#f3e9ce" strokeWidth="2" />
            </pattern>
          </defs>
          <rect width={width} height={height} fill="url(#garden-grass)" />
          <rect
            x="27"
            y="65"
            width={width - 54}
            height={height - 88}
            rx="8"
            fill="#7b9e65"
            opacity=".4"
          />
          <rect
            x="23"
            y="61"
            width={width - 46}
            height={height - 88}
            fill="url(#garden-paving)"
          />
          <path
            d={`M${width / 2 - 34} ${height - 30}V${height}H${width / 2 + 34}V${height - 30}`}
            fill="#e8dcb9"
          />
          <g shapeRendering="crispEdges">
            {/* A low fence frames the courtyard without covering the walking area. */}
            {Array.from({ length: cols - 1 }, (_, i) => (
              <g key={i} transform={`translate(${20 + i * 40} 25)`}>
                <path d="M0 0H40V5H0ZM0 13H40V18H0Z" fill="#d5b984" />
                <path d="M0-5H7V25H0Z" fill="#f0d6a2" />
                <path d="M5-5H8V25H5Z" fill="#b49768" />
              </g>
            ))}
            <Tree x={30} y={76} />
            <Tree x={width - 30} y={76} />
            <Tree x={23} y={height - 28} small />
            <Tree x={width - 23} y={height - 28} small />
            <g transform={`translate(${width / 2} 35)`}>
              <path d="M-38-13H38V14H-38Z" fill="#876c4c" />
              <path d="M-35-10H35V10H-35Z" fill="#f4e7be" />
              <text
                y="3"
                textAnchor="middle"
                fontSize="9"
                fontWeight="700"
                letterSpacing="1"
                fill="#53664e"
              >
                QUIZ GARDEN
              </text>
            </g>
            {world.garden.benches.map(([x, y]: number[], i: number) => (
              <g
                key={i}
                transform={`translate(${(x + 0.5) * TILE} ${(y + 0.5) * TILE})`}
              >
                <rect
                  x="-17"
                  y="-18"
                  width="34"
                  height="25"
                  fill="#48664a"
                  opacity=".18"
                />
                <path d="M-16-10H-12V9H-16ZM12-10H16V9H12Z" fill="#526052" />
                <path d="M-18-23H18V-7H-18ZM-18-5H18V1H-18Z" fill="#a4774d" />
                <path
                  d="M-17-21H17M-17-15H17M-17-3H17"
                  stroke="#d6a46a"
                  strokeWidth="3"
                />
              </g>
            ))}
            <g
              transform={`translate(${world.garden.cx * TILE} ${world.garden.cy * TILE})`}
            >
              <ellipse cy="10" rx="35" ry="27" fill="#6d795d" opacity=".2" />
              <path d="M-32-20H32V22H-32Z" fill="#abaf9d" />
              <path d="M-32-26H32V15H-32Z" fill="#c4c8b3" />
              <path d="M-25-20H25V8H-25Z" fill="#78b8bf" />
              <path d="M-19-15H19M-17 2H17" stroke="#b7e1db" strokeWidth="3" />
              <path d="M-5-30H5V-6H-5Z" fill="#9ca993" />
              <path d="M-12-34H12V-27H-12Z" fill="#d8dcc7" />
              <path
                className="garden-water"
                d="M-3-36V-42H3V-36M-10-23V-15M10-23V-15"
                stroke="#dbf2e4"
                strokeWidth="3"
              />
            </g>
            {[65, width - 65].map((x, i) => (
              <g key={i} transform={`translate(${x} ${height - 12})`}>
                <path d="M-15-7H15V4H-15Z" fill="#9b7454" />
                <path d="M-12-10H12V-4H-12Z" fill="#628359" />
                <path d="M-9-16V-7M7-18V-7" stroke="#50744f" strokeWidth="2" />
                <path d="M-12-18H-6V-12H-12Z" fill="#efc86e" />
                <path d="M4-20H10V-14H4Z" fill="#d99286" />
              </g>
            ))}
          </g>
          {players.map((p) => {
            const seed = playerSeed(p.id);
            return (
              <g
                key={p.id}
                ref={(el) => {
                  if (el) actors.current.set(p.id, el);
                  else actors.current.delete(p.id);
                }}
                transform="translate(-100 -100)"
                className={`garden-actor ${p.id === playerId ? "garden-you" : ""} ${p.id === selected ? "garden-selected" : ""}`}
                onClick={() => setSelected(p.id)}
                data-player-id={p.id}
              >
                <title>
                  {p.name}
                  {p.id === playerId ? " (You)" : ""}
                </title>
                <ellipse
                  className="garden-actor-shadow"
                  cy="1"
                  rx="13"
                  ry="4"
                  fill="#5b6a4b"
                  opacity=".23"
                />
                <ellipse
                  className="garden-selection-ring"
                  cy="1"
                  rx="17"
                  ry="6"
                  fill="none"
                  stroke="#fff9cf"
                  strokeWidth="2"
                />
                <Character seed={seed} />
                <g className="garden-dust" fill="#fff7d6" aria-hidden="true">
                  <path d="M-17-4H-14V-1H-17ZM12-2H16V1H12ZM-6 3H-3V6H-6Z" />
                </g>
                <g className="garden-emote">
                  <rect
                    x="-10"
                    y="-66"
                    width="20"
                    height="17"
                    rx="4"
                    fill="#fffdf0"
                  />
                  <path d="M-3-50L0-46L4-50" fill="#fffdf0" />
                  <text
                    y="-54"
                    textAnchor="middle"
                    fontSize="10"
                    fill="#54684d"
                  >
                    ♪
                  </text>
                </g>
                <g className="garden-label">
                  <rect
                    x="-27"
                    y="6"
                    width="54"
                    height="14"
                    rx="4"
                    fill={p.id === playerId ? "#315748" : "#fffaf0"}
                    opacity=".96"
                  />
                  <text
                    y="16"
                    textAnchor="middle"
                    fontSize="9"
                    fill={p.id === playerId ? "#fff9df" : "#354d40"}
                  >
                    {Array.from(p.name).slice(0, 8).join("")}
                    {Array.from(p.name).length > 8 ? "…" : ""}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
        {!players.length && (
          <div className="garden-empty">
            <strong>Your crowd starts here.</strong>
            <span>Share the code. Watch the garden come to life.</span>
          </div>
        )}
      </div>
      <div className="garden-caption">
        <span>
          {players.length
            ? "Little adventures before the quiz begins."
            : "A quiet moment before everyone arrives."}
        </span>
        <span>
          {paused || reduced ? "Movement paused" : "✦ Make yourself at home"}
        </span>
      </div>
      {picked && (
        <div className="garden-selected-person" role="status">
          <span>
            <strong>{picked.name}</strong>
            {picked.id === playerId ? " · You" : " · In the garden"}
          </span>
          <button
            type="button"
            onClick={() => setSelected(null)}
            aria-label="Close selected student"
          >
            ×
          </button>
        </div>
      )}
      <details className="garden-roster">
        <summary>
          See everyone <span>{players.length} joined</span>
        </summary>
        <ul>
          {players.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="garden-find"
                aria-pressed={selected === p.id}
                onClick={() => setSelected(selected === p.id ? null : p.id)}
              >
                <span
                  className="garden-roster-dot"
                  style={{
                    background: shirts[playerSeed(p.id) % shirts.length],
                  }}
                />
                <span>{p.name}</span>
                {p.id === playerId && <small>You</small>}
              </button>
              {onRemove && (
                <button
                  type="button"
                  className="garden-remove"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => onRemove(p.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
