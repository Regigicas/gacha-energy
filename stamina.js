/* Pure stamina logic: no DOM, no storage, no clock of its own. Every function
   that depends on time takes `now` explicitly so it can be tested.
   A classic script, not an ES module: browsers refuse to load modules from
   file://, and the app must keep working when index.html is opened from disk.
   It exposes a single global, `Stamina`. */

(function (root) {
  'use strict';

  const MAX_GAMES = 50;
  const NAME_MAX = 120;
  const STATE_VERSION = 2;

  const MINUTE = 60000;

  /* ── Model ───────────────────────────────────────────────────────────────
     A game is { name, cur, anchorAt, max, regen, target }. `cur` is the stamina
     the player had at `anchorAt` (ms epoch). The pair only changes when the
     player edits a field, so the model is time-invariant: current stamina is
     always derived, and saving never has to snapshot a moving value.
     Numeric fields are null while the input is empty or unparseable. */

  function toNumberOrNull(value) {
    const n = typeof value === 'number' ? value
      : typeof value === 'string' && value.trim() !== '' ? Number(value)
        : NaN;
    return Number.isFinite(n) ? n : null;
  }

  /* Anything read back from storage or an imported file is untrusted: coerce it
     to primitives here, and never build HTML from it. */
  function normalizeGame(raw, now) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    /* v1 stored `savedAt`, which meant the same thing as `anchorAt`. */
    const anchorAt = toNumberOrNull(raw.anchorAt ?? raw.savedAt);
    return {
      name: typeof raw.name === 'string' ? raw.name.slice(0, NAME_MAX) : '',
      cur: toNumberOrNull(raw.cur),
      max: toNumberOrNull(raw.max),
      regen: toNumberOrNull(raw.regen),
      target: toNumberOrNull(raw.target),
      /* A future anchor means clock skew; treat it as "just now". */
      anchorAt: anchorAt > 0 && anchorAt <= now ? anchorAt : now,
    };
  }

  /* Accepts the current format ({ version, notify, games }) and v1 (a bare
     array of games). Returns null when `data` is neither. */
  function parseState(data, now) {
    const isLegacy = Array.isArray(data);
    const list = isLegacy ? data
      : data && typeof data === 'object' && Array.isArray(data.games) ? data.games
        : null;
    if (!list) return null;
    return {
      games: list.slice(0, MAX_GAMES).map((raw) => normalizeGame(raw, now)).filter(Boolean),
      notify: !isLegacy && data.notify === true,
    };
  }

  function serializeState({ games, notify }) {
    return {
      version: STATE_VERSION,
      notify: notify === true,
      games: games.map(({ name, cur, anchorAt, max, regen, target }) =>
        ({ name, cur, anchorAt, max, regen, target })),
    };
  }

  /* ── Validation ──────────────────────────────────────────────────────────
     Each returns null when fine, or { field, message } naming the input that
     needs fixing. The target is optional and never blocks the main result. */

  function validate({ cur, max, regen }) {
    if (cur === null) return { field: 'cur', message: 'Enter your current stamina.' };
    if (cur < 0) return { field: 'cur', message: 'Current stamina cannot be negative.' };
    if (max === null || max <= 0) return { field: 'max', message: 'Max stamina must be greater than 0.' };
    if (regen === null || regen <= 0) return { field: 'regen', message: 'Minutes per point must be greater than 0.' };
    return null;
  }

  function validateTarget({ target, max }) {
    if (target === null) return null;
    if (target <= 0 || target > max) {
      return { field: 'target', message: 'Target must be between 1 and max stamina.' };
    }
    return null;
  }

  /* ── Regeneration ───────────────────────────────────────────────────────── */

  /* Stamina at `now`, fractional. Regen stops at max, but a value already over
     the cap (refill items) is kept as-is rather than clamped down. Returns null
     when the game cannot be computed. */
  function staminaAt(game, now) {
    if (validate(game)) return null;
    const { cur, max, regen, anchorAt } = game;
    if (cur >= max) return cur;
    const gained = Math.max(0, now - anchorAt) / MINUTE / regen;
    return Math.min(max, cur + gained);
  }

  /* Epoch ms at which stamina reaches `amount` (assumed <= max). */
  function timeToReach(game, amount) {
    const { cur, regen, anchorAt } = game;
    if (amount <= cur) return anchorAt;
    return anchorAt + (amount - cur) * regen * MINUTE;
  }

  /* Bank the stamina earned so far under the current settings, so that changing
     max or regen only affects regeneration from `now` on. Never clamps down, so
     a half-typed max ("2" on the way to "240") cannot destroy progress. */
  function reanchor(game, now) {
    return { ...game, cur: staminaAt(game, now) ?? game.cur, anchorAt: now };
  }

  /* ── Formatting ─────────────────────────────────────────────────────────── */

  /* Rounds up, so a countdown never reads "0s" while stamina is not yet full. */
  function formatDuration(totalSeconds) {
    const total = Math.max(0, Math.ceil(totalSeconds));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    return `${seconds}s`;
  }

  function dayLabel(target, now) {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTarget = new Date(target);
    startOfTarget.setHours(0, 0, 0, 0);
    /* Round, not floor: a DST day is 23 or 25 hours long. */
    const days = Math.round((startOfTarget - startOfToday) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days > 1 && days < 7) return new Date(target).toLocaleDateString([], { weekday: 'long' });
    return new Date(target).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  /* Trim binary-float noise without turning 0.1 into 0.1000000000000001. */
  const tidy = (n) => Math.round(n * 100) / 100;

  root.Stamina = Object.freeze({
    MAX_GAMES,
    NAME_MAX,
    STATE_VERSION,
    toNumberOrNull,
    normalizeGame,
    parseState,
    serializeState,
    validate,
    validateTarget,
    staminaAt,
    timeToReach,
    reanchor,
    formatDuration,
    dayLabel,
    tidy,
  });
})(globalThis);
