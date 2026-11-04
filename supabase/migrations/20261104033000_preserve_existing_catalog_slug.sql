create or replace function public.importb2b_keep_catalog_slug() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.public_slug is null then
    select s.public_slug into new.public_slug from public.importb2b_catalog_settings s where s.owner_id = new.owner_id;
  end if;
  return new;
end;
$$;
create trigger importb2b_keep_catalog_slug before insert or update of public_slug on public.importb2b_catalog_settings
for each row when (new.public_slug is null) execute function public.importb2b_keep_catalog_slug();