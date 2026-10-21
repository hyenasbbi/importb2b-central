-- Read notices expire 24 hours after reading; unread notices are retained.
create index if not exists notifications_read_at_cleanup_idx on public.notifications(read_at) where read_at is not null;
select cron.schedule('importb2b-read-notifications-cleanup','*/5 * * * *',$job$delete from public.notifications where read_at <= now() - interval '24 hours'$job$);
