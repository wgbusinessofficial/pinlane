import React, { useState, useEffect, useMemo, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  constants                                                          */
/* ------------------------------------------------------------------ */

const ALL_PINS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const BACK_ROW = [7, 8, 9, 10];
const LEFT_SIDE = [2, 4, 7, 8];
const RIGHT_SIDE = [3, 6, 9, 10];

// rack drawn from the bowler's view: back row on top, headpin at the bottom
const RACK_ROWS = [
  [7, 8, 9, 10],
  [4, 5, 6],
  [2, 3],
  [1],
];

// pins that physically touch — used for split detection
const NEIGHBORS = {
  1: [2, 3],
  2: [1, 3, 4, 5],
  3: [1, 2, 5, 6],
  4: [2, 5, 7, 8],
  5: [2, 3, 4, 6, 8, 9],
  6: [3, 5, 9, 10],
  7: [4, 8],
  8: [4, 5, 7, 9],
  9: [5, 6, 8, 10],
  10: [6, 9],
};

const HITS = [
  { id: "pocket", label: "Pocket", note: "caught the right edge of the head pin" },
  { id: "nose", label: "Nose", note: "dead flush on the head pin \u2014 too much of it" },
  { id: "brooklyn", label: "Brooklyn", note: "crossed past the head pin to the left side" },
  { id: "right", label: "Missed right", note: "came up short \u2014 too little head pin" },
];

// starting order for the one-tap leaves (right-handed), replaced by the
// bowler's own frequencies as soon as there are logged games
const SEED_LEAVES = [
  [10],
  [7],
  [5],
  [3, 6, 10],
  [2, 4, 5, 8],
  [4],
  [6, 10],
  [9],
  [8],
  [3, 10],
  [2, 8, 10],
  [1, 2, 4, 10],
  [4, 7],
  [5, 7],
  [8, 10],
  [4, 6, 7, 10],
];

const STYLES = [
  { id: "two", label: "Two-handed" },
  { id: "one", label: "One-handed" },
];
const styleLabel = (id) =>
  (STYLES.find((x) => x.id === id) || STYLES[0]).label;

// 3-6-9 spare system, right-handed: keep the same target, move your feet.
// Positive = boards LEFT of your strike stance, negative = boards RIGHT.
const SPARE_MOVE = {
  1: 0, 5: 0,
  3: 3, 9: 3,
  6: 6,
  10: 9,
  2: -3, 8: -3,
  4: -6,
  7: -9,
};

// the pin you actually aim at for a given leave: the one nearest you on the
// side the cluster sits, so the ball carries the rest through
function keyPin(leave) {
  if (!leave.length) return null;
  if (leave.length === 1) return leave[0];
  const rowOf = (p) => (p === 1 ? 0 : p <= 3 ? 1 : p <= 6 ? 2 : 3);
  const front = Math.min(...leave.map(rowOf));
  const frontPins = leave.filter((p) => rowOf(p) === front);
  // right-side clusters: take the leftmost front pin so the ball drives right
  const rightHeavy =
    leave.filter((p) => RIGHT_SIDE.includes(p)).length >=
    leave.filter((p) => LEFT_SIDE.includes(p)).length;
  return rightHeavy ? Math.min(...frontPins) : Math.max(...frontPins);
}

function spareAim(leave) {
  const kp = keyPin(leave);
  if (kp === null) return null;
  const move = SPARE_MOVE[kp] ?? 0;
  const corner = kp === 10 || kp === 7;
  const split = isSplit(leave);
  return {
    pin: kp,
    move,
    corner,
    split,
    note: split
      ? "Split \u2014 aim to take out the pin you're most likely to make, or fit it between if they're close."
      : corner
      ? "Corner pin. Throw it firmer than your strike ball so it stays straight on the dry."
      : leave.length > 1
      ? `Cover the ${kp} and let the ball carry the rest.`
      : "",
  };
}

const DEFAULT_PINNED = ["10", "7", "5"];

const STORAGE_KEY = "bowling-tracker-v1";
const DEFAULT_BALLS = ["Phaze II 14lb", "House ball"];

/* ------------------------------------------------------------------ */
/*  scoring + analysis                                                 */
/* ------------------------------------------------------------------ */

const emptyFrames = () =>
  Array.from({ length: 10 }, () => ({ throws: [], hit: null }));

function runningScores(frames) {
  const rolls = [];
  frames.forEach((f) => (f.throws || []).forEach((t) => rolls.push(t.length)));
  const scores = new Array(10).fill(null);
  let i = 0;
  let total = 0;

  for (let frame = 0; frame < 10; frame++) {
    const a = rolls[i];
    if (a === undefined) break;

    if (a === 10) {
      const b = rolls[i + 1];
      const c = rolls[i + 2];
      if (b === undefined || c === undefined) break;
      total += 10 + b + c;
      scores[frame] = total;
      i += 1;
    } else {
      const b = rolls[i + 1];
      if (b === undefined) break;
      if (a + b === 10) {
        const c = rolls[i + 2];
        if (c === undefined) break;
        total += 10 + c;
        scores[frame] = total;
        i += 2;
      } else {
        total += a + b;
        scores[frame] = total;
        i += 2;
      }
    }
  }
  return scores;
}

function finalScore(frames) {
  const s = runningScores(frames);
  for (let i = 9; i >= 0; i--) if (s[i] !== null) return s[i];
  return 0;
}

// where we are in the game, and which pins are still up
function cursor(frames) {
  for (let f = 0; f < 10; f++) {
    const th = frames[f].throws;

    if (f < 9) {
      if (th.length === 0) return { frame: f, ball: 0, standing: ALL_PINS };
      if (th[0].length === 10) continue;
      if (th.length === 1)
        return {
          frame: f,
          ball: 1,
          standing: ALL_PINS.filter((p) => !th[0].includes(p)),
        };
      continue;
    }

    // tenth frame
    if (th.length === 0) return { frame: 9, ball: 0, standing: ALL_PINS };
    if (th.length === 1) {
      if (th[0].length === 10) return { frame: 9, ball: 1, standing: ALL_PINS };
      return {
        frame: 9,
        ball: 1,
        standing: ALL_PINS.filter((p) => !th[0].includes(p)),
      };
    }
    if (th.length === 2) {
      const [a, b] = th;
      if (a.length === 10) {
        if (b.length === 10) return { frame: 9, ball: 2, standing: ALL_PINS };
        return {
          frame: 9,
          ball: 2,
          standing: ALL_PINS.filter((p) => !b.includes(p)),
        };
      }
      if (a.length + b.length === 10)
        return { frame: 9, ball: 2, standing: ALL_PINS };
      return { done: true };
    }
    return { done: true };
  }
  return { done: true };
}

// head pin down + standing pins in more than one touching cluster
function isSplit(standing) {
  if (standing.includes(1) || standing.length < 2) return false;
  const seen = new Set([standing[0]]);
  const queue = [standing[0]];
  while (queue.length) {
    const p = queue.pop();
    for (const n of NEIGHBORS[p]) {
      if (standing.includes(n) && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen.size < standing.length;
}

// which ball was in hand for throw k of a frame
function ballFor(game, frame, k) {
  const explicit = frame.throwBalls && frame.throwBalls[k];
  if (explicit) return explicit;
  if (k === 0) return game.ball;
  return game.spareBall || game.ball;
}

// best guess at where the ball hit, read off what it left (right-handed)
function inferHit(standing) {
  if (!standing.length) return "pocket";
  if (isSplit(standing)) return "nose"; // the rack only opens up on a flush hit
  if (standing.every((p) => BACK_ROW.includes(p))) return "pocket";
  if (standing.includes(1)) return "right"; // head pin survived
  const hasL = standing.some((p) => LEFT_SIDE.includes(p));
  const hasR = standing.some((p) => RIGHT_SIDE.includes(p));
  if (hasL && hasR) return "nose"; // rack opened down the middle
  if (hasR) return "brooklyn"; // right side survived, so the ball went left
  return "right"; // left side survived, so the ball came up short
}

// next-shot suggestion, following USBC's 2-and-1 in-game adjustment rule
function coachTip(hit, leave, style) {
  const key = leave.join("-");
  if (!leave.length)
    return {
      head: "Strike",
      body: "Nothing to fix. Same feet, same target, same speed \u2014 repeat it.",
    };

  if (hit === "pocket") {
    return {
      head: key === "10" ? "Ringing 10" : `Pocket, left the ${key}`,
      body:
        "The ball got there, it just didn't carry. Don't move off one of these. Watch the 6 pin next shot: if it flies straight back you caught a bit too much head pin; if it slides into the right gutter you caught too little.",
    };
  }

  if (hit === "brooklyn") {
    return {
      head: "Too much head pin",
      body:
        "The whole right side survived, so the ball got past the pocket and into the middle. Coaches call this hitting high. Move 2 and 1 left \u2014 feet two boards left, target one board left \u2014 to give it room to come back instead of crossing over.",
    };
  }

  if (hit === "nose") {
    return {
      head: "Dead on the head pin",
      body:
        "You hit the 1 flush instead of its right edge, so the rack split apart instead of chaining. Also counts as high. Move 2 and 1 left, or keep your feet and pick a target farther down the lane so the ball hooks later.",
    };
  }

  // light / missed right
  const extra =
    key === "5"
      ? "A lone 5-pin is the classic thin-hit signature. "
      : leave.includes(1)
      ? "Head pin still standing means you never really got to it. "
      : key === "2-4-5-8"
      ? "The bucket means you clipped the head pin thin. "
      : "";
  return {
    head: "Not enough head pin",
    body:
      extra +
      "The ball clipped the 1 thin and came up short of the pocket \u2014 coaches call this light. Move 2 and 1 right \u2014 feet two boards right, target one board right. Or keep your feet and pick a target closer to the foul line so it hooks earlier.",
  };
}

// longest run of consecutive strikes inside a single game, tenth frame included
function longestString(frames) {
  let best = 0;
  let run = 0;
  frames.forEach((fr, i) => {
    const th = fr.throws;
    if (i < 9) {
      if (th.length && th[0].length === 10) {
        run++;
        best = Math.max(best, run);
      } else if (th.length) run = 0;
      return;
    }
    th.forEach((arr, k) => {
      const fresh =
        k === 0 ||
        th[k - 1].length === 10 ||
        (k >= 2 && th[k - 2].length + th[k - 1].length === 10);
      if (!fresh) return; // second ball at a partial rack can't be a strike
      if (arr.length === 10) {
        run++;
        best = Math.max(best, run);
      } else run = 0;
    });
  });
  return best;
}

// games bowled close together are one session
function groupSessions(games) {
  const sorted = [...games].sort((a, b) => new Date(a.date) - new Date(b.date));
  const out = [];
  sorted.forEach((g) => {
    const last = out[out.length - 1];
    const t = new Date(g.date).getTime();
    if (last && t - last.end < 4 * 60 * 60 * 1000) {
      last.games.push(g);
      last.end = t;
    } else {
      out.push({ start: t, end: t, games: [g] });
    }
  });
  return out.reverse();
}

function analyze(games, positions) {
  const base = {
    games: games.length,
    pins: 0,
    average: 0,
    high: 0,
    low: 0,
    firstBall: 0,
    strikePct: 0,
    sparePct: 0,
    cleanPct: 0,
    openPct: 0,
    pocketPct: 0,
    carryPct: 0,
    splitPct: 0,
    splitConv: 0,
    singlePinPct: 0,
    hits: {},
    bestString: 0,
    byGame: [],
    tagged: 0,
    inferred: 0,
    byStyle: [],
    byBall: [],
    leaveTotal: 0,
    leaves: [],
    scores: [],
  };
  if (!games.length) return base;

  let firstBallPins = 0;
  let firstBalls = 0;
  let strikes = 0;
  let spares = 0;
  let spareTries = 0;
  let frameCount = 0;
  let clean = 0;
  let pocketProxy = 0;
  let taggedPocket = 0;
  let tagged = 0;
  let inferred = 0;
  let splits = 0;
  let splitsMade = 0;
  let singles = 0;
  let singlesMade = 0;
  const hits = {};
  const leaveCount = {};
  const scores = [];
  let bestString = 0;
  const byGame = {};
  const byStyle = {};
  const byBall = {};
  const bump = (name, key, v = 1) => {
    if (!byBall[name])
      byBall[name] = {
        name,
        first: 0,
        firstPins: 0,
        strikes: 0,
        spareTries: 0,
        spares: 0,
      };
    byBall[name][key] += v;
  };

  games.forEach((g) => {
    const gScore = finalScore(g.frames);
    scores.push(gScore);
    bestString = Math.max(bestString, longestString(g.frames));

    const gi = Math.min((positions && positions[g.id]) || g.gameNo || 1, 4);
    if (!byGame[gi]) byGame[gi] = { n: gi, games: 0, pins: 0, first: 0, strikes: 0 };
    byGame[gi].games++;
    byGame[gi].pins += gScore;

    const sty = g.style || "two";
    if (!byStyle[sty])
      byStyle[sty] = {
        style: sty,
        games: 0,
        pins: 0,
        first: 0,
        firstPins: 0,
        strikes: 0,
      };
    byStyle[sty].games++;
    byStyle[sty].pins += gScore;

    g.frames.forEach((fr, idx) => {
      const th = fr.throws;
      if (!th.length) return;
      frameCount++;

      firstBallPins += th[0].length;
      firstBalls++;

      byGame[gi].first++;
      if (th[0].length === 10) byGame[gi].strikes++;

      byStyle[sty].first++;
      byStyle[sty].firstPins += th[0].length;
      if (th[0].length === 10) byStyle[sty].strikes++;

      const b0 = ballFor(g, fr, 0);
      bump(b0, "first");
      bump(b0, "firstPins", th[0].length);
      if (th[0].length === 10) bump(b0, "strikes");
      if (th[0].length < 10 && th.length > 1) {
        const b1 = ballFor(g, fr, 1);
        bump(b1, "spareTries");
        if (th[0].length + th[1].length === 10) bump(b1, "spares");
      }

      const leave =
        th[0].length === 10 ? [] : ALL_PINS.filter((p) => !th[0].includes(p));
      const hit = fr.hit || inferHit(leave);
      hits[hit] = (hits[hit] || 0) + 1;
      if (fr.hit) tagged++;
      else inferred++;
      if (hit === "pocket") taggedPocket++;

      if (th[0].length === 10) {
        strikes++;
        clean++;
        pocketProxy++;
      } else {
        const standing = ALL_PINS.filter((p) => !th[0].includes(p));
        if (standing.length && standing.every((p) => BACK_ROW.includes(p)))
          pocketProxy++;

        if (th.length > 1) {
          spareTries++;
          const made = th[0].length + th[1].length === 10;
          if (made) {
            spares++;
            clean++;
          }
          const key = standing.join("-");
          if (!leaveCount[key])
            leaveCount[key] = { pins: standing, seen: 0, made: 0 };
          leaveCount[key].seen++;
          if (made) leaveCount[key].made++;

          if (isSplit(standing)) {
            splits++;
            if (made) splitsMade++;
          }
          if (standing.length === 1) {
            singles++;
            if (made) singlesMade++;
          }
        }
      }

    });
  });

  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  const totalPins = scores.reduce((a, b) => a + b, 0);

  return {
    ...base,
    pins: totalPins,
    average: Math.round(totalPins / games.length),
    high: Math.max(...scores),
    low: Math.min(...scores),
    firstBall: firstBalls
      ? Math.round((firstBallPins / firstBalls) * 10) / 10
      : 0,
    strikePct: pct(strikes, firstBalls),
    sparePct: pct(spares, spareTries),
    cleanPct: pct(clean, frameCount),
    openPct: pct(frameCount - clean, frameCount),
    pocketPct: pct(pocketProxy, firstBalls),
    carryPct: pct(strikes, pocketProxy),
    taggedPocketPct: pct(taggedPocket, tagged + inferred),
    tagged,
    inferred,
    splitPct: pct(splits, spareTries),
    splitConv: pct(splitsMade, splits),
    singlePinPct: pct(singlesMade, singles),
    hits,
    bestString,
    byGame: Object.values(byGame).sort((a, b) => a.n - b.n),
    byStyle: Object.values(byStyle).sort((a, b) => b.games - a.games),
    byBall: Object.values(byBall).sort((a, b) => b.first - a.first),
    leaveTotal: spareTries,
    leaves: Object.values(leaveCount)
      .sort((a, b) => b.seen - a.seen)
      .slice(0, 12),
    scores,
  };
}

/* ------------------------------------------------------------------ */
/*  pin artwork                                                        */
/* ------------------------------------------------------------------ */

function Pin({ n, down, disabled, onClick }) {
  return (
    <button
      className={`pin ${down ? "is-down" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={down}
      aria-label={`Pin ${n}${down ? ", down" : ", standing"}`}
    >
      <svg viewBox="0 0 24 32" aria-hidden="true">
        <path
          className="pin-body"
          d="M12 1.5c3.2 0 4.9 2.6 4.9 5.3 0 2.6-2.1 4.2-2.1 6.2 0 2.6 5.1 4.3 5.1 10.1 0 5.2-3.8 7.9-7.9 7.9s-7.9-2.7-7.9-7.9c0-5.8 5.1-7.5 5.1-10.1 0-2-2.1-3.6-2.1-6.2 0-2.7 1.7-5.3 4.9-5.3z"
        />
        <rect className="pin-stripe" x="6.4" y="12.2" width="11.2" height="1.9" rx="0.9" />
        <rect className="pin-stripe" x="5.6" y="15.4" width="12.8" height="1.9" rx="0.9" />
      </svg>
      <span className="pin-num">{n}</span>
    </button>
  );
}

function LeaveRack({ pins }) {
  return (
    <span className="lrack" aria-hidden="true">
      {RACK_ROWS.map((row, i) => (
        <span key={i} className="lrow">
          {row.map((p) => (
            <svg
              key={p}
              className={`lpin ${pins.includes(p) ? "" : "down"}`}
              viewBox="0 0 24 32"
            >
              <path
                className="b"
                d="M12 1.5c3.2 0 4.9 2.6 4.9 5.3 0 2.6-2.1 4.2-2.1 6.2 0 2.6 5.1 4.3 5.1 10.1 0 5.2-3.8 7.9-7.9 7.9s-7.9-2.7-7.9-7.9c0-5.8 5.1-7.5 5.1-10.1 0-2-2.1-3.6-2.1-6.2 0-2.7 1.7-5.3 4.9-5.3z"
              />
              <rect className="s" x="6" y="12.4" width="12" height="2.4" rx="1.2" />
            </svg>
          ))}
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  frame strip                                                        */
/* ------------------------------------------------------------------ */

function marks(frame, idx) {
  const th = frame.throws;
  const out = ["", "", ""];
  if (!th.length) return out;

  if (idx < 9) {
    if (th[0].length === 10) {
      out[1] = "X";
      return out;
    }
    out[0] = th[0].length === 0 ? "\u2013" : String(th[0].length);
    if (th.length > 1) {
      out[1] =
        th[0].length + th[1].length === 10
          ? "/"
          : th[1].length === 0
          ? "\u2013"
          : String(th[1].length);
    }
    return out;
  }

  // tenth
  th.forEach((arr, k) => {
    if (arr.length === 10) {
      out[k] = "X";
      return;
    }
    if (k > 0) {
      const prev = th[k - 1];
      const freshRack = prev.length === 10;
      if (!freshRack && prev.length + arr.length === 10) {
        out[k] = "/";
        return;
      }
    }
    out[k] = arr.length === 0 ? "\u2013" : String(arr.length);
  });
  return out;
}

function FrameStrip({ frames, activeFrame }) {
  const scores = runningScores(frames);
  return (
    <div className="strip" role="table" aria-label="Scoresheet">
      {frames.map((f, i) => {
        const m = marks(f, i);
        return (
          <div
            key={i}
            className={`frame ${i === activeFrame ? "is-active" : ""} ${
              i === 9 ? "is-tenth" : ""
            }`}
          >
            <div className="frame-no">{i + 1}</div>
            <div className="frame-marks">
              <span>{m[0]}</span>
              <span>{m[1]}</span>
              {i === 9 && <span>{m[2]}</span>}
            </div>
            <div className="frame-score">
              {scores[i] === null ? "" : scores[i]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  small ui pieces                                                    */
/* ------------------------------------------------------------------ */

function Stat({ label, value, suffix, hint, wide }) {
  return (
    <div className={`stat ${wide ? "stat-wide" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {suffix && <span className="stat-suffix">{suffix}</span>}
      </div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

function Trend({ scores }) {
  if (scores.length < 2) return null;
  const pts = scores.slice(-20);
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  // scale to the actual spread, with headroom so dots never touch the edges
  const span = hi - lo || 20;
  const pad = Math.max(span * 0.25, 8);
  const yLo = Math.max(0, Math.round(lo - pad));
  const yHi = Math.min(300, Math.round(hi + pad));
  const avg = Math.round(pts.reduce((a, b) => a + b, 0) / pts.length);

  const W = 320;
  const H = 104;
  const M = 12;
  const x = (i) => M + (i / (pts.length - 1)) * (W - M * 2);
  const y = (v) => M + (1 - (v - yLo) / (yHi - yLo)) * (H - M * 2);
  const d = pts
    .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");

  return (
    <div className="trend">
      <div className="trend-head">
        <span className="stat-label">Last {pts.length} games</span>
        <span className="trend-range">
          {lo}&ndash;{hi}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Score trend">
        <line
          className="trend-avg"
          x1={M}
          x2={W - M}
          y1={y(avg)}
          y2={y(avg)}
        />
        <path className="trend-line" d={d} />
        {pts.map((v, i) => (
          <circle key={i} className="trend-dot" cx={x(i)} cy={y(v)} r="3.2" />
        ))}
      </svg>
      <div className="trend-ends">
        <span>{pts[0]}</span>
        <span className="trend-avg-label">avg {avg}</span>
        <span>{pts[pts.length - 1]}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  app                                                                */
/* ------------------------------------------------------------------ */

export default function PinDeck() {
  const [tab, setTab] = useState("bowl");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  const [games, setGames] = useState([]);
  const [balls, setBalls] = useState(DEFAULT_BALLS);
  const [active, setActive] = useState(null); // {frames, ball, started}
  const [ballFilter, setBallFilter] = useState("all");
  const [mode, setMode] = useState("left"); // "left" = tap what's standing, "fell" = tap what dropped
  const [knocked, setKnocked] = useState([]); // pins currently selected
  const [pendingHit, setPendingHit] = useState(null); // hit tag for the ball about to be logged
  const [pinned, setPinned] = useState(DEFAULT_PINNED); // leave keys held at the top
  const [confirmReset, setConfirmReset] = useState(false);
  const [pickStrike, setPickStrike] = useState(null);
  const [pickSpare, setPickSpare] = useState(null);
  const [pickStyle, setPickStyle] = useState("two");
  const [handBall, setHandBall] = useState(null); // override for the next throw

  /* ---- load ---- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY);
        if (!cancelled && res?.value) {
          const data = JSON.parse(res.value);
          setGames(data.games || []);
          setBalls(data.balls?.length ? data.balls : DEFAULT_BALLS);
          setActive(data.active || null);
          if (data.mode) setMode(data.mode);
          if (Array.isArray(data.pinned)) setPinned(data.pinned);
        }
      } catch {
        // no saved data yet — that's the normal first run
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- save ---- */
  const persist = useCallback(async (next) => {
    try {
      const res = await window.storage.set(STORAGE_KEY, JSON.stringify(next));
      if (!res) setError("Couldn't save that shot. Your last entry may not stick.");
      else setError(null);
    } catch {
      setError("Couldn't save that shot. Your last entry may not stick.");
    }
  }, []);

  const commit = useCallback(
    (patch) => {
      const next = {
        games: patch.games ?? games,
        balls: patch.balls ?? balls,
        mode: patch.mode ?? mode,
        pinned: patch.pinned ?? pinned,
        active: patch.active !== undefined ? patch.active : active,
      };
      if (patch.games !== undefined) setGames(patch.games);
      if (patch.balls !== undefined) setBalls(patch.balls);
      if (patch.mode !== undefined) setMode(patch.mode);
      if (patch.pinned !== undefined) setPinned(patch.pinned);
      if (patch.active !== undefined) setActive(patch.active);
      persist(next);
    },
    [games, balls, active, mode, pinned, persist]
  );

  /* ---- derived ---- */
  const cur = useMemo(
    () => (active ? cursor(active.frames) : { done: true }),
    [active]
  );

  const filtered = useMemo(
    () => (ballFilter === "all" ? games : games.filter((g) => g.ball === ballFilter)),
    [games, ballFilter]
  );
  // a game's place in its sitting, derived from the session grouping itself
  const gamePositions = useMemo(() => {
    const map = {};
    groupSessions(games).forEach((sess) => {
      sess.games.forEach((g, i) => {
        map[g.id] = i + 1;
      });
    });
    return map;
  }, [games]);

  const stats = useMemo(
    () => analyze(filtered, gamePositions),
    [filtered, gamePositions]
  );

  // quick-pick leaves: pinned first, then whatever this bowler leaves most
  const leaveOptions = useMemo(() => {
    const freq = {};
    games.forEach((g) =>
      g.frames.forEach((fr) => {
        const th = fr.throws;
        if (!th.length || th[0].length === 10) return;
        const st = ALL_PINS.filter((p) => !th[0].includes(p));
        if (!st.length) return;
        const k = st.join("-");
        if (!freq[k]) freq[k] = { pins: st, n: 0 };
        freq[k].n++;
      })
    );

    const out = [];
    const seen = new Set();
    const push = (pins, isPinned) => {
      const k = pins.join("-");
      if (seen.has(k) || out.length >= 16) return;
      seen.add(k);
      out.push({ pins, key: k, n: freq[k]?.n || 0, pinned: !!isPinned });
    };

    pinned.forEach((k) => push(k.split("-").map(Number), true));
    Object.values(freq)
      .sort((a, b) => b.n - a.n)
      .forEach((x) => push(x.pins, false));
    SEED_LEAVES.forEach((pins) => push(pins, false));
    return out;
  }, [games, pinned]);

  function togglePinned(key) {
    commit({
      pinned: pinned.includes(key)
        ? pinned.filter((k) => k !== key)
        : [...pinned, key],
    });
  }

  const standing = cur.standing || [];
  // on the spare you're marking conversions, so that ball always uses "what fell"
  const effMode = cur.ball === 0 ? mode : "fell";
  // in the tenth, a bonus ball can land on a full rack — that's a strike, not a spare
  const freshRack = standing.length === 10;
  const defaultBall = active
    ? cur.ball === 0 || freshRack
      ? active.ball
      : active.spareBall || active.ball
    : null;
  const inHand = handBall || defaultBall;
  const pinsDown =
    effMode === "fell" ? knocked : standing.filter((p) => !knocked.includes(p));

  function switchMode(m) {
    if (m === mode) return;
    setKnocked([]);
    commit({ mode: m });
  }

  /* ---- actions ---- */
  function startGame(ball, spareBall, style) {
    commit({
      active: {
        frames: emptyFrames(),
        ball,
        spareBall: spareBall || null,
        style: style || "two",
        started: Date.now(),
      },
    });
    setKnocked([]);
    setHandBall(null);
    setTab("bowl");
  }

  function togglePin(p) {
    setKnocked((k) => (k.includes(p) ? k.filter((x) => x !== p) : [...k, p]));
  }

  function recordThrow(pins) {
    if (!active || cur.done) return;
    const isFirst = cur.ball === 0;
    const used = handBall || defaultBall;
    const frames = active.frames.map((f, i) =>
      i === cur.frame
        ? {
            ...f,
            throws: [...f.throws, pins],
            throwBalls: [...(f.throwBalls || []), used],
            hit: isFirst ? pendingHit : f.hit,
          }
        : f
    );
    commit({ active: { ...active, frames } });
    setKnocked([]);
    setPendingHit(null);
    setHandBall(null);
  }

  function undo() {
    if (!active) return;
    for (let i = 9; i >= 0; i--) {
      if (active.frames[i].throws.length) {
        const frames = active.frames.map((f, k) =>
          k === i
            ? {
                ...f,
                throws: f.throws.slice(0, -1),
                throwBalls: (f.throwBalls || []).slice(0, -1),
                hit: f.throws.length === 1 ? null : f.hit,
              }
            : f
        );
        commit({ active: { ...active, frames } });
        setKnocked([]);
        setPendingHit(null);
        return;
      }
    }
  }

  function saveGame() {
    if (!active) return;
    const now = Date.now();
    // how many games already belong to this sitting
    const recent = games.filter(
      (g) => now - new Date(g.date).getTime() < 4 * 60 * 60 * 1000
    );
    const g = {
      id: `${now}`,
      date: new Date().toISOString(),
      ball: active.ball,
      spareBall: active.spareBall || null,
      style: active.style || "two",
      gameNo: recent.length + 1,
      frames: active.frames,
      score: finalScore(active.frames),
    };
    commit({ games: [...games, g], active: null });
    setKnocked([]);
    setPendingHit(null);
    setHandBall(null);
    setTab("stats");
  }

  function discardGame() {
    commit({ active: null });
    setKnocked([]);
  }

  function exportData() {
    const blob = new Blob(
      [JSON.stringify({ version: 1, games, balls, pinned, mode }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pin-deck-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importData(file, merge) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!Array.isArray(data.games)) throw new Error("no games");
        const incoming = merge
          ? [
              ...games,
              ...data.games.filter((g) => !games.some((x) => x.id === g.id)),
            ]
          : data.games;
        commit({
          games: incoming.sort((a, b) => new Date(a.date) - new Date(b.date)),
          balls: Array.from(new Set([...balls, ...(data.balls || [])])),
          pinned: data.pinned || pinned,
        });
        setError(null);
      } catch {
        setError("That file didn't look like a Pin Deck backup.");
      }
    };
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsText(file);
  }

  async function resetAll() {
    setGames([]);
    setBalls(DEFAULT_BALLS);
    setActive(null);
    setPinned(DEFAULT_PINNED);
    setMode("left");
    setKnocked([]);
    setPendingHit(null);
    setBallFilter("all");
    setConfirmReset(false);
    try {
      await window.storage.delete(STORAGE_KEY);
      setError(null);
    } catch {
      setError("Couldn't clear saved data. Try again.");
    }
  }

  function deleteGame(id) {
    commit({ games: games.filter((g) => g.id !== id) });
  }

  function addBall(name) {
    const clean = name.trim();
    if (!clean || balls.includes(clean)) return;
    commit({ balls: [...balls, clean] });
  }

  /* ---- helpers ---- */

  const liveScore = active ? finalScore(active.frames) : 0;
  const leaveIsSplit = cur.ball === 1 && isSplit(standing);

  /* ---- render ---- */
  if (!loaded) {
    return (
      <div className="wrap">
        <Styles />
        <div className="loading">Racking pins…</div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <Styles />

      <header className="top">
        <div className="brand">
          <span className="brand-mark">▲</span>
          <span className="brand-name">Pin Deck</span>
        </div>
        <nav className="tabs">
          {["bowl", "stats", "history"].map((t) => (
            <button
              key={t}
              className={tab === t ? "tab is-on" : "tab"}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>

      {error && <div className="alert">{error}</div>}

      {/* ------------------------------ BOWL ------------------------------ */}
      {tab === "bowl" && !active && (
        <section className="panel empty">
          <h2 className="empty-head">Start a game</h2>

          <div className="stat-label">Delivery</div>
          <div className="modeswitch" style={{ marginBottom: 18 }}>
            {STYLES.map((st) => (
              <button
                key={st.id}
                className={pickStyle === st.id ? "seg is-on" : "seg"}
                onClick={() => setPickStyle(st.id)}
              >
                {st.label}
              </button>
            ))}
          </div>

          <div className="stat-label">Strike ball</div>
          <div className="ball-list">
            {balls.map((b) => (
              <button
                key={b}
                className={`ball-btn ${pickStrike === b ? "is-on" : ""}`}
                onClick={() => {
                  setPickStrike(b);
                  if (pickSpare === b) setPickSpare(null);
                }}
              >
                {b}
              </button>
            ))}
          </div>

          <div className="stat-label" style={{ marginTop: 16 }}>
            Spare ball <span className="sublabel">optional</span>
          </div>
          <div className="ball-list">
            <button
              className={`ball-btn slim ${pickSpare === null ? "is-on" : ""}`}
              onClick={() => setPickSpare(null)}
            >
              Same ball for spares
            </button>
            {balls
              .filter((b) => b !== pickStrike)
              .map((b) => (
                <button
                  key={b}
                  className={`ball-btn slim ${pickSpare === b ? "is-on" : ""}`}
                  onClick={() => setPickSpare(b)}
                >
                  {b}
                </button>
              ))}
          </div>

          <button
            className="btn btn-primary wide"
            disabled={!pickStrike}
            onClick={() => startGame(pickStrike, pickSpare, pickStyle)}
          >
            {pickStrike ? `Bowl with the ${pickStrike}` : "Pick a strike ball"}
          </button>

          <AddBall onAdd={addBall} />
        </section>
      )}

      {tab === "bowl" && active && (
        <section className="panel">
          <div className="scorehead">
            <div>
              <div className="scorehead-label">
                {active.ball} &middot; {styleLabel(active.style)}
              </div>
              <div className="scorehead-score">{liveScore}</div>
            </div>
            <div className="scorehead-right">
              {cur.done ? (
                <span className="chip chip-done">Game over</span>
              ) : (
                <span className="chip">
                  Frame {cur.frame + 1} · Ball {cur.ball + 1}
                </span>
              )}
            </div>
          </div>

          <FrameStrip frames={active.frames} activeFrame={cur.frame ?? -1} />

          {!cur.done && (
            <>
              <div className="hitbar">
                <div className="stat-label">
                  {cur.ball === 0
                    ? "Where did it hit?"
                    : freshRack
                    ? "Fresh rack"
                    : "Spare attempt"}
                </div>
                {cur.ball === 0 && (
                  <div className="tags">
                    {HITS.map((h) => (
                      <button
                        key={h.id}
                        className={`tag ${pendingHit === h.id ? "is-on" : ""}`}
                        onClick={() =>
                          setPendingHit(pendingHit === h.id ? null : h.id)
                        }
                        title={h.note}
                      >
                        {h.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {cur.ball > 0 &&
                !freshRack &&
                (() => {
                  const aim = spareAim(standing);
                  if (!aim) return null;
                  const dir =
                    aim.move === 0
                      ? "Same spot as your strike ball"
                      : `${Math.abs(aim.move)} boards ${
                          aim.move > 0 ? "left" : "right"
                        }`;
                  return (
                    <div className="aimcard">
                      <div className="aim-top">
                        <div>
                          <div className="stat-label">Aim at the</div>
                          <div className="aim-pin">{aim.pin} pin</div>
                        </div>
                        <div className="aim-move">
                          <div className="stat-label">Move your feet</div>
                          <div className="aim-move-val">{dir}</div>
                          <div className="aim-sub">same target as always</div>
                        </div>
                      </div>
                      {aim.note && <p className="aim-note">{aim.note}</p>}
                    </div>
                  );
                })()}

              {cur.ball > 0 &&
                !freshRack &&
                (() => {
                  const first = active.frames[cur.frame].throws[0] || [];
                  const leave = ALL_PINS.filter((p) => !first.includes(p));
                  const hit =
                    active.frames[cur.frame].hit || inferHit(leave);
                  const tip = coachTip(hit, leave, active.style);
                  return (
                    <div className="coach">
                      <div className="coach-head">{tip.head}</div>
                      <p className="coach-body">{tip.body}</p>
                    </div>
                  );
                })()}

              {active.spareBall && (
                <div className="handbar">
                  <span className="stat-label">In hand</span>
                  <div className="handswitch">
                    {[active.ball, active.spareBall].map((b) => (
                      <button
                        key={b}
                        className={inHand === b ? "seg is-on" : "seg"}
                        onClick={() => setHandBall(b)}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="quickbar">
                <button
                  className="qbtn strike"
                  onClick={() => recordThrow(standing)}
                >
                  {freshRack ? "Strike" : "Spare"}
                </button>
                <button className="qbtn gutter" onClick={() => recordThrow([])}>
                  {freshRack ? "Gutter" : "Missed"}
                </button>
              </div>

              {cur.ball === 0 && (
                <div className="leavebar">
                  <div className="stat-label">Left a&hellip; <span className="sublabel">pinned, then most frequent</span></div>
                  <div className="leavegrid">
                    {leaveOptions.map((l) => (
                      <div
                        key={l.key}
                        className={`leavecell ${l.pinned ? "is-pinned" : ""}`}
                      >
                        <button
                          className="leavecard"
                          onClick={() =>
                            recordThrow(
                              ALL_PINS.filter((p) => !l.pins.includes(p))
                            )
                          }
                          aria-label={`Left the ${l.pins.join(", ")}`}
                        >
                          <LeaveRack pins={l.pins} />
                          <span className="leavecard-name">{l.key}</span>
                        </button>
                        <button
                          className="tack"
                          onClick={() => togglePinned(l.key)}
                          aria-pressed={l.pinned}
                          aria-label={
                            l.pinned
                              ? `Unpin the ${l.key}`
                              : `Pin the ${l.key} to the top`
                          }
                          title={l.pinned ? "Unpin" : "Pin to top"}
                        >
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path d="M6 1h4v5l2.5 3.5H9.8V15H8.2V9.5H3.5L6 6V1z" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <details
                className="manual"
                key={`${cur.frame}-${cur.ball}`}
                open={cur.ball > 0}
              >
                <summary>
                  <span>
                    {cur.ball === 0
                      ? "Something else \u2014 mark it on the deck"
                      : freshRack
                      ? "Full rack \u2014 mark what fell"
                      : `${standing.join("-")} left \u2014 mark what fell`}
                  </span>
                  {leaveIsSplit && <span className="chip chip-split">Split</span>}
                </summary>

                {cur.ball === 0 && (
                  <div className="modeswitch" role="group" aria-label="Entry mode">
                    <button
                      className={mode === "left" ? "seg is-on" : "seg"}
                      onClick={() => switchMode("left")}
                    >
                      Mark what's left
                    </button>
                    <button
                      className={mode === "fell" ? "seg is-on" : "seg"}
                      onClick={() => switchMode("fell")}
                    >
                      Mark what fell
                    </button>
                  </div>
                )}

                <div className="deck">
                  {RACK_ROWS.map((row, i) => (
                    <div key={i} className="deck-row">
                      {row.map((p) => {
                        const inPlay = standing.includes(p);
                        const picked = knocked.includes(p);
                        const isDown =
                          !inPlay || (effMode === "fell" ? picked : !picked);
                        return (
                          <Pin
                            key={p}
                            n={p}
                            down={isDown}
                            disabled={!inPlay}
                            onClick={() => togglePin(p)}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>

                <div className="deck-actions">
                  <button className="btn btn-ghost" onClick={() => setKnocked([])}>
                    Clear
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => recordThrow(pinsDown)}
                  >
                    Log {pinsDown.length} {pinsDown.length === 1 ? "pin" : "pins"}
                  </button>
                </div>
              </details>
            </>
          )}

          <div className="game-actions">
            <button className="btn btn-ghost" onClick={undo}>
              Undo last ball
            </button>
            <button className="btn btn-ghost danger" onClick={discardGame}>
              Discard
            </button>
            <button
              className="btn btn-primary"
              onClick={saveGame}
              disabled={!cur.done}
            >
              Save game
            </button>
          </div>
        </section>
      )}

      {/* ------------------------------ STATS ----------------------------- */}
      {tab === "stats" && (
        <section className="panel">
          <div className="filter">
            <button
              className={ballFilter === "all" ? "pill is-on" : "pill"}
              onClick={() => setBallFilter("all")}
            >
              All balls
            </button>
            {balls.map((b) => (
              <button
                key={b}
                className={ballFilter === b ? "pill is-on" : "pill"}
                onClick={() => setBallFilter(b)}
              >
                {b}
              </button>
            ))}
          </div>

          {!filtered.length ? (
            <div className="empty">
              <h2 className="empty-head">No games yet</h2>
              <p className="empty-sub">
                Bowl a game and your numbers show up here.
              </p>
            </div>
          ) : (
            <>
              <div className="grid">
                <Stat label="Average" value={stats.average} />
                <Stat label="High game" value={stats.high} />
                <Stat label="Games" value={stats.games} />
                <Stat
                  label="First ball average"
                  value={stats.firstBall}
                  hint="pins on ball one"
                />
              </div>

              <h3 className="section-head">Marking</h3>
              <div className="grid">
                <Stat label="Strike" value={stats.strikePct} suffix="%" />
                <Stat
                  label="Spare"
                  value={stats.sparePct}
                  suffix="%"
                  hint="of spare attempts"
                />
                <Stat
                  label="Clean frames"
                  value={stats.cleanPct}
                  suffix="%"
                  hint="strike or spare"
                />
                <Stat label="Open frames" value={stats.openPct} suffix="%" />
                <Stat
                  label="Longest string"
                  value={stats.bestString}
                  hint="strikes in a row"
                  wide
                />
              </div>

              <h3 className="section-head">Ball reaction</h3>
              <div className="grid">
                <Stat
                  label="Pocket"
                  value={stats.pocketPct}
                  suffix="%"
                  hint="strikes + back-row leaves"
                />
                <Stat
                  label="Carry"
                  value={stats.carryPct}
                  suffix="%"
                  hint="strikes per pocket hit"
                />
                <Stat label="Split rate" value={stats.splitPct} suffix="%" />
                <Stat
                  label="Single pin"
                  value={stats.singlePinPct}
                  suffix="%"
                  hint="conversions"
                />
              </div>

              {stats.tagged + stats.inferred > 0 && (
                <>
                  <h3 className="section-head">Where the ball goes</h3>
                  <div className="grid" style={{ marginBottom: 12 }}>
                    <Stat
                      label="Pocket (by hit)"
                      value={stats.taggedPocketPct}
                      suffix="%"
                      hint={
                        stats.inferred
                          ? `${stats.inferred} read from the leave`
                          : "all tagged by you"
                      }
                    />
                    <Stat
                      label="Nose + crossover"
                      value={
                        Math.round(
                          (((stats.hits.nose || 0) +
                            (stats.hits.brooklyn || 0)) /
                            (stats.tagged + stats.inferred)) *
                            1000
                        ) / 10
                      }
                      suffix="%"
                      hint="the miss you're chasing"
                    />
                  </div>
                  <div className="bars">
                    {HITS.map((h) => {
                      const n = stats.hits[h.id] || 0;
                      const total = stats.tagged + stats.inferred;
                      const pctv = total ? Math.round((n / total) * 100) : 0;
                      return (
                        <div key={h.id} className="bar-row">
                          <span className="bar-label">{h.label}</span>
                          <div className="bar-track">
                            <div
                              className={`bar-fill ${
                                h.id === "pocket" ? "good" : ""
                              }`}
                              style={{ width: `${pctv}%` }}
                            />
                          </div>
                          <span className="bar-val">{pctv}%</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {stats.leaves.length > 0 && (
                <>
                  <h3 className="section-head">Leaves</h3>
                  <div className="leaverows">
                    {stats.leaves.map((l) => {
                      const share = stats.leaveTotal
                        ? Math.round((l.seen / stats.leaveTotal) * 100)
                        : 0;
                      const conv = Math.round((l.made / l.seen) * 100);
                      return (
                        <div key={l.pins.join("-")} className="leaverow">
                          <LeaveRack pins={l.pins} />
                          <div className="leaverow-main">
                            <div className="leaverow-top">
                              <span className="leaverow-name">
                                {l.pins.join("-")}
                              </span>
                              <span className="leaverow-n">
                                {l.seen}&times; &middot; {share}% of leaves
                              </span>
                            </div>
                            <div className="bar-track">
                              <div
                                className="bar-fill"
                                style={{ width: `${share}%` }}
                              />
                            </div>
                          </div>
                          <div className="leaverow-conv">
                            <span className={conv >= 50 ? "conv good" : "conv"}>
                              {conv}%
                            </span>
                            <span className="leaverow-convlabel">made</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {stats.byGame.length > 1 && (
                <>
                  <h3 className="section-head">By position in a session</h3>
                  <div className="ballrows">
                    {stats.byGame.map((gm) => (
                      <div key={gm.n} className="ballrow">
                        <div className="ballrow-name">
                          {gm.n === 1
                            ? "1st game of a sitting"
                            : gm.n === 2
                            ? "2nd game of a sitting"
                            : gm.n === 3
                            ? "3rd game of a sitting"
                            : "4th game onward"}
                        </div>
                        <div className="ballrow-stats">
                          <span>
                            <b>{Math.round(gm.pins / gm.games)}</b> average
                          </span>
                          <span>
                            <b>
                              {gm.first
                                ? Math.round((gm.strikes / gm.first) * 100)
                                : 0}
                              %
                            </b>{" "}
                            strike
                          </span>
                          <span>
                            from <b>{gm.games}</b>{" "}
                            {gm.games === 1 ? "game" : "games"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="hint-line">
                    Each row is how you score in that slot of a sitting, pooled
                    across every session. A drop down the list usually means the
                    lanes are drying out, not that you got worse.
                  </p>
                </>
              )}

              {stats.byStyle.length > 1 && (
                <>
                  <h3 className="section-head">By delivery</h3>
                  <div className="ballrows">
                    {stats.byStyle.map((st) => (
                      <div key={st.style} className="ballrow">
                        <div className="ballrow-name">
                          {styleLabel(st.style)}
                        </div>
                        <div className="ballrow-stats">
                          <span>
                            <b>{Math.round(st.pins / st.games)}</b> average
                          </span>
                          <span>
                            <b>
                              {Math.round((st.firstPins / st.first) * 10) / 10}
                            </b>{" "}
                            first ball
                          </span>
                          <span>
                            <b>{Math.round((st.strikes / st.first) * 100)}%</b>{" "}
                            strike
                          </span>
                          <span>
                            <b>{st.games}</b> games
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {stats.byBall.length > 1 && (
                <>
                  <h3 className="section-head">By ball</h3>
                  <div className="ballrows">
                    {stats.byBall.map((b) => (
                      <div key={b.name} className="ballrow">
                        <div className="ballrow-name">{b.name}</div>
                        <div className="ballrow-stats">
                          {b.first > 0 && (
                            <span>
                              <b>{Math.round((b.firstPins / b.first) * 10) / 10}</b>{" "}
                              first ball
                            </span>
                          )}
                          {b.first > 0 && (
                            <span>
                              <b>{Math.round((b.strikes / b.first) * 100)}%</b>{" "}
                              strike
                            </span>
                          )}
                          {b.spareTries > 0 && (
                            <span>
                              <b>
                                {Math.round((b.spares / b.spareTries) * 100)}%
                              </b>{" "}
                              spare ({b.spareTries})
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <Trend scores={stats.scores} />
            </>
          )}
        </section>
      )}

      {/* ----------------------------- HISTORY ---------------------------- */}
      {tab === "history" && (
        <section className="panel">
          {!games.length ? (
            <div className="empty">
              <h2 className="empty-head">Nothing logged yet</h2>
              <p className="empty-sub">Saved games land here, newest first.</p>
            </div>
          ) : (
            <div className="sessions">
              {groupSessions(games).map((sess) => {
                const tot = sess.games.reduce((a, g) => a + g.score, 0);
                return (
                  <div key={sess.start} className="session">
                    <div className="session-head">
                      <span className="session-date">
                        {new Date(sess.start).toLocaleDateString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <span className="session-meta">
                        {sess.games.length}{" "}
                        {sess.games.length === 1 ? "game" : "games"} &middot;{" "}
                        {tot} pins &middot; {Math.round(tot / sess.games.length)}{" "}
                        avg
                      </span>
                    </div>
                    <div className="history">
                      {[...sess.games].reverse().map((g) => (
                        <details key={g.id} className="game-row">
                          <summary>
                            <span className="game-score">{g.score}</span>
                            <span className="game-meta">
                              {g.ball} &middot; {styleLabel(g.style)}
                            </span>
                            <button
                              className="del"
                              onClick={(e) => {
                                e.preventDefault();
                                deleteGame(g.id);
                              }}
                              aria-label="Delete game"
                            >
                              &times;
                            </button>
                          </summary>
                          <FrameStrip frames={g.frames} activeFrame={-1} />
                        </details>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="backupbox">
            <div className="stat-label">Backup</div>
            <p className="reset-note">
              Clearing Safari data wipes your games. Save a copy somewhere safe
              now and then.
            </p>
            <div className="reset-actions">
              <button className="btn btn-ghost" onClick={exportData}>
                Download backup
              </button>
              <label className="btn btn-ghost filelabel">
                Restore from file
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => {
                    const f = e.target.files && e.target.files[0];
                    if (f) importData(f, true);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>

          <div className="resetbox">
            <div className="stat-label">Start over</div>
            <p className="reset-note">
              Erases every game, your ball list, and your pinned leaves. This
              can&rsquo;t be undone.
            </p>
            {confirmReset ? (
              <div className="reset-actions">
                <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>
                  Keep my data
                </button>
                <button className="btn btn-danger" onClick={resetAll}>
                  Yes, erase everything
                </button>
              </div>
            ) : (
              <button
                className="btn btn-ghost danger"
                onClick={() => setConfirmReset(true)}
              >
                Reset all data
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function AddBall({ onAdd }) {
  const [v, setV] = useState("");
  return (
    <div className="addball">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Add another ball"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onAdd(v);
            setV("");
          }
        }}
      />
      <button
        className="btn btn-ghost"
        onClick={() => {
          onAdd(v);
          setV("");
        }}
      >
        Add
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  styles                                                             */
/* ------------------------------------------------------------------ */

function Styles() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

.wrap{
  --lane:#E7D5AA;
  --lane-2:#D9C393;
  --board:#C3A870;
  --oil:#141C29;
  --oil-2:#22304a;
  --pin:#FBF7EE;
  --stripe:#BE2F2A;
  --amber:#E9863B;
  --ink:#2A2015;

  font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  background:var(--lane);
  background-image:repeating-linear-gradient(90deg,transparent 0 38px,rgba(0,0,0,.045) 38px 39px);
  color:var(--ink);
  min-height:100%;
  padding:0 0 40px;
  -webkit-font-smoothing:antialiased;
}
.wrap *{box-sizing:border-box}
.wrap button{font-family:inherit;cursor:pointer}
.wrap button:focus-visible,.wrap input:focus-visible{outline:2px solid var(--amber);outline-offset:2px}

.loading{padding:60px 20px;text-align:center;letter-spacing:.1em;text-transform:uppercase;font-size:12px;opacity:.6}

/* header */
.top{
  background:var(--oil);display:flex;align-items:center;justify-content:space-between;
  padding:14px 16px;position:sticky;top:0;z-index:20;
  border-bottom:3px solid var(--stripe);
}
.brand{display:flex;align-items:center;gap:9px}
.brand-mark{color:var(--stripe);font-size:13px;transform:translateY(-1px)}
.brand-name{
  font-family:'Barlow Condensed',Impact,sans-serif;font-weight:700;
  text-transform:uppercase;letter-spacing:.16em;color:var(--pin);font-size:19px;
}
.tabs{display:flex;gap:2px}
.tab{
  background:transparent;border:0;color:rgba(251,247,238,.5);
  font-size:11px;letter-spacing:.12em;text-transform:uppercase;
  padding:7px 10px;border-radius:3px;
}
.tab.is-on{color:var(--oil);background:var(--amber);font-weight:600}

.alert{
  background:var(--stripe);color:#fff;font-size:12px;padding:9px 16px;letter-spacing:.02em;
}

.panel{max-width:640px;margin:0 auto;padding:18px 16px 0}

/* score header */
.scorehead{
  background:var(--oil);border-radius:5px;padding:14px 16px;
  display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;
}
.scorehead-label{
  color:rgba(251,247,238,.55);font-size:10px;letter-spacing:.16em;
  text-transform:uppercase;margin-bottom:2px;
}
.scorehead-score{
  font-family:'Barlow Condensed',Impact,sans-serif;font-weight:700;
  font-size:46px;line-height:.9;color:var(--amber);font-variant-numeric:tabular-nums;
}
.chip{
  display:inline-block;background:var(--oil-2);color:var(--pin);
  font-size:10px;letter-spacing:.12em;text-transform:uppercase;
  padding:6px 10px;border-radius:3px;
}
.chip-done{background:var(--amber);color:var(--oil);font-weight:600}
.chip-split{background:var(--stripe);color:#fff;font-weight:600}

/* scoresheet strip */
.strip{
  display:grid;grid-template-columns:repeat(9,1fr) 1.42fr;
  border:1.5px solid var(--ink);background:var(--pin);margin-bottom:20px;overflow:hidden;border-radius:3px;
}
.frame{border-right:1px solid rgba(42,32,21,.28);position:relative}
.frame:last-child{border-right:0}
.frame.is-active{background:#FFF3D8}
.frame-no{
  font-size:8px;letter-spacing:.06em;opacity:.45;padding:2px 0 0 3px;
}
.frame-marks{
  display:flex;justify-content:flex-end;gap:1px;padding:0 2px;
}
.frame-marks span{
  width:15px;height:15px;border:1px solid rgba(42,32,21,.35);
  display:flex;align-items:center;justify-content:center;
  font-size:11px;font-weight:600;line-height:1;
}
.frame-score{
  text-align:center;font-size:14px;font-weight:600;padding:3px 0 5px;
  font-variant-numeric:tabular-nums;min-height:24px;
}

/* pin deck */
.deck-title{font-size:10px;letter-spacing:.16em;text-transform:uppercase;opacity:.6}
.deck{
  background:linear-gradient(180deg,#EFE2C2,#E2CFA2);
  border:1.5px solid rgba(42,32,21,.25);border-radius:5px;
  padding:11px 8px 14px;display:flex;flex-direction:column;align-items:center;gap:3px;
}
.deck-row{display:flex;gap:5px;justify-content:center}
.pin{
  background:none;border:0;padding:0;position:relative;
  width:29px;height:39px;display:flex;align-items:center;justify-content:center;
  transition:transform .16s ease,opacity .16s ease;
}
.pin svg{width:100%;height:100%;display:block}
.pin-body{fill:var(--pin);stroke:rgba(42,32,21,.5);stroke-width:1}
.pin-stripe{fill:var(--stripe)}
.pin-num{
  position:absolute;bottom:4px;left:50%;transform:translateX(-50%);
  font-size:9px;font-weight:600;color:rgba(42,32,21,.55);pointer-events:none;
}
.pin.is-down{transform:rotate(58deg) translateY(6px) scale(.86);opacity:.28}
.pin:disabled{cursor:default}
@media (prefers-reduced-motion:reduce){.pin{transition:none}}

.modeswitch{
  display:flex;gap:0;margin-bottom:10px;border:1.5px solid var(--ink);
  border-radius:4px;overflow:hidden;
}
.seg{
  flex:1;background:rgba(255,255,255,.4);border:0;color:var(--ink);
  padding:9px 6px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;
}
.seg + .seg{border-left:1.5px solid var(--ink)}
.seg.is-on{background:var(--oil);color:var(--amber);font-weight:600}

.quickbar{display:flex;gap:8px;margin-bottom:12px}
.qbtn{
  flex:1;border:0;border-radius:5px;padding:17px 10px;color:#fff;
  font-family:'Barlow Condensed',Impact,sans-serif;font-weight:700;font-size:21px;
  text-transform:uppercase;letter-spacing:.14em;line-height:1;
}
.qbtn.strike{background:#1F7A45;box-shadow:inset 0 -3px 0 rgba(0,0,0,.22)}
.qbtn.gutter{background:var(--stripe);box-shadow:inset 0 -3px 0 rgba(0,0,0,.22)}

.hitbar{margin-bottom:12px}

.leavebar{margin-bottom:16px}
.leavegrid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:8px}
.leavecell{position:relative}
.leavecard{width:100%;
  background:var(--pin);border:1.5px solid rgba(42,32,21,.28);border-radius:5px;
  padding:9px 3px 7px;display:flex;flex-direction:column;align-items:center;gap:6px;
}
.leavecard:hover{border-color:var(--oil);background:#FFF3D8}
.leavecard-name{
  font-size:11.5px;font-weight:600;letter-spacing:.03em;font-variant-numeric:tabular-nums;
}
.leavecell.is-pinned .leavecard{border-color:var(--oil);box-shadow:inset 3px 0 0 var(--amber)}
.tack{
  position:absolute;top:-5px;right:-5px;width:20px;height:20px;padding:0;
  border:1.5px solid rgba(42,32,21,.3);border-radius:50%;
  background:var(--lane);display:flex;align-items:center;justify-content:center;
}
.tack svg{width:9px;height:9px;fill:rgba(42,32,21,.35)}
.tack:hover{border-color:var(--oil)}
.leavecell.is-pinned .tack{background:var(--oil);border-color:var(--oil)}
.leavecell.is-pinned .tack svg{fill:var(--amber)}
.sublabel{opacity:.55;letter-spacing:.08em;margin-left:4px}
.lrack{display:flex;flex-direction:column;align-items:center;gap:2px}
.lrow{display:flex;gap:2.5px;justify-content:center}
.lpin{width:11px;height:15px;display:block;flex:none}
.lpin .b{fill:var(--pin);stroke:rgba(42,32,21,.55);stroke-width:1.8}
.lpin .s{fill:var(--stripe)}
.lpin.down .b{fill:rgba(42,32,21,.09);stroke:rgba(42,32,21,.12)}
.lpin.down .s{fill:rgba(42,32,21,.12)}

.manual{margin-top:4px}
.manual > summary{
  list-style:none;cursor:pointer;display:flex;align-items:center;
  justify-content:space-between;gap:10px;
  border:1.5px solid var(--ink);border-radius:4px;
  background:rgba(255,255,255,.45);
  font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:500;
  color:var(--ink);padding:13px 14px;
}
.manual > summary:hover{background:var(--oil);border-color:var(--oil);color:var(--amber)}
.manual > summary::-webkit-details-marker{display:none}
.manual > summary::after{
  content:"\u25BE";font-size:11px;opacity:.75;flex:none;transition:transform .18s ease;
}
.manual[open] > summary{
  background:var(--oil);border-color:var(--oil);color:var(--amber);
  border-bottom-left-radius:0;border-bottom-right-radius:0;
}
.manual[open] > summary::after{transform:rotate(180deg)}
.manual[open] > summary + *{margin-top:12px}
@media (prefers-reduced-motion:reduce){.manual > summary::after{transition:none}}

.deck-actions{display:flex;gap:8px;margin:14px 0 6px;flex-wrap:wrap}
.game-actions{display:flex;gap:8px;margin:22px 0 10px;flex-wrap:wrap}

.btn{
  border:1.5px solid var(--ink);background:transparent;color:var(--ink);
  padding:10px 14px;border-radius:4px;font-size:11px;letter-spacing:.1em;
  text-transform:uppercase;font-weight:500;
}
.btn-primary{background:var(--oil);border-color:var(--oil);color:var(--amber);font-weight:600;flex:1;min-width:140px}
.btn-primary:disabled{opacity:.32;cursor:not-allowed}
.btn-ghost{background:rgba(255,255,255,.45)}
.btn.danger{border-color:var(--stripe);color:var(--stripe)}

/* hit tags */
.tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.tag{
  border:1.5px solid rgba(42,32,21,.4);background:rgba(255,255,255,.5);
  padding:8px 11px;border-radius:20px;font-size:11px;letter-spacing:.04em;color:var(--ink);
}
.tag.is-on{background:var(--oil);color:var(--amber);border-color:var(--oil);font-weight:600}

/* start screen */
.empty{padding:34px 4px}
.empty-head{
  font-family:'Barlow Condensed',Impact,sans-serif;font-weight:700;font-size:30px;
  text-transform:uppercase;letter-spacing:.03em;margin:0 0 4px;
}
.empty-sub{font-size:12px;opacity:.65;margin:0 0 18px}
.ball-list{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}
.ball-btn{
  background:var(--oil);color:var(--pin);border:0;border-left:5px solid var(--amber);
  padding:16px 16px;border-radius:4px;text-align:left;font-size:14px;letter-spacing:.04em;
}
.ball-btn.is-on{box-shadow:inset 0 0 0 2px var(--amber)}
.ball-btn.slim{padding:11px 14px;font-size:13px;border-left-width:4px}
.btn.wide{width:100%;margin:18px 0 16px;padding:15px}

.coach{
  background:var(--oil);border-left:5px solid var(--amber);border-radius:5px;
  padding:12px 14px;margin-bottom:14px;
}
.coach-head{
  font-family:'Barlow Condensed',Impact,sans-serif;font-weight:700;font-size:16px;
  text-transform:uppercase;letter-spacing:.12em;color:var(--amber);margin-bottom:5px;
}
.coach-body{font-size:11.5px;line-height:1.55;color:rgba(251,247,238,.82);margin:0}

.handbar{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.handswitch{display:flex;flex:1;border:1.5px solid var(--ink);border-radius:4px;overflow:hidden}
.handswitch .seg{padding:8px 6px;font-size:10px}

.ballrows{display:flex;flex-direction:column;gap:6px}
.ballrow{background:var(--pin);border-radius:4px;padding:11px 13px;border-left:4px solid var(--oil)}
.ballrow-name{font-size:13px;font-weight:600;letter-spacing:.03em;margin-bottom:5px}
.ballrow-stats{display:flex;flex-wrap:wrap;gap:12px;font-size:10px;opacity:.7;letter-spacing:.04em}
.ballrow-stats b{font-size:14px;opacity:1;font-variant-numeric:tabular-nums}

.addball{display:flex;gap:8px}
.addball input{
  flex:1;border:1.5px solid rgba(42,32,21,.4);background:rgba(255,255,255,.55);
  padding:10px 12px;border-radius:4px;font-family:inherit;font-size:13px;color:var(--ink);
}

/* stats */
.filter{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px}
.pill{
  border:1.5px solid rgba(42,32,21,.35);background:rgba(255,255,255,.45);
  padding:7px 12px;border-radius:20px;font-size:10px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--ink);
}
.pill.is-on{background:var(--oil);color:var(--amber);border-color:var(--oil);font-weight:600}

.section-head{
  font-family:'Barlow Condensed',Impact,sans-serif;font-weight:700;font-size:15px;
  text-transform:uppercase;letter-spacing:.18em;margin:26px 0 10px;
  padding-bottom:5px;border-bottom:1.5px solid rgba(42,32,21,.28);
}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.stat{background:var(--pin);border-radius:4px;padding:12px 13px;border-left:4px solid var(--oil)}
.stat-label{font-size:9px;letter-spacing:.15em;text-transform:uppercase;opacity:.55;margin-bottom:4px}
.stat-value{
  font-family:'Barlow Condensed',Impact,sans-serif;font-weight:700;font-size:31px;
  line-height:1;font-variant-numeric:tabular-nums;
}
.stat-suffix{font-size:15px;opacity:.5;margin-left:2px}
.stat-hint{font-size:9.5px;opacity:.5;margin-top:3px}

.bars{display:flex;flex-direction:column;gap:7px}
.bar-row{display:flex;align-items:center;gap:9px}
.bar-label{font-size:10px;letter-spacing:.08em;text-transform:uppercase;width:74px;opacity:.7}
.bar-track{flex:1;height:14px;background:rgba(42,32,21,.13);border-radius:2px;overflow:hidden}
.bar-fill{height:100%;background:var(--oil-2);transition:width .3s ease}
.bar-fill.good{background:var(--amber)}
.bar-val{font-size:11px;width:34px;text-align:right;font-variant-numeric:tabular-nums}


.leaverows{display:flex;flex-direction:column;gap:6px}
.leaverow{
  background:var(--pin);border-radius:4px;padding:9px 12px;
  display:flex;align-items:center;gap:12px;
}
.leaverow-main{flex:1;min-width:0}
.leaverow-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:5px}
.leaverow-name{font-size:14px;font-weight:600;letter-spacing:.03em;font-variant-numeric:tabular-nums}
.leaverow-n{font-size:9.5px;opacity:.5;white-space:nowrap;font-variant-numeric:tabular-nums}
.leaverow-conv{display:flex;flex-direction:column;align-items:flex-end;flex:none;width:44px}
.conv{
  font-family:'Barlow Condensed',Impact,sans-serif;font-weight:700;font-size:20px;
  line-height:1;font-variant-numeric:tabular-nums;color:var(--stripe);
}
.conv.good{color:#1F7A45}
.leaverow-convlabel{font-size:8px;letter-spacing:.12em;text-transform:uppercase;opacity:.45;margin-top:2px}

.aimcard{
  background:var(--pin);border-left:5px solid #1F7A45;border-radius:5px;
  padding:12px 14px;margin-bottom:10px;
}
.aim-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
.aim-pin{
  font-family:'Barlow Condensed',Impact,sans-serif;font-weight:700;font-size:30px;
  line-height:1;color:#1F7A45;
}
.aim-move{text-align:right}
.aim-move-val{
  font-family:'Barlow Condensed',Impact,sans-serif;font-weight:700;font-size:20px;
  line-height:1.1;
}
.aim-sub{font-size:9px;letter-spacing:.1em;text-transform:uppercase;opacity:.45;margin-top:3px}
.aim-note{font-size:11px;line-height:1.5;opacity:.7;margin:9px 0 0}

.hint-line{font-size:10.5px;line-height:1.5;opacity:.55;margin:8px 2px 0}

.sessions{display:flex;flex-direction:column;gap:18px}
.session-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:7px}
.session-date{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.session-meta{font-size:10px;opacity:.55;font-variant-numeric:tabular-nums}

.backupbox{
  margin-top:26px;border:1.5px solid rgba(42,32,21,.28);border-radius:5px;
  padding:14px;background:rgba(255,255,255,.35);
}
.filelabel{position:relative;overflow:hidden;display:inline-flex;align-items:center}
.filelabel input{position:absolute;inset:0;opacity:0;cursor:pointer}

.resetbox{
  margin-top:28px;border:1.5px dashed rgba(190,47,42,.5);
  border-radius:5px;padding:14px;background:rgba(190,47,42,.05);
}
.reset-note{font-size:11px;line-height:1.5;opacity:.65;margin:5px 0 12px}
.reset-actions{display:flex;gap:8px;flex-wrap:wrap}
.btn-danger{background:var(--stripe);border-color:var(--stripe);color:#fff;font-weight:600}

.trend{margin-top:26px;background:var(--oil);border-radius:5px;padding:14px}
.trend .stat-label{color:rgba(251,247,238,.5)}
.trend svg{width:100%;height:auto;display:block;margin-top:4px}
.trend-line{fill:none;stroke:var(--amber);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.trend-avg{stroke:rgba(251,247,238,.22);stroke-width:1;stroke-dasharray:3 4}
.trend-head{display:flex;align-items:baseline;justify-content:space-between}
.trend-range{font-size:10px;color:rgba(251,247,238,.45);font-variant-numeric:tabular-nums}
.trend-avg-label{color:rgba(251,247,238,.35)}
.trend-dot{fill:var(--pin)}
.trend-ends{display:flex;justify-content:space-between;align-items:baseline;color:rgba(251,247,238,.5);font-size:10px;margin-top:4px;font-variant-numeric:tabular-nums}

/* history */
.history{display:flex;flex-direction:column;gap:7px}
.game-row{background:var(--pin);border-radius:4px;overflow:hidden}
.game-row summary{
  list-style:none;cursor:pointer;padding:13px 14px;display:flex;align-items:center;gap:12px;
}
.game-row summary::-webkit-details-marker{display:none}
.game-score{
  font-family:'Barlow Condensed',Impact,sans-serif;font-weight:700;font-size:26px;
  min-width:52px;font-variant-numeric:tabular-nums;
}
.game-meta{flex:1;font-size:11px;opacity:.6}
.del{background:none;border:0;font-size:20px;line-height:1;color:rgba(42,32,21,.35);padding:0 4px}
.del:hover{color:var(--stripe)}
.game-row .strip{margin:0 12px 12px;border-radius:2px}

@media (max-width:420px){
  .pin{width:26px;height:35px}
  .leavegrid{grid-template-columns:repeat(4,1fr);gap:5px}
  .lpin{width:9px;height:12px}
  .leavecard{padding:8px 2px 6px}
  .leavecard-name{font-size:10px}
  .qbtn{font-size:18px;padding:15px 6px}
  .deck-row{gap:4px}
  .frame-marks span{width:12px;height:13px;font-size:9px}
  .frame-score{font-size:12px}
}
`}</style>
  );
}
