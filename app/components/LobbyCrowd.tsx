import type { CSSProperties } from "react";

type Player = { id: string; name: string };
const colors = ["#b8cf82", "#edbd8c", "#9ecac6", "#c4b4dc", "#e8aaa3"];

export default function LobbyCrowd({ players, playerId, onRemove }: {
  players: Player[];
  playerId?: string | null;
  onRemove?: (id: string) => void;
}) {
  return (
    <div className="crowd-garden" aria-label="Students waiting in the lobby">
      <div className="crowd-garden-caption" aria-hidden="true">A little company before the quiz</div>
      {!players.length ? <p className="crowd-empty">The garden is quiet. Share the code to invite your crowd.</p> : (
        <ul className="crowd-cast">
          {players.map((p) => {
            const seed = Array.from(p.id).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
            return (
              <li className={`crowd-member ${p.id === playerId ? "is-you" : ""}`} key={p.id}
                style={{ "--character-color": colors[seed % colors.length], "--character-delay": `${-(seed % 80) / 10}s`, "--character-speed": `${4 + seed % 4}s` } as CSSProperties}>
                <div className="crowd-character-space" aria-hidden="true">
                  <span className="crowd-shadow" />
                  <svg className={`crowd-character crowd-action-${seed % 3}`} viewBox="0 0 100 110" fill="none">
                    <path className="crowd-leg left" d="M39 77L34 96L23 96" />
                    <path className="crowd-leg right" d="M60 77L65 96L76 96" />
                    <path className="crowd-arm left" d="M25 49Q8 50 12 33" />
                    <path className="crowd-arm right" d="M75 49Q92 50 88 33" />
                    <rect x="23" y="17" width="54" height="66" rx="25" fill="var(--character-color)" stroke="#244d3f" strokeWidth="2.5" />
                    <g className="crowd-face">
                      <circle cx="39" cy="43" r="3" fill="#244d3f" />
                      <circle cx="61" cy="43" r="3" fill="#244d3f" />
                      <path d="M43 55Q50 62 57 55" stroke="#244d3f" strokeWidth="2.5" strokeLinecap="round" />
                    </g>
                    <circle cx="32" cy="53" r="5" fill="#fff" opacity=".3" />
                    <circle cx="68" cy="53" r="5" fill="#fff" opacity=".3" />
                  </svg>
                </div>
                <div className="crowd-nameplate">
                  <span className="crowd-name" title={p.name}>{p.name}</span>
                  {p.id === playerId && <small>You</small>}
                  {onRemove && <button type="button" aria-label={`Remove ${p.name}`} onClick={() => onRemove(p.id)}>×</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
