-- Source fragment for the migration generator. Run the generated migration 003, not this file.
begin;
alter table classroom_private.quizzes add column revision integer not null default 1;
alter table classroom_private.attempts add column started_at timestamptz;
alter table classroom_private.attempts add column overall_deadline bigint;
alter table classroom_private.attempts add column finish_reason text;
create table classroom_private.drafts (
 id uuid primary key, owner_id uuid not null references auth.users(id), kind text not null check(kind in ('editor','import')),
 payload jsonb not null, revision integer not null default 1, updated_at timestamptz not null default clock_timestamp(),
 published_id uuid, published_revision integer
);
create index classroom_draft_owner on classroom_private.drafts(owner_id,updated_at desc);
alter table classroom_private.drafts enable row level security;
revoke all on classroom_private.drafts from public,anon,authenticated;
create table classroom_private.exposures (
 room_id uuid not null,player_id uuid not null,question_index integer not null,opened_at timestamptz not null default clock_timestamp(),
 primary key(room_id,player_id,question_index),
 foreign key(room_id,player_id) references classroom_private.players(room_id,id) on delete cascade
);
alter table classroom_private.exposures enable row level security;
revoke all on classroom_private.exposures from public,anon,authenticated;
create index classroom_overall_due on classroom_private.attempts(overall_deadline) where status<>'FINISHED';

create function classroom_private.random_order(n integer, shuffled boolean) returns jsonb
language sql volatile set search_path='' as $$
 select coalesce(jsonb_agg(i order by case when shuffled then random() else i::double precision end),'[]'::jsonb) from generate_series(0,n-1) i;
$$;
create function classroom_private.canonical_index(s jsonb,p uuid,step_number integer) returns integer
language sql immutable set search_path='' as $$select coalesce((s->'questionOrders'->p::text->>step_number)::integer,step_number)$$;
create function classroom_private.choice_order(s jsonb,p uuid,idx integer) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(s->'choiceOrders'->p::text->idx,(select jsonb_agg(i order by i) from generate_series(0,jsonb_array_length(s->'quiz'->'questions'->idx->'choices')-1)i));
$$;

alter function public.classroom_request(jsonb) set schema classroom_private;
alter function classroom_private.classroom_request(jsonb) rename to v2_request;
alter function classroom_private.snapshot(uuid,uuid,boolean) rename to v2_snapshot;
alter function classroom_private.self_snapshot(uuid,uuid,boolean) rename to v2_self_snapshot;

create or replace function classroom_private.self_reconcile(room uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s jsonb; changed integer;
begin
 select state into s from classroom_private.rooms where id=room for update;
 if s->>'phase'<>'RUNNING' then return; end if;
 if s->>'timerMode'='quiz' then
   update classroom_private.attempts set status='FINISHED',deadline=null,finished_at=clock_timestamp(),finish_reason='overall_timeout'
    where room_id=room and status<>'FINISHED' and overall_deadline<=extract(epoch from clock_timestamp())*1000;
 else
   update classroom_private.attempts set status=case when s->>'feedback'='each' then 'REVIEW' else 'LOCKED' end
    where room_id=room and status='OPEN' and deadline<=extract(epoch from clock_timestamp())*1000;
 end if;
 get diagnostics changed=row_count;
 if changed>0 then
   if not exists(select 1 from classroom_private.attempts where room_id=room and status<>'FINISHED') then s:=s||jsonb_build_object('phase','FINISHED','revealedCount',jsonb_array_length(s->'quiz'->'questions')); end if;
   update classroom_private.rooms set state=s||jsonb_build_object('revision',(s->>'revision')::integer+1) where id=room;
 end if;
end;
$$;

create or replace function classroom_private.self_snapshot(room uuid, who uuid, hosting boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r classroom_private.rooms; s jsonb; p uuid; a classroom_private.attempts;
  canonical integer; allowed boolean; q jsonb; board jsonb; result jsonb; own integer; total integer; idx integer;
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
  idx:=coalesce(a.question_index,0); canonical:=classroom_private.canonical_index(s,p,idx); allowed:=s->>'phase'<>'CANCELLED' and (s->>'feedback'<>'session_end' or s->>'phase'='FINISHED');
  phase:=case when s->>'phase' in ('LOBBY','CANCELLED','FINISHED') then s->>'phase'
    when hosting then 'RUNNING' when done then 'ATTEMPT_FINISHED'
    when a.status='OPEN' then 'QUESTION_OPEN' when a.status='REVIEW' then 'ANSWER_REVEALED' else 'QUESTION_LOCKED' end;
  if s->>'phase'<>'LOBBY' and not hosting and not done then q:=s->'quiz'->'questions'->canonical; end if;
  reveal_current:=s->>'feedback'='each' and a.status='REVIEW';
  select choice into own from classroom_private.answers where room_id=room and player_id=p and question_index=canonical;
  board:=classroom_private.board(room,s || jsonb_build_object('revealedCount',total));
  select (x->>'score')::integer into own_score from jsonb_array_elements(board) x where x->>'id'=p::text;
  result:=jsonb_build_object('id',r.id,'code',r.code,'title',s->'quiz'->>'title',
    'timerMode',coalesce(s->>'timerMode','question'),'quizDurationSeconds',s->'quizDurationSeconds','finishReason',a.finish_reason,'mode','self','feedback',s->>'feedback','phase',phase,'sessionPhase',s->>'phase',
    'revision',(s->>'revision')::integer,'index',idx,'total',total,
    'deadline',case when hosting and s->>'timerMode'='quiz' and s->>'phase'='RUNNING' then (select min(overall_deadline) from classroom_private.attempts where room_id=room) when a.status<>'FINISHED' and s->>'timerMode'='quiz' then a.overall_deadline when a.status='OPEN' then a.deadline else null end,
    'serverNow',floor(extract(epoch from clock_timestamp())*1000),
    'ownAnswer',own,'score',case when (s->>'feedback'='each' or done) and allowed then coalesce(own_score,0) else null end,
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
    'review',case when not hosting and done and allowed then (
      select coalesce(jsonb_agg(jsonb_build_object('prompt',x.value->>'prompt','choices',x.value->'choices',
        'correct',x.value->'correct','explanation',x.value->>'explanation','ownAnswer',z.choice) order by x.ordinality),'[]'::jsonb)
      from jsonb_array_elements(s->'quiz'->'questions') with ordinality x
      left join classroom_private.answers z on z.room_id=room and z.player_id=p and z.question_index=x.ordinality-1
    ) else '[]'::jsonb end);
  return result;
end;
$$;
create or replace function classroom_private.self_request(body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid(); action text:=body->>'action'; r classroom_private.rooms; s jsonb;
  a classroom_private.attempts; p uuid; idx integer; canonical integer; total integer; q jsonb; choice integer;
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
    idx:=a.question_index; canonical:=classroom_private.canonical_index(s,p,idx); q:=s->'quiz'->'questions'->canonical;
    if q->>'id' is distinct from body->>'questionId' then raise exception 'This question is no longer active. Refresh your attempt.'; end if;
    if action='answer' then
      if exists(select 1 from classroom_private.answers where room_id=r.id and player_id=p and question_index=canonical) then return classroom_private.self_snapshot(r.id,who,false); end if;
      now_ms:=floor(extract(epoch from clock_timestamp())*1000);
      if a.status<>'OPEN' or now_ms>=a.deadline then raise exception 'Time is up. Answers are locked.'; end if;
      if coalesce(body->>'choice','') !~ '^\d+$' then raise exception 'Choose a valid answer.'; end if;
      choice:=(body->>'choice')::integer;
      if choice not between 0 and jsonb_array_length(q->'choices')-1 then raise exception 'Choose a valid answer.'; end if;
      insert into classroom_private.answers(room_id,player_id,question_index,choice,received_at) values(r.id,p,canonical,choice,to_timestamp(now_ms/1000.0));
      update classroom_private.attempts set status=case when s->>'feedback'='each' then 'REVIEW' else 'LOCKED' end where room_id=r.id and player_id=p;
    else
      if a.status='OPEN' then raise exception 'Submit your answer or wait for the timer before continuing.'; end if;
      if idx=total-1 then
        update classroom_private.attempts set status='FINISHED',deadline=null,finished_at=clock_timestamp(),finish_reason='student_finished' where room_id=r.id and player_id=p;
        if not exists(select 1 from classroom_private.attempts where room_id=r.id and status<>'FINISHED') then s:=s || jsonb_build_object('phase','FINISHED','revealedCount',total); end if;
      else
        now_ms:=floor(extract(epoch from clock_timestamp())*1000);
        update classroom_private.attempts set question_index=idx+1,status='OPEN',deadline=coalesce(a.overall_deadline,now_ms+(s->'quiz'->'questions'->classroom_private.canonical_index(s,p,idx+1)->>'seconds')::bigint*1000) where room_id=r.id and player_id=p;
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
      select r.id,id,'OPEN',case when s->>'timerMode'='quiz' then now_ms+(s->>'quizDurationSeconds')::bigint*1000 else now_ms+(s->'quiz'->'questions'->classroom_private.canonical_index(s,id,0)->>'seconds')::bigint*1000 end from classroom_private.players where room_id=r.id;
    update classroom_private.attempts set started_at=to_timestamp(now_ms/1000.0), overall_deadline=case when s->>'timerMode'='quiz' then deadline else null end where room_id=r.id; s:=s || jsonb_build_object('phase','RUNNING');
  elsif action='close_session' then
    if s->>'phase'<>'RUNNING' then raise exception 'This session is not running.'; end if;
    update classroom_private.attempts set status='FINISHED',deadline=null,finished_at=coalesce(finished_at,clock_timestamp()),finish_reason=coalesce(finish_reason,'teacher_closed') where room_id=r.id;
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
-- Source fragment for the migration generator.
create function classroom_private.display_snapshot(room uuid,who uuid,hosting boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s jsonb; result jsonb; p uuid; idx integer; q jsonb; ordering jsonb; own integer; correct integer; review jsonb:='[]'; item jsonb; canonical integer; step integer;
begin
 select state into s from classroom_private.rooms where id=room;
 if s->>'mode'='self' then result:=classroom_private.self_snapshot(room,who,hosting);
 else result:=classroom_private.teacher_snapshot(room,who,hosting)||jsonb_build_object('mode','teacher'); end if;
 select id into p from classroom_private.players where room_id=room and user_id=who;
 idx:=(result->>'index')::integer;
 if s->>'mode'='self' then idx:=classroom_private.canonical_index(s,p,idx); end if;
 q:=result->'question';
 if q is not null and q<>'null'::jsonb then
   ordering:=classroom_private.choice_order(s,case when hosting then null else p end,idx);
   own:=(result->>'ownAnswer')::integer; correct:=(q->>'correct')::integer;
   q:=q||jsonb_build_object('choices',(select jsonb_agg(q->'choices'->(v.value::text)::integer order by v.ordinality) from jsonb_array_elements(ordering) with ordinality v),
     'choiceIds',(select jsonb_agg((q->>'id')||':'||(v.value::text) order by v.ordinality) from jsonb_array_elements(ordering) with ordinality v));
   if correct is not null then q:=q||jsonb_build_object('correct',(select ordinality-1 from jsonb_array_elements(ordering) with ordinality where value=to_jsonb(correct))); end if;
   result:=result||jsonb_build_object('question',q,'ownAnswer',case when own is not null then (select ordinality-1 from jsonb_array_elements(ordering) with ordinality where value=to_jsonb(own)) else null end);
 end if;
 if jsonb_array_length(coalesce(result->'review','[]'::jsonb))>0 then
   for step in 0..jsonb_array_length(result->'review')-1 loop
     canonical:=classroom_private.canonical_index(s,p,step);item:=result->'review'->canonical;ordering:=classroom_private.choice_order(s,p,canonical);
     review:=review||jsonb_build_array(item||jsonb_build_object('id',s->'quiz'->'questions'->canonical->>'id','choices',(select jsonb_agg(item->'choices'->(v.value::text)::integer order by v.ordinality) from jsonb_array_elements(ordering) with ordinality v),
      'correct',(select ordinality-1 from jsonb_array_elements(ordering) with ordinality where value=item->'correct'),
      'ownAnswer',(select ordinality-1 from jsonb_array_elements(ordering) with ordinality where value=item->'ownAnswer')));
   end loop;
   result:=result||jsonb_build_object('review',review);
 end if;
 return result||jsonb_build_object('settingsVersion',coalesce((s->>'settingsVersion')::integer,2),'timerMode',coalesce(s->>'timerMode','question'),'quizDurationSeconds',s->'quizDurationSeconds','shuffleChoices',coalesce((s->>'shuffleChoices')::boolean,false));
end;
$$;
create function classroom_private.snapshot(room uuid,who uuid,hosting boolean) returns jsonb
language sql security definer set search_path='' as $$ select classroom_private.display_snapshot(room,who,hosting) $$;

create function classroom_private.capture_exposure() returns trigger
language plpgsql security definer set search_path='' as $$
declare s jsonb; idx integer;
begin
 select state into s from classroom_private.rooms where id=new.room_id;
 idx:=classroom_private.canonical_index(s,new.player_id,new.question_index);
 if new.status='OPEN' then insert into classroom_private.exposures(room_id,player_id,question_index) values(new.room_id,new.player_id,idx) on conflict do nothing; end if;
 return new;
end;
$$;
create trigger classroom_attempt_exposure after insert or update on classroom_private.attempts for each row execute function classroom_private.capture_exposure();
create function classroom_private.capture_teacher_exposure() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.state->>'mode' is distinct from 'self' and new.state->>'phase'='QUESTION_OPEN' then
  insert into classroom_private.exposures(room_id,player_id,question_index)
   select new.id,id,(new.state->>'index')::integer from classroom_private.players where room_id=new.id on conflict do nothing;
 end if; return new;
end;
$$;
create trigger classroom_teacher_exposure after update on classroom_private.rooms for each row execute function classroom_private.capture_teacher_exposure();

create function public.classroom_request(body jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid(); action text:=coalesce(body->>'action','dashboard'); result jsonb; r classroom_private.rooms; s jsonb; p record; q record; ordering jsonb; orders jsonb:='{}'; choices jsonb:='{}'; list jsonb; idx integer; canonical integer; selected_value integer; d classroom_private.drafts; published uuid; updated_id uuid; source classroom_private.quizzes; presented integer; feedback text; timer text;
begin
 if who is null then raise exception 'Sign in before continuing.' using errcode='42501'; end if;
 if pg_column_size(body)>600000 then raise exception 'Request is too large.'; end if;
 if action='capabilities' then return jsonb_build_object('schemaVersion',3,'selfPaced',true,'expansion',true,'drafts',true); end if;
 if action like 'draft_%' then
  if not classroom_private.is_admin(who) then raise exception 'Administrator access required.' using errcode='42501'; end if;
  if action='draft_list' then return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'title',coalesce(payload->'quiz'->>'title',payload->'result'->>'title','Untitled draft'),'revision',revision,'updatedAt',extract(epoch from updated_at)*1000) order by updated_at desc),'[]') from classroom_private.drafts where owner_id=who and published_id is null); end if;
  select * into d from classroom_private.drafts where id=(body->>'id')::uuid for update;
  if found and d.owner_id<>who then raise exception 'You do not own this draft.' using errcode='42501'; end if;
  if action='draft_load' then if d.id is null then raise exception 'Draft not found.'; end if; return to_jsonb(d); end if;
  if action='draft_save' then
   if body->>'kind' not in ('editor','import') or jsonb_typeof(body->'payload') is distinct from 'object' then raise exception 'Invalid draft payload.'; end if;
   if pg_column_size(body->'payload')>500000 then raise exception 'Draft exceeds the 500 KB limit.'; end if;
   if d.id is not null and ((body->>'revision')::integer is distinct from d.revision or d.published_id is not null) then raise exception 'Draft conflict. Save your recovery copy as a new draft or reload the cloud version.'; end if;
   if d.id is null and coalesce((body->>'revision')::integer,0)<>0 then raise exception 'Draft was discarded. Save recovery as a new draft.'; end if;
   if d.id is null then
    insert into classroom_private.drafts(id,owner_id,kind,payload) values((body->>'id')::uuid,who,body->>'kind',body->'payload') returning * into d;
   else update classroom_private.drafts set payload=body->'payload',revision=revision+1,updated_at=clock_timestamp() where id=d.id returning * into d; end if;
   return to_jsonb(d);
  end if;
  if d.id is null then raise exception 'Draft not found.'; end if;
  if action='draft_discard' then
   if (body->>'revision')::integer is distinct from d.revision then raise exception 'Draft changed. Reload before discarding.'; end if;
   delete from classroom_private.drafts where id=d.id;return jsonb_build_object('ok',true);
  end if;
  if action='draft_publish' then
   if d.published_id is not null and d.published_revision=(body->>'revision')::integer then return jsonb_build_object('quiz',jsonb_build_object('id',d.published_id)); end if;
   if (body->>'revision')::integer is distinct from d.revision then raise exception 'Draft changed. Save and review before publishing.'; end if;
   if d.kind='import' and exists(select 1 from jsonb_array_elements(d.payload->'result'->'questions') iq(value) cross join lateral jsonb_array_elements(coalesce(iq.value->'issues','[]')) i where coalesce((i->>'acknowledged')::boolean,false)=false) then raise exception 'Review every flagged import note before publishing.'; end if;
   s:=case when d.kind='editor' then d.payload->'quiz' else d.payload->'result' end;
   if s->>'id' is not null then
    select * into source from classroom_private.quizzes where id=(s->>'id')::uuid for update;
    if not found then raise exception 'Source quiz was deleted. Save as a new quiz.'; end if;
    if source.owner_id<>who or not(s ? 'revision') or (s->>'revision')::integer<>source.revision then raise exception 'Source quiz changed. Save as a new quiz or reload.'; end if;
   end if;
   result:=classroom_private.v2_request(jsonb_build_object('action','save','quiz',s));
   published:=(result->'quiz'->>'id')::uuid;
   update classroom_private.quizzes set revision=revision+1 where id=published;
   result:=jsonb_set(result,'{quiz,revision}',to_jsonb((select revision from classroom_private.quizzes where id=published)));
   update classroom_private.drafts set published_id=published,published_revision=d.revision where id=d.id;
   return result;
  end if;
  raise exception 'Unknown draft action.';
 end if;
 if action='save' then
  if not classroom_private.is_admin(who) then raise exception 'Administrator access required.' using errcode='42501'; end if;
  if body->'quiz'->>'id' is not null then
   select * into source from classroom_private.quizzes where id=(body->'quiz'->>'id')::uuid for update;
   if found and source.owner_id<>who then raise exception 'You do not own this quiz.' using errcode='42501'; end if;
   if found and body->'quiz' ? 'revision' and (body->'quiz'->>'revision')::integer<>source.revision then raise exception 'Quiz changed in another tab. Save as a new quiz or reload.'; end if;
  end if;
  result:=classroom_private.v2_request(body);
  update classroom_private.quizzes set revision=revision+1 where id=(result->'quiz'->>'id')::uuid returning id into updated_id;
  result:=jsonb_set(result,'{quiz,revision}',to_jsonb((select revision from classroom_private.quizzes where id=updated_id)));
  return result;
 end if;
 if action='dashboard' then
  result:=classroom_private.v2_request(body);
  if (result->>'admin')::boolean then result:=jsonb_set(result,'{quizzes}',(select coalesce(jsonb_agg(data||jsonb_build_object('id',id,'revision',revision,'updatedAt',extract(epoch from updated_at)*1000) order by updated_at desc),'[]') from classroom_private.quizzes where owner_id=who)); end if;
  return result;
 end if;
 if action='host' then
  feedback:=coalesce(body->>'feedback','end');timer:=coalesce(body->>'timerMode','question');
  if feedback not in ('each','end','session_end') or timer not in ('question','quiz') or (timer='quiz' and coalesce(body->>'mode','teacher')<>'self') then raise exception 'Invalid session settings.'; end if;
  if coalesce(body->>'quizDurationSeconds','1200') !~ '^\d+$' or coalesce((body->>'quizDurationSeconds')::integer,1200) not between 60 and 10800 then raise exception 'Whole-quiz duration must be 1–180 minutes.'; end if;
  result:=classroom_private.v2_request(body||jsonb_build_object('feedback',case when feedback='session_end' then 'end' else feedback end));
  select * into r from classroom_private.rooms where code=result->>'code' for update;
  s:=r.state||jsonb_build_object('settingsVersion',3,'feedback',feedback,'timerMode',timer,'quizDurationSeconds',coalesce((body->>'quizDurationSeconds')::integer,1200),'shuffleQuestions',coalesce((body->>'shuffleQuestions')::boolean,false),'shuffleChoices',coalesce((body->>'shuffleChoices')::boolean,false));
  list:=(select jsonb_agg(value||jsonb_build_object('sourceIndex',ordinality-1) order by ordinality) from jsonb_array_elements(s->'quiz'->'questions') with ordinality);
  if s->>'mode'='teacher' and (s->>'shuffleQuestions')::boolean then list:=(select jsonb_agg(value order by random()) from jsonb_array_elements(list)); end if;
  s:=jsonb_set(s,'{quiz,questions}',list);update classroom_private.rooms set state=s where id=r.id;
  return result||jsonb_build_object('settingsVersion',3);
 end if;
 if action='delete' then return classroom_private.v2_request(body); end if;
 if action not in ('snapshot','join','remove','answer','start','next_self','next','close','reveal','finish','cancel','close_session','export','session_analysis') then raise exception 'Unknown game action.'; end if;
 select * into r from classroom_private.rooms where code=upper(body->>'code') for update;
 if not found then raise exception 'Room not found.'; end if;
 s:=r.state;
 if action='session_analysis' then
  if r.owner_id<>who or not classroom_private.is_admin(who) then raise exception 'You do not own this room.' using errcode='42501'; end if;
  if s->>'mode'='self' then perform classroom_private.self_reconcile(r.id); end if;
  return classroom_private.session_analysis(r.id);
 end if;
 if action='start' and (s->>'settingsVersion')::integer=3 then
  if r.owner_id<>who or not classroom_private.is_admin(who) or s->>'phase'<>'LOBBY' then raise exception 'You do not own this room or it has already started.' using errcode='42501'; end if;
  for p in select id from classroom_private.players where room_id=r.id loop
   orders:=orders||jsonb_build_object(p.id::text,classroom_private.random_order(jsonb_array_length(s->'quiz'->'questions'),s->>'mode'='self' and (s->>'shuffleQuestions')::boolean));
   list:='[]';for q in select value from jsonb_array_elements(s->'quiz'->'questions') loop list:=list||jsonb_build_array(classroom_private.random_order(jsonb_array_length(q.value->'choices'),(s->>'shuffleChoices')::boolean));end loop;
   choices:=choices||jsonb_build_object(p.id::text,list);
  end loop;
  s:=s||jsonb_build_object('questionOrders',orders,'choiceOrders',choices);update classroom_private.rooms set state=s where id=r.id;
 end if;
 if action='answer' then
  select id into updated_id from classroom_private.players where room_id=r.id and user_id=who;
  if updated_id is null then raise exception 'Your player session is no longer valid.' using errcode='42501'; end if;
  if s->>'mode'='self' then select question_index into idx from classroom_private.attempts where room_id=r.id and player_id=updated_id;canonical:=classroom_private.canonical_index(s,updated_id,idx);
  else canonical:=(s->>'index')::integer;end if;
  if body ? 'choiceId' then
   select ordinality-1 into selected_value from jsonb_array_elements(s->'quiz'->'questions'->canonical->'choices') with ordinality where (s->'quiz'->'questions'->canonical->>'id')||':'||(ordinality-1)::text=body->>'choiceId';
   if selected_value is null then raise exception 'Invalid choice ID for this question.'; end if;body:=body||jsonb_build_object('choice',selected_value);
  elsif coalesce((s->>'shuffleChoices')::boolean,false) then raise exception 'Refresh this page to use shuffled choice IDs.';end if;
 end if;
 if s->>'mode'='self' and action in ('snapshot','answer','next_self','start','close_session','cancel') then
  result:=classroom_private.self_request(body);
  return classroom_private.display_snapshot(r.id,who,action not in ('answer','next_self') and (action<>'snapshot' or coalesce((body->>'hosting')::boolean,false)));
 end if;
 result:=classroom_private.v2_request(body);
 if action in ('snapshot','answer','start','next','close','reveal','finish','cancel','remove') then
  return classroom_private.display_snapshot(r.id,who,action<>'answer' and (action<>'snapshot' or coalesce((body->>'hosting')::boolean,false)));
 end if;
 return result;
end;
$$;

create function classroom_private.session_analysis(room uuid) returns jsonb
language sql security definer set search_path='' as $$
 with r as (select * from classroom_private.rooms where id=room), roster as(select count(*)::integer n from classroom_private.players where room_id=room),
 questions as(select value q,(ordinality-1)::integer idx from r,jsonb_array_elements(r.state->'quiz'->'questions') with ordinality),
 metrics as(select q,idx,(select count(*) from classroom_private.answers where room_id=room and question_index=idx)::integer submitted,
 (select count(*) from classroom_private.answers where room_id=room and question_index=idx and choice=(q->>'correct')::integer)::integer correct,
 (select count(*) from classroom_private.exposures where room_id=room and question_index=idx)::integer reached,
 (select percentile_cont(0.5) within group(order by greatest(0,extract(epoch from (a.received_at-e.opened_at))*1000)) from classroom_private.answers a join classroom_private.exposures e using(room_id,player_id,question_index) where a.room_id=room and a.question_index=idx) median,
 (select count(*) from classroom_private.answers a join classroom_private.exposures e using(room_id,player_id,question_index) where a.room_id=room and a.question_index=idx)::integer samples from questions)
 select jsonb_build_object('title',r.state->'quiz'->>'title','phase',r.state->>'phase','mode',coalesce(r.state->>'mode','teacher'),'eligible',n,'questions',
 (select coalesce(jsonb_agg(jsonb_build_object('id',q->>'id','index',idx,'sourceIndex',coalesce((q->>'sourceIndex')::integer,idx),'prompt',q->>'prompt','choices',q->'choices','correctChoice',q->'correct','explanation',q->>'explanation','eligible',n,'submitted',submitted,'correct',correct,'incorrect',submitted-correct,'unanswered',case when r.state->>'phase'='FINISHED' then n-submitted else null end,'reached',case when r.state ? 'settingsVersion' and (r.state->>'settingsVersion')::integer>=3 then reached else null end,'correctRate',correct::numeric/nullif(n,0),'submissionAccuracy',correct::numeric/nullif(submitted,0),'medianResponseMs',median,'timingSamples',samples,
 'distribution',(select jsonb_agg(jsonb_build_object('text',c.value,'count',(select count(*) from classroom_private.answers where room_id=room and question_index=idx and choice=c.ordinality-1)) order by c.ordinality) from jsonb_array_elements(q->'choices') with ordinality c)) order by coalesce((q->>'sourceIndex')::integer,idx)),'[]') from metrics)) from r,roster;
$$;

revoke all on all functions in schema classroom_private from public,anon,authenticated;
revoke all on function public.classroom_request(jsonb) from public,anon;
grant execute on function public.classroom_request(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
