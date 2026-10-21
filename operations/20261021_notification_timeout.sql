-- Keep existing schedules and cron-secret lookup, allow the HTTP call to finish.
do $$
declare task record;
begin
  for task in select jobid,command from cron.job where jobname in
    ('importb2b-finance-reminder-3d','importb2b-sales-reminder-weekdays') loop
    if task.command not like '%timeout_milliseconds := 10000%' then
      raise exception 'Unexpected cron timeout configuration; inspect before applying';
    end if;
    perform cron.alter_job(task.jobid,command:=replace(task.command,
      'timeout_milliseconds := 10000','timeout_milliseconds := 60000'));
  end loop;
end $$;
