alter table public.objects add column if not exists start_date date;
alter table public.objects add column if not exists responsible_user_id uuid references auth.users(id) on delete set null;
create table public.team_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null,
 email text not null unique
);
alter table public.team_members enable row level security;
grant select on public.team_members to authenticated;
create policy "Members read own profile and admins read team" on public.team_members for select to authenticated
 using (user_id=(select auth.uid()) or exists(select 1 from public.admins where user_id=(select auth.uid())));
insert into public.team_members(user_id,full_name,email)
 select id,email,email from auth.users where email is not null;
create policy "Employees read assigned objects" on public.objects for select to authenticated
 using (responsible_user_id=(select auth.uid()));
create table public.daily_reports (
 id uuid primary key default gen_random_uuid(),
 object_id bigint not null references public.objects(id),
 author_id uuid not null references auth.users(id),
 report_date date not null,
 done text not null check(length(trim(done))>0),
 next_plan text not null default '',
 problems text not null default '',
 needs text not null default '',
 photos text[] not null default '{}',
 created_at timestamptz not null default now()
);
create index daily_reports_object_date on public.daily_reports(object_id,report_date desc);
create index objects_responsible_user on public.objects(responsible_user_id);
alter table public.daily_reports enable row level security;
grant select,insert on public.daily_reports to authenticated;
grant update(photos) on public.daily_reports to authenticated;
create policy "Read reports for accessible objects" on public.daily_reports for select to authenticated
 using (exists(select 1 from public.objects o where o.id=object_id));
create policy "Create own reports for accessible objects" on public.daily_reports for insert to authenticated
 with check (author_id=(select auth.uid()) and photos='{}'::text[] and exists(select 1 from public.objects o where o.id=object_id));
create policy "Attach photos to own accessible reports" on public.daily_reports for update to authenticated
 using (author_id=(select auth.uid()) and exists(select 1 from public.objects o where o.id=object_id))
 with check (author_id=(select auth.uid()) and exists(select 1 from public.objects o where o.id=object_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values ('daily-photos','daily-photos',false,10485760,array['image/jpeg','image/png','image/webp']);
create policy "Read photos for accessible objects" on storage.objects for select to authenticated
 using (bucket_id='daily-photos' and exists(select 1 from public.objects o where o.id::text=(storage.foldername(name))[1]));
create policy "Upload own report photos" on storage.objects for insert to authenticated
 with check (bucket_id='daily-photos' and (storage.foldername(name))[3]=(select auth.uid())::text
 and exists(select 1 from public.daily_reports r where r.id::text=(storage.foldername(name))[2]
 and r.object_id::text=(storage.foldername(name))[1] and r.author_id=(select auth.uid())));
create policy "Remove own uploaded report photos" on storage.objects for delete to authenticated
 using (bucket_id='daily-photos' and (storage.foldername(name))[3]=(select auth.uid())::text
 and exists(select 1 from public.daily_reports r where r.id::text=(storage.foldername(name))[2]
 and r.object_id::text=(storage.foldername(name))[1] and r.author_id=(select auth.uid())));

revoke all on public.team_members from anon,authenticated;
grant select on public.team_members to authenticated;
revoke all on public.daily_reports from anon,authenticated;
grant select,insert on public.daily_reports to authenticated;
grant update(photos) on public.daily_reports to authenticated;

-- Backend employee handler: bypassing RLS still requires table privileges.
grant select on public.admins to service_role;
grant insert on public.team_members to service_role;
