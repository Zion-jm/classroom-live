-- Run AFTER the main migration. Enable the pg_cron extension in the dashboard
-- first if your project does not allow CREATE EXTENSION here.
create extension if not exists pg_cron;
do $$
declare job bigint;
begin
  select jobid into job from cron.job where jobname = 'classroom-expire-questions';
  if job is not null then perform cron.unschedule(job); end if;
  perform cron.schedule('classroom-expire-questions', '1 second',
    'select classroom_private.expire_questions();');
end;
$$;
