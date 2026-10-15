-- Shared Central workspace for the two existing administrators.
-- Existing rows retain their original owner_id; created_by remains the actor.
CREATE OR REPLACE FUNCTION public.importb2b_shared_owner()
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
SELECT CASE WHEN auth.uid() IN ('9503c97f-e84e-467c-b22e-14745e6f62d9'::uuid,'ff1ccd91-3b9a-4c37-bf19-dd28adabbb39'::uuid)
THEN '9503c97f-e84e-467c-b22e-14745e6f62d9'::uuid ELSE auth.uid() END $$;

DO $$
DECLARE rec record;
BEGIN
  FOR rec IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tbl
      ON tbl.table_schema=c.table_schema AND tbl.table_name=c.table_name
    WHERE c.table_schema='public' AND tbl.table_type='BASE TABLE'
      AND c.column_name='owner_id' AND c.table_name LIKE 'importb2b_%'
      AND c.table_name <> 'importb2b_push_subscriptions'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS central_two_admins_shared ON public.%I',rec.table_name);
    EXECUTE format(
      'CREATE POLICY central_two_admins_shared ON public.%I FOR ALL TO authenticated
       USING (auth.uid() IN (%L::uuid,%L::uuid) AND owner_id IN (%L::uuid,%L::uuid))
       WITH CHECK (auth.uid() IN (%L::uuid,%L::uuid) AND owner_id IN (%L::uuid,%L::uuid))',
       rec.table_name,'9503c97f-e84e-467c-b22e-14745e6f62d9','ff1ccd91-3b9a-4c37-bf19-dd28adabbb39','9503c97f-e84e-467c-b22e-14745e6f62d9','ff1ccd91-3b9a-4c37-bf19-dd28adabbb39','9503c97f-e84e-467c-b22e-14745e6f62d9','ff1ccd91-3b9a-4c37-bf19-dd28adabbb39','9503c97f-e84e-467c-b22e-14745e6f62d9','ff1ccd91-3b9a-4c37-bf19-dd28adabbb39'
    );
  END LOOP;
END $$;

-- Preserve each function's existing signature and business logic while
-- resolving the shared owner for POS operations.
DO $$
DECLARE rec record; src text; changed text;
BEGIN
  FOR rec IN SELECT oid,proname FROM pg_proc
    WHERE pronamespace='public'::regnamespace
      AND proname IN ('importb2b_complete_sale','importb2b_complete_quick_sale')
  LOOP
    src:=pg_get_functiondef(rec.oid);
    IF position('v_uid uuid:=public.importb2b_shared_owner()' in src)>0 THEN CONTINUE; END IF;
    changed:=replace(src,'v_uid uuid:=auth.uid();',
      'v_uid uuid:=public.importb2b_shared_owner(); v_actor uuid:=auth.uid();');
    IF changed=src THEN RAISE EXCEPTION 'Unexpected function definition %',rec.proname; END IF;
    changed:=replace(changed,',v_uid,''pending'')',',v_actor,''pending'')');
    changed:=replace(changed,',v_uid,''linked'')',',v_actor,''linked'')');
    changed:=replace(changed,'where id=v_uid),auth.email()',
      'where id=v_actor),auth.email()');
    EXECUTE changed;
  END LOOP;
END $$;
