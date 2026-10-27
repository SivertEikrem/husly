// =====================================================================
// Husly – appen (app.html)
// Én side med ruter: #/hjem, #/beskjeder, #/utgifter, #/kalender,
// #/vask, #/handleliste, #/huset og #/meg.
// All data hentes fra Supabase. Ingenting viktig lagres i nettleseren.
// =====================================================================

/* ---------- Tilstand ---------- */

const S = {
  session: null,
  me: null,            // profilen min
  households: [],      // kollektivene jeg er med i
  hid: null,           // aktivt kollektiv
  house: null,
  role: 'member',
  members: [],         // [{ user_id, role, joined_at, profile }]
  people: {},          // id -> profil
  readAt: null,        // når jeg sist leste beskjedene
  unread: 0,
  channel: null,
  route: 'hjem',
  week: null,          // valgt uke i vaskelista (mandag)
  calMonth: null,      // valgt måned i kalenderen (den 1.)
  calSel: null,        // valgt dag i kalenderen (yyyy-mm-dd)
  hiddenAt: 0
};

const HID_KEY = 'husly-kollektiv';
const CODE_KEY = 'husly-kode';

const ROUTES = {
  hjem:        { title: 'Hjem',        icon: 'home',     render: renderHome },
  beskjeder:   { title: 'Beskjeder',   icon: 'message',  render: renderMessages },
  utgifter:    { title: 'Utgifter',    icon: 'money',    render: renderExpenses },
  kalender:    { title: 'Kalender',    icon: 'calendar', render: renderCalendar },
  vask:        { title: 'Vaskeliste',  icon: 'sparkle',  render: renderChores,   blurb: 'Hvem har hva denne uka' },
  handleliste: { title: 'Handleliste', icon: 'cart',     render: renderShopping, blurb: 'Det som mangler i huset' },
  huset:       { title: 'Huset',       icon: 'house',    render: renderHouse,    blurb: 'Wifi, regler og medlemmer' },
  meg:         { title: 'Meg',         icon: 'user',     render: renderMe,       blurb: 'Profil, tema og konto' }
};
const SIDEBAR_ROUTES = ['hjem', 'beskjeder', 'utgifter', 'kalender', 'vask', 'handleliste', 'huset'];
const TAB_ROUTES = ['hjem', 'beskjeder', 'utgifter', 'kalender'];
const MORE_ROUTES = ['vask', 'handleliste', 'huset', 'meg'];

/* ---------- Små hjelpere ---------- */

async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

const meId = () => S.me.id;
const isMe = (id) => id === S.me.id;
const isAdmin = () => S.role === 'admin';
const person = (id) => S.people[id] || null;
const personName = (id) => S.people[id]?.display_name || 'Tidligere medlem';
const firstName = (id) => personName(id).split(/\s+/)[0];
const youOr = (id) => (isMe(id) ? 'Du' : personName(id));
const youOrLower = (id) => (isMe(id) ? 'deg' : personName(id));

function pageHead(title, sub = '', actions = '') {
  return `<div class="page-head">
    <div><h1 class="page-title">${esc(title)}</h1>${sub ? `<p class="page-sub">${sub}</p>` : ''}</div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ''}
  </div>`;
}

function skeleton() {
  return `<div class="page-head"><div>
      <div class="skeleton" style="width:190px;height:36px"></div>
      <div class="skeleton" style="width:250px;height:16px;margin-top:12px"></div>
    </div></div>
    <div class="stack">
      <div class="skeleton" style="height:150px;border-radius:var(--r-lg)"></div>
      <div class="skeleton" style="height:260px;border-radius:var(--r-lg)"></div>
    </div>`;
}

function errorState(e) {
  return `<div class="card empty" style="margin-top:24px">
    ${icon('info')}
    <div class="empty-title">Kunne ikke hente data</div>
    <p>${esc(errMsg(e))}</p>
    <button class="btn btn-secondary btn-sm" data-retry>${icon('refresh')}Prøv igjen</button>
  </div>`;
}

function emptyState(ic, title, text, action = '') {
  return `<div class="empty">${icon(ic)}<div class="empty-title">${esc(title)}</div><p>${text}</p>${action}</div>`;
}

function peopleOptions(selected) {
  return S.members.map((m) =>
    `<option value="${m.user_id}" ${m.user_id === selected ? 'selected' : ''}>${esc(m.profile.display_name)}${isMe(m.user_id) ? ' (deg)' : ''}</option>`
  ).join('');
}

function avatarStack(ids, max = 4) {
  if (!ids.length) return '';
  const shown = ids.slice(0, max).map((id) => avatar(person(id), 'sm')).join('');
  const more = ids.length > max ? `<span class="avatar sm ghost">+${ids.length - max}</span>` : '';
  return `<span class="avatar-stack">${shown}${more}</span>`;
}

/* ---------- Oppstart ---------- */

async function boot() {
  qs('#boot').innerHTML = brandMark();
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    location.replace('./' + location.search);
    return;
  }
  S.session = data.session;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') location.replace('./');
    if (session) S.session = session;
  });

  try {
    S.me = await q(sb.rpc('ensure_profile'));
  } catch (e) {
    return fatal(e);
  }

  // Invitasjon via lenke (?kode=XXXX) eller lagret fra forsiden
  const params = new URLSearchParams(location.search);
  let code = normalizeCode(params.get('kode'));
  try { code = code || normalizeCode(localStorage.getItem(CODE_KEY)); localStorage.removeItem(CODE_KEY); } catch (e) {}
  if (params.has('kode')) history.replaceState(null, '', location.pathname + location.hash);
  if (code) {
    try {
      const hid = await q(sb.rpc('join_household', { p_code: code }));
      rememberHid(hid);
      toast('Du er med i kollektivet');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  try {
    await loadHouseholds();
  } catch (e) {
    return fatal(e);
  }

  if (!S.households.length) {
    showOnboarding();
  } else {
    await enterHousehold(pickHid());
  }

  window.addEventListener('hashchange', () => route());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { S.hiddenAt = Date.now(); return; }
    if (S.hid && S.hiddenAt && Date.now() - S.hiddenAt > 60000) { updateUnread(); refresh(); }
  });
  window.addEventListener('scroll', () => {
    qs('#topbar')?.classList.toggle('scrolled', window.scrollY > 4);
  }, { passive: true });
}

function fatal(e) {
  qs('#boot').innerHTML = `<div class="card empty" style="max-width:380px">
    ${icon('info')}<div class="empty-title">Noe gikk galt</div><p>${esc(errMsg(e))}</p>
    <div style="display:flex;gap:8px"><button class="btn btn-secondary btn-sm" onclick="location.reload()">Last inn på nytt</button>
    <button class="btn btn-ghost btn-sm" id="fatal-out">Logg ut</button></div></div>`;
  qs('#fatal-out')?.addEventListener('click', signOut);
}

function rememberHid(hid) {
  try { localStorage.setItem(HID_KEY, hid); } catch (e) {}
}

function pickHid() {
  let saved = null;
  try { saved = localStorage.getItem(HID_KEY); } catch (e) {}
  return S.households.some((h) => h.id === saved) ? saved : S.households[0].id;
}

async function loadHouseholds() {
  const mem = await q(sb.from('household_members').select('household_id, role').eq('user_id', meId()));
  const ids = mem.map((m) => m.household_id);
  const hs = ids.length ? await q(sb.from('households').select('*').in('id', ids)) : [];
  S.households = hs
    .map((h) => ({ ...h, role: mem.find((m) => m.household_id === h.id)?.role || 'member' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'));
}

async function loadMembers() {
  const ms = await q(sb.from('household_members')
    .select('user_id, role, joined_at, messages_read_at')
    .eq('household_id', S.hid).order('joined_at'));
  const ps = await q(sb.from('profiles').select('id, display_name, phone, color').in('id', ms.map((m) => m.user_id)));
  S.people = Object.fromEntries(ps.map((p) => [p.id, p]));
  S.people[S.me.id] = S.people[S.me.id] || S.me;
  S.members = ms.map((m) => ({ ...m, profile: S.people[m.user_id] })).filter((m) => m.profile);
  const mine = ms.find((m) => isMe(m.user_id));
  S.role = mine?.role || 'member';
  S.readAt = mine?.messages_read_at || new Date().toISOString();
}

async function enterHousehold(hid) {
  S.hid = hid;
  rememberHid(hid);
  S.house = S.households.find((h) => h.id === hid);
  S.week = null;
  S.calSel = null;
  try {
    await loadMembers();
  } catch (e) {
    return fatal(e);
  }
  qs('#onboard').hidden = true;
  qs('#boot').hidden = true;
  qs('#shell').hidden = false;
  renderShell();
  subscribeRealtime();
  updateUnread();
  if (!location.hash) history.replaceState(null, '', '#/hjem');
  await route();
}

/* ---------- Sanntid ---------- */

const reloadFeedSoon = debounce(() => {
  if (S.route === 'beskjeder') { loadFeed({ keepPosition: true }); markRead(); }
  else updateUnread();
}, 300);
const reloadShoppingSoon = debounce(() => { if (S.route === 'handleliste') loadShopping(); }, 300);

function subscribeRealtime() {
  if (S.channel) sb.removeChannel(S.channel);
  S.channel = sb.channel('hus-' + S.hid)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `household_id=eq.${S.hid}` }, reloadFeedSoon)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items', filter: `household_id=eq.${S.hid}` }, reloadShoppingSoon)
    .subscribe();
}

async function updateUnread() {
  try {
    const { count, error } = await sb.from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', S.hid)
      .neq('author_id', meId())
      .gt('created_at', S.readAt);
    if (error) throw error;
    S.unread = count || 0;
  } catch (e) {
    S.unread = 0;
  }
  updateBadges();
}

async function markRead() {
  S.readAt = new Date().toISOString();
  S.unread = 0;
  updateBadges();
  try { await q(sb.rpc('mark_messages_read', { hid: S.hid })); } catch (e) { /* ikke kritisk */ }
}

function updateBadges() {
  const n = S.unread > 9 ? '9+' : String(S.unread);
  qsa('[data-unread]').forEach((el) => { el.textContent = n; el.hidden = !S.unread; });
}

/* ---------- Skallet (meny, topplinje, fanelinje) ---------- */

function houseMark(h) {
  return `<span class="hs-mark" aria-hidden="true">${esc(initials(h?.name || '?').slice(0, 1))}</span>`;
}

function renderShell() {
  const h = S.house;
  const count = S.members.length;
  const switcher = `<button type="button" class="house-switch" data-house-menu aria-label="Bytt kollektiv">
      ${houseMark(h)}
      <span class="hs-text"><span class="hs-name">${esc(h.name)}</span><span class="hs-sub">${count} ${count === 1 ? 'medlem' : 'medlemmer'}</span></span>
      ${icon('chevUpDown', 'icon-sm')}
    </button>`;

  qs('#sidebar').innerHTML = `
    <a class="brand" href="#/hjem">${brandMark()}<span>Husly</span></a>
    ${switcher}
    <nav class="nav" aria-label="Hovedmeny">
      ${SIDEBAR_ROUTES.map((r) => `<a href="#/${r}" data-route="${r}">${icon(ROUTES[r].icon)}<span>${ROUTES[r].title}</span>${r === 'beskjeder' ? '<span class="count" data-unread hidden></span>' : ''}</a>`).join('')}
    </nav>
    <div class="sidebar-foot">
      <a class="me-chip" href="#/meg" data-route="meg">${avatar(S.me, 'sm')}<span class="me-name">${esc(S.me.display_name)}</span></a>
      ${themeToggle()}
    </div>`;

  qs('#topbar').innerHTML = `${switcher}${themeToggle()}
    <a href="#/meg" class="btn btn-icon" aria-label="Meg">${avatar(S.me, 'sm')}</a>`;

  qs('#tabbar').innerHTML = TAB_ROUTES.map((r) =>
    `<a href="#/${r}" data-route="${r}">${icon(ROUTES[r].icon)}<span>${ROUTES[r].title}</span>${r === 'beskjeder' ? '<span class="dot" data-unread hidden></span>' : ''}</a>`
  ).join('') + `<button type="button" data-more>${icon('more')}<span>Mer</span></button>`;

  qsa('[data-house-menu]').forEach((b) => b.addEventListener('click', openHouseMenu));
  qs('[data-more]').addEventListener('click', openMore);
  updateNav();
  updateBadges();
}

function updateNav() {
  qsa('[data-route]').forEach((a) => {
    if (a.dataset.route === S.route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const more = qs('[data-more]');
  if (more) {
    if (MORE_ROUTES.includes(S.route)) more.setAttribute('aria-current', 'page');
    else more.removeAttribute('aria-current');
  }
}

function openMore() {
  const s = openSheet({
    title: 'Mer',
    body: `<div class="more-grid">${MORE_ROUTES.map((r) =>
      `<a class="more-tile" href="#/${r}">${icon(ROUTES[r].icon)}<span>${ROUTES[r].title}<small>${ROUTES[r].blurb}</small></span></a>`
    ).join('')}</div>`
  });
  s.el.addEventListener('click', (e) => { if (e.target.closest('a')) s.close(); });
}

function openHouseMenu() {
  const s = openSheet({
    title: 'Kollektiv',
    body: `<div class="menu-list">
      ${S.households.map((h) => `<button type="button" class="menu-item" data-h="${h.id}">
        ${houseMark(h)}
        <span>${esc(h.name)}</span>
        ${h.id === S.hid ? `<span class="check">${icon('check')}</span>` : ''}
      </button>`).join('')}
      <div class="nav-sep"></div>
      <button type="button" class="menu-item" data-create>${icon('plus')}<span>Opprett et nytt kollektiv</span></button>
      <button type="button" class="menu-item" data-join>${icon('link')}<span>Bli med med kode</span></button>
    </div>`
  });
  s.el.addEventListener('click', async (e) => {
    const h = e.target.closest('[data-h]');
    if (h) {
      s.close();
      if (h.dataset.h !== S.hid) { await enterHousehold(h.dataset.h); location.hash = '#/hjem'; }
      return;
    }
    if (e.target.closest('[data-create]')) { s.close(); openCreateHousehold(); }
    if (e.target.closest('[data-join]')) { s.close(); openJoinHousehold(); }
  });
}

/* ---------- Ruter ---------- */

let renderToken = 0;
const stale = (tok) => tok !== renderToken;

function currentRoute() {
  const r = location.hash.replace(/^#\/?/, '').split(/[?/]/)[0];
  return ROUTES[r] ? r : 'hjem';
}

async function route({ keepScroll = false } = {}) {
  if (!S.hid) return;
  const name = currentRoute();
  const changed = name !== S.route;
  S.route = name;
  updateNav();
  const tok = ++renderToken;
  const view = qs('#view');
  const y = window.scrollY;
  if (!keepScroll) {
    view.innerHTML = skeleton();
    window.scrollTo(0, 0);
  }
  document.title = `${ROUTES[name].title} – ${S.house?.name || 'Husly'}`;
  try {
    await ROUTES[name].render(view, tok);
    if (keepScroll && !stale(tok) && name !== 'beskjeder') window.scrollTo(0, y);
    if (changed && !keepScroll && name !== 'beskjeder') view.focus({ preventScroll: true });
  } catch (e) {
    if (stale(tok)) return;
    console.error(e);
    view.innerHTML = errorState(e);
    qs('[data-retry]', view)?.addEventListener('click', () => route());
  }
}

const refresh = () => route({ keepScroll: true });

/* =====================================================================
   HJEM
   ===================================================================== */

async function renderHome(view, tok) {
  const t = isoDate(today());
  const mon = startOfWeek(today());
  const [chores, sched, bals, events, msgs, items] = await Promise.all([
    q(sb.from('chores').select('id, name, every_weeks, rotation').eq('household_id', S.hid).order('created_at')),
    q(sb.rpc('chore_schedule', { hid: S.hid, p_from: isoDate(mon), p_weeks: 1 })),
    q(sb.rpc('household_balances', { hid: S.hid })),
    q(sb.from('events').select('id, title, starts_on, ends_on, start_time, end_time, location')
      .eq('household_id', S.hid).or(`starts_on.gte.${t},ends_on.gte.${t}`)
      .order('starts_on').order('start_time', { nullsFirst: true }).limit(4)),
    q(sb.from('messages').select('id, author_id, body, pinned, created_at')
      .eq('household_id', S.hid).order('created_at', { ascending: false }).limit(20)),
    q(sb.from('shopping_items').select('id, name, quantity').eq('household_id', S.hid).eq('done', false).order('created_at'))
  ]);
  if (stale(tok)) return;

  const choreById = Object.fromEntries(chores.map((c) => [c.id, c]));
  const week = isoWeek(today());
  const rows = sched.filter((r) => choreById[r.chore_id]);
  const mine = rows.filter((r) => isMe(r.assignee));
  const doneCount = rows.filter((r) => r.completed_by).length;

  // Ukeslappen
  let slipTitle, slipList = '';
  if (!chores.length) {
    slipTitle = 'Ingen vaskeliste ennå';
    slipList = `<p style="margin-top:8px;position:relative;z-index:1;max-width:40ch">Legg inn oppgavene i huset, så fordeles de automatisk uke for uke.</p>`;
  } else if (mine.length) {
    slipTitle = mine.length === 1 ? 'Din tur denne uka' : `${mine.length} oppgaver på deg denne uka`;
    slipList = `<ul class="slip-list">${mine.map((r) => {
      const c = choreById[r.chore_id];
      const done = !!r.completed_by;
      return `<li class="slip-item ${done ? 'done' : ''}">
        <button type="button" class="check-btn" aria-pressed="${done}" aria-label="${done ? 'Angre' : 'Marker som gjort'}: ${esc(c.name)}" data-chore="${c.id}" data-period="${r.period_start}">${icon('check')}</button>
        <span class="slip-name">${esc(c.name)}</span>
        <span class="slip-meta">${done ? `Gjort ${esc(fmtAgo(r.completed_at))}` : choreNextText(c, r)}</span>
      </li>`;
    }).join('')}</ul>`;
  } else {
    slipTitle = 'Du har fri denne uka';
    slipList = `<ul class="slip-list">${rows.map((r) => {
      const c = choreById[r.chore_id];
      return `<li class="slip-item ${r.completed_by ? 'done' : ''}">${avatar(person(r.assignee), 'sm')}
        <span class="slip-name">${esc(c.name)}</span><span class="slip-meta">${esc(r.assignee ? firstName(r.assignee) : 'Ingen')}</span></li>`;
    }).join('')}</ul>`;
  }

  // Saldo
  const myBal = bals.find((b) => isMe(b.user_id))?.balance_ore || 0;
  const balCls = myBal > 0 ? 'pos' : myBal < 0 ? 'neg' : '';
  const balText = myBal > 0 ? 'Du får igjen penger fra husfellene.' : myBal < 0 ? 'Du skylder husfellene dine.' : 'Du er i null med alle.';

  // Beskjeder
  const pinned = msgs.filter((m) => m.pinned);
  const latest = msgs.filter((m) => !m.pinned).slice(0, Math.max(1, 3 - pinned.length));
  const notes = [...pinned, ...latest];
  const unreadCount = msgs.filter((m) => !isMe(m.author_id) && m.created_at > S.readAt).length;

  const d = today();
  view.innerHTML = `
    <section class="greeting">
      <h1>${greetingWord()}, ${esc(S.me.display_name.split(/\s+/)[0])}</h1>
      <p>${cap(fmtDateLong(d))}, uke ${week} i ${esc(S.house.name)}</p>
    </section>

    <section class="slip" aria-label="Vaskelista denne uka">
      <div class="slip-top"><span class="slip-week">Uke ${week}</span></div>
      <h2 class="slip-title">${slipTitle}</h2>
      ${slipList}
      <div class="slip-foot">
        <a href="#/vask">${chores.length ? 'Se hele vaskelista' : 'Sett opp vaskelista'}</a>
        ${chores.length ? `<span>${doneCount} av ${rows.length} gjort i huset</span>` : ''}
      </div>
    </section>

    <div class="home-grid">
      <div class="stack">
        <section class="card">
          <div class="card-head">
            <h2 class="card-title">Beskjeder ${unreadCount ? `<span class="badge accent" style="margin-left:6px">${unreadCount} ${unreadCount === 1 ? 'ny' : 'nye'}</span>` : ''}</h2>
            <a class="card-link" href="#/beskjeder">Åpne</a>
          </div>
          ${notes.length ? notes.map((m) => `
            <div class="note-preview">
              <div class="np-head">${avatar(person(m.author_id), 'sm')}<strong>${esc(personName(m.author_id))}</strong>
                <span class="muted">${esc(fmtAgo(m.created_at))}</span>
                ${m.pinned ? `<span class="badge" style="margin-left:auto">${icon('pin', 'icon-sm')}Festet</span>` : ''}</div>
              <div class="np-body">${linkify(m.body)}</div>
            </div>`).join('')
          : `<p class="muted" style="font-size:var(--fs-sm)">Ingen beskjeder ennå. <a href="#/beskjeder">Skriv den første.</a></p>`}
        </section>

        <section class="card">
          <div class="card-head"><h2 class="card-title">Kommer</h2><a class="card-link" href="#/kalender">Kalender</a></div>
          ${events.length ? events.map((ev) => miniEvent(ev)).join('')
          : `<p class="muted" style="font-size:var(--fs-sm)">Ingenting i kalenderen. <a href="#/kalender">Legg til en hendelse.</a></p>`}
        </section>
      </div>

      <div class="stack">
        <section class="card">
          <div class="card-head"><h2 class="card-title">Saldoen din</h2><a class="card-link" href="#/utgifter">Utgifter</a></div>
          <div class="balance-big amount ${balCls}">${fmtKr(myBal, { plus: true })}</div>
          <p class="balance-caption">${balText}</p>
        </section>

        <section class="card">
          <div class="card-head"><h2 class="card-title">Handleliste</h2><a class="card-link" href="#/handleliste">${items.length ? `${items.length} ${items.length === 1 ? 'vare' : 'varer'}` : 'Åpne'}</a></div>
          ${items.length
            ? `<div class="chips">${items.slice(0, 10).map((i) => `<span class="chip">${esc(i.name)}${i.quantity ? `<span class="muted">${esc(i.quantity)}</span>` : ''}</span>`).join('')}${items.length > 10 ? `<span class="chip muted">+${items.length - 10}</span>` : ''}</div>`
            : `<p class="muted" style="font-size:var(--fs-sm)">Ingenting mangler akkurat nå.</p>`}
        </section>
      </div>
    </div>`;

  qsa('[data-chore]', view).forEach((b) => b.addEventListener('click', () => toggleChore(b)));
  qsa('[data-ev]', view).forEach((b) => b.addEventListener('click', () => openEventById(b.dataset.ev)));
}

function choreNextText(chore, row) {
  const parts = [];
  if (chore.every_weeks > 1) parts.push(`Til ${fmtDateShort(parseDate(row.period_end))}`);
  const rot = chore.rotation || [];
  const i = rot.indexOf(row.assignee);
  if (rot.length > 1 && i >= 0) parts.push(`Neste: ${firstName(rot[(i + 1) % rot.length])}`);
  return esc(parts.join(', '));
}

function dateTile(d) {
  return `<div class="date-tile ${sameDay(d, today()) ? 'today' : ''}" aria-hidden="true"><span class="dt-day">${d.getDate()}</span><span class="dt-mon">${MONTHS_TILE[d.getMonth()]}</span></div>`;
}

function miniEvent(ev) {
  const start = parseDate(ev.starts_on);
  const shown = start < today() ? today() : start;
  return `<button type="button" class="mini-event" data-ev="${ev.id}" style="width:100%;background:none;border-left:0;border-right:0;border-bottom:0;text-align:left;cursor:pointer;font:inherit;color:inherit">
    ${dateTile(shown)}
    <div class="row-main"><div class="row-title">${esc(ev.title)}</div><div class="row-sub">${esc(eventWhen(ev))}</div></div>
  </button>`;
}

async function toggleChore(btn) {
  const done = btn.getAttribute('aria-pressed') === 'true';
  btn.setAttribute('aria-pressed', String(!done));
  try {
    if (done) {
      await q(sb.from('chore_completions').delete().eq('chore_id', btn.dataset.chore).eq('period_start', btn.dataset.period));
    } else {
      await q(sb.from('chore_completions').insert({ chore_id: btn.dataset.chore, period_start: btn.dataset.period, completed_by: meId() }));
      toast('Markert som gjort');
    }
  } catch (e) {
    toast(errMsg(e), 'error');
  }
  refresh();
}

/* =====================================================================
   BESKJEDER
   ===================================================================== */

async function renderMessages(view, tok) {
  view.innerHTML = `
    ${pageHead('Beskjeder', 'Alt huset må vite, samlet på ett sted.')}
    <div id="pinned" class="pinned-board"></div>
    <div id="feed" class="feed" aria-live="polite"></div>
    <form class="composer" id="composer">
      <label class="sr-only" for="msg-input">Skriv en beskjed</label>
      <textarea id="msg-input" rows="1" maxlength="2000" placeholder="Skriv en beskjed til huset"></textarea>
      <button class="btn" type="submit" aria-label="Send beskjed">${icon('send')}</button>
    </form>`;

  S.feedReadBefore = S.readAt;
  await loadFeed({ tok, scrollToEnd: true });
  if (stale(tok)) return;
  markRead();

  const form = qs('#composer', view);
  const ta = qs('#msg-input', view);
  const touch = window.matchMedia('(hover: none)').matches;
  const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; };
  ta.addEventListener('input', autosize);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !touch) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = ta.value.trim();
    if (!body) return;
    const btn = qs('button[type=submit]', form);
    await withBusy(btn, async () => {
      try {
        await q(sb.from('messages').insert({ household_id: S.hid, author_id: meId(), body }));
        ta.value = '';
        autosize();
        await loadFeed({ scrollToEnd: true });
        markRead();
      } catch (err) {
        toast(errMsg(err), 'error');
      }
    });
    ta.focus();
  });

  const onAction = async (e) => {
    // På mobil vises knappene når man trykker på beskjeden
    const msgEl = e.target.closest('.msg');
    if (msgEl && !e.target.closest('button, a') && window.matchMedia('(hover: none)').matches) {
      const open = msgEl.classList.contains('open');
      qsa('.msg.open', view).forEach((m) => m.classList.remove('open'));
      if (!open) msgEl.classList.add('open');
      return;
    }
    const pinBtn = e.target.closest('[data-pin]');
    const delBtn = e.target.closest('[data-del]');
    if (pinBtn) {
      const pinned = pinBtn.dataset.pin === 'true';
      try {
        await q(sb.from('messages').update({ pinned: !pinned }).eq('id', pinBtn.dataset.id));
        toast(pinned ? 'Beskjeden er løsnet' : 'Beskjeden er festet');
        loadFeed({ keepPosition: true });
      } catch (err) { toast(errMsg(err), 'error'); }
    }
    if (delBtn) {
      const ok = await confirmSheet({ title: 'Slette beskjeden?', text: 'Beskjeden forsvinner for alle i huset.', confirmLabel: 'Slett', danger: true });
      if (!ok) return;
      try {
        await q(sb.from('messages').delete().eq('id', delBtn.dataset.id));
        toast('Beskjeden er slettet');
        loadFeed({ keepPosition: true });
      } catch (err) { toast(errMsg(err), 'error'); }
    }
  };
  qs('#feed', view).addEventListener('click', onAction);
  qs('#pinned', view).addEventListener('click', onAction);
}

async function loadFeed({ tok = renderToken, scrollToEnd = false, keepPosition = false } = {}) {
  const nearEnd = window.innerHeight + window.scrollY > document.documentElement.scrollHeight - 160;
  const [rows, pinned] = await Promise.all([
    q(sb.from('messages').select('id, author_id, body, pinned, created_at')
      .eq('household_id', S.hid).order('created_at', { ascending: false }).limit(150)),
    q(sb.from('messages').select('id, author_id, body, pinned, created_at')
      .eq('household_id', S.hid).eq('pinned', true).order('created_at', { ascending: false }))
  ]);
  if (stale(tok) || S.route !== 'beskjeder') return;
  const feed = qs('#feed');
  const pinBox = qs('#pinned');
  if (!feed) return;

  rows.reverse();
  const canDelete = (m) => isMe(m.author_id) || isAdmin();
  const actions = (m) => `<div class="msg-actions">
      <button type="button" class="btn btn-icon btn-sm" data-pin="${m.pinned}" data-id="${m.id}" aria-label="${m.pinned ? 'Løsne' : 'Fest'} beskjeden" title="${m.pinned ? 'Løsne' : 'Fest øverst'}">${icon('pin', 'icon-sm')}</button>
      ${canDelete(m) ? `<button type="button" class="btn btn-icon btn-sm" data-del data-id="${m.id}" aria-label="Slett beskjeden" title="Slett">${icon('trash', 'icon-sm')}</button>` : ''}
    </div>`;

  pinBox.innerHTML = pinned.map((m) => `
    <div class="pinned-note">
      <div class="pn-head">${icon('pin', 'icon-sm')}${avatar(person(m.author_id), 'sm')}<span>${esc(personName(m.author_id))}, ${esc(fmtAgo(m.created_at))}</span>
        <button type="button" class="btn btn-icon" data-pin="true" data-id="${m.id}" aria-label="Løsne beskjeden" title="Løsne">${icon('x', 'icon-sm')}</button></div>
      <div class="pn-body">${linkify(m.body)}</div>
    </div>`).join('');

  if (!rows.length) {
    feed.innerHTML = `<div class="card">${emptyState('message', 'Ingen beskjeder ennå', 'Skriv den første beskjeden til huset, for eksempel om søppeltømming eller et husmøte.')}</div>`;
    return;
  }

  let html = '';
  let prev = null;
  for (const m of rows) {
    const d = new Date(m.created_at);
    if (!prev || !sameDay(new Date(prev.created_at), d)) {
      html += `<div class="day-sep">${esc(fmtDayRelative(d))}</div>`;
      prev = null;
    }
    const cont = prev && prev.author_id === m.author_id && (d - new Date(prev.created_at)) < 5 * 60000;
    const unread = !isMe(m.author_id) && S.feedReadBefore && m.created_at > S.feedReadBefore;
    html += `<article class="msg ${cont ? 'cont' : ''} ${unread ? 'unread' : ''}">
      ${avatar(person(m.author_id))}
      <div>
        <div class="msg-head"><span class="msg-author">${esc(personName(m.author_id))}</span><time class="msg-time" datetime="${m.created_at}">${fmtClock(d)}</time>
          ${m.pinned ? `<span class="msg-pin">${icon('pin', 'icon-sm')}Festet</span>` : ''}</div>
        <div class="msg-body">${linkify(m.body)}</div>
      </div>
      ${actions(m)}
    </article>`;
    prev = m;
  }
  feed.innerHTML = html;

  if (scrollToEnd || (keepPosition && nearEnd)) {
    requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
  }
}

/* =====================================================================
   UTGIFTER
   ===================================================================== */

function settlePlan(bals) {
  const debt = bals.filter((b) => b.balance_ore < 0).map((b) => ({ id: b.user_id, amt: -b.balance_ore })).sort((a, b) => b.amt - a.amt);
  const cred = bals.filter((b) => b.balance_ore > 0).map((b) => ({ id: b.user_id, amt: b.balance_ore })).sort((a, b) => b.amt - a.amt);
  const out = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const x = Math.min(debt[i].amt, cred[j].amt);
    if (x > 0) out.push({ from: debt[i].id, to: cred[j].id, amt: x });
    debt[i].amt -= x;
    cred[j].amt -= x;
    if (debt[i].amt === 0) i++;
    if (cred[j].amt === 0) j++;
  }
  return out;
}

async function renderExpenses(view, tok) {
  const [bals, expenses, payments] = await Promise.all([
    q(sb.rpc('household_balances', { hid: S.hid })),
    q(sb.from('expenses').select('id, paid_by, description, amount_ore, spent_on, created_by, created_at')
      .eq('household_id', S.hid).order('spent_on', { ascending: false }).order('created_at', { ascending: false }).limit(150)),
    q(sb.from('payments').select('id, from_user, to_user, amount_ore, note, paid_on, created_by, created_at')
      .eq('household_id', S.hid).order('paid_on', { ascending: false }).order('created_at', { ascending: false }).limit(150))
  ]);
  const shares = expenses.length
    ? await q(sb.from('expense_shares').select('expense_id, user_id, share_ore').in('expense_id', expenses.map((e) => e.id)))
    : [];
  if (stale(tok)) return;

  // Navn på tidligere medlemmer kommer fra saldo-funksjonen
  const balPeople = Object.fromEntries(bals.map((b) => [b.user_id, { id: b.user_id, display_name: b.display_name, color: b.color }]));
  const who = (id) => person(id) || balPeople[id] || null;
  const whoName = (id) => (isMe(id) ? 'Du' : (who(id)?.display_name || 'Tidligere medlem'));

  const sharesBy = {};
  shares.forEach((s) => { (sharesBy[s.expense_id] ||= []).push(s); });

  const myBal = bals.find((b) => isMe(b.user_id))?.balance_ore || 0;
  const shown = bals.filter((b) => b.is_member || b.balance_ore !== 0)
    .sort((a, b) => b.balance_ore - a.balance_ore);
  const maxAbs = Math.max(1, ...shown.map((b) => Math.abs(b.balance_ore)));
  const plan = settlePlan(bals);

  const balRows = shown.map((b) => {
    const w = Math.round((Math.abs(b.balance_ore) / maxAbs) * 50);
    const cls = b.balance_ore > 0 ? 'pos' : b.balance_ore < 0 ? 'neg' : '';
    return `<div class="bal-row">
      ${avatar(who(b.user_id), 'sm')}
      <span class="bal-name">${esc(isMe(b.user_id) ? 'Du' : b.display_name)}${b.is_member ? '' : ' <span class="muted">(flyttet)</span>'}</span>
      <span class="bal-bar">${cls ? `<span class="${cls}" style="width:${w}%"></span>` : ''}</span>
      <span class="bal-amt amount ${cls}">${fmtKr(b.balance_ore, { plus: true })}</span>
    </div>`;
  }).join('');

  const planRows = plan.length ? plan.map((p) => {
    const toPhone = person(p.to)?.phone;
    const involvesMe = isMe(p.from) || isMe(p.to);
    return `<div class="settle">
      ${avatar(who(p.from), 'sm')}<span class="arrow">${icon('arrowRight', 'icon-sm')}</span>${avatar(who(p.to), 'sm')}
      <div class="settle-text">
        <div><strong>${esc(whoName(p.from))}</strong> betaler <strong>${esc(isMe(p.to) ? 'deg' : whoName(p.to))}</strong> <span class="amount">${fmtKr(p.amt)}</span></div>
        ${toPhone && isMe(p.from) ? `<div class="settle-sub">Vipps til ${esc(fmtPhone(toPhone))}</div>` : ''}
      </div>
      ${involvesMe ? `<button type="button" class="btn btn-secondary btn-sm" data-settle='${JSON.stringify(p)}'>Betalt</button>` : ''}
    </div>`;
  }).join('') : emptyState('check', 'Alle er i null', 'Ingen skylder noen noe akkurat nå.');

  // Historikk: utgifter og betalinger blandet, nyeste først, gruppert på måned
  const tx = [
    ...expenses.map((e) => ({ kind: 'e', date: e.spent_on, created: e.created_at, data: e })),
    ...payments.map((p) => ({ kind: 'p', date: p.paid_on, created: p.created_at, data: p }))
  ].sort((a, b) => (b.date + b.created).localeCompare(a.date + a.created));

  let hist = '';
  let lastMonth = '';
  for (const t of tx) {
    const d = parseDate(t.date);
    const mk = `${d.getFullYear()}-${d.getMonth()}`;
    if (mk !== lastMonth) {
      hist += `<li class="group-label">${cap(MONTHS[d.getMonth()])} ${d.getFullYear()}</li>`;
      lastMonth = mk;
    }
    if (t.kind === 'e') {
      const e = t.data;
      const sh = sharesBy[e.id] || [];
      const myShare = sh.find((s) => isMe(s.user_id))?.share_ore || 0;
      hist += `<li><button type="button" class="row" data-exp="${e.id}">
        <span class="tx-icon">${icon('receipt')}</span>
        <span class="row-main"><span class="row-title" style="display:block">${esc(e.description)}</span>
          <span class="row-sub">${esc(whoName(e.paid_by))} betalte, ${fmtDateShort(d)}${sh.length ? `, delt på ${sh.length}` : ''}</span></span>
        <span class="row-end"><span class="amount" style="display:block">${fmtKr(e.amount_ore)}</span>
          <span class="row-sub">${isMe(e.paid_by) ? 'du la ut' : myShare ? `din del ${fmtKr(myShare)}` : 'ikke med'}</span></span>
      </button></li>`;
    } else {
      const p = t.data;
      hist += `<li><button type="button" class="row" data-pay="${p.id}">
        <span class="tx-icon pay">${icon('swap')}</span>
        <span class="row-main"><span class="row-title" style="display:block">${esc(whoName(p.from_user))} betalte ${esc(isMe(p.to_user) ? 'deg' : whoName(p.to_user))}</span>
          <span class="row-sub">${p.note ? esc(p.note) + ', ' : ''}${fmtDateShort(d)}</span></span>
        <span class="row-end"><span class="amount pos">${fmtKr(p.amount_ore)}</span></span>
      </button></li>`;
    }
  }

  const myCls = myBal > 0 ? 'pos' : myBal < 0 ? 'neg' : '';
  view.innerHTML = `
    ${pageHead('Utgifter', 'Felles innkjøp og hvem som skylder hvem.',
      `<button type="button" class="btn btn-secondary" data-new-pay>${icon('swap')}<span class="btn-label-wide">Registrer betaling</span></button>
       <button type="button" class="btn" data-new-exp>${icon('plus')}Ny utgift</button>`)}
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2 class="card-title">Saldo</h2></div>
        <div class="balance-big amount ${myCls}">${fmtKr(myBal, { plus: true })}</div>
        <p class="balance-caption" style="margin-bottom:18px">${myBal > 0 ? 'Du får igjen totalt.' : myBal < 0 ? 'Du skylder totalt.' : 'Du er i null.'}</p>
        <div class="bal-list">${balRows}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2 class="card-title">Slik gjør dere opp</h2></div>
        ${planRows}
      </section>
    </div>
    <section class="card flush" style="margin-top:16px">
      <div class="card-head"><h2 class="card-title">Historikk</h2></div>
      ${tx.length ? `<ul class="list">${hist}</ul>`
        : emptyState('receipt', 'Ingen utgifter ennå', 'Når noen handler noe til huset, legger de det inn her. Da regnes det ut hvem som skylder hvem.',
          `<button type="button" class="btn btn-sm" data-new-exp>${icon('plus')}Legg inn den første</button>`)}
    </section>`;

  qsa('[data-new-exp]', view).forEach((b) => b.addEventListener('click', openExpenseForm));
  qs('[data-new-pay]', view).addEventListener('click', () => openPaymentForm());
  qsa('[data-settle]', view).forEach((b) => b.addEventListener('click', () => openPaymentForm(JSON.parse(b.dataset.settle))));
  qsa('[data-exp]', view).forEach((b) => b.addEventListener('click', () => {
    const e = expenses.find((x) => x.id === b.dataset.exp);
    openExpenseDetail(e, sharesBy[e.id] || [], who);
  }));
  qsa('[data-pay]', view).forEach((b) => b.addEventListener('click', () => {
    openPaymentDetail(payments.find((x) => x.id === b.dataset.pay), who);
  }));
}

function openExpenseForm() {
  const s = openSheet({
    title: 'Ny utgift',
    body: `<form id="exp-form" novalidate>
      <div class="field"><label class="label" for="ex-desc">Hva ble kjøpt?</label>
        <input class="input" id="ex-desc" maxlength="80" placeholder="F.eks. dopapir og oppvaskmiddel" required autofocus></div>
      <div class="field-row">
        <div class="field"><label class="label" for="ex-amt">Beløp</label>
          <div class="input-affix"><input class="input num" id="ex-amt" inputmode="decimal" placeholder="0" required><span class="affix">kr</span></div></div>
        <div class="field"><label class="label" for="ex-date">Dato</label>
          <input class="input" id="ex-date" type="date" value="${isoDate(today())}" required></div>
      </div>
      <div class="field"><label class="label" for="ex-payer">Hvem betalte?</label>
        <select class="select" id="ex-payer">${peopleOptions(meId())}</select></div>
      <div class="field"><span class="label" id="ex-split-label">Delt mellom</span>
        <div class="people-picker" role="group" aria-labelledby="ex-split-label">
          ${S.members.map((m) => `<button type="button" class="person-toggle" aria-pressed="true" data-uid="${m.user_id}">${avatar(m.profile, 'sm')}${esc(isMe(m.user_id) ? 'Deg' : m.profile.display_name)}</button>`).join('')}
        </div></div>
      <div class="split-preview"><span id="ex-preview-text">Skriv inn beløpet</span><strong class="amount" id="ex-preview"></strong></div>
      <div class="form-error" data-error hidden style="margin-top:14px"></div>
    </form>`,
    foot: `<button type="button" class="btn btn-secondary" data-close>Avbryt</button><button type="submit" class="btn" form="exp-form">Lagre utgift</button>`
  });
  const f = qs('#exp-form', s.el);
  const picked = () => qsa('.person-toggle[aria-pressed="true"]', f).map((b) => b.dataset.uid);
  const preview = () => {
    const ore = parseKr(qs('#ex-amt', f).value);
    const n = picked().length;
    qs('#ex-preview-text', f).textContent = !n ? 'Velg minst én person' : !ore ? 'Skriv inn beløpet' : n === 1 ? 'Én person betaler' : `Hver av ${n} betaler`;
    qs('#ex-preview', f).textContent = ore && n ? fmtKr(Math.ceil(ore / n)) : '';
  };
  qsa('.person-toggle', f).forEach((b) => b.addEventListener('click', () => {
    b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
    preview();
  }));
  qs('#ex-amt', f).addEventListener('input', preview);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = qs('[data-error]', f);
    const desc = qs('#ex-desc', f).value.trim();
    const ore = parseKr(qs('#ex-amt', f).value);
    const parts = picked();
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    if (!desc) return fail('Skriv hva som ble kjøpt.');
    if (!ore) return fail('Skriv inn et gyldig beløp, for eksempel 249,90.');
    if (!parts.length) return fail('Velg minst én person å dele med.');
    await withBusy(qs('[form="exp-form"]', s.el), async () => {
      try {
        await q(sb.rpc('add_expense', {
          p_household: S.hid, p_description: desc, p_amount_ore: ore,
          p_paid_by: qs('#ex-payer', f).value, p_participants: parts, p_spent_on: qs('#ex-date', f).value || isoDate(today())
        }));
        s.close();
        toast('Utgiften er lagret');
        refresh();
      } catch (x) { fail(errMsg(x)); }
    });
  });
}

function openPaymentForm(prefill) {
  const from = prefill?.from || meId();
  const to = prefill?.to || (S.members.find((m) => !isMe(m.user_id))?.user_id || meId());
  const s = openSheet({
    title: 'Registrer betaling',
    body: `<form id="pay-form" novalidate>
      <p class="hint" style="margin-bottom:14px;font-size:var(--fs-sm)">Når noen har Vippset eller overført penger, registrerer du det her så saldoen blir riktig.</p>
      <div class="field-row">
        <div class="field"><label class="label" for="py-from">Fra</label><select class="select" id="py-from">${peopleOptions(from)}</select></div>
        <div class="field"><label class="label" for="py-to">Til</label><select class="select" id="py-to">${peopleOptions(to)}</select></div>
      </div>
      <div class="field"><label class="label" for="py-amt">Beløp</label>
        <div class="input-affix"><input class="input num" id="py-amt" inputmode="decimal" value="${prefill ? (prefill.amt / 100).toFixed(2).replace('.', ',').replace(',00', '') : ''}" required autofocus><span class="affix">kr</span></div></div>
      <div class="field"><label class="label" for="py-note">Notat <span class="muted">(valgfritt)</span></label>
        <input class="input" id="py-note" maxlength="80" placeholder="F.eks. Vipps for strøm"></div>
      <div class="form-error" data-error hidden style="margin-top:14px"></div>
    </form>`,
    foot: `<button type="button" class="btn btn-secondary" data-close>Avbryt</button><button type="submit" class="btn" form="pay-form">Registrer</button>`
  });
  const f = qs('#pay-form', s.el);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = qs('[data-error]', f);
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    const fromId = qs('#py-from', f).value;
    const toId = qs('#py-to', f).value;
    const ore = parseKr(qs('#py-amt', f).value);
    if (fromId === toId) return fail('Velg to forskjellige personer.');
    if (!isMe(fromId) && !isMe(toId)) return fail('Du kan bare registrere betalinger du selv har sendt eller fått.');
    if (!ore) return fail('Skriv inn et gyldig beløp.');
    await withBusy(qs('[form="pay-form"]', s.el), async () => {
      try {
        await q(sb.from('payments').insert({
          household_id: S.hid, from_user: fromId, to_user: toId, amount_ore: ore,
          note: qs('#py-note', f).value.trim() || null, created_by: meId()
        }));
        s.close();
        toast('Betalingen er registrert');
        refresh();
      } catch (x) { fail(errMsg(x)); }
    });
  });
}

function openExpenseDetail(e, shares, who) {
  const canDelete = isMe(e.created_by) || isMe(e.paid_by) || isAdmin();
  const name = (id) => (isMe(id) ? 'Deg' : who(id)?.display_name || 'Tidligere medlem');
  const s = openSheet({
    title: e.description,
    body: `<div class="detail-amount">${fmtKr(e.amount_ore)}</div>
      <dl class="kv">
        <dt>Betalt av</dt><dd>${esc(name(e.paid_by))}</dd>
        <dt>Dato</dt><dd>${esc(cap(fmtDateLong(parseDate(e.spent_on))))}</dd>
        ${e.created_by && e.created_by !== e.paid_by ? `<dt>Lagt inn av</dt><dd>${esc(name(e.created_by))}</dd>` : ''}
      </dl>
      <h3 style="font-size:var(--fs-sm);color:var(--text-3);margin:20px 0 4px">Fordeling</h3>
      <ul class="list">${shares.sort((a, b) => b.share_ore - a.share_ore).map((x) => `
        <li class="row" style="padding:10px 0;min-height:0">${avatar(who(x.user_id), 'sm')}<span class="row-main">${esc(name(x.user_id))}</span><span class="amount">${fmtKr(x.share_ore)}</span></li>`).join('')}
      </ul>`,
    foot: canDelete
      ? `<button type="button" class="btn btn-danger" data-delete>${icon('trash')}Slett</button><span class="spacer"></span><button type="button" class="btn btn-secondary" data-close>Lukk</button>`
      : `<button type="button" class="btn btn-secondary" data-close>Lukk</button>`
  });
  qs('[data-delete]', s.el)?.addEventListener('click', async () => {
    s.close();
    const ok = await confirmSheet({ title: 'Slette utgiften?', text: `«${e.description}» fjernes, og saldoen regnes ut på nytt for alle.`, confirmLabel: 'Slett utgiften', danger: true });
    if (!ok) return;
    try {
      await q(sb.from('expenses').delete().eq('id', e.id));
      toast('Utgiften er slettet');
      refresh();
    } catch (x) { toast(errMsg(x), 'error'); }
  });
}

function openPaymentDetail(p, who) {
  const canDelete = isMe(p.created_by) || isAdmin();
  const name = (id) => (isMe(id) ? 'Deg' : who(id)?.display_name || 'Tidligere medlem');
  const s = openSheet({
    title: 'Betaling',
    body: `<div class="detail-amount amount pos">${fmtKr(p.amount_ore)}</div>
      <dl class="kv">
        <dt>Fra</dt><dd>${esc(name(p.from_user))}</dd>
        <dt>Til</dt><dd>${esc(name(p.to_user))}</dd>
        <dt>Dato</dt><dd>${esc(cap(fmtDateLong(parseDate(p.paid_on))))}</dd>
        ${p.note ? `<dt>Notat</dt><dd>${esc(p.note)}</dd>` : ''}
      </dl>`,
    foot: canDelete
      ? `<button type="button" class="btn btn-danger" data-delete>${icon('trash')}Slett</button><span class="spacer"></span><button type="button" class="btn btn-secondary" data-close>Lukk</button>`
      : `<button type="button" class="btn btn-secondary" data-close>Lukk</button>`
  });
  qs('[data-delete]', s.el)?.addEventListener('click', async () => {
    s.close();
    const ok = await confirmSheet({ title: 'Slette betalingen?', text: 'Saldoen regnes ut på nytt som om betalingen aldri skjedde.', confirmLabel: 'Slett betalingen', danger: true });
    if (!ok) return;
    try {
      await q(sb.from('payments').delete().eq('id', p.id));
      toast('Betalingen er slettet');
      refresh();
    } catch (x) { toast(errMsg(x), 'error'); }
  });
}

/* =====================================================================
   KALENDER
   ===================================================================== */

function eventWhen(ev) {
  const start = parseDate(ev.starts_on);
  let s = fmtDayRelative(start);
  if (ev.ends_on && ev.ends_on !== ev.starts_on) s += ` til ${fmtDate(parseDate(ev.ends_on))}`;
  if (ev.start_time) s += `, kl. ${fmtTime(ev.start_time)}${ev.end_time ? `–${fmtTime(ev.end_time)}` : ''}`;
  return s;
}

function eventSub(ev) {
  return eventWhen(ev) + (ev.location ? `, ${ev.location}` : '');
}

async function renderCalendar(view, tok) {
  if (!S.calMonth) { const t = today(); S.calMonth = new Date(t.getFullYear(), t.getMonth(), 1); }
  const first = S.calMonth;
  const gridStart = startOfWeek(first);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((dow(first) + daysInMonth) / 7);
  const gridEnd = addDays(gridStart, weeks * 7 - 1);
  const gs = isoDate(gridStart);
  const ge = isoDate(gridEnd);
  const t = isoDate(today());

  const [monthEvents, upcoming] = await Promise.all([
    q(sb.from('events').select('*').eq('household_id', S.hid)
      .lte('starts_on', ge).or(`starts_on.gte.${gs},ends_on.gte.${gs}`)
      .order('starts_on').order('start_time', { nullsFirst: true })),
    q(sb.from('events').select('*').eq('household_id', S.hid)
      .or(`starts_on.gte.${t},ends_on.gte.${t}`)
      .order('starts_on').order('start_time', { nullsFirst: true }).limit(25))
  ]);
  const allIds = [...new Set([...monthEvents, ...upcoming].map((e) => e.id))];
  const att = allIds.length ? await q(sb.from('event_attendees').select('event_id, user_id').in('event_id', allIds)) : [];
  if (stale(tok)) return;

  const going = {};
  att.forEach((a) => { (going[a.event_id] ||= []).push(a.user_id); });

  // Hendelser per dag i rutenettet
  const byDay = {};
  monthEvents.forEach((ev) => {
    let d = parseDate(ev.starts_on);
    const end = parseDate(ev.ends_on || ev.starts_on);
    if (d < gridStart) d = new Date(gridStart);
    while (d <= end && d <= gridEnd) {
      (byDay[isoDate(d)] ||= []).push(ev);
      d = addDays(d, 1);
    }
  });

  let cells = `<div></div>${WEEKDAYS_SHORT.map((w) => `<div class="cal-dow">${cap(w)}</div>`).join('')}`;
  for (let w = 0; w < weeks; w++) {
    const monday = addDays(gridStart, w * 7);
    cells += `<div class="cal-wk" title="Uke ${isoWeek(monday)}">${isoWeek(monday)}</div>`;
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i);
      const key = isoDate(d);
      const evs = byDay[key] || [];
      const cls = [d.getMonth() !== first.getMonth() ? 'out' : '', sameDay(d, today()) ? 'today' : ''].join(' ');
      cells += `<button type="button" class="cal-day ${cls}" data-day="${key}" aria-pressed="${S.calSel === key}"
          aria-label="${esc(cap(fmtDateLong(d)))}${evs.length ? `, ${evs.length} ${evs.length === 1 ? 'hendelse' : 'hendelser'}` : ''}">
        <span class="n">${d.getDate()}</span>
        <span class="cal-dots">${evs.slice(0, 3).map(() => '<i></i>').join('')}</span>
        <span class="ev-labels">${evs.slice(0, 2).map((ev) => `<span class="ev-label">${ev.start_time ? fmtTime(ev.start_time) + ' ' : ''}${esc(ev.title)}</span>`).join('')}${evs.length > 2 ? `<span class="ev-more">+${evs.length - 2} til</span>` : ''}</span>
      </button>`;
    }
  }

  const evRow = (ev, tileDate) => `<li><button type="button" class="row" data-ev="${ev.id}">
      ${dateTile(tileDate || parseDate(ev.starts_on))}
      <span class="row-main"><span class="row-title" style="display:block">${esc(ev.title)}</span><span class="row-sub">${esc(eventSub(ev))}</span></span>
      <span class="row-end">${avatarStack(going[ev.id] || [], 3)}</span>
    </button></li>`;

  let listTitle, listHtml;
  if (S.calSel) {
    const d = parseDate(S.calSel);
    const evs = byDay[S.calSel] || [];
    listTitle = cap(fmtDateLong(d));
    listHtml = evs.length ? `<ul class="list">${evs.map((ev) => evRow(ev, d)).join('')}</ul>`
      : emptyState('calendar', 'Ingenting denne dagen', 'Planlegg noe for huset denne dagen.', `<button type="button" class="btn btn-sm" data-new-ev="${S.calSel}">${icon('plus')}Ny hendelse</button>`);
  } else {
    listTitle = 'Kommende';
    listHtml = upcoming.length
      ? `<ul class="list">${upcoming.map((ev) => evRow(ev, parseDate(ev.starts_on) < today() ? today() : null)).join('')}</ul>`
      : emptyState('calendar', 'Ingenting planlagt', 'Legg inn fellesmiddager, husmøter, besøk eller når noen er bortreist.', `<button type="button" class="btn btn-sm" data-new-ev>${icon('plus')}Ny hendelse</button>`);
  }

  const isThisMonth = first.getMonth() === today().getMonth() && first.getFullYear() === today().getFullYear();
  view.innerHTML = `
    ${pageHead('Kalender', 'Planer og hendelser i huset.', `<button type="button" class="btn" data-new-ev>${icon('plus')}Ny hendelse</button>`)}
    <section class="card cal">
      <div class="cal-head">
        <h2 class="cal-title">${cap(MONTHS[first.getMonth()])} ${first.getFullYear()}</h2>
        ${isThisMonth && !S.calSel ? '' : '<button type="button" class="btn btn-secondary btn-sm" data-cal-today>I dag</button>'}
        <button type="button" class="btn btn-icon" data-cal-prev aria-label="Forrige måned">${icon('chevLeft')}</button>
        <button type="button" class="btn btn-icon" data-cal-next aria-label="Neste måned">${icon('chevRight')}</button>
      </div>
      <div class="cal-grid">${cells}</div>
    </section>
    <section class="card flush" style="margin-top:16px">
      <div class="card-head" style="padding-bottom:8px"><h2 class="card-title">${esc(listTitle)}</h2>
        ${S.calSel ? '<button type="button" class="card-link" style="border:0;background:none;cursor:pointer" data-cal-clear>Vis kommende</button>' : ''}</div>
      ${listHtml}
    </section>`;

  const moveMonth = (n) => { S.calMonth = new Date(first.getFullYear(), first.getMonth() + n, 1); S.calSel = null; refresh(); };
  qs('[data-cal-prev]', view).addEventListener('click', () => moveMonth(-1));
  qs('[data-cal-next]', view).addEventListener('click', () => moveMonth(1));
  qs('[data-cal-today]', view)?.addEventListener('click', () => { S.calMonth = null; S.calSel = null; refresh(); });
  qs('[data-cal-clear]', view)?.addEventListener('click', () => { S.calSel = null; refresh(); });
  qsa('[data-day]', view).forEach((b) => b.addEventListener('click', () => {
    S.calSel = S.calSel === b.dataset.day ? null : b.dataset.day;
    const d = parseDate(b.dataset.day);
    if (d.getMonth() !== first.getMonth()) S.calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    refresh();
  }));
  qsa('[data-new-ev]', view).forEach((b) => b.addEventListener('click', () => openEventForm(null, b.dataset.newEv || S.calSel)));
  qsa('[data-ev]', view).forEach((b) => b.addEventListener('click', () => {
    const ev = [...monthEvents, ...upcoming].find((x) => x.id === b.dataset.ev);
    openEventDetail(ev, going[ev.id] || []);
  }));
}

async function openEventById(id) {
  try {
    const ev = await q(sb.from('events').select('*').eq('id', id).single());
    const att = await q(sb.from('event_attendees').select('user_id').eq('event_id', id));
    openEventDetail(ev, att.map((a) => a.user_id));
  } catch (e) { toast(errMsg(e), 'error'); }
}

function openEventDetail(ev, goingIds) {
  const amGoing = goingIds.includes(meId());
  const canDelete = isMe(ev.created_by) || isAdmin();
  const s = openSheet({
    title: ev.title,
    body: `
      <div class="stack" style="gap:12px">
        <div class="contact-line" style="font-size:var(--fs-md)">${icon('clock')}<span>${esc(eventWhen(ev))}</span></div>
        ${ev.location ? `<div class="contact-line" style="font-size:var(--fs-md)">${icon('mapPin')}<span>${esc(ev.location)}</span></div>` : ''}
        ${ev.description ? `<p style="white-space:pre-wrap;color:var(--text-2)">${linkify(ev.description)}</p>` : ''}
      </div>
      <h3 style="font-size:var(--fs-sm);color:var(--text-3);margin:22px 0 8px">Blir med (${goingIds.length})</h3>
      ${goingIds.length ? `<div class="chips">${goingIds.map((id) => `<span class="chip" style="padding-left:4px">${avatar(person(id), 'sm')}${esc(isMe(id) ? 'Deg' : personName(id))}</span>`).join('')}</div>`
        : '<p class="muted" style="font-size:var(--fs-sm)">Ingen har meldt seg på ennå.</p>'}
      <p class="hint" style="margin-top:18px">Lagt inn av ${esc(ev.created_by ? youOrLower(ev.created_by) : 'tidligere medlem')}.</p>`,
    foot: `
      ${canDelete ? `<button type="button" class="btn btn-ghost" data-delete aria-label="Slett hendelsen">${icon('trash')}</button>` : ''}
      <button type="button" class="btn btn-ghost" data-edit>${icon('edit')}Endre</button>
      <span class="spacer"></span>
      <button type="button" class="btn ${amGoing ? 'btn-secondary' : 'btn-accent'}" data-going>${amGoing ? 'Meld meg av' : 'Jeg blir med'}</button>`
  });
  qs('[data-going]', s.el).addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, async () => {
      try {
        if (amGoing) await q(sb.from('event_attendees').delete().eq('event_id', ev.id).eq('user_id', meId()));
        else await q(sb.from('event_attendees').insert({ event_id: ev.id, user_id: meId() }));
        s.close();
        toast(amGoing ? 'Du er meldt av' : 'Du er med');
        refresh();
      } catch (x) { toast(errMsg(x), 'error'); }
    });
  });
  qs('[data-edit]', s.el).addEventListener('click', () => { s.close(); openEventForm(ev); });
  qs('[data-delete]', s.el)?.addEventListener('click', async () => {
    s.close();
    const ok = await confirmSheet({ title: 'Slette hendelsen?', text: `«${ev.title}» fjernes fra kalenderen for alle.`, confirmLabel: 'Slett', danger: true });
    if (!ok) return;
    try {
      await q(sb.from('events').delete().eq('id', ev.id));
      toast('Hendelsen er slettet');
      refresh();
    } catch (x) { toast(errMsg(x), 'error'); }
  });
}

function openEventForm(ev, dateIso) {
  const editing = !!ev;
  const s = openSheet({
    title: editing ? 'Endre hendelse' : 'Ny hendelse',
    body: `<form id="ev-form" novalidate>
      <div class="field"><label class="label" for="ev-title">Tittel</label>
        <input class="input" id="ev-title" maxlength="80" value="${esc(ev?.title || '')}" placeholder="F.eks. Fellesmiddag" required autofocus></div>
      <div class="field-row">
        <div class="field"><label class="label" for="ev-start">Dato</label>
          <input class="input" id="ev-start" type="date" value="${ev?.starts_on || dateIso || isoDate(today())}" required></div>
        <div class="field"><label class="label" for="ev-end">Til dato <span class="muted">(valgfritt)</span></label>
          <input class="input" id="ev-end" type="date" value="${ev?.ends_on || ''}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label class="label" for="ev-t1">Fra kl. <span class="muted">(valgfritt)</span></label>
          <input class="input" id="ev-t1" type="time" value="${fmtTime(ev?.start_time)}"></div>
        <div class="field"><label class="label" for="ev-t2">Til kl. <span class="muted">(valgfritt)</span></label>
          <input class="input" id="ev-t2" type="time" value="${fmtTime(ev?.end_time)}"></div>
      </div>
      <div class="field"><label class="label" for="ev-loc">Sted <span class="muted">(valgfritt)</span></label>
        <input class="input" id="ev-loc" maxlength="120" value="${esc(ev?.location || '')}" placeholder="F.eks. stua"></div>
      <div class="field"><label class="label" for="ev-desc">Beskrivelse <span class="muted">(valgfritt)</span></label>
        <textarea class="textarea" id="ev-desc" maxlength="1000">${esc(ev?.description || '')}</textarea></div>
      <div class="form-error" data-error hidden style="margin-top:14px"></div>
    </form>`,
    foot: `<button type="button" class="btn btn-secondary" data-close>Avbryt</button><button type="submit" class="btn" form="ev-form">${editing ? 'Lagre endringer' : 'Legg til'}</button>`
  });
  const f = qs('#ev-form', s.el);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = qs('[data-error]', f);
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    const row = {
      title: qs('#ev-title', f).value.trim(),
      starts_on: qs('#ev-start', f).value,
      ends_on: qs('#ev-end', f).value || null,
      start_time: qs('#ev-t1', f).value || null,
      end_time: qs('#ev-t2', f).value || null,
      location: qs('#ev-loc', f).value.trim() || null,
      description: qs('#ev-desc', f).value.trim() || null
    };
    if (!row.title) return fail('Gi hendelsen en tittel.');
    if (!row.starts_on) return fail('Velg en dato.');
    if (row.ends_on && row.ends_on < row.starts_on) return fail('Til-datoen kan ikke være før fra-datoen.');
    if (row.ends_on === row.starts_on) row.ends_on = null;
    if (row.end_time && !row.start_time) return fail('Fyll inn starttidspunktet også.');
    await withBusy(qs('[form="ev-form"]', s.el), async () => {
      try {
        if (editing) await q(sb.from('events').update(row).eq('id', ev.id));
        else await q(sb.from('events').insert({ ...row, household_id: S.hid, created_by: meId() }));
        s.close();
        toast(editing ? 'Endringene er lagret' : 'Hendelsen er lagt til');
        const d = parseDate(row.starts_on);
        if (S.route === 'kalender') { S.calMonth = new Date(d.getFullYear(), d.getMonth(), 1); }
        refresh();
      } catch (x) { fail(errMsg(x)); }
    });
  });
}

/* =====================================================================
   VASKELISTE
   ===================================================================== */

const FREQ = [
  { n: 1, label: 'Hver uke' },
  { n: 2, label: 'Annenhver uke' },
  { n: 3, label: 'Hver tredje uke' },
  { n: 4, label: 'Hver fjerde uke' }
];
const CHORE_SUGGESTIONS = ['Kjøkken', 'Bad', 'Stue og gang', 'Søppel og pant'];

async function renderChores(view, tok) {
  const thisMon = startOfWeek(today());
  if (!S.week) S.week = thisMon;
  const ROTA_WEEKS = 6;

  const [chores, sched, rota] = await Promise.all([
    q(sb.from('chores').select('*').eq('household_id', S.hid).order('created_at')),
    q(sb.rpc('chore_schedule', { hid: S.hid, p_from: isoDate(S.week), p_weeks: 1 })),
    q(sb.rpc('chore_schedule', { hid: S.hid, p_from: isoDate(thisMon), p_weeks: ROTA_WEEKS }))
  ]);
  if (stale(tok)) return;

  const choreById = Object.fromEntries(chores.map((c) => [c.id, c]));
  const weekEnd = addDays(S.week, 6);
  const isThis = sameDay(S.week, thisMon);

  const rows = sched.filter((r) => choreById[r.chore_id]).map((r) => {
    const c = choreById[r.chore_id];
    const done = !!r.completed_by;
    const mine = isMe(r.assignee);
    let sub = r.assignee ? (mine ? 'Deg' : personName(r.assignee)) : 'Ingen i rundgangen';
    if (done) sub = `Gjort av ${youOrLower(r.completed_by)}, ${fmtAgo(r.completed_at)}`;
    else if (c.every_weeks > 1) sub += `, ${FREQ[c.every_weeks - 1].label.toLowerCase()} (til ${fmtDateShort(parseDate(r.period_end))})`;
    return `<li class="row chore-row ${mine ? 'mine' : ''} ${done ? 'done' : ''}">
      <button type="button" class="check-btn" aria-pressed="${done}" aria-label="${done ? 'Angre' : 'Marker som gjort'}: ${esc(c.name)}" data-chore="${c.id}" data-period="${r.period_start}">${icon('check')}</button>
      <div class="row-main"><div class="row-title">${esc(c.name)}${mine && !done ? ' <span class="badge accent">Din tur</span>' : ''}</div>
        <div class="row-sub">${esc(sub)}</div>${c.description ? `<div class="row-sub">${esc(c.description)}</div>` : ''}</div>
      ${avatar(person(r.assignee), 'sm')}
    </li>`;
  }).join('');

  // Rundgangstabell for de neste ukene
  const weekMondays = Array.from({ length: ROTA_WEEKS }, (_, i) => addDays(thisMon, i * 7));
  const rotaRows = chores.map((c) => {
    const cells = weekMondays.map((m) => {
      const key = isoDate(m);
      const r = rota.find((x) => x.chore_id === c.id && x.period_start <= key && x.period_end >= key);
      const who = r?.assignee;
      return `<td class="${sameDay(m, thisMon) ? 'cur' : ''}">${who ? `<span class="who ${isMe(who) ? 'me' : ''}">${avatar(person(who), 'sm')}${esc(isMe(who) ? 'Deg' : firstName(who))}</span>` : '<span class="muted">–</span>'}</td>`;
    }).join('');
    return `<tr><td><button type="button" class="link-btn" style="text-decoration:none;color:var(--text)" data-edit-chore="${c.id}">${esc(c.name)}</button></td>${cells}</tr>`;
  }).join('');

  view.innerHTML = `
    ${pageHead('Vaskeliste', 'Oppgavene går på rundgang, uke for uke.', `<button type="button" class="btn" data-new-chore>${icon('plus')}Ny oppgave</button>`)}
    ${chores.length ? `
    <section class="card flush">
      <div class="card-head" style="padding-bottom:12px">
        <div class="week-nav">
          <button type="button" class="btn btn-icon" data-week="-1" aria-label="Forrige uke">${icon('chevLeft')}</button>
          <div class="week-label">Uke ${isoWeek(S.week)}<small>${fmtDateShort(S.week)} – ${fmtDateShort(weekEnd)}</small></div>
          <button type="button" class="btn btn-icon" data-week="1" aria-label="Neste uke">${icon('chevRight')}</button>
        </div>
        ${isThis ? '<span class="badge">Denne uka</span>' : '<button type="button" class="btn btn-secondary btn-sm" data-week="0">Denne uka</button>'}
      </div>
      <ul class="list">${rows}</ul>
    </section>
    <section class="card flush" style="margin-top:16px">
      <div class="card-head"><h2 class="card-title">Rundgang de neste ukene</h2><span class="hint">Trykk på en oppgave for å endre den</span></div>
      <div class="rota" style="margin-top:4px"><table>
        <thead><tr><th>Oppgave</th>${weekMondays.map((m) => `<th class="${sameDay(m, thisMon) ? 'cur' : ''}">Uke ${isoWeek(m)}</th>`).join('')}</tr></thead>
        <tbody>${rotaRows}</tbody>
      </table></div>
    </section>`
    : `<section class="card">${emptyState('sparkle', 'Ingen oppgaver ennå', 'Legg inn det som må gjøres i huset. Alle settes automatisk opp på rundgang.',
        `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
          <button type="button" class="btn btn-sm" data-suggest>${icon('plus')}Legg til vanlige oppgaver</button>
          <button type="button" class="btn btn-secondary btn-sm" data-new-chore>Lag din egen</button></div>
         <p class="hint">Vanlige oppgaver: ${CHORE_SUGGESTIONS.join(', ')}.</p>`)}</section>`}`;

  qsa('[data-new-chore]', view).forEach((b) => b.addEventListener('click', () => openChoreForm()));
  qsa('[data-chore]', view).forEach((b) => b.addEventListener('click', () => toggleChore(b)));
  qsa('[data-week]', view).forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.week);
    S.week = n === 0 ? thisMon : addDays(S.week, n * 7);
    refresh();
  }));
  qsa('[data-edit-chore]', view).forEach((b) => b.addEventListener('click', () => openChoreForm(choreById[b.dataset.editChore])));
  qs('[data-suggest]', view)?.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, async () => {
      try {
        for (const name of CHORE_SUGGESTIONS) {
          await q(sb.from('chores').insert({ household_id: S.hid, name }));
        }
        toast('Vaskelista er klar');
        refresh();
      } catch (x) { toast(errMsg(x), 'error'); }
    });
  });
}

function openChoreForm(chore) {
  const editing = !!chore;
  const memberIds = S.members.map((m) => m.user_id);
  let order = editing ? [...chore.rotation, ...memberIds.filter((id) => !chore.rotation.includes(id))] : [...memberIds];
  let included = new Set(editing ? chore.rotation : memberIds);

  const s = openSheet({
    title: editing ? 'Endre oppgave' : 'Ny oppgave',
    body: `<form id="ch-form" novalidate>
      <div class="field"><label class="label" for="ch-name">Navn</label>
        <input class="input" id="ch-name" maxlength="60" value="${esc(chore?.name || '')}" placeholder="F.eks. Kjøkken" required autofocus></div>
      <div class="field"><label class="label" for="ch-desc">Hva skal gjøres? <span class="muted">(valgfritt)</span></label>
        <input class="input" id="ch-desc" maxlength="300" value="${esc(chore?.description || '')}" placeholder="F.eks. benker, komfyr og gulv"></div>
      <div class="field"><label class="label" for="ch-freq">Hvor ofte</label>
        <select class="select" id="ch-freq">${FREQ.map((f) => `<option value="${f.n}" ${(chore?.every_weeks || 1) === f.n ? 'selected' : ''}>${f.label}</option>`).join('')}</select></div>
      ${editing ? `<div class="field"><span class="label">Rundgang</span>
        <span class="hint">Rekkefølgen bestemmer hvem som har oppgaven etter hvem. Fjern haken for å ta noen ut.</span>
        <ul class="order-list" id="ch-order"></ul></div>`
      : '<p class="hint" style="margin-top:14px">Alle i huset settes opp på rundgang. Du kan endre rekkefølgen etterpå.</p>'}
      <div class="form-error" data-error hidden style="margin-top:14px"></div>
    </form>`,
    foot: `${editing ? `<button type="button" class="btn btn-ghost" data-delete aria-label="Slett oppgaven">${icon('trash')}</button><span class="spacer"></span>` : ''}
      <button type="button" class="btn btn-secondary" data-close>Avbryt</button><button type="submit" class="btn" form="ch-form">${editing ? 'Lagre' : 'Legg til'}</button>`
  });
  const f = qs('#ch-form', s.el);

  const drawOrder = () => {
    const ul = qs('#ch-order', f);
    if (!ul) return;
    let n = 0;
    ul.innerHTML = order.map((id, i) => {
      const on = included.has(id);
      if (on) n++;
      return `<li class="order-item ${on ? '' : 'off'}">
        <span class="pos-n">${on ? n : ''}</span>
        <input type="checkbox" ${on ? 'checked' : ''} data-inc="${id}" aria-label="Ta med ${esc(personName(id))}" style="width:18px;height:18px;accent-color:var(--ink)">
        ${avatar(person(id), 'sm')}<span class="name">${esc(isMe(id) ? 'Deg' : personName(id))}</span>
        <button type="button" class="btn btn-icon btn-sm" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Flytt opp">${icon('arrowUp', 'icon-sm')}</button>
        <button type="button" class="btn btn-icon btn-sm" data-down="${i}" ${i === order.length - 1 ? 'disabled' : ''} aria-label="Flytt ned">${icon('arrowDown', 'icon-sm')}</button>
      </li>`;
    }).join('');
  };
  drawOrder();
  qs('#ch-order', f)?.addEventListener('click', (e) => {
    const up = e.target.closest('[data-up]');
    const down = e.target.closest('[data-down]');
    if (up) { const i = +up.dataset.up; [order[i - 1], order[i]] = [order[i], order[i - 1]]; drawOrder(); }
    if (down) { const i = +down.dataset.down; [order[i + 1], order[i]] = [order[i], order[i + 1]]; drawOrder(); }
  });
  qs('#ch-order', f)?.addEventListener('change', (e) => {
    const c = e.target.closest('[data-inc]');
    if (!c) return;
    if (c.checked) included.add(c.dataset.inc); else included.delete(c.dataset.inc);
    drawOrder();
  });

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = qs('[data-error]', f);
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    const row = {
      name: qs('#ch-name', f).value.trim(),
      description: qs('#ch-desc', f).value.trim() || null,
      every_weeks: Number(qs('#ch-freq', f).value)
    };
    if (!row.name) return fail('Gi oppgaven et navn.');
    if (editing) {
      row.rotation = order.filter((id) => included.has(id));
      if (!row.rotation.length) return fail('Minst én person må være med i rundgangen.');
    }
    await withBusy(qs('[form="ch-form"]', s.el), async () => {
      try {
        if (editing) await q(sb.from('chores').update(row).eq('id', chore.id));
        else await q(sb.from('chores').insert({ ...row, household_id: S.hid }));
        s.close();
        toast(editing ? 'Oppgaven er oppdatert' : 'Oppgaven er lagt til');
        refresh();
      } catch (x) { fail(errMsg(x)); }
    });
  });

  qs('[data-delete]', s.el)?.addEventListener('click', async () => {
    s.close();
    const ok = await confirmSheet({ title: 'Slette oppgaven?', text: `«${chore.name}» og historikken for den fjernes fra vaskelista.`, confirmLabel: 'Slett', danger: true });
    if (!ok) return;
    try {
      await q(sb.from('chores').delete().eq('id', chore.id));
      toast('Oppgaven er slettet');
      refresh();
    } catch (x) { toast(errMsg(x), 'error'); }
  });
}

/* =====================================================================
   HANDLELISTE
   ===================================================================== */

async function renderShopping(view, tok) {
  view.innerHTML = `
    ${pageHead('Handleliste', '<span id="shop-count">&nbsp;</span>')}
    <section class="card flush">
      <form class="add-bar" id="shop-add" autocomplete="off">
        <label class="sr-only" for="shop-name">Vare</label>
        <input class="input" id="shop-name" maxlength="80" placeholder="Legg til en vare" enterkeyhint="done">
        <label class="sr-only" for="shop-qty">Antall</label>
        <input class="input qty" id="shop-qty" maxlength="30" placeholder="Antall">
        <button class="btn" type="submit">${icon('plus')}Legg til</button>
      </form>
      <div id="shop-list"></div>
    </section>`;
  await loadShopping(tok);
  if (stale(tok)) return;

  const form = qs('#shop-add', view);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = qs('#shop-name', form).value.trim();
    const quantity = qs('#shop-qty', form).value.trim() || null;
    if (!name) { qs('#shop-name', form).focus(); return; }
    qs('#shop-name', form).value = '';
    qs('#shop-qty', form).value = '';
    qs('#shop-name', form).focus();
    try {
      await q(sb.from('shopping_items').insert({ household_id: S.hid, name, quantity, added_by: meId() }));
      loadShopping();
    } catch (x) { toast(errMsg(x), 'error'); }
  });

  qs('#shop-list', view).addEventListener('click', async (e) => {
    const chk = e.target.closest('[data-item]');
    const del = e.target.closest('[data-del-item]');
    const clear = e.target.closest('[data-clear]');
    try {
      if (chk) {
        const done = chk.getAttribute('aria-pressed') !== 'true';
        chk.setAttribute('aria-pressed', String(done));
        chk.closest('.item-row')?.classList.toggle('done', done);
        await q(sb.from('shopping_items').update({
          done, done_by: done ? meId() : null, done_at: done ? new Date().toISOString() : null
        }).eq('id', chk.dataset.item));
        loadShopping();
      }
      if (del) {
        await q(sb.from('shopping_items').delete().eq('id', del.dataset.delItem));
        loadShopping();
      }
      if (clear) {
        await q(sb.from('shopping_items').delete().eq('household_id', S.hid).eq('done', true));
        toast('Kjøpte varer er fjernet');
        loadShopping();
      }
    } catch (x) { toast(errMsg(x), 'error'); }
  });
}

async function loadShopping(tok = renderToken) {
  const items = await q(sb.from('shopping_items').select('*').eq('household_id', S.hid).order('created_at'));
  if (stale(tok) || S.route !== 'handleliste') return;
  const box = qs('#shop-list');
  if (!box) return;
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done).sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''));
  qs('#shop-count').textContent = open.length
    ? `${open.length} ${open.length === 1 ? 'vare' : 'varer'} på lista`
    : 'Lista er tom';

  const row = (i) => `<li class="row item-row ${i.done ? 'done' : ''}">
    <button type="button" class="check-btn" aria-pressed="${i.done}" data-item="${i.id}" aria-label="${i.done ? 'Angre kjøpt' : 'Marker som kjøpt'}: ${esc(i.name)}">${icon('check')}</button>
    <div class="row-main"><div class="row-title">${esc(i.name)}${i.quantity ? `<span class="item-qty">${esc(i.quantity)}</span>` : ''}</div>
      <div class="row-sub">${i.done
        ? `Kjøpt av ${esc(i.done_by ? youOrLower(i.done_by) : 'noen')}${i.done_at ? ', ' + esc(fmtAgo(i.done_at)) : ''}`
        : `Lagt til av ${esc(i.added_by ? youOrLower(i.added_by) : 'noen')}, ${esc(fmtAgo(i.created_at))}`}</div></div>
    <button type="button" class="btn btn-icon btn-sm" data-del-item="${i.id}" aria-label="Fjern ${esc(i.name)}">${icon('x', 'icon-sm')}</button>
  </li>`;

  box.innerHTML = (open.length
    ? `<ul class="list" style="border-top:1px solid var(--border)">${open.map(row).join('')}</ul>`
    : `<div style="border-top:1px solid var(--border)">${emptyState('cart', 'Ingenting mangler', 'Legg til det huset trenger, så ser alle det med en gang.')}</div>`)
    + (done.length ? `
      <div class="card-head" style="padding:14px 18px 6px;margin:0;border-top:1px solid var(--border)">
        <h3 class="card-title" style="font-size:var(--fs-sm);color:var(--text-3)">Kjøpt (${done.length})</h3>
        <button type="button" class="btn btn-ghost btn-sm" data-clear>Fjern kjøpte</button>
      </div>
      <ul class="list">${done.map(row).join('')}</ul>` : '');
}

/* =====================================================================
   HUSET
   ===================================================================== */

async function renderHouse(view, tok) {
  const h = await q(sb.from('households').select('*').eq('id', S.hid).single());
  await loadMembers();
  if (stale(tok)) return;
  S.house = { ...S.house, ...h };
  const idx = S.households.findIndex((x) => x.id === h.id);
  if (idx >= 0) S.households[idx] = { ...S.households[idx], ...h };

  const block = (ic, title, content, wide = false) => `
    <section class="card info-card ${wide ? 'wide' : ''}">
      <div class="ic-head">${icon(ic)}<h3>${title}</h3></div>
      ${content}
    </section>`;
  const textOr = (v, empty) => (v ? `<div class="ic-body">${linkify(v)}</div>` : `<p class="ic-empty">${empty}</p>`);

  const wifi = h.wifi_name || h.wifi_password
    ? `${h.wifi_name ? `<div class="ic-body"><span class="muted">Nettverk</span><div style="font-weight:600">${esc(h.wifi_name)}</div></div>` : ''}
       ${h.wifi_password ? `<div style="margin-top:10px"><span class="muted">Passord</span>
         <div class="secret"><code id="wifi-pass" data-shown="false">••••••••</code>
         <button type="button" class="btn btn-icon btn-sm" data-reveal aria-label="Vis passordet">${icon('eye', 'icon-sm')}</button>
         <button type="button" class="btn btn-icon btn-sm" data-copy-wifi aria-label="Kopier passordet">${icon('copy', 'icon-sm')}</button></div></div>` : ''}`
    : '<p class="ic-empty">Legg inn wifi-navn og passord, så slipper dere å spørre.</p>';

  const landlord = h.landlord_name || h.landlord_phone || h.landlord_email
    ? `${h.landlord_name ? `<div style="font-weight:600">${esc(h.landlord_name)}</div>` : ''}
       ${h.landlord_phone ? `<div class="contact-line">${icon('phone', 'icon-sm')}<a href="tel:${esc(h.landlord_phone.replace(/\s/g, ''))}">${esc(fmtPhone(h.landlord_phone))}</a></div>` : ''}
       ${h.landlord_email ? `<div class="contact-line">${icon('mail', 'icon-sm')}<a href="mailto:${esc(h.landlord_email)}">${esc(h.landlord_email)}</a></div>` : ''}`
    : '<p class="ic-empty">Hvem ringer dere når noe går i stykker?</p>';

  const memberRows = S.members.map((m) => `
    <li class="row">
      ${avatar(m.profile)}
      <div class="row-main">
        <div class="row-title">${esc(m.profile.display_name)}${isMe(m.user_id) ? ' <span class="muted" style="font-weight:500">(deg)</span>' : ''}</div>
        <div class="row-sub">${m.role === 'admin' ? 'Administrator' : 'Medlem'}${m.profile.phone ? `, <a href="tel:${esc(m.profile.phone.replace(/\s/g, ''))}" style="color:inherit">${esc(fmtPhone(m.profile.phone))}</a>` : ''}</div>
      </div>
      ${isAdmin() && !isMe(m.user_id) ? `<button type="button" class="btn btn-ghost btn-sm" data-member="${m.user_id}">Administrer</button>` : ''}
    </li>`).join('');

  const inviteUrl = pageUrl('./?kode=' + h.invite_code);

  view.innerHTML = `
    ${pageHead(h.name, h.address ? esc(h.address) : 'Felles informasjon for alle i huset.',
      `<button type="button" class="btn btn-secondary" data-edit-house>${icon('edit')}Rediger</button>`)}
    <div class="info-grid">
      ${block('wifi', 'Wifi', wifi)}
      ${block('recycle', 'Søppel og tømming', textOr(h.trash_info, 'Når hentes søppelet, og hvor står dunkene?'))}
      ${block('rules', 'Husregler', textOr(h.rules, 'Stilletid, gjester, oppvask: det dere har blitt enige om.'))}
      ${block('key', 'Utleier', landlord)}
      ${h.notes ? block('note', 'Annet', textOr(h.notes, ''), true) : ''}
    </div>

    <div class="grid-2" style="margin-top:16px">
      <section class="card flush">
        <div class="card-head"><h2 class="card-title">Medlemmer (${S.members.length})</h2></div>
        <ul class="list" style="margin-top:4px">${memberRows}</ul>
      </section>
      <section class="card">
        <div class="card-head"><h2 class="card-title">Inviter husfeller</h2></div>
        <p style="color:var(--text-2);font-size:var(--fs-sm);margin-bottom:14px">Send lenken, eller be dem skrive inn koden etter at de har laget konto.</p>
        <div class="invite-code num">${esc(h.invite_code.slice(0, 4))}<span>–</span>${esc(h.invite_code.slice(4))}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">
          <button type="button" class="btn" data-share>${icon('link')}${navigator.share ? 'Del lenke' : 'Kopier lenke'}</button>
          <button type="button" class="btn btn-secondary" data-copy-code>${icon('copy')}Kopier kode</button>
        </div>
        ${isAdmin() ? `<button type="button" class="btn btn-ghost btn-sm btn-block" style="margin-top:8px" data-new-code>${icon('refresh', 'icon-sm')}Lag ny kode</button>` : ''}
      </section>
    </div>

    <section class="card danger-zone" style="margin-top:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <div style="flex:1;min-width:220px">
        <h2 class="card-title">Flytte ut?</h2>
        <p class="muted" style="font-size:var(--fs-sm)">Gjør opp utgiftene før du forlater kollektivet.</p>
      </div>
      <button type="button" class="btn btn-danger" data-leave>${icon('logout')}Forlat kollektivet</button>
      ${isAdmin() ? `<button type="button" class="btn btn-danger" data-delete-house>${icon('trash')}Slett kollektivet</button>` : ''}
    </section>`;

  qs('[data-edit-house]', view).addEventListener('click', () => openHouseForm(h));
  qs('[data-reveal]', view)?.addEventListener('click', (e) => {
    const code = qs('#wifi-pass', view);
    const shown = code.dataset.shown === 'true';
    code.textContent = shown ? '••••••••' : h.wifi_password;
    code.dataset.shown = String(!shown);
    e.currentTarget.innerHTML = icon(shown ? 'eye' : 'eyeOff', 'icon-sm');
    e.currentTarget.setAttribute('aria-label', shown ? 'Vis passordet' : 'Skjul passordet');
  });
  qs('[data-copy-wifi]', view)?.addEventListener('click', () => copyText(h.wifi_password, 'Wifi-passordet er kopiert'));
  qs('[data-copy-code]', view).addEventListener('click', () => copyText(fmtCode(h.invite_code), 'Koden er kopiert'));
  qs('[data-share]', view).addEventListener('click', async () => {
    if (navigator.share) {
      try { await navigator.share({ title: `Bli med i ${h.name} på Husly`, url: inviteUrl }); } catch (e) { /* avbrutt */ }
    } else copyText(inviteUrl, 'Lenken er kopiert');
  });
  qs('[data-new-code]', view)?.addEventListener('click', async () => {
    const ok = await confirmSheet({ title: 'Lage ny kode?', text: 'Den gamle koden og lenken slutter å virke. De som allerede er med, påvirkes ikke.', confirmLabel: 'Lag ny kode' });
    if (!ok) return;
    try { await q(sb.rpc('regenerate_invite_code', { hid: S.hid })); toast('Ny kode er laget'); refresh(); }
    catch (x) { toast(errMsg(x), 'error'); }
  });
  qsa('[data-member]', view).forEach((b) => b.addEventListener('click', () => openMemberMenu(S.members.find((m) => m.user_id === b.dataset.member))));
  qs('[data-leave]', view).addEventListener('click', leaveHousehold);
  qs('[data-delete-house]', view)?.addEventListener('click', deleteHousehold);
}

function openHouseForm(h) {
  const v = (k) => esc(h[k] || '');
  const s = openSheet({
    title: 'Informasjon om huset',
    wide: true,
    body: `<form id="house-form" novalidate>
      <div class="field"><label class="label" for="h-name">Navn på kollektivet</label><input class="input" id="h-name" maxlength="60" value="${v('name')}" required></div>
      <div class="field"><label class="label" for="h-address">Adresse</label><input class="input" id="h-address" maxlength="200" value="${v('address')}" placeholder="Gate, postnummer og sted"></div>
      <div class="field-row">
        <div class="field"><label class="label" for="h-wifi">Wifi-navn</label><input class="input" id="h-wifi" maxlength="100" value="${v('wifi_name')}" autocomplete="off"></div>
        <div class="field"><label class="label" for="h-wifipw">Wifi-passord</label><input class="input" id="h-wifipw" maxlength="100" value="${v('wifi_password')}" autocomplete="off"></div>
      </div>
      <div class="field"><label class="label" for="h-trash">Søppel og tømming</label><textarea class="textarea" id="h-trash" maxlength="2000" placeholder="F.eks. Restavfall tømmes tirsdager, papir annenhver fredag. Dunkene står bak huset.">${v('trash_info')}</textarea></div>
      <div class="field"><label class="label" for="h-rules">Husregler</label><textarea class="textarea" id="h-rules" maxlength="4000" placeholder="F.eks. Stille etter kl. 23 på hverdager. Oppvasken tas samme dag.">${v('rules')}</textarea></div>
      <div class="field-row">
        <div class="field"><label class="label" for="h-ll-name">Utleier</label><input class="input" id="h-ll-name" maxlength="100" value="${v('landlord_name')}"></div>
        <div class="field"><label class="label" for="h-ll-phone">Utleiers telefon</label><input class="input" id="h-ll-phone" maxlength="30" inputmode="tel" value="${v('landlord_phone')}"></div>
      </div>
      <div class="field"><label class="label" for="h-ll-email">Utleiers e-post</label><input class="input" id="h-ll-email" maxlength="120" type="email" value="${v('landlord_email')}"></div>
      <div class="field"><label class="label" for="h-notes">Annet</label><textarea class="textarea" id="h-notes" maxlength="4000" placeholder="Hvor sikringsskapet er, nøkkelboks, parkering …">${v('notes')}</textarea></div>
      <div class="form-error" data-error hidden style="margin-top:14px"></div>
    </form>`,
    foot: `<button type="button" class="btn btn-secondary" data-close>Avbryt</button><button type="submit" class="btn" form="house-form">Lagre</button>`
  });
  const f = qs('#house-form', s.el);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = qs('[data-error]', f);
    const val = (id) => qs(id, f).value.trim() || null;
    const row = {
      name: qs('#h-name', f).value.trim(),
      address: val('#h-address'), wifi_name: val('#h-wifi'), wifi_password: val('#h-wifipw'),
      trash_info: val('#h-trash'), rules: val('#h-rules'),
      landlord_name: val('#h-ll-name'), landlord_phone: val('#h-ll-phone'), landlord_email: val('#h-ll-email'),
      notes: val('#h-notes')
    };
    if (!row.name) { err.textContent = 'Kollektivet må ha et navn.'; err.hidden = false; return; }
    if (row.landlord_email && !validEmail(row.landlord_email)) { err.textContent = 'E-postadressen til utleier ser ikke riktig ut.'; err.hidden = false; return; }
    await withBusy(qs('[form="house-form"]', s.el), async () => {
      try {
        await q(sb.from('households').update(row).eq('id', S.hid));
        s.close();
        toast('Informasjonen er lagret');
        await loadHouseholds();
        S.house = S.households.find((x) => x.id === S.hid);
        renderShell();
        refresh();
      } catch (x) { err.textContent = errMsg(x); err.hidden = false; }
    });
  });
}

function openMemberMenu(m) {
  const admin = m.role === 'admin';
  const s = openSheet({
    title: m.profile.display_name,
    body: `<div class="menu-list">
      <button type="button" class="menu-item" data-role>${icon('crown')}<span>${admin ? 'Fjern som administrator' : 'Gjør til administrator'}</span></button>
      <button type="button" class="menu-item" data-remove style="color:var(--neg)">${icon('logout')}<span>Fjern fra kollektivet</span></button>
    </div>
    <p class="hint" style="margin-top:12px">Administratorer kan fjerne medlemmer, endre roller og lage ny invitasjonskode.</p>`
  });
  qs('[data-role]', s.el).addEventListener('click', async () => {
    s.close();
    try {
      await q(sb.rpc('set_member_role', { hid: S.hid, uid: m.user_id, p_role: admin ? 'member' : 'admin' }));
      toast(admin ? 'Rollen er endret til medlem' : 'Rollen er endret til administrator');
      refresh();
    } catch (x) { toast(errMsg(x), 'error'); }
  });
  qs('[data-remove]', s.el).addEventListener('click', async () => {
    s.close();
    const ok = await confirmSheet({ title: `Fjerne ${m.profile.display_name}?`, text: 'Personen mister tilgang til kollektivet og tas ut av vaskelista. Utgiftene deres blir liggende i historikken.', confirmLabel: 'Fjern', danger: true });
    if (!ok) return;
    try {
      await q(sb.rpc('remove_member', { hid: S.hid, uid: m.user_id }));
      toast(`${m.profile.display_name} er fjernet`);
      await loadMembers();
      renderShell();
      refresh();
    } catch (x) { toast(errMsg(x), 'error'); }
  });
}

async function leaveHousehold() {
  let balText = '';
  try {
    const bals = await q(sb.rpc('household_balances', { hid: S.hid }));
    const my = bals.find((b) => isMe(b.user_id))?.balance_ore || 0;
    if (my !== 0) balText = my > 0 ? ` Du har ${fmtKr(my)} til gode.` : ` Du skylder ${fmtKr(-my)}.`;
  } catch (e) { /* vis uten saldo */ }
  const last = S.members.length === 1;
  const ok = await confirmSheet({
    title: 'Forlate kollektivet?',
    text: (last ? 'Du er den siste i kollektivet, så alt innholdet slettes.' : 'Du mister tilgangen og tas ut av vaskelista.') + balText,
    confirmLabel: 'Forlat', danger: true
  });
  if (!ok) return;
  try {
    await q(sb.rpc('leave_household', { hid: S.hid }));
    toast(`Du har forlatt ${S.house.name}`);
    await afterHouseholdGone();
  } catch (x) { toast(errMsg(x), 'error'); }
}

async function deleteHousehold() {
  const ok = await confirmSheet({
    title: 'Slette kollektivet?',
    text: `Alt i ${S.house.name} slettes for alle medlemmene: beskjeder, utgifter, kalender, vaskeliste og handleliste. Dette kan ikke angres.`,
    confirmLabel: 'Slett for alltid', danger: true, requireText: 'SLETT'
  });
  if (!ok) return;
  try {
    await q(sb.rpc('delete_household', { hid: S.hid }));
    toast('Kollektivet er slettet');
    await afterHouseholdGone();
  } catch (x) { toast(errMsg(x), 'error'); }
}

async function afterHouseholdGone() {
  try { localStorage.removeItem(HID_KEY); } catch (e) {}
  if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
  await loadHouseholds();
  if (!S.households.length) { S.hid = null; showOnboarding(); return; }
  await enterHousehold(S.households[0].id);
  location.hash = '#/hjem';
}

/* =====================================================================
   MEG
   ===================================================================== */

async function renderMe(view) {
  const email = S.session?.user?.email || '';
  const pref = getThemePref();
  view.innerHTML = `
    ${pageHead('Meg', 'Profil, utseende og konto.')}
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2 class="card-title">Profil</h2></div>
        <form id="me-form" novalidate>
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
            <span id="me-avatar">${avatar(S.me, 'lg')}</span>
            <div><div style="font-weight:700">${esc(S.me.display_name)}</div><div class="muted" style="font-size:var(--fs-sm)">${esc(email)}</div></div>
          </div>
          <div class="field"><label class="label" for="me-name">Navn</label>
            <input class="input" id="me-name" maxlength="40" value="${esc(S.me.display_name)}" required></div>
          <div class="field"><label class="label" for="me-phone">Telefon <span class="muted">(valgfritt)</span></label>
            <input class="input" id="me-phone" maxlength="20" inputmode="tel" autocomplete="tel" value="${esc(S.me.phone || '')}">
            <span class="hint">Vises for husfellene, så de kan Vippse deg.</span></div>
          <div class="field"><span class="label" id="me-color-label">Farge</span>
            <div class="color-pick" role="group" aria-labelledby="me-color-label">
              ${PERSON_COLORS.map((c) => `<button type="button" data-color="${c.key}" style="--pc:var(--p-${c.key})" aria-pressed="${S.me.color === c.key}" aria-label="${c.name}" title="${c.name}"></button>`).join('')}
            </div></div>
          <div class="form-error" data-error hidden style="margin-top:14px"></div>
          <button type="submit" class="btn" style="margin-top:18px">Lagre profil</button>
        </form>
      </section>

      <div class="stack">
        <section class="card">
          <div class="card-head"><h2 class="card-title">Utseende</h2></div>
          <div class="seg" role="group" aria-label="Tema">
            <button type="button" data-theme-set="system" aria-pressed="${pref === 'system'}">${icon('monitor')}System</button>
            <button type="button" data-theme-set="light" aria-pressed="${pref === 'light'}">${icon('sun')}Lys</button>
            <button type="button" data-theme-set="dark" aria-pressed="${pref === 'dark'}">${icon('moon')}Mørk</button>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h2 class="card-title">Kollektiv</h2></div>
          <div class="menu-list" style="margin:0 -12px">
            <button type="button" class="menu-item" data-create>${icon('plus')}<span>Opprett et nytt kollektiv</span></button>
            <button type="button" class="menu-item" data-join>${icon('link')}<span>Bli med med kode</span></button>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h2 class="card-title">Konto</h2></div>
          <div class="menu-list" style="margin:0 -12px">
            <button type="button" class="menu-item" data-password>${icon('key')}<span>Bytt passord</span></button>
            <a class="menu-item" href="personvern.html">${icon('shield')}<span>Personvern</span></a>
            <button type="button" class="menu-item" data-signout>${icon('logout')}<span>Logg ut</span></button>
            <button type="button" class="menu-item" data-delete-account style="color:var(--neg)">${icon('trash')}<span>Slett konto</span></button>
          </div>
        </section>
      </div>
    </div>`;

  const f = qs('#me-form', view);
  let color = S.me.color;
  qsa('[data-color]', f).forEach((b) => b.addEventListener('click', () => {
    color = b.dataset.color;
    qsa('[data-color]', f).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    qs('#me-avatar', f).innerHTML = avatar({ ...S.me, display_name: qs('#me-name', f).value || S.me.display_name, color }, 'lg');
  }));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = qs('[data-error]', f);
    const display_name = qs('#me-name', f).value.trim();
    const phone = qs('#me-phone', f).value.trim() || null;
    if (!display_name) { err.textContent = 'Skriv inn navnet ditt.'; err.hidden = false; return; }
    await withBusy(e.submitter, async () => {
      try {
        await q(sb.from('profiles').update({ display_name, phone, color }).eq('id', meId()));
        S.me = { ...S.me, display_name, phone, color };
        S.people[meId()] = { ...S.people[meId()], ...S.me };
        S.members = S.members.map((m) => (isMe(m.user_id) ? { ...m, profile: S.people[meId()] } : m));
        renderShell();
        toast('Profilen er lagret');
        refresh();
      } catch (x) { err.textContent = errMsg(x); err.hidden = false; }
    });
  });

  qsa('[data-theme-set]', view).forEach((b) => b.addEventListener('click', () => {
    setThemePref(b.dataset.themeSet);
    qsa('[data-theme-set]', view).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  qs('[data-create]', view).addEventListener('click', openCreateHousehold);
  qs('[data-join]', view).addEventListener('click', openJoinHousehold);
  qs('[data-password]', view).addEventListener('click', openPasswordForm);
  qs('[data-signout]', view).addEventListener('click', signOut);
  qs('[data-delete-account]', view).addEventListener('click', deleteAccount);
}

function openPasswordForm() {
  const s = openSheet({
    title: 'Bytt passord',
    body: `<form id="pw-form" novalidate>
      <div class="field"><label class="label" for="pw1">Nytt passord</label><input class="input" id="pw1" type="password" autocomplete="new-password" minlength="8" autofocus></div>
      <div class="field"><label class="label" for="pw2">Gjenta passordet</label><input class="input" id="pw2" type="password" autocomplete="new-password" minlength="8"></div>
      <div class="form-error" data-error hidden style="margin-top:14px"></div>
    </form>`,
    foot: `<button type="button" class="btn btn-secondary" data-close>Avbryt</button><button type="submit" class="btn" form="pw-form">Lagre passord</button>`
  });
  const f = qs('#pw-form', s.el);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = qs('[data-error]', f);
    const p1 = qs('#pw1', f).value;
    const p2 = qs('#pw2', f).value;
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    if (p1.length < 8) return fail('Passordet må ha minst 8 tegn.');
    if (p1 !== p2) return fail('Passordene er ikke like.');
    await withBusy(qs('[form="pw-form"]', s.el), async () => {
      const { error } = await sb.auth.updateUser({ password: p1 });
      if (error) return fail(errMsg(error));
      s.close();
      toast('Passordet er byttet');
    });
  });
}

async function signOut() {
  try { localStorage.removeItem(HID_KEY); } catch (e) {}
  await sb.auth.signOut();
  location.replace('./');
}

async function deleteAccount() {
  const ok = await confirmSheet({
    title: 'Slette kontoen?',
    text: 'Profilen din og alt du har lagt inn slettes for godt, også utgifter du har betalt og din del av felles utgifter. Gjør opp med husfellene først. Er du den siste i et kollektiv, slettes hele kollektivet.',
    confirmLabel: 'Slett kontoen', danger: true, requireText: 'SLETT'
  });
  if (!ok) return;
  try {
    await q(sb.rpc('delete_my_account'));
    try { localStorage.removeItem(HID_KEY); } catch (e) {}
    await sb.auth.signOut();
    location.replace('./');
  } catch (x) { toast(errMsg(x), 'error'); }
}

/* =====================================================================
   OPPRETTE / BLI MED
   ===================================================================== */

function createForm(id) {
  return `<form id="${id}" novalidate>
    <div class="field"><label class="label" for="${id}-name">Navn på kollektivet</label>
      <input class="input" id="${id}-name" maxlength="60" placeholder="F.eks. Elgeseter gate 12" required></div>
    <div class="form-error" data-error hidden style="margin-top:14px"></div>
    <button type="submit" class="btn btn-block" style="margin-top:14px">Opprett kollektiv</button>
  </form>`;
}

function joinForm(id) {
  return `<form id="${id}" novalidate>
    <div class="field"><label class="label" for="${id}-code">Invitasjonskode</label>
      <input class="input num" id="${id}-code" maxlength="12" placeholder="ABCD-1234" autocomplete="off" autocapitalize="characters" spellcheck="false" style="letter-spacing:.08em;font-weight:700" required></div>
    <div class="form-error" data-error hidden style="margin-top:14px"></div>
    <button type="submit" class="btn btn-secondary btn-block" style="margin-top:14px">Bli med</button>
  </form>`;
}

function bindCreate(form, onDone) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = qs('[data-error]', form);
    const name = qs('input', form).value.trim();
    if (!name) { err.textContent = 'Gi kollektivet et navn.'; err.hidden = false; return; }
    await withBusy(e.submitter, async () => {
      try {
        const hid = await q(sb.rpc('create_household', { p_name: name }));
        if (onDone) onDone();
        await loadHouseholds();
        history.replaceState(null, '', '#/huset');
        await enterHousehold(hid);
        toast('Kollektivet er opprettet. Inviter husfellene dine.');
      } catch (x) { err.textContent = errMsg(x); err.hidden = false; }
    });
  });
}

function bindJoin(form, onDone) {
  const input = qs('input', form);
  input.addEventListener('input', () => {
    const c = normalizeCode(input.value).slice(0, 8);
    input.value = c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = qs('[data-error]', form);
    const code = normalizeCode(input.value);
    if (code.length !== 8) { err.textContent = 'Koden har 8 tegn, for eksempel ABCD-1234.'; err.hidden = false; return; }
    await withBusy(e.submitter, async () => {
      try {
        const hid = await q(sb.rpc('join_household', { p_code: code }));
        if (onDone) onDone();
        await loadHouseholds();
        history.replaceState(null, '', '#/hjem');
        await enterHousehold(hid);
        toast('Du er med i kollektivet');
      } catch (x) { err.textContent = errMsg(x); err.hidden = false; }
    });
  });
}

function openCreateHousehold() {
  const s = openSheet({ title: 'Nytt kollektiv', body: `<p class="muted" style="margin-bottom:14px;font-size:var(--fs-sm)">Du blir administrator og får en kode du kan dele med husfellene.</p>${createForm('cr-sheet')}` });
  qs('input', s.el).focus();
  bindCreate(qs('#cr-sheet', s.el), s.close);
}

function openJoinHousehold() {
  const s = openSheet({ title: 'Bli med i et kollektiv', body: `<p class="muted" style="margin-bottom:14px;font-size:var(--fs-sm)">Be en i huset om koden. Den finner de under Huset.</p>${joinForm('jn-sheet')}` });
  qs('input', s.el).focus();
  bindJoin(qs('#jn-sheet', s.el), s.close);
}

function showOnboarding() {
  qs('#boot').hidden = true;
  qs('#shell').hidden = true;
  const el = qs('#onboard');
  el.hidden = false;
  el.innerHTML = `<div class="onboard-inner">
    <div class="onboard-head">
      <span class="brand">${brandMark()}<span>Husly</span></span>
      <div style="display:flex;gap:4px">${themeToggle()}<button type="button" class="btn btn-ghost btn-sm" id="ob-out">${icon('logout', 'icon-sm')}Logg ut</button></div>
    </div>
    <h1>Velkommen, ${esc(S.me.display_name.split(/\s+/)[0])}.</h1>
    <p class="lead">Start et nytt kollektiv, eller bli med i et som husfellene dine allerede har laget.</p>
    <div class="onboard-cards">
      <section class="card">
        <div><h2>Start et kollektiv</h2><p>Du blir administrator og får en kode du deler med de andre.</p></div>
        ${createForm('ob-create')}
      </section>
      <section class="card">
        <div><h2>Bli med</h2><p>Har du fått en kode? Skriv den inn her.</p></div>
        ${joinForm('ob-join')}
      </section>
    </div>
  </div>`;
  bindCreate(qs('#ob-create', el));
  bindJoin(qs('#ob-join', el));
  qs('#ob-out', el).addEventListener('click', signOut);
}

boot();
