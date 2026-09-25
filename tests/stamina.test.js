import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_GAMES, NAME_MAX, toNumberOrNull, normalizeGame, parseState, serializeState,
  validate, validateTarget, staminaAt, timeToReach, reanchor, formatDuration, dayLabel, tidy,
} from '../stamina.js';

const MIN = 60000;
const T0 = Date.UTC(2026, 0, 15, 12, 0, 0);
const game = (overrides = {}) =>
  ({ name: 'G', cur: 0, max: 200, regen: 8, target: null, anchorAt: T0, ...overrides });

test('toNumberOrNull accepts finite numbers and numeric strings only', () => {
  assert.equal(toNumberOrNull(5), 5);
  assert.equal(toNumberOrNull('2.5'), 2.5);
  assert.equal(toNumberOrNull(''), null);
  assert.equal(toNumberOrNull('  '), null);
  assert.equal(toNumberOrNull('12abc'), null);
  assert.equal(toNumberOrNull(Infinity), null);
  assert.equal(toNumberOrNull(null), null);
  assert.equal(toNumberOrNull({}), null);
});

test('normalizeGame coerces untrusted input', () => {
  assert.equal(normalizeGame(null, T0), null);
  assert.equal(normalizeGame([], T0), null);
  assert.equal(normalizeGame('x', T0), null);

  const g = normalizeGame({ name: 'x'.repeat(500), cur: '10', max: {}, regen: 6, extra: '<img>' }, T0);
  assert.equal(g.name.length, NAME_MAX);
  assert.equal(g.cur, 10);
  assert.equal(g.max, null);
  assert.equal(g.regen, 6);
  assert.equal(g.target, null);
  assert.equal(g.anchorAt, T0);
  assert.equal('extra' in g, false);

  assert.equal(normalizeGame({ name: 42 }, T0).name, '');
});

test('normalizeGame keeps past anchors and clamps future ones to now', () => {
  assert.equal(normalizeGame({ anchorAt: T0 - MIN }, T0).anchorAt, T0 - MIN);
  assert.equal(normalizeGame({ anchorAt: T0 + MIN }, T0).anchorAt, T0);
  assert.equal(normalizeGame({ savedAt: T0 - MIN }, T0).anchorAt, T0 - MIN, 'v1 savedAt migrates');
});

test('parseState reads v2 and v1, and rejects anything else', () => {
  const v2 = parseState({ version: 2, notify: true, games: [game()] }, T0);
  assert.equal(v2.games.length, 1);
  assert.equal(v2.notify, true);

  const v1 = parseState([{ name: 'Old', cur: 5, max: 240, regen: 6, savedAt: T0 - 60 * MIN }], T0);
  assert.equal(v1.games[0].anchorAt, T0 - 60 * MIN);
  assert.equal(v1.notify, false);

  assert.equal(parseState(null, T0), null);
  assert.equal(parseState({ games: 'nope' }, T0), null);
  assert.equal(parseState(42, T0), null);
  assert.deepEqual(parseState([], T0), { games: [], notify: false });

  const many = parseState({ games: Array.from({ length: MAX_GAMES + 10 }, () => game()) }, T0);
  assert.equal(many.games.length, MAX_GAMES);
});

test('serializeState round-trips through parseState', () => {
  const games = [game({ target: 40 }), game({ name: 'H', cur: null })];
  const back = parseState(JSON.parse(JSON.stringify(serializeState({ games, notify: true }))), T0);
  assert.deepEqual(back, { games, notify: true });
});

test('validate names the offending field', () => {
  assert.equal(validate(game()), null);
  assert.equal(validate(game({ cur: null })).field, 'cur');
  assert.equal(validate(game({ cur: -1 })).field, 'cur');
  assert.equal(validate(game({ max: 0 })).field, 'max');
  assert.equal(validate(game({ regen: null })).field, 'regen');
  assert.equal(validate(game({ cur: 500 })), null, 'over the cap is allowed');
});

test('validateTarget is optional and bounded by max', () => {
  assert.equal(validateTarget(game()), null);
  assert.equal(validateTarget(game({ target: 40 })), null);
  assert.equal(validateTarget(game({ target: 0 })).field, 'target');
  assert.equal(validateTarget(game({ target: 201 })).field, 'target');
});

test('staminaAt regenerates fractionally and stops at max', () => {
  assert.equal(staminaAt(game(), T0), 0);
  assert.equal(staminaAt(game(), T0 + 12 * MIN), 1.5);
  assert.equal(staminaAt(game(), T0 + 10000 * MIN), 200);
  assert.equal(staminaAt(game(), T0 - 60 * MIN), 0, 'clock going backwards');
  assert.equal(staminaAt(game({ cur: 250 }), T0 + 60 * MIN), 250, 'over the cap is kept');
  assert.equal(staminaAt(game({ regen: null }), T0), null);
});

test('timeToReach', () => {
  assert.equal(timeToReach(game(), 200), T0 + 200 * 8 * MIN);
  assert.equal(timeToReach(game({ cur: 50 }), 40), T0);
});

test('reanchor banks progress (regression: edits used to lose regen)', () => {
  const later = T0 + 80 * MIN;
  const g = reanchor(game(), later);
  assert.equal(g.cur, 10);
  assert.equal(g.anchorAt, later);
  assert.equal(staminaAt(g, later), staminaAt(game(), later));
});

test('reanchor never clamps down through a half-typed max', () => {
  let g = game({ max: 240, regen: 6, cur: 100 });
  const now = T0 + 6 * MIN;
  for (const max of [2, 24, 240]) g = { ...reanchor(g, now), max };
  assert.equal(g.cur, 101);
});

test('reanchor keeps cur when the game cannot be computed', () => {
  const g = reanchor(game({ cur: 7, regen: null }), T0 + MIN);
  assert.equal(g.cur, 7);
  assert.equal(g.anchorAt, T0 + MIN);
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(0.2), '1s', 'rounds up');
  assert.equal(formatDuration(65), '1m 05s');
  assert.equal(formatDuration(3600), '1h');
  assert.equal(formatDuration(3660), '1h 1m');
  assert.equal(formatDuration(86400 + 7200), '1d 2h');
  assert.equal(formatDuration(-5), '0s');
});

test('dayLabel', () => {
  const now = new Date(2026, 0, 15, 23, 0);
  assert.equal(dayLabel(new Date(2026, 0, 15, 23, 30), now), 'Today');
  assert.equal(dayLabel(new Date(2026, 0, 16, 0, 30), now), 'Tomorrow');
  assert.equal(dayLabel(new Date(2026, 0, 17, 10, 0), now),
    new Date(2026, 0, 17).toLocaleDateString([], { weekday: 'long' }));
});

test('tidy', () => {
  assert.equal(tidy(0.1 + 0.2), 0.3);
  assert.equal(tidy(240), 240);
});
