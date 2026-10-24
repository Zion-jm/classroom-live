-- First create your teacher account through Authentication > Users > Add user.
-- Replace only the email below, then run this in SQL Editor as project owner.
do $$
declare teacher uuid;
begin
  select id into teacher from auth.users
    where lower(email) = lower('REPLACE_WITH_YOUR_TEACHER_EMAIL')
      and coalesce(is_anonymous, false) = false;
  if teacher is null then raise exception 'Teacher account not found. Create the account and replace the placeholder email first.'; end if;
  insert into classroom_private.admins(user_id) values(teacher) on conflict do nothing;
end;
$$;
