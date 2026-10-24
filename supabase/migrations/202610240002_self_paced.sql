-- Upgrade an existing classroom installation. Run ONCE after migration 001.
-- Existing teacher-paced rooms and the existing Cron job remain compatible.
begin;
create table classroom_private.attempts (
  room_id uuid not null,
  player_id uuid not null,
  question_index integer not null default 0 check(question_index >= 0),
  status text not null check(status in ('OPEN','LOCKED','REVIEW','FINISHED')),
  deadline bigint,
  finished_at timestamptz,
  primary key(room_id, player_id),
  foreign key(room_id, player_id) references classroom_private.players(room_id,id) on delete cascade
);
alter table classroom_private.attempts enable row level security;
revoke all on classroom_private.attempts from public, anon, authenticated;
create index classroom_attempt_deadlines on classroom_private.attempts(deadline) where status='OPEN';

-- Preserve the working teacher-mode implementation; it is no longer a public RPC.
alter function public.classroom_request(jsonb) set schema classroom_private;
alter function classroom_private.classroom_request(jsonb) rename to teacher_request;
revoke all on function classroom_private.teacher_request(jsonb) from public, anon, authenticated;
alter function classroom_private.snapshot(uuid,uuid,boolean) rename to teacher_snapshot;
alter function classroom_private.expire_questions() rename to expire_teacher_questions;

create function classroom_private.self_reconcile(room uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s jsonb; changed integer;
begin
  -- All writers acquire the room row before any attempt rows.
  select state into s from classroom_private.rooms where id=room for update;
  if s->>'phase' <> 'RUNNING' then return; end if;
  update classroom_private.attempts set status=case when s->>'feedback'='each' then 'REVIEW' else 'LOCKED' end
    where room_id=room and status='OPEN' and deadline <= extract(epoch from clock_timestamp())*1000;
  get diagnostics changed=row_count;
  if changed>0 then
    update classroom_private.rooms set state=state || jsonb_build_object('revision',(state->>'revision')::integer+1) where id=room;
  end if;
end;
$$;

create function classroom_private.self_snapshot(room uuid, who uuid, hosting boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r classroom_private.rooms; s jsonb; p uuid; a classroom_private.attempts;
  q jsonb; board jsonb; result jsonb; own integer; total integer; idx integer;
  done boolean; reveal_current boolean; phase text; own_score integer;
begin
  select * into strict r from classroom_private.rooms where id=room;
  s:=r.state; total:=jsonb_array_length(s->'quiz'->'questions');
  if hosting then
    if r.owner_id<>who or not classroom_private.is_admin(who) then raise exception 'You do not own this room.' using errcode='42501'; end if;
  else
    select id into p from classroom_private.players where room_id=room and user_id=who;
    if p is null then raise exception 'Your player session is no longer valid.' using errcode='42501'; end if;
    select * into a from classroom_private.attempts where room_id=room and player_id=p;
  end if;
  done:=coalesce(a.status='FINISHED',false) or s->>'phase'='FINISHED';
  idx:=coalesce(a.question_index,0);
  phase:=case when s->>'phase' in ('LOBBY','CANCELLED','FINISHED') then s->>'phase'
    when hosting then 'RUNNING' when done then 'ATTEMPT_FINISHED'
    when a.status='OPEN' then 'QUESTION_OPEN' when a.status='REVIEW' then 'ANSWER_REVEALED' else 'QUESTION_LOCKED' end;
  if s->>'phase'<>'LOBBY' and not hosting and not done then q:=s->'quiz'->'questions'->idx; end if;
  reveal_current:=s->>'feedback'='each' and a.status='REVIEW';
  select choice into own from classroom_private.answers where room_id=room and player_id=p and question_index=idx;
  board:=classroom_private.board(room,s || jsonb_build_object('revealedCount',total));
  select (x->>'score')::integer into own_score from jsonb_array_elements(board) x where x->>'id'=p::text;
  result:=jsonb_build_object('id',r.id,'code',r.code,'title',s->'quiz'->>'title',
    'mode','self','feedback',s->>'feedback','phase',phase,'sessionPhase',s->>'phase',
    'revision',(s->>'revision')::integer,'index',idx,'total',total,
    'deadline',case when a.status='OPEN' then a.deadline else null end,
    'serverNow',floor(extract(epoch from clock_timestamp())*1000),
    'ownAnswer',own,'score',case when s->>'feedback'='each' or done then coalesce(own_score,0) else null end,
    'revealedCount',case when done then total else 0 end,
    'finishedCount',(select count(*) from classroom_private.attempts where room_id=room and status='FINISHED'),
    'players',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) order by x.name,x.id),'[]'::jsonb) from classroom_private.players x where room_id=room),
    'progress',case when hosting then (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,
      'status',coalesce(t.status,'WAITING'),'index',coalesce(t.question_index,0),
      'answered',(select count(*) from classroom_private.answers z where z.room_id=room and z.player_id=x.id)) order by x.name,x.id),'[]'::jsonb)
      from classroom_private.players x left join classroom_private.attempts t on t.room_id=x.room_id and t.player_id=x.id where x.room_id=room) else '[]'::jsonb end,
    'question',case when q is null then null else jsonb_build_object('id',q->>'id','prompt',q->>'prompt','choices',q->'choices','seconds',q->'seconds') ||
      case when reveal_current then jsonb_build_object('correct',q->'correct','explanation',q->>'explanation') else '{}'::jsonb end end,
    'leaderboard',case when s->>'phase'='FINISHED' or hosting then board else '[]'::jsonb end,
    'review',case when not hosting and done then (
      select coalesce(jsonb_agg(jsonb_build_object('prompt',x.value->>'prompt','choices',x.value->'choices',
        'correct',x.value->'correct','explanation',x.value->>'explanation','ownAnswer',z.choice) order by x.ordinality),'[]'::jsonb)
      from jsonb_array_elements(s->'quiz'->'questions') with ordinality x
      left join classroom_private.answers z on z.room_id=room and z.player_id=p and z.question_index=x.ordinality-1
    ) else '[]'::jsonb end);
  return result;
end;
$$;

create function classroom_private.snapshot(room uuid,who uuid,hosting boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if (select state->>'mode' from classroom_private.rooms where id=room)='self' then
    return classroom_private.self_snapshot(room,who,hosting);
  end if;
  return classroom_private.teacher_snapshot(room,who,hosting) || jsonb_build_object('mode','teacher');
end;
$$;

create function classroom_private.self_request(body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid(); action text:=body->>'action'; r classroom_private.rooms; s jsonb;
  a classroom_private.attempts; p uuid; idx integer; total integer; q jsonb; choice integer;
  now_ms bigint; rev integer; hosting boolean:=coalesce((body->>'hosting')::boolean,false);
begin
  if who is null then raise exception 'Sign in before continuing.' using errcode='42501'; end if;
  select * into r from classroom_private.rooms where code=upper(body->>'code') for update;
  if not found then raise exception 'Room not found.'; end if;
  select id into p from classroom_private.players where room_id=r.id and user_id=who;
  if action in ('answer','next_self') or (action='snapshot' and not hosting) then
    if p is null then raise exception 'Your player session is no longer valid.' using errcode='42501'; end if;
  else
    if r.owner_id<>who or not classroom_private.is_admin(who) then raise exception 'You do not own this room.' using errcode='42501'; end if;
  end if;
  perform classroom_private.self_reconcile(r.id);
  select state into s from classroom_private.rooms where id=r.id;
  if action='snapshot' then return classroom_private.self_snapshot(r.id,who,hosting); end if;
  total:=jsonb_array_length(s->'quiz'->'questions');
  rev:=(s->>'revision')::integer;
  if action in ('answer','next_self') then
    if s->>'phase'<>'RUNNING' then raise exception 'This session is not accepting answers.'; end if;
    select * into a from classroom_private.attempts where room_id=r.id and player_id=p;
    if not found or a.status='FINISHED' then raise exception 'Your attempt has already finished.'; end if;
    idx:=a.question_index; q:=s->'quiz'->'questions'->idx;
    if q->>'id' is distinct from body->>'questionId' then raise exception 'This question is no longer active. Refresh your attempt.'; end if;
    if action='answer' then
      if exists(select 1 from classroom_private.answers where room_id=r.id and player_id=p and question_index=idx) then return classroom_private.self_snapshot(r.id,who,false); end if;
      now_ms:=floor(extract(epoch from clock_timestamp())*1000);
      if a.status<>'OPEN' or now_ms>=a.deadline then raise exception 'Time is up. Answers are locked.'; end if;
      if coalesce(body->>'choice','') !~ '^\d+$' then raise exception 'Choose a valid answer.'; end if;
      choice:=(body->>'choice')::integer;
      if choice not between 0 and jsonb_array_length(q->'choices')-1 then raise exception 'Choose a valid answer.'; end if;
      insert into classroom_private.answers(room_id,player_id,question_index,choice,received_at) values(r.id,p,idx,choice,to_timestamp(now_ms/1000.0));
      update classroom_private.attempts set status=case when s->>'feedback'='each' then 'REVIEW' else 'LOCKED' end where room_id=r.id and player_id=p;
    else
      if a.status='OPEN' then raise exception 'Submit your answer or wait for the timer before continuing.'; end if;
      if idx=total-1 then
        update classroom_private.attempts set status='FINISHED',deadline=null,finished_at=clock_timestamp() where room_id=r.id and player_id=p;
        if not exists(select 1 from classroom_private.attempts where room_id=r.id and status<>'FINISHED') then s:=s || jsonb_build_object('phase','FINISHED','revealedCount',total); end if;
      else
        now_ms:=floor(extract(epoch from clock_timestamp())*1000);
        update classroom_private.attempts set question_index=idx+1,status='OPEN',deadline=now_ms+(s->'quiz'->'questions'->(idx+1)->>'seconds')::bigint*1000 where room_id=r.id and player_id=p;
      end if;
    end if;
    update classroom_private.rooms set state=s || jsonb_build_object('revision',rev+1) where id=r.id;
    return classroom_private.self_snapshot(r.id,who,false);
  end if;
  -- Reconciliation may have incremented revision since the host's last read.
  -- Reject any already-stale command; permit only its own expiry reconciliation.
  if body->>'revision' is null or (body->>'revision')::integer<>(r.state->>'revision')::integer then raise exception 'The room changed. Refreshing its state; try again.'; end if;
  if action='start' then
    if s->>'phase'<>'LOBBY' or not exists(select 1 from classroom_private.players where room_id=r.id) then raise exception 'Start requires a lobby with at least one player.'; end if;
    now_ms:=floor(extract(epoch from clock_timestamp())*1000);
    insert into classroom_private.attempts(room_id,player_id,status,deadline)
      select r.id,id,'OPEN',now_ms+(s->'quiz'->'questions'->0->>'seconds')::bigint*1000 from classroom_private.players where room_id=r.id;
    s:=s || jsonb_build_object('phase','RUNNING');
  elsif action='close_session' then
    if s->>'phase'<>'RUNNING' then raise exception 'This session is not running.'; end if;
    update classroom_private.attempts set status='FINISHED',deadline=null,finished_at=coalesce(finished_at,clock_timestamp()) where room_id=r.id;
    s:=s || jsonb_build_object('phase','FINISHED','revealedCount',total);
  elsif action='cancel' then
    if s->>'phase' in ('FINISHED','CANCELLED') then raise exception 'This game has ended.'; end if;
    s:=s || jsonb_build_object('phase','CANCELLED');
  else raise exception 'This control is unavailable in self-paced mode.';
  end if;
  update classroom_private.rooms set state=s || jsonb_build_object('revision',rev+1) where id=r.id;
  return classroom_private.self_snapshot(r.id,who,true);
end;
$$;

create function public.classroom_request(body jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare action text:=coalesce(body->>'action','dashboard'); result jsonb; chosen text; feedback text; r classroom_private.rooms;
begin
  if auth.uid() is null then raise exception 'Sign in before continuing.' using errcode='42501'; end if;
  if pg_column_size(body)>300000 then raise exception 'Request is too large.'; end if;
  if action='capabilities' then return jsonb_build_object('schemaVersion',2,'selfPaced',true); end if;
  if action='host' then
    chosen:=coalesce(body->>'mode','teacher'); feedback:=coalesce(body->>'feedback','end');
    if chosen not in ('teacher','self') or feedback not in ('each','end') then raise exception 'Choose a valid session mode and feedback option.'; end if;
    result:=classroom_private.teacher_request(body);
    update classroom_private.rooms set state=state || jsonb_build_object('mode',chosen,'feedback',feedback) where code=result->>'code';
    return result || jsonb_build_object('mode',chosen,'feedback',feedback);
  end if;
  if action not in ('dashboard','save','delete') then
    select * into r from classroom_private.rooms where code=upper(body->>'code');
    if found and r.state->>'mode'='self' then
      if action='join' then
        result:=classroom_private.teacher_request(body); return result;
      elsif action='remove' then
        -- Legacy lobby removal is still valid and uses the mode-aware snapshot.
        return classroom_private.teacher_request(body);
      elsif action='export' then
        -- Export all self-paced questions, including unanswered questions.
        if r.owner_id<>auth.uid() or not classroom_private.is_admin(auth.uid()) then raise exception 'You do not own this room.' using errcode='42501'; end if;
        return jsonb_build_object('state',classroom_private.self_snapshot(r.id,auth.uid(),true) || jsonb_build_object('revealedCount',jsonb_array_length(r.state->'quiz'->'questions')),
          'questions',r.state->'quiz'->'questions','answers',(select coalesce(jsonb_agg(jsonb_build_object('playerId',player_id,'index',question_index,'choice',choice)),'[]'::jsonb) from classroom_private.answers where room_id=r.id));
      else return classroom_private.self_request(body); end if;
    end if;
  end if;
  return classroom_private.teacher_request(body);
end;
$$;

-- Keep the already scheduled Cron command unchanged.
create function classroom_private.expire_questions() returns integer
language plpgsql security definer set search_path='' as $$
declare n integer; r record;
begin
  n:=classroom_private.expire_teacher_questions();
  for r in select id from classroom_private.rooms where state->>'mode'='self' and state->>'phase'='RUNNING' for update skip locked loop
    perform classroom_private.self_reconcile(r.id);
  end loop;
  return n;
end;
$$;
revoke all on all functions in schema classroom_private from public,anon,authenticated;
revoke all on function public.classroom_request(jsonb) from public,anon;
grant execute on function public.classroom_request(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
