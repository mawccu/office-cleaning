-- ============================================================
--  THE OFFICE — upgrade identity from name+PIN to real accounts
--  (username + hashed password). Run ONCE in the Supabase SQL Editor.
--
--  Safe on live data: keeps every existing user and all their data.
--  Existing PINs are hashed into passwords, so nobody is locked out
--  (they can keep using their old PIN until they change it, and set a
--  proper 8+ char password from the app). New sign-ups require 8+ chars.
-- ============================================================

set search_path = public, extensions;
create extension if not exists pgcrypto;

-- 1) store a bcrypt hash instead of a plaintext PIN
alter table public.users add column if not exists pass_hash  text;
alter table public.users add column if not exists created_at timestamptz not null default now();
update public.users set pass_hash = crypt(pin, gen_salt('bf')) where pass_hash is null and pin is not null;
alter table public.users alter column pass_hash set not null;

-- 2) verify a name + password against the stored hash
create or replace function public._require(p_name text, p_pin text)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  p_name := btrim(p_name);
  if not exists (select 1 from public.users where name = p_name and pass_hash = crypt(p_pin, pass_hash)) then
    raise exception 'Wrong username or password';
  end if;
  return p_name;
end; $$;

-- 3) auth_user = "log in" (verify only; used on boot + the log-in screen)
create or replace function public.auth_user(p_name text, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._require(p_name, p_pin);
end; $$;

-- 4) sign_up = create a new account (unique username, 8+ char password)
create or replace function public.sign_up(p_name text, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  p_name := btrim(p_name);
  if length(p_name) = 0 then raise exception 'Enter a username'; end if;
  if length(p_name) > 40 then raise exception 'Username is too long'; end if;
  if p_pin is null or length(p_pin) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  if exists (select 1 from public.users where lower(name) = lower(p_name)) then
    raise exception 'That username is already taken';
  end if;
  insert into public.users(name, pass_hash) values (p_name, crypt(p_pin, gen_salt('bf')));
end; $$;

-- 5) change_password (for anyone still on an old short PIN)
create or replace function public.change_password(p_name text, p_pin text, p_new text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_name text;
begin
  v_name := public._require(p_name, p_pin);
  if p_new is null or length(p_new) < 8 then raise exception 'New password must be at least 8 characters'; end if;
  update public.users set pass_hash = crypt(p_new, gen_salt('bf')) where name = v_name;
end; $$;

grant execute on function
  public.auth_user(text,text),
  public.sign_up(text,text),
  public.change_password(text,text,text)
  to anon;

-- 6) drop the plaintext PIN column — passwords are hashed now
alter table public.users drop column if exists pin;
