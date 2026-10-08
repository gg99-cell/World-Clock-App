// World Clock — plain JS, no build step.
// Offsets are never calculated by hand: the browser's time-zone database (Intl)
// converts "now" into each city's official IANA time zone.

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;
const MAX_RESULTS = 10;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Weekday dial starts with Monday at the top.
const DIAL_DAYS = [1, 2, 3, 4, 5, 6, 0];

// Places the geocoding service does not know, added so every time zone is reachable.
const EXTRA_PLACES = [
  {
    id: 'extra-kiritimati',
    name: 'Kiritimati',
    aliases: ['Christmas Island Kiribati'],
    admin1: 'Line Islands',
    country: 'Kiribati',
    country_code: 'KI',
    timezone: 'Pacific/Kiritimati',
    population: 7369,
  },
];

// ---------- Clock source ----------
// The device clock is "now". For testing, ?now=<ISO time> starts a simulated
// clock at that moment which then runs forward in real time.
const simParam = new URLSearchParams(location.search).get('now');
const simStart = simParam ? Date.parse(simParam) : NaN;
const bootTime = Date.now();

function now() {
  return Number.isNaN(simStart) ? new Date() : new Date(simStart + (Date.now() - bootTime));
}

// ---------- Time-zone helpers ----------
const formatterCache = new Map();

function formatterFor(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    }));
  }
  return formatterCache.get(timeZone);
}

function isValidZone(timeZone) {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

// One call gives every value for one instant, so time, date and day can never disagree.
function zonedParts(date, timeZone) {
  const p = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(date)) p[type] = value;
  const year = Number(p.year);
  const month = Number(p.month);
  const day = Number(p.day);
  const hour = Number(p.hour) % 24;
  const minute = Number(p.minute);
  const second = Number(p.second);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const offsetMinutes = Math.round((wallAsUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  return { year, month, day, hour, minute, second, weekday, offsetMinutes };
}

function formatOffset(minutes) {
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
}

function formatDifference(minutes) {
  if (minutes === 0) return 'Same time as you';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const parts = [];
  if (h) parts.push(`${h} h`);
  if (m) parts.push(`${m} min`);
  return `${parts.join(' ')} ${minutes > 0 ? 'ahead of' : 'behind'} you`;
}

const pad = (n) => String(n).padStart(2, '0');
const formatTime = (p) => `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;

// ---------- Place helpers ----------
const regionNames = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; }
})();

function countryOf(place) {
  if (place.country) return place.country;
  if (place.country_code && regionNames) {
    try { return regionNames.of(place.country_code.toUpperCase()); } catch { /* fall through */ }
  }
  return '';
}

function placeDetails(place) {
  const parts = [];
  if (place.admin1 && place.admin1 !== place.name) parts.push(place.admin1);
  const country = countryOf(place);
  if (country && country !== place.admin1) parts.push(country);
  return parts.join(', ');
}

function normalize(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function extraMatches(query) {
  const q = normalize(query);
  return EXTRA_PLACES.filter((p) =>
    [p.name, ...(p.aliases || [])].some((n) => normalize(n).startsWith(q)));
}

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const input = $('city-input');
const list = $('city-list');
const statusEl = $('search-status');
const emptyState = $('empty-state');
const cityView = $('city-view');
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs, text) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

function polar(r, angleDeg) {
  const a = (angleDeg - 90) * Math.PI / 180;
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)];
}

function buildClockFace() {
  const ticks = $('clock-ticks');
  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0;
    const [x1, y1] = polar(major ? 80 : 84, i * 6);
    const [x2, y2] = polar(88, i * 6);
    ticks.appendChild(svgEl('line', { x1, y1, x2, y2, class: major ? 'tick tick-major' : 'tick' }));
  }
  const numbers = $('clock-numbers');
  for (let n = 1; n <= 12; n++) {
    const [x, y] = polar(67, n * 30);
    numbers.appendChild(svgEl('text', { x, y, class: 'num', 'text-anchor': 'middle' }, n));
  }
}

const weekLabels = [];
const weekPills = [];

function buildWeekDial() {
  const group = $('week-labels');
  const step = 360 / 7;
  DIAL_DAYS.forEach((dayIndex, i) => {
    const [sx1, sy1] = polar(60, i * step + step / 2);
    const [sx2, sy2] = polar(92, i * step + step / 2);
    group.appendChild(svgEl('line', { x1: sx1, y1: sy1, x2: sx2, y2: sy2, class: 'week-sep' }));
    const [x, y] = polar(74, i * step);
    const pill = svgEl('rect', { x: x - 21, y: y - 12, width: 42, height: 24, rx: 12, class: 'week-pill' });
    const label = svgEl('text', { x, y, class: 'week-label', 'text-anchor': 'middle' },
      WEEKDAYS[dayIndex].slice(0, 3).toUpperCase());
    group.append(pill, label);
    weekPills[dayIndex] = pill;
    weekLabels[dayIndex] = label;
  });
}

function rotate(id, deg) {
  $(id).setAttribute('transform', `rotate(${deg} 100 100)`);
}

// ---------- Rendering ----------
let currentPlace = null;

function render() {
  if (!currentPlace) return;
  const date = now();
  const p = zonedParts(date, currentPlace.timezone);

  // Time
  rotate('hand-hour', (p.hour % 12 + p.minute / 60 + p.second / 3600) * 30);
  rotate('hand-minute', (p.minute + p.second / 60) * 6);
  rotate('hand-second', p.second * 6);
  $('time-text').textContent = formatTime(p);

  // Date
  $('cal-month').textContent = MONTHS[p.month - 1].toUpperCase();
  $('cal-day').textContent = p.day;
  $('cal-year').textContent = p.year;
  $('date-text').textContent = `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;

  // Day
  rotate('hand-week', DIAL_DAYS.indexOf(p.weekday) * (360 / 7));
  weekLabels.forEach((el, i) => el.classList.toggle('today', i === p.weekday));
  weekPills.forEach((el, i) => el.classList.toggle('today', i === p.weekday));
  $('day-text').textContent = WEEKDAYS[p.weekday];

  // City line (offset can change at a daylight-saving switch, so refresh it every tick)
  $('city-zone').textContent = `${currentPlace.timezone} · ${formatOffset(p.offsetMinutes)}`;
  const localOffset = -date.getTimezoneOffset();
  $('city-diff').textContent = formatDifference(p.offsetMinutes - localOffset);

  document.title = `${formatTime(p).slice(0, 5)} ${currentPlace.name} · World Clock`;
}

function tick() {
  render();
  setTimeout(tick, 1000 - (now().getTime() % 1000) + 5);
}

function showPlace(place) {
  currentPlace = place;
  const details = placeDetails(place);
  $('city-name').textContent = details ? `${place.name}, ${details}` : place.name;
  emptyState.hidden = true;
  cityView.hidden = false;
  render();
}

// ---------- Search ----------
let results = [];
let activeIndex = -1;
let debounceTimer = null;
let requestId = 0;
let controller = null;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function closeList() {
  list.hidden = true;
  list.replaceChildren();
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  activeIndex = -1;
}

function renderList() {
  list.replaceChildren();
  const date = now();
  results.forEach((place, i) => {
    const li = document.createElement('li');
    li.id = `city-option-${i}`;
    li.className = 'city-option';
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === activeIndex));

    const text = document.createElement('div');
    text.className = 'option-text';
    const name = document.createElement('div');
    name.className = 'option-name';
    name.textContent = place.name;
    const where = document.createElement('div');
    where.className = 'option-place';
    where.textContent = placeDetails(place);
    text.append(name, where);

    const time = document.createElement('span');
    time.className = 'option-time';
    time.textContent = formatTime(zonedParts(date, place.timezone)).slice(0, 5);

    li.append(text, time);
    li.addEventListener('pointerdown', (e) => {
      e.preventDefault(); // keep focus in the input
      choose(i);
    });
    list.appendChild(li);
  });
  list.hidden = results.length === 0;
  input.setAttribute('aria-expanded', String(results.length > 0));
  if (activeIndex >= 0) {
    input.setAttribute('aria-activedescendant', `city-option-${activeIndex}`);
    $(`city-option-${activeIndex}`).scrollIntoView({ block: 'nearest' });
  } else {
    input.removeAttribute('aria-activedescendant');
  }
}

function choose(i) {
  const place = results[i];
  if (!place) return;
  input.value = place.name;
  closeList();
  setStatus('');
  showPlace(place);
}

async function search(query) {
  const id = ++requestId;
  if (controller) controller.abort();
  controller = new AbortController();

  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=20&language=en&format=json`;
  let data;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    if (err.name === 'AbortError' || id !== requestId) return;
    closeList();
    setStatus("Can't search right now. Check your connection and try again.", true);
    return;
  }
  if (id !== requestId) return;

  const found = (data.results || []).filter((p) => p.timezone && isValidZone(p.timezone));
  const extras = extraMatches(query).filter((x) =>
    !found.some((p) => p.timezone === x.timezone && normalize(p.name) === normalize(x.name)));
  // Stable sort: biggest population first, service order breaks ties.
  results = [...found, ...extras]
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (b.p.population || 0) - (a.p.population || 0) || a.i - b.i)
    .map(({ p }) => p)
    .slice(0, MAX_RESULTS);

  activeIndex = -1;
  if (results.length === 0) {
    closeList();
    setStatus(`No city found for ‘${query}’. Check the spelling.`, true);
  } else {
    setStatus('');
    renderList();
  }
}

input.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  const query = input.value.trim();
  if (query.length < MIN_CHARS) {
    requestId++;
    if (controller) controller.abort();
    closeList();
    setStatus('');
    return;
  }
  debounceTimer = setTimeout(() => search(query), DEBOUNCE_MS);
});

input.addEventListener('keydown', (e) => {
  if (list.hidden || results.length === 0) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = (activeIndex + 1) % results.length;
    renderList();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = (activeIndex - 1 + results.length) % results.length;
    renderList();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    choose(activeIndex >= 0 ? activeIndex : 0);
  } else if (e.key === 'Escape') {
    closeList();
  }
});

input.addEventListener('blur', closeList);
input.addEventListener('focus', () => {
  if (results.length && input.value.trim().length >= MIN_CHARS && !currentPlaceMatchesInput()) renderList();
});

function currentPlaceMatchesInput() {
  return currentPlace && input.value === currentPlace.name;
}

// ---------- Start ----------
buildClockFace();
buildWeekDial();
if (!Number.isNaN(simStart)) {
  const banner = $('sim-banner');
  banner.textContent = `Simulated clock: started at ${new Date(simStart).toISOString()}. Remove ?now= from the address to use the real time.`;
  banner.hidden = false;
}
tick();
