-- ============================================================
--  THE OFFICE — Requests & Favors service.
--
--  A favor = a small ask (a tea, an errand, grab-me-something) with an
--  optional reward/tip. Lifecycle:
--      open -> claimed -> done            (free favor, reward = 0)
--      open -> claimed -> done -> paid    (when a reward is offered)
--
--  Standalone + idempotent: run this whole file once in the Supabase SQL
--  Editor. It depends on public._require (from the cleaning schema) already
--  existing. Running it twice is harmless.
-- ============================================================

create table if not exists public.favors (
  id          uuid primary key default gen_random_uuid(),
  poster_name text not null,
  title       text not null,
  note        text,
  category    text not null default 'other' check (category in ('tea','errand','other')),
  reward      numeric not null default 0 check (reward >= 0),  -- 0 = free favor
  status      text not null default 'open' check (status in ('open','claimed','done','paid')),
  claimed_by  text,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  done_at     timestamptz,
  paid_at     timestamptz
);

create or replace function public.post_favor(p_name text, p_pin text, p_title text, p_note text, p_category text, p_reward numeric)
returns public.favors
language plpgsql security definer set search_path = public as $$
declare v_name text; v_fav public.favors;
begin
  v_name := public._require(p_name, p_pin);
  p_title := btrim(p_title);
  if length(p_title) = 0 then raise exception 'Say what you need'; end if;
  if p_reward is null or p_reward < 0 then p_reward := 0; end if;
  if p_category is null or p_category not in ('tea','errand','other') then p_category := 'other'; end if;
  insert into public.favors(poster_name, title, note, category, reward)
    values (v_name, p_title, nullif(btrim(p_note), ''), p_category, p_reward)
    returning * into v_fav;
  return v_fav;
end;
$$;

create or replace function public.edit_favor(p_name text, p_pin text, p_id uuid, p_title text, p_note text, p_category text, p_reward numeric)
returns public.favors
language plpgsql security definer set search_path = public as $$
declare v_name text; v_fav public.favors;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_fav from public.favors where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if v_fav.poster_name <> v_name then raise exception 'Only the poster can edit this'; end if;
  if v_fav.status <> 'open' then raise exception 'Already claimed'; end if;
  if p_reward is null or p_reward < 0 then p_reward := v_fav.reward; end if;
  if p_category is null or p_category not in ('tea','errand','other') then p_category := v_fav.category; end if;
  update public.favors
    set title = coalesce(nullif(btrim(p_title), ''), title),
        note = nullif(btrim(p_note), ''),
        category = p_category,
        reward = p_reward
    where id = p_id returning * into v_fav;
  return v_fav;
end;
$$;

create or replace function public.cancel_favor(p_name text, p_pin text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_name text; v_fav public.favors;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_fav from public.favors where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if v_fav.poster_name <> v_name then raise exception 'Only the poster can cancel this'; end if;
  if v_fav.status <> 'open' then raise exception 'Already claimed'; end if;
  delete from public.favors where id = p_id;
end;
$$;

create or replace function public.claim_favor(p_name text, p_pin text, p_id uuid)
returns public.favors
language plpgsql security definer set search_path = public as $$
declare v_name text; v_fav public.favors;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_fav from public.favors where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_fav.status <> 'open' then raise exception 'Already claimed'; end if;
  update public.favors set status = 'claimed', claimed_by = v_name, claimed_at = now()
    where id = p_id returning * into v_fav;
  return v_fav;
end;
$$;

create or replace function public.unclaim_favor(p_name text, p_pin text, p_id uuid)
returns public.favors
language plpgsql security definer set search_path = public as $$
declare v_name text; v_fav public.favors;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_fav from public.favors where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if v_fav.claimed_by <> v_name then raise exception 'Only the person on it can un-claim'; end if;
  if v_fav.status <> 'claimed' then raise exception 'Cannot un-claim now'; end if;
  update public.favors set status = 'open', claimed_by = null, claimed_at = null
    where id = p_id returning * into v_fav;
  return v_fav;
end;
$$;

create or replace function public.mark_favor_done(p_name text, p_pin text, p_id uuid)
returns public.favors
language plpgsql security definer set search_path = public as $$
declare v_name text; v_fav public.favors;
begin
  v_name := public._require(p_name, p_pin);
  select * into v_fav from public.favors where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if v_fav.claimed_by <> v_name then raise exception 'Only the person on it can mark it done'; end if;
  if v_fav.status <> 'claimed' then raise exception 'Not in progress'; end if;
  update public.favors set status = 'done', done_at = now() where id = p_id returning * into v_fav;
  return v_fav;
end;
$$;

create or replace function public.mark_favor_paid(p_name text, p_pin text, p_id uuid)
returns public.favors
language plpgsql security definer set search_path = public as $$
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
end;
$$;

-- RLS: world-readable; writes only via the PIN-checked functions above.
alter table public.favors enable row level security;
drop policy if exists "anon read favors" on public.favors;
create policy "anon read favors" on public.favors for select to anon using (true);

grant execute on function
  public.post_favor(text,text,text,text,text,numeric),
  public.edit_favor(text,text,uuid,text,text,text,numeric),
  public.cancel_favor(text,text,uuid),
  public.claim_favor(text,text,uuid),
  public.unclaim_favor(text,text,uuid),
  public.mark_favor_done(text,text,uuid),
  public.mark_favor_paid(text,text,uuid)
  to anon;

-- Realtime so every device updates live.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'favors') then
    alter publication supabase_realtime add table public.favors;
  end if;
end
$$;
