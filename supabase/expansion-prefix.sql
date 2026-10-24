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
