-- ============================================================
--  Cleaning Bids — full schema
--  identity (name + PIN) + bundled bids + lifecycle
--  (open -> claimed -> cleaned -> paid) + deadlines + tasks + note.
--
--  Run this whole file once in the Supabase SQL Editor.
--  It DROPS and recreates the tables (clears all existing data).
-- ============================================================

drop table if exists public.bids   cascade;
drop table if exists public.claims cascade;
drop table if exists public.users  cascade;

-- Identity: a name + a PIN. Never exposed to the client (no anon select);
-- only the security-definer functions below can read it.
create table public.users (
  name       text primary key,
  pin        text not null,
  created_at timestamptz not null default now()
);

-- One bid = one posting that moves through a lifecycle.
create table public.bids (
  id            uuid primary key default gen_random_uuid(),
  bidder_name   text not null,
  amount        numeric not null check (amount > 0),
  rooms         jsonb not null,
  tasks         jsonb not null default '[]'::jsonb,
  note          text,
  status        text not null default 'open' check (status in ('open','claimed','cleaned','paid')),
  due_at        timestamptz,
  claimed_by    text,
  scheduled_for timestamptz,
  cleaned_at    timestamptz,
  paid_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- Register a new name (with its PIN) or verify an existing one.
create or replace function public.auth_user(p_name text, p_pin text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  p_name := btrim(p_name);
  if length(p_name) = 0 then raise exception 'Name required'; end if;
  if length(p_pin) < 4 then raise exception 'PIN must be at least 4 digits'; end if;
  insert into public.users(name, pin) values (p_name, p_pin) on conflict (name) do nothing;
  if not exists (select 1 from public.users where name = p_name and pin = p_pin) then
    raise exception 'That name is already taken with a different PIN';
  end if;
end;
$$;

-- Internal: verify name+pin, return the trimmed name (or raise).
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

create or replace function public.place_bid(p_name text, p_pin text, p_amount numeric, p_rooms jsonb, p_due_at timestamptz, p_tasks jsonb, p_note text)
returns public.bids
language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than 0'; end if;
  if p_rooms is null or jsonb_array_length(p_rooms) = 0 then raise exception 'Pick at least one room'; end if;
  insert into public.bids(bidder_name, amount, rooms, due_at, tasks, note)
    values (v_name, p_amount, p_rooms, p_due_at, coalesce(p_tasks, '[]'::jsonb), p_note)
    returning * into v_bid;
  return v_bid;
end;
$$;

create or replace function public.edit_bid(p_name text, p_pin text, p_bid_id uuid, p_amount numeric, p_due_at timestamptz, p_tasks jsonb, p_note text)
returns public.bids
language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_bid from public.bids where id = p_bid_id;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.bidder_name <> v_name then raise exception 'Only the bidder can edit this'; end if;
  if v_bid.status <> 'open' then raise exception 'Bid already claimed'; end if;
  update public.bids
    set amount = coalesce(p_amount, amount), due_at = p_due_at,
        tasks = coalesce(p_tasks, tasks), note = p_note
    where id = p_bid_id returning * into v_bid;
  return v_bid;
end;
$$;

create or replace function public.cancel_bid(p_name text, p_pin text, p_bid_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_bid from public.bids where id = p_bid_id;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.bidder_name <> v_name then raise exception 'Only the bidder can cancel this'; end if;
  if v_bid.status <> 'open' then raise exception 'Bid already claimed'; end if;
  delete from public.bids where id = p_bid_id;
end;
$$;

create or replace function public.claim_bid(p_name text, p_pin text, p_bid_id uuid)
returns public.bids
language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_bid from public.bids where id = p_bid_id for update;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.status <> 'open' then raise exception 'Already claimed'; end if;
  update public.bids set status = 'claimed', claimed_by = v_name where id = p_bid_id returning * into v_bid;
  return v_bid;
end;
$$;

create or replace function public.schedule_bid(p_name text, p_pin text, p_bid_id uuid, p_scheduled_for timestamptz)
returns public.bids
language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_bid from public.bids where id = p_bid_id;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.claimed_by <> v_name then raise exception 'Only the claimer can set the time'; end if;
  if v_bid.status <> 'claimed' then raise exception 'Not in progress'; end if;
  update public.bids set scheduled_for = p_scheduled_for where id = p_bid_id returning * into v_bid;
  return v_bid;
end;
$$;

create or replace function public.unclaim_bid(p_name text, p_pin text, p_bid_id uuid)
returns public.bids
language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_bid from public.bids where id = p_bid_id;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.claimed_by <> v_name then raise exception 'Only the claimer can un-claim'; end if;
  if v_bid.status <> 'claimed' then raise exception 'Cannot un-claim now'; end if;
  update public.bids set status = 'open', claimed_by = null, scheduled_for = null where id = p_bid_id returning * into v_bid;
  return v_bid;
end;
$$;

create or replace function public.mark_cleaned(p_name text, p_pin text, p_bid_id uuid)
returns public.bids
language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_bid from public.bids where id = p_bid_id;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.claimed_by <> v_name then raise exception 'Only the claimer can mark it cleaned'; end if;
  if v_bid.status <> 'claimed' then raise exception 'Not in progress'; end if;
  update public.bids set status = 'cleaned', cleaned_at = now() where id = p_bid_id returning * into v_bid;
  return v_bid;
end;
$$;

create or replace function public.mark_paid(p_name text, p_pin text, p_bid_id uuid)
returns public.bids
language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_bid from public.bids where id = p_bid_id;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.bidder_name <> v_name then raise exception 'Only the bidder can mark it paid'; end if;
  if v_bid.status <> 'cleaned' then raise exception 'Not cleaned yet'; end if;
  update public.bids set status = 'paid', paid_at = now() where id = p_bid_id returning * into v_bid;
  return v_bid;
end;
$$;

-- Row-Level Security: the board is world-readable; every write goes
-- through the PIN-checked functions above. Direct table writes are blocked.
alter table public.bids  enable row level security;
alter table public.users enable row level security;
create policy "anon read bids" on public.bids for select to anon using (true);
-- users has NO policies on purpose: unreadable/unwritable except via the functions.

grant execute on function
  public.auth_user(text,text),
  public.place_bid(text,text,numeric,jsonb,timestamptz,jsonb,text),
  public.edit_bid(text,text,uuid,numeric,timestamptz,jsonb,text),
  public.cancel_bid(text,text,uuid),
  public.claim_bid(text,text,uuid),
  public.schedule_bid(text,text,uuid,timestamptz),
  public.unclaim_bid(text,text,uuid),
  public.mark_cleaned(text,text,uuid),
  public.mark_paid(text,text,uuid)
  to anon;

-- Realtime so every device updates live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bids'
  ) then
    alter publication supabase_realtime add table public.bids;
  end if;
end
$$;
