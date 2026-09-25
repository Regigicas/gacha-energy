import {
  MAX_GAMES, toNumberOrNull, parseState, serializeState, validate, validateTarget,
  staminaAt, timeToReach, reanchor, formatDuration, dayLabel, tidy,
} from './stamina.js';

/* Namespaced: on GitHub Pages every repo under the same user shares one
   origin, and therefore one localStorage. */
const STORAGE_KEY = 'gacha-energy:state';
const LEGACY_STORAGE_KEY = 'gachaGameList';
const SAVE_DELAY_MS = 300;
const REMOVE_ANIMATION_MS = 200;
const TOAST_MS = 6000;
const MAX_IMPORT_BYTES = 1_000_000;
/* setTimeout overflows past ~24.8 days; re-check at least hourly anyway. */
const MAX_TIMER_MS = 3_600_000;

const NEW_GAME = { name: '', cur: 0, max: 240, regen: 6, target: null };

const PRESETS = [
  { name: 'Genshin Impact', max: 200, regen: 8 },
  { name: 'Honkai: Star Rail', max: 240, regen: 6 },
  { name: 'Zenless Zone Zero', max: 240, regen: 6 },
  { name: 'Wuthering Waves', max: 240, regen: 6 },
  { name: 'Arknights', max: 135, regen: 6 },
];

const $ = (id) => document.getElementById(id);
const grid = $('gamesGrid');
const template = $('cardTemplate');
const addGameBtn = $('addGameBtn');
const notifyBtn = $('notifyBtn');
const toastEl = $('toast');
const toastText = $('toastText');
const toastAction = $('toastAction');

/* Card element -> { card, game, el, live }. The grid's DOM order is the
   display order, and the order games are saved in. */
const entries = new Map();
/* Add Game + presets, disabled together at MAX_GAMES. */
const addButtons = [addGameBtn];
const canNotify = 'Notification' in window;

let notify = false;
let saveTimer = null;
let ticker = null;
let notifyTimer = null;
let notifyCheckedAt = Date.now();
let toastTimer = null;
let toastRun = null;
let cardSeq = 0;

const orderedEntries = () => [...grid.children].map((card) => entries.get(card)).filter(Boolean);

/* ── Persistence ─────────────────────────────────────────────────────────── */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw !== null) return parseState(JSON.parse(raw), Date.now());
  } catch {
    /* Storage blocked (private mode) or a corrupt value: start clean rather
       than break the app. */
  }
  return null;
}

const currentState = () => serializeState({ games: orderedEntries().map((e) => e.game), notify });

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentState()));
    /* Anything under the v1 key has been carried over by now. */
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* Quota or private mode: the session keeps working in memory. */
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

function flushSave() {
  if (saveTimer !== null) saveNow();
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

const formatClock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/* Validates and re-renders one card. Errors appear once a value is committed
   (change / Enter), then track the input live until fixed, so typing never
   flashes an error mid-edit. */
function refresh(entry, { explain }) {
  const { game, el } = entry;
  const problem = validate(game) ?? validateTarget(game);
  if (!problem) el.err.textContent = '';
  else if (explain || el.err.textContent) el.err.textContent = problem.message;

  const flagged = problem && el.err.textContent ? problem.field : null;
  for (const [field, input] of Object.entries(el.fields)) {
    if (field === flagged) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', el.err.id);
    } else {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  }

  render(entry, Date.now());
  ensureTicker();
  scheduleNotifications();
}

function render(entry, now) {
  const { game, el } = entry;
  const stamina = staminaAt(game, now);
  entry.live = stamina !== null && stamina < game.max;
  el.barWrap.hidden = el.result.hidden = stamina === null;
  if (stamina === null) return;

  const { max, target } = game;
  const whole = Math.floor(stamina);
  /* Keep the field on the live value, except while it is being edited. */
  if (document.activeElement !== el.fields.cur && el.fields.cur.value !== String(whole)) {
    el.fields.cur.value = whole;
  }

  const fill = Math.min(100, (stamina / max) * 100);
  /* Floor, so a nearly-full bar never claims 100% before it really is. */
  const pct = Math.floor(fill);
  el.barFill.style.width = `${fill}%`;
  el.barText.textContent = `${whole} / ${tidy(max)} · ${pct}%`;
  el.bar.setAttribute('aria-valuenow', String(pct));

  const isFull = stamina >= max;
  el.fullMsg.hidden = !isFull;
  el.grid.hidden = isFull;
  el.target.hidden = isFull || target === null || validateTarget(game) !== null;

  if (isFull) {
    el.fullMsg.textContent = stamina > max
      ? `✅ Full, ${tidy(stamina - max)} over the cap`
      : '✅ Stamina is full!';
    return;
  }

  const fullAt = timeToReach(game, max);
  el.timeRem.textContent = formatDuration((fullAt - now) / 1000);
  el.timeRemSub.textContent = `${Math.ceil(max - stamina)} stamina to restore`;
  el.fullAt.textContent = formatClock(fullAt);
  el.fullAtSub.textContent = dayLabel(fullAt, now);

  if (!el.target.hidden) {
    const reached = stamina >= target;
    el.target.classList.toggle('is-reached', reached);
    if (reached) {
      el.target.textContent = `🎯 Target of ${tidy(target)} reached`;
    } else {
      const at = timeToReach(game, target);
      const day = dayLabel(at, now);
      el.target.textContent = `🎯 ${tidy(target)} in ${formatDuration((at - now) / 1000)} · ` +
        `${formatClock(at)}${day === 'Today' ? '' : ` ${day}`}`;
    }
  }
}

/* ── Live countdown ──────────────────────────────────────────────────────── */

function tick() {
  const now = Date.now();
  for (const entry of entries.values()) {
    if (entry.live) render(entry, now);
  }
  ensureTicker();
}

function ensureTicker() {
  const wanted = document.visibilityState === 'visible' && [...entries.values()].some((e) => e.live);
  if (wanted && ticker === null) {
    ticker = setInterval(tick, 1000);
  } else if (!wanted && ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
}

/* ── Notifications ───────────────────────────────────────────────────────
   Web pages cannot schedule notifications, so these only fire while the app
   is still running in the background (a hidden tab, a minimised window). */

const notificationsOn = () => notify && canNotify && Notification.permission === 'granted';
const fullAtOf = ({ game }) => (validate(game) ? null : timeToReach(game, game.max));

function scheduleNotifications() {
  clearTimeout(notifyTimer);
  notifyTimer = null;
  notifyCheckedAt = Date.now();
  if (!notificationsOn()) return;
  const upcoming = [...entries.values()].map(fullAtOf).filter((at) => at > notifyCheckedAt);
  if (upcoming.length === 0) return;
  notifyTimer = setTimeout(checkNotifications, Math.min(Math.min(...upcoming) - notifyCheckedAt, MAX_TIMER_MS));
}

function checkNotifications() {
  const now = Date.now();
  /* On screen, the card itself already says it is full. */
  if (document.visibilityState === 'hidden') {
    for (const entry of entries.values()) {
      const at = fullAtOf(entry);
      if (at !== null && at > notifyCheckedAt && at <= now) showFullNotification(entry.game);
    }
  }
  scheduleNotifications();
}

async function showFullNotification(game) {
  const title = game.name ? `${game.name}: stamina full` : 'Stamina full';
  const options = { body: `Back at ${tidy(game.max)}. Time to spend it!`, icon: 'icons/icon-192.png' };
  try {
    /* Android only supports notifications shown through a service worker. */
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) await registration.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    /* Permission revoked meanwhile: nothing useful to do. */
  }
}

function renderNotifyButton() {
  notifyBtn.hidden = !canNotify;
  notifyBtn.setAttribute('aria-pressed', String(notificationsOn()));
}

async function toggleNotifications() {
  if (notificationsOn()) {
    notify = false;
  } else {
    const permission = Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
    notify = permission === 'granted';
    showToast(notify
      ? "You'll be notified when a game fills up while the app is in the background."
      : 'Notifications are blocked for this site. Allow them in your browser settings.');
  }
  renderNotifyButton();
  scheduleSave();
  scheduleNotifications();
}

/* ── Toast ───────────────────────────────────────────────────────────────── */

function showToast(message, action = null) {
  clearTimeout(toastTimer);
  toastText.textContent = message;
  toastAction.hidden = !action;
  toastAction.textContent = action?.label ?? '';
  toastRun = action?.run ?? null;
  toastEl.classList.add('is-visible');
  toastTimer = setTimeout(hideToast, TOAST_MS);
}

function hideToast() {
  clearTimeout(toastTimer);
  if (toastEl.contains(document.activeElement)) addGameBtn.focus();
  toastEl.classList.remove('is-visible');
  toastRun = null;
}

/* ── Cards ───────────────────────────────────────────────────────────────── */

function createEntry(game) {
  const card = template.content.firstElementChild.cloneNode(true);
  const q = (selector) => card.querySelector(selector);
  const el = {
    name: q('.js-name'),
    prev: q('.js-prev'),
    next: q('.js-next'),
    remove: q('.js-remove'),
    fields: Object.fromEntries([...card.querySelectorAll('[data-field]')].map((i) => [i.dataset.field, i])),
    err: q('.js-err'),
    barWrap: q('.js-bar-wrap'),
    barText: q('.js-bar-text'),
    bar: q('.js-bar'),
    barFill: q('.js-bar-fill'),
    result: q('.js-result'),
    fullMsg: q('.js-full-msg'),
    grid: q('.js-grid'),
    timeRem: q('.js-time-rem'),
    timeRemSub: q('.js-time-rem-sub'),
    fullAt: q('.js-full-at'),
    fullAtSub: q('.js-full-at-sub'),
    target: q('.js-target'),
  };
  const entry = { card, game, el, live: false };

  el.err.id = `card-${++cardSeq}-error`;
  el.name.value = game.name;
  el.name.addEventListener('input', () => {
    game.name = el.name.value;
    scheduleSave();
  });

  for (const [field, input] of Object.entries(el.fields)) {
    input.value = game[field] === null ? '' : tidy(game[field]);
    input.addEventListener('input', () => onFieldInput(entry, field));
    input.addEventListener('change', () => refresh(entry, { explain: true }));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') refresh(entry, { explain: true });
    });
  }

  el.prev.addEventListener('click', () => moveGame(entry, -1));
  el.next.addEventListener('click', () => moveGame(entry, 1));
  el.remove.addEventListener('click', () => removeGame(entry));
  return entry;
}

function onFieldInput(entry, field) {
  const { game, el } = entry;
  const now = Date.now();
  const value = toNumberOrNull(el.fields[field].value);
  if (field === 'cur') Object.assign(game, { cur: value, anchorAt: now });
  else if (field === 'target') game.target = value;
  /* Settings changes apply from now on; stamina earned so far is kept. */
  else Object.assign(game, reanchor(game, now), { [field]: value });
  refresh(entry, { explain: false });
  scheduleSave();
}

function addGame(game, { index = null } = {}) {
  if (entries.size >= MAX_GAMES) return null;
  const entry = createEntry(game);
  const before = index === null ? null : orderedEntries()[index]?.card ?? null;
  grid.insertBefore(entry.card, before);
  entries.set(entry.card, entry);
  refresh(entry, { explain: false });
  refreshControls();
  scheduleSave();
  return entry;
}

/* Adding by hand focuses what the player will want to type next. */
function addNewGame(preset = {}) {
  const entry = addGame({ ...NEW_GAME, ...preset, anchorAt: Date.now() });
  if (!entry) return;
  const input = preset.name ? entry.el.fields.cur : entry.el.name;
  input.focus();
  input.select();
}

function removeGame(entry) {
  const list = orderedEntries();
  const index = list.indexOf(entry);
  const { card, game } = entry;
  const hadFocus = card.contains(document.activeElement);

  /* Out of the model at once, so nothing can save it during the animation. */
  entries.delete(card);
  card.inert = true;
  card.classList.add('is-removing');
  setTimeout(() => card.remove(), REMOVE_ANIMATION_MS);
  saveNow();
  refreshControls();
  ensureTicker();
  scheduleNotifications();

  if (hadFocus) {
    const neighbour = list[index + 1] ?? list[index - 1];
    (neighbour ? neighbour.card : addGameBtn).focus();
  }

  showToast(`Removed ${game.name || 'a game'}`, {
    label: 'Undo',
    run: () => addGame(game, { index })?.card.focus(),
  });
}

function moveGame(entry, step) {
  const list = orderedEntries();
  const other = list[list.indexOf(entry) + step];
  if (!other) return;
  grid.insertBefore(entry.card, step < 0 ? other.card : other.card.nextSibling);
  refreshControls();
  scheduleSave();
  /* Moving the node drops focus; put it back on a button that still works. */
  const [same, opposite] = step < 0 ? [entry.el.prev, entry.el.next] : [entry.el.next, entry.el.prev];
  (same.disabled ? opposite : same).focus();
}

function refreshControls() {
  const list = orderedEntries();
  list.forEach(({ el }, i) => {
    el.prev.disabled = i === 0;
    el.next.disabled = i === list.length - 1;
  });

  const atLimit = list.length >= MAX_GAMES;
  for (const button of addButtons) {
    button.disabled = atLimit;
    button.title = atLimit ? `You can track up to ${MAX_GAMES} games.` : '';
  }

  setEmptyState(list.length === 0);
}

function setEmptyState(show) {
  const existing = $('emptyState');
  if (show === Boolean(existing)) return;
  if (!show) {
    existing.remove();
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'emptyState';
  button.className = 'empty-state';
  button.addEventListener('click', () => addNewGame());

  const icon = document.createElement('span');
  icon.className = 'es-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '🎮';

  const text = document.createElement('span');
  text.textContent = 'No games yet. Click to add one.';

  button.append(icon, text);
  grid.append(button);
}

/* ── Export / import ─────────────────────────────────────────────────────── */

function exportGames() {
  const json = JSON.stringify(currentState(), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `gacha-stamina-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  /* Safari cancels the download if the URL is revoked straight away. */
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function importGames(file) {
  let state = null;
  if (file.size <= MAX_IMPORT_BYTES) {
    try {
      state = parseState(JSON.parse(await file.text()), Date.now());
    } catch {
      /* Not JSON: reported below. */
    }
  }
  if (!state) {
    showToast("That file isn't a Gacha Stamina export.");
    return;
  }

  const count = state.games.length;
  const plural = (n) => `${n} game${n === 1 ? '' : 's'}`;
  if (entries.size > 0 && !confirm(`Replace your ${plural(entries.size)} with the ${plural(count)} in this file?`)) {
    return;
  }

  for (const card of entries.keys()) card.remove();
  entries.clear();
  for (const game of state.games) addGame(game);
  refreshControls();
  ensureTicker();
  scheduleNotifications();
  saveNow();
  showToast(`Imported ${plural(count)}.`);
}

/* ── Boot ────────────────────────────────────────────────────────────────── */

/* Controls are wired before any stored data is touched, so a storage failure
   can never leave the page without a way to add a game. */
addGameBtn.addEventListener('click', () => addNewGame());

const presetsWrap = $('presetsWrap');
for (const preset of PRESETS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-secondary btn-small';
  button.textContent = `＋ ${preset.name}`;
  button.addEventListener('click', () => addNewGame(preset));
  presetsWrap.append(button);
  addButtons.push(button);
}

$('exportBtn').addEventListener('click', exportGames);
const importFile = $('importFile');
$('importBtn').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', () => {
  const [file] = importFile.files;
  importFile.value = ''; // so picking the same file again still fires
  if (file) importGames(file);
});

notifyBtn.addEventListener('click', toggleNotifications);

toastAction.addEventListener('click', () => {
  const run = toastRun;
  hideToast();
  run?.();
});
/* Hold the toast while the player is reaching for it. */
for (const type of ['pointerenter', 'focusin']) toastEl.addEventListener(type, () => clearTimeout(toastTimer));
for (const type of ['pointerleave', 'focusout']) {
  toastEl.addEventListener(type, () => {
    if (toastEl.classList.contains('is-visible')) toastTimer = setTimeout(hideToast, TOAST_MS);
  });
}

const saved = loadState();
notify = saved?.notify ?? false;
for (const game of saved?.games ?? []) addGame(game);
refreshControls();
renderNotifyButton();
scheduleNotifications();

document.addEventListener('visibilitychange', () => {
  /* Debounced writes must not be lost when the tab is backgrounded. */
  if (document.visibilityState === 'hidden') flushSave();
  else tick();
  ensureTicker();
});
window.addEventListener('pagehide', flushSave);

/* ── PWA: register the service worker for offline support ───────────────── */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
