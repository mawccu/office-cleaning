-- ============================================================
--  MIGRATION: add underbidding (lowest offer wins) + helpers
--  (equal split) to a LIVE Cleaning Bids board.
--
--  Safe to run on a database that already has data — it does NOT
--  drop any tables. Run this whole file once in the Supabase SQL
--  Editor. Running it twice is harmless (idempotent).
-- ============================================================

-- 1) New column: remember each posting's original (ceiling) price.
alter table public.bids add column if not exists posted_amount numeric;
update public.bids set posted_amount = amount where posted_amount is null;
alter table public.bids alter column posted_amount set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bids_posted_amount_check') then
    alter table public.bids add constraint bids_posted_amount_check check (posted_amount > 0);
  end if;
end
$$;

-- 2) Offers (server-internal) + helpers (world-readable).
create table if not exists public.offers (
  id           uuid primary key default gen_random_uuid(),
  bid_id       uuid not null references public.bids(id) on delete cascade,
  cleaner_name text not null,
  amount       numeric not null check (amount > 0),
  created_at   timestamptz not null default now(),
  unique (bid_id, cleaner_name)
);

create table if not exists public.helpers (
  id          uuid primary key default gen_random_uuid(),
  bid_id      uuid not null references public.bids(id) on delete cascade,
  helper_name text not null,
  invited_by  text not null,
  status      text not null default 'invited' check (status in ('invited','accepted')),
  created_at  timestamptz not null default now(),
  unique (bid_id, helper_name)
);

-- 3) Leader helper + all new/updated functions.
create or replace function public._sync_leader(p_bid_id uuid)
returns public.bids
language plpgsql security definer set search_path = public as $$
declare v_bid public.bids; v_name text; v_amt numeric;
begin
  select cleaner_name, amount into v_name, v_amt
    from public.offers where bid_id = p_bid_id
    order by amount asc, created_at asc limit 1;
  if v_name is null then
    update public.bids b set claimed_by = null, amount = b.posted_amount
      where id = p_bid_id returning * into v_bid;
  else
    update public.bids set claimed_by = v_name, amount = v_amt
      where id = p_bid_id returning * into v_bid;
  end if;
  return v_bid;
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
  insert into public.bids(bidder_name, amount, posted_amount, rooms, due_at, tasks, note)
    values (v_name, p_amount, p_amount, p_rooms, p_due_at, coalesce(p_tasks, '[]'::jsonb), p_note)
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
  if exists (select 1 from public.offers where bid_id = p_bid_id) then
    raise exception 'Cannot change the price once cleaners have made offers';
  end if;
  update public.bids
    set amount = coalesce(p_amount, amount),
        posted_amount = coalesce(p_amount, posted_amount),
        due_at = p_due_at,
        tasks = coalesce(p_tasks, tasks), note = p_note
    where id = p_bid_id returning * into v_bid;
  return v_bid;
end;
$$;

create or replace function public.place_offer(p_name text, p_pin text, p_bid_id uuid, p_amount numeric)
returns public.bids
language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_bid from public.bids where id = p_bid_id for update;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.status <> 'open' then raise exception 'This job is no longer open for offers'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Offer must be greater than 0'; end if;
  if p_amount >= v_bid.amount then
    raise exception 'Your offer must be lower than the current price (% )', v_bid.amount;
  end if;
  insert into public.offers(bid_id, cleaner_name, amount)
    values (p_bid_id, v_name, p_amount)
    on conflict (bid_id, cleaner_name) do update set amount = excluded.amount, created_at = now();
  v_bid := public._sync_leader(p_bid_id);
  return v_bid;
end;
$$;

create or replace function public.retract_offer(p_name text, p_pin text, p_bid_id uuid)
returns public.bids
language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_bid from public.bids where id = p_bid_id for update;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.status <> 'open' then raise exception 'The auction is already closed'; end if;
  delete from public.offers where bid_id = p_bid_id and cleaner_name = v_name;
  v_bid := public._sync_leader(p_bid_id);
  return v_bid;
end;
$$;

create or replace function public.claim_bid(p_name text, p_pin text, p_bid_id uuid)
returns public.bids
language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids; v_has_offers boolean;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_bid from public.bids where id = p_bid_id for update;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.status <> 'open' then raise exception 'Already claimed'; end if;
  v_has_offers := exists (select 1 from public.offers where bid_id = p_bid_id);
  if v_has_offers then
    if v_bid.claimed_by is distinct from v_name then
      raise exception 'The lowest offer (by %) holds this job — undercut it to take it', v_bid.claimed_by;
    end if;
    update public.bids set status = 'claimed' where id = p_bid_id returning * into v_bid;
  else
    update public.bids set status = 'claimed', claimed_by = v_name, amount = posted_amount
      where id = p_bid_id returning * into v_bid;
  end if;
  delete from public.offers where bid_id = p_bid_id;
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
  delete from public.helpers where bid_id = p_bid_id;
  update public.bids
    set status = 'open', claimed_by = null, amount = posted_amount, scheduled_for = null
    where id = p_bid_id returning * into v_bid;
  return v_bid;
end;
$$;

create or replace function public.invite_helper(p_name text, p_pin text, p_bid_id uuid, p_helper text)
returns void
language plpgsql security definer set search_path = public as $$
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
  insert into public.helpers(bid_id, helper_name, invited_by, status)
    values (p_bid_id, p_helper, v_name, 'invited')
    on conflict (bid_id, helper_name) do nothing;
end;
$$;

create or replace function public.respond_invite(p_name text, p_pin text, p_bid_id uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  v_name := public._require(p_name, p_pin);
  if not exists (select 1 from public.helpers where bid_id = p_bid_id and helper_name = v_name) then
    raise exception 'No invite for you on this job';
  end if;
  if p_accept then
    update public.helpers set status = 'accepted' where bid_id = p_bid_id and helper_name = v_name;
  else
    delete from public.helpers where bid_id = p_bid_id and helper_name = v_name;
  end if;
end;
$$;

create or replace function public.remove_helper(p_name text, p_pin text, p_bid_id uuid, p_helper text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_name text; v_bid public.bids;
begin
  v_name := public._require(p_name, p_pin);
  p_helper := btrim(p_helper);
  select * into v_bid from public.bids where id = p_bid_id;
  if not found then raise exception 'Bid not found'; end if;
  if v_bid.claimed_by <> v_name and p_helper <> v_name then
    raise exception 'Only the claimer or the helper themselves can remove this';
  end if;
  delete from public.helpers where bid_id = p_bid_id and helper_name = p_helper;
end;
$$;

-- 4) RLS: helpers world-readable, offers hidden.
alter table public.offers  enable row level security;
alter table public.helpers enable row level security;
drop policy if exists "anon read helpers" on public.helpers;
create policy "anon read helpers" on public.helpers for select to anon using (true);

-- 5) Grants for the new functions.
grant execute on function
  public.place_offer(text,text,uuid,numeric),
  public.retract_offer(text,text,uuid),
  public.invite_helper(text,text,uuid,text),
  public.respond_invite(text,text,uuid,boolean),
  public.remove_helper(text,text,uuid,text)
  to anon;

-- 6) Realtime for the helpers table.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'helpers') then
    alter publication supabase_realtime add table public.helpers;
  end if;
end
$$;
