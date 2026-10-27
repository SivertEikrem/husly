// =====================================================================
// Husly – felles kode for alle sider
// Lastes i <head> rett etter supabase-js og config.js.
// =====================================================================

/* ---------- Tema (lys / mørk / system) ---------- */

const THEME_KEY = 'husly-tema';
const root = document.documentElement;

function getThemePref() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { return 'system'; }
}

function applyTheme(pref) {
  if (pref === 'light' || pref === 'dark') root.dataset.theme = pref;
  else delete root.dataset.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = effectiveTheme() === 'dark' ? '#14171b' : '#f2f3f5';
}

function effectiveTheme() {
  if (root.dataset.theme) return root.dataset.theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function setThemePref(pref) {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch (e) { /* privat modus o.l. */ }
  applyTheme(pref);
}

function toggleTheme() {
  setThemePref(effectiveTheme() === 'dark' ? 'light' : 'dark');
}

applyTheme(getThemePref());
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(getThemePref()));
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-theme-toggle]')) toggleTheme();
});

/* ---------- Supabase ---------- */

const CONFIG = window.HUSLY_CONFIG || {};
const sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

// Lager en full adresse til en side i samme mappe (fungerer både på eget
// domene og på brukernavn.github.io/repo/)
function pageUrl(path) {
  return new URL(path, window.location.href).href;
}

/* ---------- Datoer på norsk (egne oppslagslister) ---------- */

const MONTHS = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
const MONTHS_SHORT = ['jan.', 'feb.', 'mars', 'april', 'mai', 'juni', 'juli', 'aug.', 'sep.', 'okt.', 'nov.', 'des.'];
const MONTHS_TILE = ['JAN', 'FEB', 'MAR', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DES'];
const WEEKDAYS = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
const WEEKDAYS_SHORT = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];

const pad2 = (n) => String(n).padStart(2, '0');
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// 0 = mandag … 6 = søndag
function dow(d) { return (d.getDay() + 6) % 7; }

function isoDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function parseDate(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function today() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function startOfWeek(d) { return addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -dow(d)); }

function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

function daysBetween(a, b) { return Math.round((parseDate(isoDate(b)) - parseDate(isoDate(a))) / 86400000); }

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}

// «27. oktober» (med årstall hvis det ikke er i år)
function fmtDate(d) {
  const y = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()}. ${MONTHS[d.getMonth()]}${y}`;
}

// «27. okt.»
function fmtDateShort(d) {
  const y = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}${y}`;
}

// «tirsdag 27. oktober»
function fmtDateLong(d) { return `${WEEKDAYS[dow(d)]} ${fmtDate(d)}`; }

// «I dag», «I morgen», «I går» eller «Tirsdag 27. oktober»
function fmtDayRelative(d) {
  const diff = daysBetween(today(), d);
  if (diff === 0) return 'I dag';
  if (diff === 1) return 'I morgen';
  if (diff === -1) return 'I går';
  return cap(fmtDateLong(d));
}

// «18:00» fra «18:00:00»
function fmtTime(t) { return t ? String(t).slice(0, 5) : ''; }

function fmtClock(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

// Tidspunkt for beskjeder o.l.: «nå nettopp», «14 min siden», «i går 18:02»
function fmtAgo(ts) {
  const d = new Date(ts);
  const secs = (Date.now() - d.getTime()) / 1000;
  if (secs < 60) return 'nå nettopp';
  if (secs < 3600) return `${Math.floor(secs / 60)} min siden`;
  const diff = daysBetween(d, today());
  if (diff === 0) return `i dag ${fmtClock(d)}`;
  if (diff === 1) return `i går ${fmtClock(d)}`;
  if (diff < 7) return `${WEEKDAYS[dow(d)]} ${fmtClock(d)}`;
  return `${fmtDateShort(d)} ${fmtClock(d)}`;
}

function greetingWord() {
  const h = new Date().getHours();
  if (h < 5) return 'God natt';
  if (h < 10) return 'God morgen';
  if (h < 17) return 'Hei';
  if (h < 22) return 'God kveld';
  return 'God natt';
}

/* ---------- Penger (lagres i øre) ---------- */

function groupThousands(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// 123450 -> «1 234,50 kr», 120000 -> «1 200 kr»
function fmtKr(ore, opts = {}) {
  const neg = ore < 0;
  const abs = Math.abs(Math.round(ore));
  const kr = Math.floor(abs / 100);
  const rest = abs % 100;
  let s = groupThousands(kr) + (rest ? ',' + pad2(rest) : '');
  if (neg && !opts.noSign) s = '−' + s;
  else if (!neg && opts.plus && abs > 0) s = '+' + s;
  return s + ' kr';
}

// «1 234,5» / «1234.50» / «99» -> øre (heltall), ellers null
function parseKr(str) {
  const s = String(str || '').replace(/\s|kr/gi, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [k, d = ''] = s.split('.');
  const ore = Number(k) * 100 + Number((d + '00').slice(0, 2));
  return ore > 0 ? ore : null;
}

/* ---------- HTML-hjelpere ---------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Escaper teksten og gjør lenker klikkbare
function linkify(s) {
  return esc(s).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,:;!?)"'\]]/g, (url) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

function qs(sel, el = document) { return el.querySelector(sel); }
function qsa(sel, el = document) { return Array.from(el.querySelectorAll(sel)); }

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = parts[0][0] || '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}

const PERSON_COLORS = [
  { key: 'sky', name: 'Blå' }, { key: 'moss', name: 'Grønn' }, { key: 'ember', name: 'Oransje' },
  { key: 'plum', name: 'Lilla' }, { key: 'rose', name: 'Rosa' }, { key: 'teal', name: 'Turkis' },
  { key: 'amber', name: 'Gyllen' }, { key: 'slate', name: 'Grå' }
];

function avatar(person, size = '') {
  if (!person) return `<span class="avatar ghost ${size}" aria-hidden="true">?</span>`;
  return `<span class="avatar ${size}" data-c="${esc(person.color)}" title="${esc(person.display_name)}" aria-hidden="true">${esc(initials(person.display_name))}</span>`;
}

/* ---------- Ikoner (egen samling, 24×24, strek) ---------- */

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  message: '<path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.6A8.5 8.5 0 1 1 21 11.5Z"/>',
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  more: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',
  sparkle: '<path d="M11 3.5l1.7 4.6 4.6 1.7-4.6 1.7L11 16.1l-1.7-4.6-4.6-1.7 4.6-1.7z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  cart: '<circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/><path d="M2.5 3.5h2.6l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 7.5H6"/>',
  house: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/><path d="M12 12.5v.01M12 16v1.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.2A6.5 6.5 0 0 1 21.5 20"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  pin: '<path d="M12 16.5V22"/><path d="M8.5 3h7l-1 6 3.5 4v2.5H6V13l3.5-4z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/>',
  logout: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mapPin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  wifi: '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.6a10 10 0 0 1 14 0M8.5 16.2a5 5 0 0 1 7 0"/><path d="M12 20h.01"/>',
  phone: '<path d="M21 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.1 4.2 2 2 0 0 1 3.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="M13.5 6.5l4 4"/>',
  chevLeft: '<path d="m15 18-6-6 6-6"/>',
  chevRight: '<path d="m9 18 6-6-6-6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  chevUpDown: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  send: '<path d="M21 3 10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5z"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 20 3M16 7l3 3M14 9l2 2"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  note: '<path d="M14.5 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.5z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20.5V16h-4.5"/>',
  recycle: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7"/><path d="M9 7l1-3h4l1 3"/>',
  rules: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>',
  crown: '<path d="M3 7.5l4.5 4L12 5l4.5 6.5L21 7.5l-2 11H5z"/>',
  shield: '<path d="M12 21s7-3.5 7-9.5V5.5L12 3 5 5.5v6C5 17.5 12 21 12 21Z"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14"/><path d="m17 12 4 4-4 4M21 16H7"/>',
  door: '<path d="M14 3H6a1 1 0 0 0-1 1v17h9"/><path d="M14 3l5 2v16l-5-1z"/><path d="M11.5 12v.5"/>'
};

function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

function brandMark(cls = '') {
  return `<svg class="brand-mark ${cls}" viewBox="0 0 32 32" aria-hidden="true"><rect class="bm-bg" width="32" height="32" rx="9"/><path class="bm-house" d="M7.5 15.2 16 8.5l8.5 6.7v8.3a1 1 0 0 1-1 1h-4.6v-5.2h-5.8v5.2H8.5a1 1 0 0 1-1-1z"/></svg>`;
}

function themeToggle() {
  return `<button type="button" class="btn-icon btn theme-toggle" data-theme-toggle aria-label="Bytt mellom lys og mørk modus" title="Bytt tema">${icon('sun', 'icon-sun')}${icon('moon', 'icon-moon')}</button>`;
}

/* ---------- Tilbakemeldinger ---------- */

function toast(msg, type = 'ok') {
  let box = qs('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'error' ? ' error' : '');
  t.innerHTML = (type === 'error' ? icon('info') : icon('check')) + `<span>${esc(msg)}</span>`;
  box.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .25s'; t.style.opacity = '0'; }, 3200);
  setTimeout(() => t.remove(), 3500);
}

// Oversetter feilmeldinger fra Supabase til norsk
function errMsg(error) {
  const m = String(error?.message || error || '');
  const map = [
    [/Invalid login credentials/i, 'Feil e-post eller passord.'],
    [/User already registered|already been registered/i, 'Det finnes allerede en konto med denne e-postadressen.'],
    [/Email not confirmed/i, 'Du må bekrefte e-postadressen din først. Sjekk innboksen.'],
    [/Password should be at least/i, 'Passordet er for kort.'],
    [/should be different from the old password/i, 'Det nye passordet må være forskjellig fra det gamle.'],
    [/rate limit|too many requests|security purposes/i, 'For mange forsøk. Vent litt og prøv igjen.'],
    [/invalid.*email|unable to validate email/i, 'E-postadressen ser ikke riktig ut.'],
    [/expired|invalid.*(token|otp|link)/i, 'Lenken er utløpt eller allerede brukt. Be om en ny.'],
    [/row-level security|permission denied/i, 'Du har ikke tilgang til å gjøre dette.'],
    [/Failed to fetch|NetworkError|Load failed/i, 'Får ikke kontakt med serveren. Sjekk internettforbindelsen.'],
    [/JWT|not authenticated|session/i, 'Du er logget ut. Logg inn på nytt.']
  ];
  for (const [re, txt] of map) if (re.test(m)) return txt;
  return m || 'Noe gikk galt. Prøv igjen.';
}

async function withBusy(btn, fn) {
  if (btn) { btn.classList.add('is-loading'); btn.disabled = true; }
  try { return await fn(); }
  finally { if (btn) { btn.classList.remove('is-loading'); btn.disabled = false; } }
}

/* ---------- Ark (dialoger) ---------- */

// Åpner et ark. body/foot er HTML. Returnerer { el, close }.
function openSheet({ title, body = '', foot = '', onClose, wide = false }) {
  const d = document.createElement('dialog');
  d.className = 'sheet';
  if (wide) d.style.width = 'min(640px, calc(100vw - 32px))';
  d.innerHTML = `
    <div class="sheet-head">
      <h2 class="sheet-title">${esc(title)}</h2>
      <button type="button" class="btn btn-icon" data-close aria-label="Lukk">${icon('x')}</button>
    </div>
    <div class="sheet-body">${body}</div>
    ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}`;
  document.body.appendChild(d);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (d.open) d.close();
    d.remove();
    if (onClose) onClose();
  };
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-close]')) close();
  });
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  d.showModal();
  const first = d.querySelector('[autofocus]');
  if (first) first.focus();
  return { el: d, close };
}

function confirmSheet({ title, text, confirmLabel = 'Bekreft', danger = false, requireText = '' }) {
  return new Promise((resolve) => {
    let answered = false;
    const body = `<p style="color:var(--text-2)">${esc(text)}</p>` + (requireText
      ? `<div class="field" style="margin-top:16px"><label class="label" for="confirm-input">Skriv <strong>${esc(requireText)}</strong> for å bekrefte</label><input class="input" id="confirm-input" autocomplete="off" autocapitalize="characters"></div>`
      : '');
    const s = openSheet({
      title,
      body,
      foot: `<button type="button" class="btn btn-secondary" data-close>Avbryt</button><button type="button" class="btn ${danger ? 'btn-danger' : ''}" data-ok ${requireText ? 'disabled' : ''}>${esc(confirmLabel)}</button>`,
      onClose: () => { if (!answered) resolve(false); }
    });
    const ok = qs('[data-ok]', s.el);
    if (requireText) {
      const inp = qs('#confirm-input', s.el);
      inp.focus();
      inp.addEventListener('input', () => { ok.disabled = inp.value.trim().toUpperCase() !== requireText.toUpperCase(); });
    }
    ok.addEventListener('click', () => { answered = true; s.close(); resolve(true); });
  });
}

/* ---------- Diverse ---------- */

async function copyText(text, label = 'Kopiert') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(label); } catch (err) { toast('Kunne ikke kopiere', 'error'); }
    ta.remove();
  }
}

function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim()); }

function normalizeCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

function fmtCode(code) { return code ? `${code.slice(0, 4)}-${code.slice(4)}` : ''; }

function fmtPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 8) return `${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5)}`;
  return p || '';
}

function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
