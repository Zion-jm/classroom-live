-- Run once in Supabase SQL Editor as the project owner. No secrets in this file.
begin;
create schema if not exists classroom_private;
revoke all on schema classroom_private from public, anon, authenticated;

create table classroom_private.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table classroom_private.quizzes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  data jsonb not null,
  updated_at timestamptz not null default clock_timestamp()
);
create table classroom_private.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-F0-9]{6}$'),
  owner_id uuid not null references auth.users(id),
  state jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index classroom_open_rooms on classroom_private.rooms ((state->>'phase'))
  where state->>'phase' = 'QUESTION_OPEN';
create index classroom_owner_rooms on classroom_private.rooms(owner_id, created_at desc);
create index classroom_owner_quizzes on classroom_private.quizzes(owner_id);
create table classroom_private.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references classroom_private.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  name text not null check (char_length(name) between 1 and 30),
  normalized_name text not null,
  unique(room_id, user_id), unique(room_id, normalized_name), unique(room_id, id)
);
create index classroom_player_identity on classroom_private.players(user_id, room_id);
create table classroom_private.answers (
  room_id uuid not null,
  player_id uuid not null,
  question_index integer not null check (question_index >= 0),
  choice integer not null check (choice between 0 and 5),
  received_at timestamptz not null default clock_timestamp(),
  primary key(room_id, player_id, question_index),
  foreign key(room_id, player_id) references classroom_private.players(room_id, id) on delete cascade
);
-- RLS is defense in depth: no direct client table grants or policies.
alter table classroom_private.admins enable row level security;
alter table classroom_private.quizzes enable row level security;
alter table classroom_private.rooms enable row level security;
alter table classroom_private.players enable row level security;
alter table classroom_private.answers enable row level security;
revoke all on all tables in schema classroom_private from public, anon, authenticated;

create function classroom_private.is_admin(who uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from classroom_private.admins where user_id = who);
$$;

create function classroom_private.board(room uuid, s jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  with scores as (
    select p.id, p.name, count(a.player_id) filter (
      where a.question_index < (s->>'revealedCount')::integer
      and a.choice = (s->'quiz'->'questions'->a.question_index->>'correct')::integer
    )::integer as score
    from classroom_private.players p left join classroom_private.answers a
      on a.player_id = p.id and a.room_id = p.room_id
    where p.room_id = room group by p.id, p.name
  ), ranked as (
    select id, name, score, rank() over(order by score desc) as rank from scores
  ) select coalesce(jsonb_agg(to_jsonb(ranked) order by score desc, name, id), '[]'::jsonb) from ranked;
$$;

create function classroom_private.snapshot(room uuid, who uuid, hosting boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r classroom_private.rooms; s jsonb; q jsonb; p uuid; board jsonb; selected integer; visible boolean;
begin
  select * into strict r from classroom_private.rooms where id = room;
  if hosting then
    if r.owner_id <> who or not classroom_private.is_admin(who) then raise exception 'You do not own this room.' using errcode = '42501'; end if;
  else
    select id into p from classroom_private.players where room_id = room and user_id = who;
    if p is null then raise exception 'Your player session is no longer valid.' using errcode = '42501'; end if;
  end if;
  s := r.state; q := s->'quiz'->'questions'->(s->>'index')::integer;
  if (s->>'index')::integer < 0 then q := null; end if;
  visible := s->>'phase' in ('ANSWER_REVEALED', 'FINISHED');
  board := classroom_private.board(room, s);
  select choice into selected from classroom_private.answers where room_id = room and player_id = p and question_index = (s->>'index')::integer;
  return jsonb_build_object(
    'id', r.id, 'code', r.code, 'title', s->'quiz'->>'title',
    'phase', s->>'phase', 'revision', (s->>'revision')::integer,
    'index', (s->>'index')::integer, 'total', jsonb_array_length(s->'quiz'->'questions'),
    'deadline', s->'deadline', 'serverNow', floor(extract(epoch from clock_timestamp()) * 1000),
    'revealedCount', (s->>'revealedCount')::integer,
    'players', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name, x.id), '[]'::jsonb) from classroom_private.players x where room_id = room),
    'submitted', (select count(*) from classroom_private.answers where room_id = room and question_index = (s->>'index')::integer),
    'question', case when q is null then null else
      jsonb_build_object('id', q->>'id', 'prompt', q->>'prompt', 'choices', q->'choices', 'seconds', q->'seconds') ||
      case when visible then jsonb_build_object('correct', q->'correct', 'explanation', q->>'explanation') else '{}'::jsonb end end,
    'ownAnswer', selected,
    'score', coalesce((select (x->>'score')::integer from jsonb_array_elements(board) x where x->>'id' = p::text), 0),
    'leaderboard', case when hosting or s->>'phase' = 'FINISHED' then board else '[]'::jsonb end
  );
end;
$$;

-- Broadcast ONLY invalidation metadata. Clients fetch individually authorized snapshots.
create function classroom_private.room_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('revision', new.state->'revision'), 'changed', 'classroom-host:' || new.code, true);
  if old.state->>'phase' is distinct from new.state->>'phase'
     or old.state->>'index' is distinct from new.state->>'index'
     or old.state->>'rosterRevision' is distinct from new.state->>'rosterRevision' then
    perform realtime.send(jsonb_build_object('revision', new.state->'revision'), 'changed', 'classroom-room:' || new.code, true);
  end if;
  return new;
end;
$$;
create trigger classroom_room_events after update on classroom_private.rooms
for each row execute function classroom_private.room_event();

create function public.classroom_can_listen(topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from classroom_private.rooms r
    where (topic = 'classroom-host:' || r.code and r.owner_id = auth.uid() and classroom_private.is_admin(auth.uid()))
       or (topic = 'classroom-room:' || r.code and exists (
          select 1 from classroom_private.players p where p.room_id = r.id and p.user_id = auth.uid()
       ))
  );
$$;
revoke all on function public.classroom_can_listen(text) from public, anon;
grant execute on function public.classroom_can_listen(text) to authenticated;
create policy classroom_receive_private on realtime.messages for select to authenticated
using (extension = 'broadcast' and public.classroom_can_listen(realtime.topic()));
-- No INSERT policy: browsers cannot publish authoritative game events.

create function classroom_private.expire_questions() returns integer
language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  update classroom_private.rooms set state = state || jsonb_build_object(
    'phase', 'QUESTION_LOCKED', 'revision', (state->>'revision')::integer + 1
  ) where state->>'phase' = 'QUESTION_OPEN'
    and (state->>'deadline')::numeric <= extract(epoch from clock_timestamp()) * 1000;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create function public.classroom_request(body jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid(); action text := coalesce(body->>'action', 'dashboard');
  admin boolean; r classroom_private.rooms; s jsonb; q jsonb; item jsonb; question jsonb;
  qs jsonb := '[]'::jsonb; choices jsonb; qid uuid; pid uuid; existing integer;
  idx integer; total integer; correct integer; duration integer; player_count integer;
  submitted_count integer; revision integer; now_ms bigint; room_code text; player_name text;
  hosting boolean := coalesce((body->>'hosting')::boolean, false);
begin
  if who is null then raise exception 'Sign in before continuing.' using errcode = '42501'; end if;
  if pg_column_size(body) > 300000 then raise exception 'Request is too large.'; end if;
  admin := classroom_private.is_admin(who);
  if action = 'dashboard' then
    if not admin then return jsonb_build_object('admin', false); end if;
    return jsonb_build_object('admin', true,
      'quizzes', (select coalesce(jsonb_agg(data || jsonb_build_object('id', id, 'updatedAt', extract(epoch from updated_at)*1000) order by updated_at desc), '[]'::jsonb) from classroom_private.quizzes where owner_id = who),
      'rooms', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'title', x.state->'quiz'->>'title', 'phase', x.state->>'phase', 'createdAt', extract(epoch from x.created_at)*1000, 'players', (select count(*) from classroom_private.players where room_id = x.id)) order by x.created_at desc), '[]'::jsonb) from classroom_private.rooms x where x.owner_id = who)
    );
  end if;
  if action in ('save', 'delete', 'host') then
    if not admin then raise exception 'Administrator access required.' using errcode = '42501'; end if;
    if action = 'save' then
      q := body->'quiz';
      if jsonb_typeof(q->'title') is distinct from 'string' or char_length(btrim(q->>'title')) not between 1 and 120 then raise exception 'Enter a title of 1–120 characters.'; end if;
      if jsonb_typeof(q->'questions') is distinct from 'array' then raise exception 'Questions must be an array.'; end if;
      if jsonb_array_length(q->'questions') not between 1 and 100 then raise exception 'Add 1–100 questions.'; end if;
      for item in select value from jsonb_array_elements(q->'questions') loop
        if jsonb_typeof(item->'prompt') is distinct from 'string' or char_length(btrim(item->>'prompt')) not between 1 and 2000 then raise exception 'Every question needs text of 1–2000 characters.'; end if;
        choices := item->'choices';
        if jsonb_typeof(choices) is distinct from 'array' then raise exception 'Choices must be an array.'; end if;
        if jsonb_array_length(choices) not between 2 and 6 then raise exception 'Add 2–6 choices.'; end if;
        for question in select value from jsonb_array_elements(choices) loop
          if jsonb_typeof(question) <> 'string' or char_length(btrim(question #>> '{}')) not between 1 and 500 then raise exception 'Every choice needs text of 1–500 characters.'; end if;
        end loop;
        if coalesce(item->>'correct', '') !~ '^\d+$' or coalesce(item->>'seconds', '') !~ '^\d+$' then raise exception 'Select a correct choice and a whole-number timer.'; end if;
        correct := (item->>'correct')::integer; duration := (item->>'seconds')::integer;
        if correct not between 0 and jsonb_array_length(choices)-1 or duration not between 5 and 300 then raise exception 'Invalid correct choice or timer (5–300 seconds).'; end if;
        if item ? 'explanation' and jsonb_typeof(item->'explanation') <> 'string' then raise exception 'Explanation must be text.'; end if;
        if char_length(coalesce(item->>'explanation', '')) > 2000 then raise exception 'Explanation is too long.'; end if;
        qs := qs || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'prompt', btrim(item->>'prompt'), 'choices', choices, 'correct', correct, 'seconds', duration, 'explanation', coalesce(item->>'explanation', '')));
      end loop;
      qid := coalesce(nullif(q->>'id', '')::uuid, gen_random_uuid());
      if exists(select 1 from classroom_private.quizzes where id = qid and owner_id <> who) then raise exception 'You do not own this quiz.' using errcode = '42501'; end if;
      q := jsonb_build_object('title', btrim(q->>'title'), 'questions', qs);
      insert into classroom_private.quizzes as owned(id, owner_id, data) values(qid, who, q)
      on conflict(id) do update set data = excluded.data, updated_at = clock_timestamp()
      where owned.owner_id = who returning owned.id into qid;
      if not found then raise exception 'You do not own this quiz.' using errcode = '42501'; end if;
      return jsonb_build_object('quiz', q || jsonb_build_object('id', qid));
    elsif action = 'delete' then
      delete from classroom_private.quizzes where id = (body->>'id')::uuid and owner_id = who;
      return jsonb_build_object('ok', true);
    else
      select data into q from classroom_private.quizzes where id = (body->>'id')::uuid and owner_id = who;
      if not found then raise exception 'Quiz not found.'; end if;
      -- Random code collision retries cannot overwrite another room.
      loop
        room_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
        begin
          insert into classroom_private.rooms(code, owner_id, state) values(room_code, who,
            jsonb_build_object('quiz', q, 'phase', 'LOBBY', 'index', -1, 'revision', 0, 'rosterRevision', 0, 'revealedCount', 0, 'deadline', null));
          exit;
        exception when unique_violation then null;
        end;
      end loop;
      return jsonb_build_object('code', room_code);
    end if;
  end if;

  if action not in ('snapshot','join','answer','remove','export','start','close','reveal','next','finish','cancel') then raise exception 'Unknown game action.'; end if;
  if action = 'snapshot' then
    select * into r from classroom_private.rooms where code = upper(body->>'code');
  else
    select * into r from classroom_private.rooms where code = upper(body->>'code') for update;
  end if;
  if not found then raise exception 'Room not found. Check the code.'; end if;
  s := r.state;
  select id into pid from classroom_private.players where room_id = r.id and user_id = who;
  if action = 'join' then
    if pid is not null then return jsonb_build_object('token', 'supabase', 'playerId', pid, 'code', r.code); end if;
    if s->>'phase' <> 'LOBBY' then raise exception 'This game has already started.'; end if;
    if jsonb_typeof(body->'name') is distinct from 'string' then raise exception 'Enter your name.'; end if;
    player_name := btrim(body->>'name');
    if char_length(player_name) not between 1 and 30 then raise exception 'Enter a name of 1–30 characters.'; end if;
    if (select count(*) from classroom_private.players where room_id = r.id) >= 50 then raise exception 'This room is full (50 players).'; end if;
    if exists(select 1 from classroom_private.players where room_id = r.id and normalized_name = lower(normalize(player_name, NFKC))) then raise exception 'That name is already in this room.'; end if;
    insert into classroom_private.players(room_id, user_id, name, normalized_name) values(r.id, who, player_name, lower(normalize(player_name, NFKC))) returning id into pid;
    update classroom_private.rooms set state = s || jsonb_build_object('revision', (s->>'revision')::integer+1, 'rosterRevision', (s->>'rosterRevision')::integer+1) where id = r.id;
    return jsonb_build_object('token', 'supabase', 'playerId', pid, 'code', r.code);
  end if;
  if action = 'snapshot' then
    if hosting then
      if not admin or r.owner_id <> who then raise exception 'You do not own this room.' using errcode = '42501'; end if;
    elsif pid is null then raise exception 'Your player session is no longer valid.' using errcode = '42501'; end if;
    -- Safe fallback if Cron is delayed; never writes on normal reads.
    update classroom_private.rooms set state = state || jsonb_build_object('phase', 'QUESTION_LOCKED', 'revision', (state->>'revision')::integer+1)
      where id = r.id and state->>'phase' = 'QUESTION_OPEN' and (state->>'deadline')::numeric <= extract(epoch from clock_timestamp())*1000;
    return classroom_private.snapshot(r.id, who, hosting);
  end if;

  if action = 'answer' then
    if pid is null then raise exception 'Your player session is no longer valid.' using errcode = '42501'; end if;
    idx := (s->>'index')::integer; q := s->'quiz'->'questions'->idx;
    if idx < 0 or q->>'id' is distinct from body->>'questionId' then raise exception 'This question is no longer active.'; end if;
    select choice into existing from classroom_private.answers where room_id = r.id and player_id = pid and question_index = idx;
    if found then return classroom_private.snapshot(r.id, who, false); end if;
    now_ms := floor(extract(epoch from clock_timestamp())*1000);
    if s->>'phase' <> 'QUESTION_OPEN' or now_ms >= (s->>'deadline')::bigint then raise exception 'Time is up. Answers are locked.'; end if;
    if coalesce(body->>'choice','') !~ '^\d+$' then raise exception 'Choose a valid answer.'; end if;
    correct := (body->>'choice')::integer;
    if correct not between 0 and jsonb_array_length(q->'choices')-1 then raise exception 'Choose a valid answer.'; end if;
    insert into classroom_private.answers(room_id, player_id, question_index, choice, received_at) values(r.id, pid, idx, correct, to_timestamp(now_ms / 1000.0));
    update classroom_private.rooms set state = s || jsonb_build_object('revision', (s->>'revision')::integer+1) where id = r.id;
    return classroom_private.snapshot(r.id, who, false);
  end if;

  if not admin or r.owner_id <> who then raise exception 'You do not own this room.' using errcode = '42501'; end if;
  if action = 'export' then
    return jsonb_build_object('state', classroom_private.snapshot(r.id, who, true), 'questions', (select coalesce(jsonb_agg(x.value order by x.ordinality), '[]'::jsonb) from jsonb_array_elements(s->'quiz'->'questions') with ordinality x where x.ordinality <= (s->>'revealedCount')::integer),
      'answers', (select coalesce(jsonb_agg(jsonb_build_object('playerId', player_id, 'index', question_index, 'choice', choice)), '[]'::jsonb) from classroom_private.answers where room_id = r.id and question_index < (s->>'revealedCount')::integer));
  end if;
  if action = 'remove' then
    if s->>'phase' <> 'LOBBY' then raise exception 'Remove players before starting.'; end if;
    delete from classroom_private.players where room_id = r.id and id = (body->>'playerId')::uuid;
    update classroom_private.rooms set state = s || jsonb_build_object('revision', (s->>'revision')::integer+1, 'rosterRevision', (s->>'rosterRevision')::integer+1) where id = r.id;
    return classroom_private.snapshot(r.id, who, true);
  end if;
  revision := (s->>'revision')::integer;
  if body->>'revision' is null or (body->>'revision')::integer <> revision then raise exception 'The room changed. Refreshing its state; try again.'; end if;
  now_ms := floor(extract(epoch from clock_timestamp())*1000);
  if s->>'phase' = 'QUESTION_OPEN' and now_ms >= (s->>'deadline')::bigint then s := s || jsonb_build_object('phase', 'QUESTION_LOCKED'); end if;
  idx := (s->>'index')::integer; total := jsonb_array_length(s->'quiz'->'questions');
  select count(*) into player_count from classroom_private.players where room_id = r.id;
  select count(*) into submitted_count from classroom_private.answers where room_id = r.id and question_index = idx;
  if action = 'start' then
    if s->>'phase' <> 'LOBBY' or player_count = 0 then raise exception 'Start requires a lobby with at least one player.'; end if;
    idx := 0;
  elsif action = 'close' then
    if s->>'phase' <> 'QUESTION_OPEN' or submitted_count <> player_count then raise exception 'Wait until everyone submits or time expires.'; end if;
    s := s || jsonb_build_object('phase', 'QUESTION_LOCKED');
  elsif action = 'reveal' then
    if s->>'phase' <> 'QUESTION_LOCKED' then raise exception 'Wait until answers lock before revealing.'; end if;
    s := s || jsonb_build_object('phase', 'ANSWER_REVEALED', 'revealedCount', idx+1);
  elsif action = 'next' then
    if s->>'phase' <> 'ANSWER_REVEALED' or idx >= total-1 then raise exception 'Reveal the answer before advancing.'; end if;
    idx := idx+1;
  elsif action = 'finish' then
    if s->>'phase' <> 'ANSWER_REVEALED' or idx <> total-1 then raise exception 'Reveal the last answer first.'; end if;
    s := s || jsonb_build_object('phase', 'FINISHED');
  elsif action = 'cancel' then
    if s->>'phase' in ('FINISHED','CANCELLED') then raise exception 'This game has ended.'; end if;
    s := s || jsonb_build_object('phase', 'CANCELLED');
  end if;
  if action in ('start','next') then
    duration := (s->'quiz'->'questions'->idx->>'seconds')::integer;
    s := s || jsonb_build_object('phase', 'QUESTION_OPEN', 'index', idx, 'startedAt', now_ms, 'deadline', now_ms + duration*1000);
  end if;
  update classroom_private.rooms set state = s || jsonb_build_object('revision', revision+1) where id = r.id;
  return classroom_private.snapshot(r.id, who, true);
end;
$$;
revoke all on all functions in schema classroom_private from public, anon, authenticated;
revoke all on function public.classroom_request(jsonb) from public, anon;
grant execute on function public.classroom_request(jsonb) to authenticated;
commit;
