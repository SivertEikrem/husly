-- =====================================================================
-- Husly – databaseskjema (versjon 001)
-- Lim inn hele filen i Supabase → SQL Editor → Run.
-- Senere endringer kommer som nummererte migrasjoner (002_..., 003_...).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabeller
-- ---------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  phone        text check (phone is null or char_length(phone) <= 20),
  color        text not null default 'sky' check (char_length(color) <= 20),
  created_at   timestamptz not null default now()
);

create table public.households (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 1 and 60),
  invite_code    text not null unique,
  address        text check (char_length(address) <= 200),
  wifi_name      text check (char_length(wifi_name) <= 100),
  wifi_password  text check (char_length(wifi_password) <= 100),
  landlord_name  text check (char_length(landlord_name) <= 100),
  landlord_phone text check (char_length(landlord_phone) <= 30),
  landlord_email text check (char_length(landlord_email) <= 120),
  trash_info     text check (char_length(trash_info) <= 2000),
  rules          text check (char_length(rules) <= 4000),
  notes          text check (char_length(notes) <= 4000),
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create table public.household_members (
  household_id     uuid not null references public.households(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  role             text not null default 'member' check (role in ('admin', 'member')),
  joined_at        timestamptz not null default now(),
  messages_read_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  author_id    uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 2000),
  pinned       boolean not null default false,
  created_at   timestamptz not null default now()
);
create index messages_household_idx on public.messages (household_id, created_at desc);

create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  paid_by      uuid not null references public.profiles(id) on delete cascade,
  description  text not null check (char_length(description) between 1 and 80),
  amount_ore   bigint not null check (amount_ore > 0 and amount_ore <= 100000000),
  spent_on     date not null default current_date,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index expenses_household_idx on public.expenses (household_id, spent_on desc);

create table public.expense_shares (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  share_ore  bigint not null check (share_ore >= 0),
  primary key (expense_id, user_id)
);
create index expense_shares_user_idx on public.expense_shares (user_id);

create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  from_user    uuid not null references public.profiles(id) on delete cascade,
  to_user      uuid not null references public.profiles(id) on delete cascade,
  amount_ore   bigint not null check (amount_ore > 0 and amount_ore <= 100000000),
  note         text check (char_length(note) <= 80),
  paid_on      date not null default current_date,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (from_user <> to_user)
);
create index payments_household_idx on public.payments (household_id, paid_on desc);

create table public.events (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 80),
  starts_on    date not null,
  ends_on      date,
  start_time   time,
  end_time     time,
  location     text check (char_length(location) <= 120),
  description  text check (char_length(description) <= 1000),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index events_household_idx on public.events (household_id, starts_on);

create table public.event_attendees (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  primary key (event_id, user_id)
);

create table public.chores (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  description  text check (char_length(description) <= 300),
  every_weeks  int not null default 1 check (every_weeks between 1 and 4),
  rotation     uuid[] not null default '{}',
  start_date   date not null default (date_trunc('week', current_date))::date,
  created_at   timestamptz not null default now()
);
create index chores_household_idx on public.chores (household_id);

create table public.chore_completions (
  chore_id     uuid not null references public.chores(id) on delete cascade,
  period_start date not null,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz not null default now(),
  primary key (chore_id, period_start)
);

create table public.shopping_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  quantity     text check (char_length(quantity) <= 30),
  added_by     uuid references public.profiles(id) on delete set null,
  done         boolean not null default false,
  done_by      uuid references public.profiles(id) on delete set null,
  done_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index shopping_items_household_idx on public.shopping_items (household_id, done, created_at);

-- ---------------------------------------------------------------------
-- Hjelpefunksjoner for tilgang
-- (security definer, slik at policyene ikke går i ring)
-- ---------------------------------------------------------------------

create function public.is_member(hid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

create function public.is_admin(hid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid() and role = 'admin'
  );
$$;

create function public.is_member_of(hid uuid, uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = uid
  );
$$;

create function public.shares_household(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.household_members a
    join public.household_members b on b.household_id = a.household_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- Invitasjonskode: 8 tegn uten tegn som er lette å forveksle (0/O, 1/I/L)
create function public.gen_invite_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea;
  code text;
  i int;
begin
  loop
    bytes := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
    code := '';
    for i in 0..7 loop
      code := code || substr(alphabet, 1 + (get_byte(bytes, i * 4) % 31), 1);
    end loop;
    exit when not exists (select 1 from public.households where invite_code = code);
  end loop;
  return code;
end;
$$;

-- ---------------------------------------------------------------------
-- Triggere
-- ---------------------------------------------------------------------

-- Nytt medlem: legg personen til i rundgangen på alle oppgaver
create function public.on_member_added() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.chores
     set rotation = rotation || new.user_id
   where household_id = new.household_id
     and not (new.user_id = any (rotation));
  return null;
end;
$$;

create trigger member_added
after insert on public.household_members
for each row execute function public.on_member_added();

-- Medlem fjernet: ta personen ut av rundgangen, sørg for at det finnes
-- en administrator, og slett kollektivet hvis det er tomt
create function public.on_member_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  next_admin uuid;
begin
  if not exists (select 1 from public.households where id = old.household_id) then
    return null;
  end if;

  update public.chores
     set rotation = array_remove(rotation, old.user_id)
   where household_id = old.household_id
     and old.user_id = any (rotation);

  if not exists (select 1 from public.household_members where household_id = old.household_id) then
    delete from public.households where id = old.household_id;
  elsif not exists (
    select 1 from public.household_members
    where household_id = old.household_id and role = 'admin'
  ) then
    select user_id into next_admin
      from public.household_members
     where household_id = old.household_id
     order by joined_at
     limit 1;
    update public.household_members
       set role = 'admin'
     where household_id = old.household_id and user_id = next_admin;
  end if;
  return null;
end;
$$;

create trigger member_removed
after delete on public.household_members
for each row execute function public.on_member_removed();

-- Oppgaver: fyll inn rundgang hvis den mangler, og sjekk at den er gyldig
create function public.before_chore_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  members uuid[];
  n int;
  offset_by int;
begin
  if tg_op = 'INSERT' and cardinality(new.rotation) = 0 then
    select coalesce(array_agg(user_id order by joined_at, user_id), '{}')
      into members
      from public.household_members
     where household_id = new.household_id;
    n := cardinality(members);
    if n > 0 then
      select count(*) % n into offset_by
        from public.chores where household_id = new.household_id;
      new.rotation := members[offset_by + 1 : n] || members[1 : offset_by];
    end if;
  end if;

  if (select count(distinct u) from unnest(new.rotation) u) <> cardinality(new.rotation) then
    raise exception 'Samme person kan bare stå én gang i rundgangen';
  end if;

  if exists (
    select 1 from unnest(new.rotation) u
    where not exists (
      select 1 from public.household_members m
      where m.household_id = new.household_id and m.user_id = u
    )
  ) then
    raise exception 'Alle i rundgangen må være medlemmer av kollektivet';
  end if;

  if tg_op = 'UPDATE' and new.household_id <> old.household_id then
    raise exception 'Kan ikke flytte en oppgave til et annet kollektiv';
  end if;

  return new;
end;
$$;

create trigger chore_write
before insert or update on public.chores
for each row execute function public.before_chore_write();

-- ---------------------------------------------------------------------
-- Funksjoner som nettsiden kaller (RPC)
-- ---------------------------------------------------------------------

-- Lager profilen første gang brukeren logger inn
create function public.ensure_profile() returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  v_name text;
  colors constant text[] := array['sky','moss','ember','plum','rose','teal','amber','slate'];
begin
  if auth.uid() is null then
    raise exception 'Du må være logget inn';
  end if;

  select * into p from public.profiles where id = auth.uid();
  if found then
    return p;
  end if;

  select coalesce(nullif(trim(raw_user_meta_data ->> 'display_name'), ''),
                  split_part(email, '@', 1))
    into v_name
    from auth.users where id = auth.uid();

  insert into public.profiles (id, display_name, color)
  values (auth.uid(),
          left(coalesce(nullif(v_name, ''), 'Ny bruker'), 40),
          colors[1 + floor(random() * 8)::int])
  on conflict (id) do nothing;

  select * into p from public.profiles where id = auth.uid();
  return p;
end;
$$;

create function public.create_household(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  hid uuid;
begin
  perform public.ensure_profile();
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Gi kollektivet et navn';
  end if;
  insert into public.households (name, invite_code, created_by)
  values (left(trim(p_name), 60), public.gen_invite_code(), auth.uid())
  returning id into hid;
  insert into public.household_members (household_id, user_id, role)
  values (hid, auth.uid(), 'admin');
  return hid;
end;
$$;

create function public.join_household(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  hid uuid;
  code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  perform public.ensure_profile();
  select id into hid from public.households where invite_code = code;
  if hid is null then
    raise exception 'Fant ingen kollektiv med den koden';
  end if;
  if exists (select 1 from public.household_members where household_id = hid and user_id = auth.uid()) then
    return hid;
  end if;
  if (select count(*) from public.household_members where household_id = hid) >= 30 then
    raise exception 'Kollektivet er fullt (maks 30 medlemmer)';
  end if;
  insert into public.household_members (household_id, user_id, role)
  values (hid, auth.uid(), 'member');
  return hid;
end;
$$;

create function public.regenerate_invite_code(hid uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  code text;
begin
  if not public.is_admin(hid) then
    raise exception 'Bare administratorer kan lage ny kode';
  end if;
  code := public.gen_invite_code();
  update public.households set invite_code = code where id = hid;
  return code;
end;
$$;

create function public.leave_household(hid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.household_members
   where household_id = hid and user_id = auth.uid();
end;
$$;

create function public.remove_member(hid uuid, uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(hid) then
    raise exception 'Bare administratorer kan fjerne medlemmer';
  end if;
  if uid = auth.uid() then
    raise exception 'Bruk «Forlat kollektivet» for å fjerne deg selv';
  end if;
  delete from public.household_members where household_id = hid and user_id = uid;
end;
$$;

create function public.set_member_role(hid uuid, uid uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(hid) then
    raise exception 'Bare administratorer kan endre roller';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'Ugyldig rolle';
  end if;
  if p_role = 'member' and (
    select count(*) from public.household_members
    where household_id = hid and role = 'admin' and user_id <> uid
  ) = 0 then
    raise exception 'Kollektivet må ha minst én administrator';
  end if;
  update public.household_members set role = p_role
   where household_id = hid and user_id = uid;
end;
$$;

create function public.delete_household(hid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(hid) then
    raise exception 'Bare administratorer kan slette kollektivet';
  end if;
  delete from public.households where id = hid;
end;
$$;

create function public.mark_messages_read(hid uuid) returns void
language sql security definer set search_path = '' as $$
  update public.household_members
     set messages_read_at = now()
   where household_id = hid and user_id = auth.uid();
$$;

create function public.add_expense(
  p_household    uuid,
  p_description  text,
  p_amount_ore   bigint,
  p_paid_by      uuid,
  p_participants uuid[],
  p_spent_on     date default current_date
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  eid uuid;
  n int;
  base bigint;
  rest bigint;
  i int := 0;
  uid uuid;
begin
  if not public.is_member(p_household) then
    raise exception 'Du er ikke medlem av dette kollektivet';
  end if;
  if not public.is_member_of(p_household, p_paid_by) then
    raise exception 'Den som betalte må være medlem av kollektivet';
  end if;
  n := cardinality(p_participants);
  if n is null or n = 0 then
    raise exception 'Velg minst én person å dele med';
  end if;
  if (select count(distinct u) from unnest(p_participants) u) <> n then
    raise exception 'Samme person er valgt flere ganger';
  end if;
  if exists (select 1 from unnest(p_participants) u where not public.is_member_of(p_household, u)) then
    raise exception 'Alle du deler med må være medlemmer av kollektivet';
  end if;
  if p_amount_ore is null or p_amount_ore <= 0 then
    raise exception 'Beløpet må være større enn null';
  end if;

  insert into public.expenses (household_id, paid_by, description, amount_ore, spent_on, created_by)
  values (p_household, p_paid_by, left(trim(p_description), 80), p_amount_ore,
          coalesce(p_spent_on, current_date), auth.uid())
  returning id into eid;

  base := p_amount_ore / n;
  rest := p_amount_ore % n;
  for uid in select u from unnest(p_participants) u order by u loop
    insert into public.expense_shares (expense_id, user_id, share_ore)
    values (eid, uid, base + case when i < rest then 1 else 0 end);
    i := i + 1;
  end loop;

  return eid;
end;
$$;

-- Saldo per person: positivt tall = får penger, negativt = skylder
create function public.household_balances(hid uuid)
returns table (user_id uuid, display_name text, color text, is_member boolean, balance_ore bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_member(hid) then
    raise exception 'Du er ikke medlem av dette kollektivet';
  end if;
  return query
  with rows as (
    select e.paid_by as uid, s.share_ore as amt
      from public.expenses e join public.expense_shares s on s.expense_id = e.id
     where e.household_id = hid
    union all
    select s.user_id, -s.share_ore
      from public.expenses e join public.expense_shares s on s.expense_id = e.id
     where e.household_id = hid
    union all
    select p.from_user, p.amount_ore from public.payments p where p.household_id = hid
    union all
    select p.to_user, -p.amount_ore from public.payments p where p.household_id = hid
    union all
    select m.user_id, 0::bigint from public.household_members m where m.household_id = hid
  )
  select r.uid,
         pr.display_name,
         pr.color,
         exists (select 1 from public.household_members m
                  where m.household_id = hid and m.user_id = r.uid),
         sum(r.amt)::bigint
    from rows r
    join public.profiles pr on pr.id = r.uid
   group by r.uid, pr.display_name, pr.color;
end;
$$;

-- Vaskeliste: hvem har hvilken oppgave i hver periode, og om den er gjort
create function public.chore_schedule(hid uuid, p_from date, p_weeks int default 1)
returns table (chore_id uuid, period_start date, period_end date, assignee uuid,
               completed_by uuid, completed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_member(hid) then
    raise exception 'Du er ikke medlem av dette kollektivet';
  end if;
  return query
  select c.id,
         ps.pstart,
         ps.pstart + c.every_weeks * 7 - 1,
         case when cardinality(c.rotation) = 0 then null
              else c.rotation[(((ps.k % cardinality(c.rotation)) + cardinality(c.rotation))
                               % cardinality(c.rotation)) + 1]
         end,
         cc.completed_by,
         cc.completed_at
    from public.chores c
    cross join lateral (
      select k, c.start_date + k * c.every_weeks * 7 as pstart
        from generate_series(
               floor((p_from - c.start_date)::numeric / (c.every_weeks * 7))::int,
               floor((p_from + greatest(p_weeks, 1) * 7 - 1 - c.start_date)::numeric
                     / (c.every_weeks * 7))::int
             ) as k
    ) ps
    left join public.chore_completions cc
           on cc.chore_id = c.id and cc.period_start = ps.pstart
   where c.household_id = hid
   order by ps.pstart, c.created_at;
end;
$$;

-- Sletter brukeren og alt som hører til (kaskade via profiles)
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Du må være logget inn';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.messages          enable row level security;
alter table public.expenses          enable row level security;
alter table public.expense_shares    enable row level security;
alter table public.payments          enable row level security;
alter table public.events            enable row level security;
alter table public.event_attendees   enable row level security;
alter table public.chores            enable row level security;
alter table public.chore_completions enable row level security;
alter table public.shopping_items    enable row level security;

-- profiles
create policy "profiles_select" on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_household(id));
create policy "profiles_update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- households (opprettes og slettes bare via funksjonene over)
create policy "households_select" on public.households for select to authenticated
  using (public.is_member(id));
create policy "households_update" on public.households for update to authenticated
  using (public.is_member(id)) with check (public.is_member(id));

-- household_members (endres bare via funksjonene over)
create policy "members_select" on public.household_members for select to authenticated
  using (public.is_member(household_id));

-- messages
create policy "messages_select" on public.messages for select to authenticated
  using (public.is_member(household_id));
create policy "messages_insert" on public.messages for insert to authenticated
  with check (public.is_member(household_id) and author_id = auth.uid());
create policy "messages_update" on public.messages for update to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "messages_delete" on public.messages for delete to authenticated
  using (author_id = auth.uid() or public.is_admin(household_id));

-- expenses (opprettes via add_expense)
create policy "expenses_select" on public.expenses for select to authenticated
  using (public.is_member(household_id));
create policy "expenses_delete" on public.expenses for delete to authenticated
  using (public.is_member(household_id)
         and (created_by = auth.uid() or paid_by = auth.uid() or public.is_admin(household_id)));

create policy "expense_shares_select" on public.expense_shares for select to authenticated
  using (exists (select 1 from public.expenses e
                 where e.id = expense_id and public.is_member(e.household_id)));

-- payments
create policy "payments_select" on public.payments for select to authenticated
  using (public.is_member(household_id));
create policy "payments_insert" on public.payments for insert to authenticated
  with check (public.is_member(household_id)
              and created_by = auth.uid()
              and (from_user = auth.uid() or to_user = auth.uid())
              and public.is_member_of(household_id, from_user)
              and public.is_member_of(household_id, to_user));
create policy "payments_delete" on public.payments for delete to authenticated
  using (public.is_member(household_id)
         and (created_by = auth.uid() or public.is_admin(household_id)));

-- events
create policy "events_select" on public.events for select to authenticated
  using (public.is_member(household_id));
create policy "events_insert" on public.events for insert to authenticated
  with check (public.is_member(household_id) and created_by = auth.uid());
create policy "events_update" on public.events for update to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "events_delete" on public.events for delete to authenticated
  using (public.is_member(household_id)
         and (created_by = auth.uid() or public.is_admin(household_id)));

create policy "attendees_select" on public.event_attendees for select to authenticated
  using (exists (select 1 from public.events e
                 where e.id = event_id and public.is_member(e.household_id)));
create policy "attendees_insert" on public.event_attendees for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.events e
                          where e.id = event_id and public.is_member(e.household_id)));
create policy "attendees_delete" on public.event_attendees for delete to authenticated
  using (user_id = auth.uid());

-- chores
create policy "chores_select" on public.chores for select to authenticated
  using (public.is_member(household_id));
create policy "chores_insert" on public.chores for insert to authenticated
  with check (public.is_member(household_id));
create policy "chores_update" on public.chores for update to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "chores_delete" on public.chores for delete to authenticated
  using (public.is_member(household_id));

create policy "completions_select" on public.chore_completions for select to authenticated
  using (exists (select 1 from public.chores c
                 where c.id = chore_id and public.is_member(c.household_id)));
create policy "completions_insert" on public.chore_completions for insert to authenticated
  with check (completed_by = auth.uid()
              and exists (select 1 from public.chores c
                          where c.id = chore_id and public.is_member(c.household_id)));
create policy "completions_delete" on public.chore_completions for delete to authenticated
  using (exists (select 1 from public.chores c
                 where c.id = chore_id and public.is_member(c.household_id)));

-- shopping_items
create policy "shopping_select" on public.shopping_items for select to authenticated
  using (public.is_member(household_id));
create policy "shopping_insert" on public.shopping_items for insert to authenticated
  with check (public.is_member(household_id) and added_by = auth.uid());
create policy "shopping_update" on public.shopping_items for update to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "shopping_delete" on public.shopping_items for delete to authenticated
  using (public.is_member(household_id));

-- ---------------------------------------------------------------------
-- Rettigheter
-- Ingenting for anon. Innloggede brukere får bare det de trenger,
-- og noen kolonner kan bare endres via funksjonene over.
-- ---------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, phone, color) on public.profiles to authenticated;

grant select on public.households to authenticated;
grant update (name, address, wifi_name, wifi_password, landlord_name, landlord_phone,
              landlord_email, trash_info, rules, notes) on public.households to authenticated;

grant select on public.household_members to authenticated;

grant select, insert, delete on public.messages to authenticated;
grant update (pinned) on public.messages to authenticated;

grant select, delete on public.expenses to authenticated;
grant select on public.expense_shares to authenticated;

grant select, insert, delete on public.payments to authenticated;

grant select, insert, delete on public.events to authenticated;
grant update (title, starts_on, ends_on, start_time, end_time, location, description)
  on public.events to authenticated;
grant select, insert, delete on public.event_attendees to authenticated;

grant select, insert, delete on public.chores to authenticated;
grant update (name, description, every_weeks, rotation) on public.chores to authenticated;
grant select, insert, delete on public.chore_completions to authenticated;

grant select, insert, delete on public.shopping_items to authenticated;
grant update (name, quantity, done, done_by, done_at) on public.shopping_items to authenticated;

grant execute on function public.ensure_profile()                              to authenticated;
grant execute on function public.create_household(text)                        to authenticated;
grant execute on function public.join_household(text)                          to authenticated;
grant execute on function public.regenerate_invite_code(uuid)                  to authenticated;
grant execute on function public.leave_household(uuid)                         to authenticated;
grant execute on function public.remove_member(uuid, uuid)                     to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text)             to authenticated;
grant execute on function public.delete_household(uuid)                        to authenticated;
grant execute on function public.mark_messages_read(uuid)                      to authenticated;
grant execute on function public.add_expense(uuid, text, bigint, uuid, uuid[], date) to authenticated;
grant execute on function public.household_balances(uuid)                      to authenticated;
grant execute on function public.chore_schedule(uuid, date, int)               to authenticated;
grant execute on function public.delete_my_account()                           to authenticated;
-- Brukes inne i policyene
grant execute on function public.is_member(uuid)                               to authenticated;
grant execute on function public.is_admin(uuid)                                to authenticated;
grant execute on function public.is_member_of(uuid, uuid)                      to authenticated;
grant execute on function public.shares_household(uuid)                        to authenticated;

-- ---------------------------------------------------------------------
-- Sanntid: beskjeder og handleliste oppdateres live hos alle i huset
-- ---------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.shopping_items;
  end if;
end;
$$;

notify pgrst, 'reload schema';
