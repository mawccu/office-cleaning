-- ============================================================
--  THE OFFICE — ONE-SHOT DATABASE SETUP
--
--  Run this ONCE in the Supabase SQL Editor and the whole app is ready:
--  cleaning (underbidding + helpers), requests/favors, resources,
--  projects (roles + slots), and the crew wall.
--
--  Safe on a live database: it only ADDS things, never drops your data,
--  and is idempotent (running it again is harmless). It assumes the
--  original cleaning schema (users, bids, _require, auth_user) is already
--  in place from schema.sql.
--
--  This single file supersedes migrate_offers_helpers.sql + favors.sql —
--  you only need to run setup.sql.
-- ============================================================

-- Make sure the identity helper exists (idempotent).
create or replace function public._require(p_name text, p_pin text)
returns text
language plpgsql security definer set search_path = public as $$
begin
  p_name := btrim(p_name);
  if not exists (select 1 from public.users where name = p_name and pin = p_pin) then
    raise exception 'Wrong name or PIN';
  end if;
  return p_name;
end;
$$;

-- ============================================================
--  1) CLEANING — underbidding (lowest offer wins) + helpers (split)
-- ============================================================
alter table public.bids add column if not exists posted_amount numeric;
update public.bids set posted_amount = amount where posted_amount is null;
alter table public.bids alter column posted_amount set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bids_posted_amount_check') then
    alter table public.bids add constraint bids_posted_amount_check check (posted_amount > 0);
  end if;
end $$;

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bids(id) on delete cascade,
  cleaner_name text not null,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (bid_id, cleaner_name)
);

create table if not exists public.helpers (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bids(id) on delete cascade,
  helper_name text not null,
  invited_by text not null,
  status text not null default 'invited' check (status in ('invited','accepted')),
  created_at timestamptz not null default now(),
  unique (bid_id, helper_name)
);

create or replace function public._sync_leader(p_bid_id uuid)
returns public.bids language plpgsql security definer set search_path = public as $$
declare v_bid public.bids; v_name text; v_amt numeric;
begin
  select cleaner_name, amount into v_name, v_amt from public.offers
    where bid_id = p_bid_id order by amount asc, created_at asc limit 1;
  if v_name is null then
    update public.bids b set claimed_by = null, amount = b.posted_amount where id = p_bid_id returning * into v_bid;
  else
    update public.bids set claimed_by = v_name, amount = v_amt where id = p_bid_id returning * into v_bid;
  end if;
  return v_bid;
end; $$;

create or replace function public.place_bid(p_name text, p_pin text, p_amount numeric, p_rooms jsonb, p_due_at timestamptz, p_tasks jsonb, p_note text)
returns public.bids language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than 0'; end if;
  if p_rooms is null or jsonb_array_length(p_rooms) = 0 then raise exception 'Pick at least one room'; end if;
  insert into public.bids(bidder_name, amount, posted_amount, rooms, due_at, tasks, note)
    values (v_name, p_amount, p_amount, p_rooms, p_due_at, coalesce(p_tasks, '[]'::jsonb), p_note)
    returning * into v_bid;
  return v_bid;
end; $$;

create or replace function public.edit_bid(p_name text, p_pin text, p_bid_id uuid, p_amount numeric, p_due_at timestamptz, p_tasks jsonb, p_note text)
returns public.bids language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_bid from public.bids where id = p_bid_id;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.bidder_name <> v_name then raise exception 'Only the bidder can edit this'; end if;
  if v_bid.status <> 'open' then raise exception 'Bid already claimed'; end if;
  if exists (select 1 from public.offers where bid_id = p_bid_id) then raise exception 'Cannot change the price once cleaners have made offers'; end if;
  update public.bids set amount = coalesce(p_amount, amount), posted_amount = coalesce(p_amount, posted_amount),
    due_at = p_due_at, tasks = coalesce(p_tasks, tasks), note = p_note where id = p_bid_id returning * into v_bid;
  return v_bid;
end; $$;

create or replace function public.place_offer(p_name text, p_pin text, p_bid_id uuid, p_amount numeric)
returns public.bids language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_bid from public.bids where id = p_bid_id for update;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.status <> 'open' then raise exception 'This job is no longer open for offers'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Offer must be greater than 0'; end if;
  if p_amount >= v_bid.amount then raise exception 'Your offer must be lower than the current price (% )', v_bid.amount; end if;
  insert into public.offers(bid_id, cleaner_name, amount) values (p_bid_id, v_name, p_amount)
    on conflict (bid_id, cleaner_name) do update set amount = excluded.amount, created_at = now();
  v_bid := public._sync_leader(p_bid_id);
  return v_bid;
end; $$;

create or replace function public.retract_offer(p_name text, p_pin text, p_bid_id uuid)
returns public.bids language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_bid from public.bids where id = p_bid_id for update;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.status <> 'open' then raise exception 'The auction is already closed'; end if;
  delete from public.offers where bid_id = p_bid_id and cleaner_name = v_name;
  v_bid := public._sync_leader(p_bid_id);
  return v_bid;
end; $$;

create or replace function public.claim_bid(p_name text, p_pin text, p_bid_id uuid)
returns public.bids language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids; v_has_offers boolean;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_bid from public.bids where id = p_bid_id for update;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.status <> 'open' then raise exception 'Already claimed'; end if;
  v_has_offers := exists (select 1 from public.offers where bid_id = p_bid_id);
  if v_has_offers then
    if v_bid.claimed_by is distinct from v_name then raise exception 'The lowest offer (by %) holds this job — undercut it to take it', v_bid.claimed_by; end if;
    update public.bids set status = 'claimed' where id = p_bid_id returning * into v_bid;
  else
    update public.bids set status = 'claimed', claimed_by = v_name, amount = posted_amount where id = p_bid_id returning * into v_bid;
  end if;
  delete from public.offers where bid_id = p_bid_id;
  return v_bid;
end; $$;

create or replace function public.unclaim_bid(p_name text, p_pin text, p_bid_id uuid)
returns public.bids language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_bid from public.bids where id = p_bid_id;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.claimed_by <> v_name then raise exception 'Only the claimer can un-claim'; end if;
  if v_bid.status <> 'claimed' then raise exception 'Cannot un-claim now'; end if;
  delete from public.helpers where bid_id = p_bid_id;
  update public.bids set status = 'open', claimed_by = null, amount = posted_amount, scheduled_for = null where id = p_bid_id returning * into v_bid;
  return v_bid;
end; $$;

create or replace function public.invite_helper(p_name text, p_pin text, p_bid_id uuid, p_helper text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  p_helper := btrim(p_helper);
  if length(p_helper) = 0 then raise exception 'Helper name required'; end if;
  select * into v_bid from public.bids where id = p_bid_id;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.claimed_by <> v_name then raise exception 'Only the claimer can invite helpers'; end if;
  if v_bid.status not in ('claimed','cleaned') then raise exception 'Can only invite while the job is active'; end if;
  if lower(p_helper) = lower(v_name) then raise exception 'You are already on this job'; end if;
  if p_helper = v_bid.bidder_name then raise exception 'The poster cannot be a paid helper'; end if;
  insert into public.helpers(bid_id, helper_name, invited_by, status) values (p_bid_id, p_helper, v_name, 'invited')
    on conflict (bid_id, helper_name) do nothing;
end; $$;

create or replace function public.respond_invite(p_name text, p_pin text, p_bid_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  v_name := public._require(p_name, p_pin);
  if not exists (select 1 from public.helpers where bid_id = p_bid_id and helper_name = v_name) then raise exception 'No invite for you on this job'; end if;
  if p_accept then update public.helpers set status = 'accepted' where bid_id = p_bid_id and helper_name = v_name;
  else delete from public.helpers where bid_id = p_bid_id and helper_name = v_name; end if;
end; $$;

create or replace function public.remove_helper(p_name text, p_pin text, p_bid_id uuid, p_helper text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  p_helper := btrim(p_helper);
  select * into v_bid from public.bids where id = p_bid_id;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.claimed_by <> v_name and p_helper <> v_name then raise exception 'Only the claimer or the helper themselves can remove this'; end if;
  delete from public.helpers where bid_id = p_bid_id and helper_name = p_helper;
end; $$;

-- ============================================================
--  2) REQUESTS & FAVORS  (tea / errands, optional reward)
-- ============================================================
create table if not exists public.favors (
  id uuid primary key default gen_random_uuid(),
  poster_name text not null,
  title text not null,
  note text,
  category text not null default 'other' check (category in ('tea','errand','other')),
  reward numeric not null default 0 check (reward >= 0),
  status text not null default 'open' check (status in ('open','claimed','done','paid')),
  claimed_by text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz, done_at timestamptz, paid_at timestamptz
);

create or replace function public.post_favor(p_name text, p_pin text, p_title text, p_note text, p_category text, p_reward numeric)
returns public.favors language plpgsql security definer set search_path = public as $$
declare v_name text; v_fav public.favors;
begin
  v_name := public._require(p_name, p_pin);
  p_title := btrim(p_title);
  if length(p_title) = 0 then raise exception 'Say what you need'; end if;
  if p_reward is null or p_reward < 0 then p_reward := 0; end if;
  if p_category is null or p_category not in ('tea','errand','other') then p_category := 'other'; end if;
  insert into public.favors(poster_name, title, note, category, reward)
    values (v_name, p_title, nullif(btrim(p_note), ''), p_category, p_reward) returning * into v_fav;
  return v_fav;
end; $$;

create or replace function public.edit_favor(p_name text, p_pin text, p_id uuid, p_title text, p_note text, p_category text, p_reward numeric)
returns public.favors language plpgsql security definer set search_path = public as $$
declare v_name text; v_fav public.favors;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_fav from public.favors where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if v_fav.poster_name <> v_name then raise exception 'Only the poster can edit this'; end if;
  if v_fav.status <> 'open' then raise exception 'Already claimed'; end if;
  if p_reward is null or p_reward < 0 then p_reward := v_fav.reward; end if;
  if p_category is null or p_category not in ('tea','errand','other') then p_category := v_fav.category; end if;
  update public.favors set title = coalesce(nullif(btrim(p_title), ''), title), note = nullif(btrim(p_note), ''),
    category = p_category, reward = p_reward where id = p_id returning * into v_fav;
  return v_fav;
end; $$;

create or replace function public.cancel_favor(p_name text, p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_fav public.favors;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_fav from public.favors where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if v_fav.poster_name <> v_name then raise exception 'Only the poster can cancel this'; end if;
  if v_fav.status <> 'open' then raise exception 'Already claimed'; end if;
  delete from public.favors where id = p_id;
end; $$;

create or replace function public.claim_favor(p_name text, p_pin text, p_id uuid)
returns public.favors language plpgsql security definer set search_path = public as $$
declare v_name text; v_fav public.favors;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_fav from public.favors where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_fav.status <> 'open' then raise exception 'Already claimed'; end if;
  update public.favors set status = 'claimed', claimed_by = v_name, claimed_at = now() where id = p_id returning * into v_fav;
  return v_fav;
end; $$;

create or replace function public.unclaim_favor(p_name text, p_pin text, p_id uuid)
returns public.favors language plpgsql security definer set search_path = public as $$
declare v_name text; v_fav public.favors;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_fav from public.favors where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if v_fav.claimed_by <> v_name then raise exception 'Only the person on it can un-claim'; end if;
  if v_fav.status <> 'claimed' then raise exception 'Cannot un-claim now'; end if;
  update public.favors set status = 'open', claimed_by = null, claimed_at = null where id = p_id returning * into v_fav;
  return v_fav;
end; $$;

create or replace function public.mark_favor_done(p_name text, p_pin text, p_id uuid)
returns public.favors language plpgsql security definer set search_path = public as $$
declare v_name text; v_fav public.favors;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_fav from public.favors where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if v_fav.claimed_by <> v_name then raise exception 'Only the person on it can mark it done'; end if;
  if v_fav.status <> 'claimed' then raise exception 'Not in progress'; end if;
  update public.favors set status = 'done', done_at = now() where id = p_id returning * into v_fav;
  return v_fav;
end; $$;

create or replace function public.mark_favor_paid(p_name text, p_pin text, p_id uuid)
returns public.favors language plpgsql security definer set search_path = public as $$
declare v_name text; v_fav public.favors;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_fav from public.favors where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if v_fav.poster_name <> v_name then raise exception 'Only the poster can mark it paid'; end if;
  if v_fav.status <> 'done' then raise exception 'Not done yet'; end if;
  if v_fav.reward <= 0 then raise exception 'This favor has no reward to pay'; end if;
  update public.favors set status = 'paid', paid_at = now() where id = p_id returning * into v_fav;
  return v_fav;
end; $$;

-- ============================================================
--  3) RESOURCES  (supplies / gear the office needs)
-- ============================================================
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  poster_name text not null,
  item text not null,
  qty text,
  note text,
  urgency text not null default 'normal' check (urgency in ('normal','urgent')),
  reward numeric not null default 0 check (reward >= 0),
  status text not null default 'open' check (status in ('open','claimed','done','paid')),
  claimed_by text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz, done_at timestamptz, paid_at timestamptz
);

create or replace function public.post_resource(p_name text, p_pin text, p_item text, p_qty text, p_note text, p_urgency text, p_reward numeric)
returns public.resources language plpgsql security definer set search_path = public as $$
declare v_name text; v_r public.resources;
begin
  v_name := public._require(p_name, p_pin);
  p_item := btrim(p_item);
  if length(p_item) = 0 then raise exception 'Say what the office needs'; end if;
  if p_reward is null or p_reward < 0 then p_reward := 0; end if;
  if p_urgency is null or p_urgency not in ('normal','urgent') then p_urgency := 'normal'; end if;
  insert into public.resources(poster_name, item, qty, note, urgency, reward)
    values (v_name, p_item, nullif(btrim(p_qty), ''), nullif(btrim(p_note), ''), p_urgency, p_reward) returning * into v_r;
  return v_r;
end; $$;

create or replace function public.edit_resource(p_name text, p_pin text, p_id uuid, p_item text, p_qty text, p_note text, p_urgency text, p_reward numeric)
returns public.resources language plpgsql security definer set search_path = public as $$
declare v_name text; v_r public.resources;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_r from public.resources where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if v_r.poster_name <> v_name then raise exception 'Only the poster can edit this'; end if;
  if v_r.status <> 'open' then raise exception 'Already claimed'; end if;
  if p_reward is null or p_reward < 0 then p_reward := v_r.reward; end if;
  if p_urgency is null or p_urgency not in ('normal','urgent') then p_urgency := v_r.urgency; end if;
  update public.resources set item = coalesce(nullif(btrim(p_item), ''), item), qty = nullif(btrim(p_qty), ''),
    note = nullif(btrim(p_note), ''), urgency = p_urgency, reward = p_reward where id = p_id returning * into v_r;
  return v_r;
end; $$;

create or replace function public.cancel_resource(p_name text, p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_r public.resources;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_r from public.resources where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if v_r.poster_name <> v_name then raise exception 'Only the poster can cancel this'; end if;
  if v_r.status <> 'open' then raise exception 'Already claimed'; end if;
  delete from public.resources where id = p_id;
end; $$;

create or replace function public.claim_resource(p_name text, p_pin text, p_id uuid)
returns public.resources language plpgsql security definer set search_path = public as $$
declare v_name text; v_r public.resources;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_r from public.resources where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_r.status <> 'open' then raise exception 'Already claimed'; end if;
  update public.resources set status = 'claimed', claimed_by = v_name, claimed_at = now() where id = p_id returning * into v_r;
  return v_r;
end; $$;

create or replace function public.unclaim_resource(p_name text, p_pin text, p_id uuid)
returns public.resources language plpgsql security definer set search_path = public as $$
declare v_name text; v_r public.resources;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_r from public.resources where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if v_r.claimed_by <> v_name then raise exception 'Only the person on it can un-claim'; end if;
  if v_r.status <> 'claimed' then raise exception 'Cannot un-claim now'; end if;
  update public.resources set status = 'open', claimed_by = null, claimed_at = null where id = p_id returning * into v_r;
  return v_r;
end; $$;

create or replace function public.mark_resource_got(p_name text, p_pin text, p_id uuid)
returns public.resources language plpgsql security definer set search_path = public as $$
declare v_name text; v_r public.resources;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_r from public.resources where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if v_r.claimed_by <> v_name then raise exception 'Only the person on it can mark it got'; end if;
  if v_r.status <> 'claimed' then raise exception 'Not in progress'; end if;
  update public.resources set status = 'done', done_at = now() where id = p_id returning * into v_r;
  return v_r;
end; $$;

create or replace function public.mark_resource_paid(p_name text, p_pin text, p_id uuid)
returns public.resources language plpgsql security definer set search_path = public as $$
declare v_name text; v_r public.resources;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_r from public.resources where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if v_r.poster_name <> v_name then raise exception 'Only the poster can mark it paid'; end if;
  if v_r.status <> 'done' then raise exception 'Not got yet'; end if;
  if v_r.reward <= 0 then raise exception 'This request has no reward to pay'; end if;
  update public.resources set status = 'paid', paid_at = now() where id = p_id returning * into v_r;
  return v_r;
end; $$;

-- ============================================================
--  4) PROJECTS  (roles + slots, "see who's in")
-- ============================================================
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_name text not null,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open','active','done')),
  created_at timestamptz not null default now()
);
create table if not exists public.project_roles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  role text not null,
  slots int not null default 1 check (slots >= 1),
  created_at timestamptz not null default now(),
  unique (project_id, role)
);
create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  member_name text not null,
  role text,
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  unique (project_id, member_name)
);

-- p_roles is a jsonb array like: [{"role":"Design","slots":2},{"role":"Dev","slots":1}]
create or replace function public.create_project(p_name text, p_pin text, p_title text, p_desc text, p_roles jsonb)
returns public.projects language plpgsql security definer set search_path = public as $$
declare v_name text; v_proj public.projects; r jsonb;
begin
  v_name := public._require(p_name, p_pin);
  p_title := btrim(p_title);
  if length(p_title) = 0 then raise exception 'Give the project a name'; end if;
  insert into public.projects(owner_name, title, description)
    values (v_name, p_title, nullif(btrim(p_desc), '')) returning * into v_proj;
  if p_roles is not null then
    for r in select * from jsonb_array_elements(p_roles) loop
      if length(btrim(coalesce(r->>'role',''))) > 0 then
        insert into public.project_roles(project_id, role, slots)
          values (v_proj.id, btrim(r->>'role'), greatest(1, coalesce((r->>'slots')::int, 1)))
          on conflict (project_id, role) do nothing;
      end if;
    end loop;
  end if;
  insert into public.project_members(project_id, member_name, role, is_owner)
    values (v_proj.id, v_name, 'owner', true);
  return v_proj;
end; $$;

create or replace function public.edit_project(p_name text, p_pin text, p_id uuid, p_title text, p_desc text)
returns public.projects language plpgsql security definer set search_path = public as $$
declare v_name text; v_proj public.projects;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_proj from public.projects where id = p_id;
  if not found then raise exception 'Project not found'; end if;
  if v_proj.owner_name <> v_name then raise exception 'Only the owner can edit this'; end if;
  update public.projects set title = coalesce(nullif(btrim(p_title), ''), title), description = nullif(btrim(p_desc), '')
    where id = p_id returning * into v_proj;
  return v_proj;
end; $$;

create or replace function public.set_project_status(p_name text, p_pin text, p_id uuid, p_status text)
returns public.projects language plpgsql security definer set search_path = public as $$
declare v_name text; v_proj public.projects;
begin
  v_name := public._require(p_name, p_pin);
  if p_status not in ('open','active','done') then raise exception 'Bad status'; end if;
  select * into v_proj from public.projects where id = p_id;
  if not found then raise exception 'Project not found'; end if;
  if v_proj.owner_name <> v_name then raise exception 'Only the owner can change status'; end if;
  update public.projects set status = p_status where id = p_id returning * into v_proj;
  return v_proj;
end; $$;

create or replace function public.cancel_project(p_name text, p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_proj public.projects;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_proj from public.projects where id = p_id;
  if not found then raise exception 'Project not found'; end if;
  if v_proj.owner_name <> v_name then raise exception 'Only the owner can delete this'; end if;
  delete from public.projects where id = p_id;
end; $$;

create or replace function public.add_role(p_name text, p_pin text, p_id uuid, p_role text, p_slots int)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_proj public.projects;
begin
  v_name := public._require(p_name, p_pin);
  p_role := btrim(p_role);
  if length(p_role) = 0 then raise exception 'Role name required'; end if;
  select * into v_proj from public.projects where id = p_id;
  if not found then raise exception 'Project not found'; end if;
  if v_proj.owner_name <> v_name then raise exception 'Only the owner can add roles'; end if;
  insert into public.project_roles(project_id, role, slots) values (p_id, p_role, greatest(1, coalesce(p_slots, 1)))
    on conflict (project_id, role) do update set slots = greatest(1, coalesce(p_slots, 1));
end; $$;

create or replace function public.remove_role(p_name text, p_pin text, p_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_proj public.projects;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_proj from public.projects where id = p_id;
  if not found then raise exception 'Project not found'; end if;
  if v_proj.owner_name <> v_name then raise exception 'Only the owner can remove roles'; end if;
  delete from public.project_roles where project_id = p_id and role = btrim(p_role);
end; $$;

create or replace function public.join_project(p_name text, p_pin text, p_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_proj public.projects; v_slots int; v_filled int; v_has_roles boolean;
begin
  v_name := public._require(p_name, p_pin);
  p_role := nullif(btrim(p_role), '');
  select * into v_proj from public.projects where id = p_id for update;
  if not found then raise exception 'Project not found'; end if;
  if v_proj.status = 'done' then raise exception 'This project is finished'; end if;
  if exists (select 1 from public.project_members where project_id = p_id and member_name = v_name) then
    raise exception 'You are already in'; end if;
  v_has_roles := exists (select 1 from public.project_roles where project_id = p_id);
  if v_has_roles then
    if p_role is null then raise exception 'Pick a role to join'; end if;
    select slots into v_slots from public.project_roles where project_id = p_id and role = p_role;
    if v_slots is null then raise exception 'That role does not exist'; end if;
    select count(*) into v_filled from public.project_members where project_id = p_id and role = p_role;
    if v_filled >= v_slots then raise exception 'That role is full'; end if;
  end if;
  insert into public.project_members(project_id, member_name, role, is_owner) values (p_id, v_name, p_role, false);
end; $$;

create or replace function public.leave_project(p_name text, p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  v_name := public._require(p_name, p_pin);
  delete from public.project_members where project_id = p_id and member_name = v_name and is_owner = false;
end; $$;

create or replace function public.remove_member(p_name text, p_pin text, p_id uuid, p_member text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_proj public.projects;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_proj from public.projects where id = p_id;
  if not found then raise exception 'Project not found'; end if;
  if v_proj.owner_name <> v_name and btrim(p_member) <> v_name then raise exception 'Not allowed'; end if;
  delete from public.project_members where project_id = p_id and member_name = btrim(p_member) and is_owner = false;
end; $$;

-- ============================================================
--  5) THE CREW  (landing "keep it alive" / rent split)
-- ============================================================
create table if not exists public.office_members (
  name text primary key,
  pledge numeric not null default 0 check (pledge >= 0),
  joined_at timestamptz not null default now()
);

create or replace function public.join_office(p_name text, p_pin text, p_pledge numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  v_name := public._require(p_name, p_pin);
  if p_pledge is null or p_pledge < 0 then p_pledge := 0; end if;
  insert into public.office_members(name, pledge) values (v_name, p_pledge)
    on conflict (name) do update set pledge = excluded.pledge;
end; $$;

create or replace function public.leave_office(p_name text, p_pin text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  v_name := public._require(p_name, p_pin);
  delete from public.office_members where name = v_name;
end; $$;

-- ============================================================
--  RLS — world-readable boards; writes only via the functions above.
--  (users + offers stay hidden.)
-- ============================================================
alter table public.bids            enable row level security;
alter table public.offers          enable row level security;
alter table public.helpers         enable row level security;
alter table public.favors          enable row level security;
alter table public.resources       enable row level security;
alter table public.projects        enable row level security;
alter table public.project_roles   enable row level security;
alter table public.project_members enable row level security;
alter table public.office_members  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['helpers','favors','resources','projects','project_roles','project_members','office_members'] loop
    execute format('drop policy if exists "anon read %1$s" on public.%1$s', t);
    execute format('create policy "anon read %1$s" on public.%1$s for select to anon using (true)', t);
  end loop;
end $$;

grant execute on function
  public.place_offer(text,text,uuid,numeric), public.retract_offer(text,text,uuid),
  public.invite_helper(text,text,uuid,text), public.respond_invite(text,text,uuid,boolean), public.remove_helper(text,text,uuid,text),
  public.post_favor(text,text,text,text,text,numeric), public.edit_favor(text,text,uuid,text,text,text,numeric),
  public.cancel_favor(text,text,uuid), public.claim_favor(text,text,uuid), public.unclaim_favor(text,text,uuid),
  public.mark_favor_done(text,text,uuid), public.mark_favor_paid(text,text,uuid),
  public.post_resource(text,text,text,text,text,text,numeric), public.edit_resource(text,text,uuid,text,text,text,text,numeric),
  public.cancel_resource(text,text,uuid), public.claim_resource(text,text,uuid), public.unclaim_resource(text,text,uuid),
  public.mark_resource_got(text,text,uuid), public.mark_resource_paid(text,text,uuid),
  public.create_project(text,text,text,text,jsonb), public.edit_project(text,text,uuid,text,text),
  public.set_project_status(text,text,uuid,text), public.cancel_project(text,text,uuid),
  public.add_role(text,text,uuid,text,int), public.remove_role(text,text,uuid,text),
  public.join_project(text,text,uuid,text), public.leave_project(text,text,uuid), public.remove_member(text,text,uuid,text),
  public.join_office(text,text,numeric), public.leave_office(text,text)
  to anon;

-- ============================================================
--  Realtime — every board updates live on every device.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['bids','helpers','favors','resources','projects','project_roles','project_members','office_members'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
