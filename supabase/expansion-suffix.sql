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
