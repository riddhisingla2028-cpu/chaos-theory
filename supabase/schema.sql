-- Chaos Theory: cloud saves and leaderboard scores.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query) for your project.
-- Every table uses row-level security: a player can only read and write their own save,
-- and can only submit scores as themselves. The browser uses the public anon key only.

-- ---------- Cloud saves ----------

create table if not exists public.saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  save_version int not null default 4,
  updated_at timestamptz not null default now()
);

alter table public.saves enable row level security;

drop policy if exists "read own save" on public.saves;
create policy "read own save" on public.saves for select using (auth.uid() = user_id);

drop policy if exists "insert own save" on public.saves;
create policy "insert own save" on public.saves for insert with check (auth.uid() = user_id);

drop policy if exists "update own save" on public.saves;
create policy "update own save" on public.saves for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Server-side validation: shape, size and sane bounds. The server stamps the time itself.
create or replace function public.validate_save() returns trigger language plpgsql as $$
begin
  if jsonb_typeof(new.data) <> 'object' then raise exception 'save must be an object'; end if;
  if pg_column_size(new.data) > 262144 then raise exception 'save too large'; end if;
  if coalesce((new.data->>'xp')::numeric, 0) < 0 or coalesce((new.data->>'xp')::numeric, 0) > 10000000 then
    raise exception 'xp out of range';
  end if;
  if coalesce((new.data->>'runs')::numeric, 0) < 0 then raise exception 'runs out of range'; end if;
  -- Purchases are never accepted from the client.
  new.data := new.data - 'premiumDemo' - 'entitlements';
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists validate_save on public.saves;
create trigger validate_save before insert or update on public.saves
  for each row execute function public.validate_save();

-- ---------- Leaderboard (prepared; the game labels it local-only until this exists) ----------

create table if not exists public.scores (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  mode text not null check (mode in ('stage','endless','orbrush','chaos','bossrush','daily')),
  stage int not null default 0 check (stage between 0 and 9),
  score int not null check (score >= 0),
  time_s numeric not null check (time_s >= 0 and time_s <= 36000),
  week text not null default to_char(now(), 'IYYY-"W"IW'),
  created_at timestamptz not null default now(),
  -- Plausibility: scoring is at most a few hundred points per second survived, plus bonuses.
  constraint plausible_score check (score <= 2000 + time_s * 800)
);

alter table public.scores enable row level security;

drop policy if exists "anyone can read scores" on public.scores;
create policy "anyone can read scores" on public.scores for select using (true);

drop policy if exists "submit own scores" on public.scores;
create policy "submit own scores" on public.scores for insert with check (auth.uid() = user_id);

-- Rate limit: at most one submission every 5 seconds per player.
create or replace function public.rate_limit_scores() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.scores where user_id = new.user_id and created_at > now() - interval '5 seconds') then
    raise exception 'too many submissions';
  end if;
  new.created_at := now();
  new.week := to_char(now(), 'IYYY-"W"IW');
  return new;
end $$;

drop trigger if exists rate_limit_scores on public.scores;
create trigger rate_limit_scores before insert on public.scores
  for each row execute function public.rate_limit_scores();

create index if not exists scores_board on public.scores (mode, stage, week, score desc);
