// Prints a transaction that tests the actual migration against temporary tables only.
// No inserts, updates, deletes or sequence calls target public business tables.
import {readFileSync} from 'node:fs';
const migration=readFileSync(new URL('../supabase/migrations/20261023121723_purchase_expense_guard.sql',import.meta.url),'utf8');
console.log(`begin;
create temp table importb2b_orders as select * from public.importb2b_orders with no data;
create temp table importb2b_expenses as select * from public.importb2b_expenses with no data;
create temp table movements (like public.movements including defaults);
alter table pg_temp.movements drop column if exists purchase_request_id;
${migration.replaceAll('public.','pg_temp.')}
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
insert into pg_temp.importb2b_orders(id,order_number,owner_id,finance_reference_id,merchandise_usdt,investment_usd,usdt_rate_ars)
values(1,1,auth.uid(),'00000000-0000-0000-0000-000000000002',100,120,1000);
do $test$
declare a jsonb; b jsonb; rejected boolean; n int;
begin
  a:=pg_temp.importb2b_register_purchase_payment_safe(1,40000,'transferencia','nahuel','00000000-0000-0000-0000-000000000011');
  b:=pg_temp.importb2b_register_purchase_payment_safe(1,40000,'transferencia','nahuel','00000000-0000-0000-0000-000000000011');
  assert a->>'movement_id'=b->>'movement_id','Retry must return the same movement';
  assert (select count(*) from pg_temp.movements)=1,'Retry inserted twice';
  assert (select registered_ars from pg_temp.importb2b_purchase_payment_status where order_id=1)=40000,'Partial balance incorrect';
  rejected:=false;
  begin
    perform pg_temp.importb2b_register_purchase_payment_safe(1,50000,'transferencia','nahuel','00000000-0000-0000-0000-000000000011');
  exception when raise_exception then rejected:=sqlerrm like '%identificador ya se usó%'; end;
  assert rejected,'Changed retry payload must fail';
  perform pg_temp.importb2b_register_purchase_payment_safe(1,60,'usdt','esteban','00000000-0000-0000-0000-000000000012');
  assert (select registered_ars from pg_temp.importb2b_purchase_payment_status where order_id=1)=100000,'Mixed currency partial payment incorrect';
  rejected:=false;
  begin
    perform pg_temp.importb2b_register_purchase_payment_safe(1,1,'efectivo','nahuel',gen_random_uuid());
  exception when raise_exception then rejected:=sqlerrm like '%supera el saldo%'; end;
  assert rejected,'Fully registered merchandise accepted another payment';
  assert (select count(*) from pg_temp.movements)=2,'Rejected payment persisted';
  rejected:=false;
  begin
    insert into pg_temp.importb2b_expenses(id,order_id,expense_type,amount_ars) values(1,1,'Materia prima',100000);
  exception when raise_exception then rejected:=sqlerrm like '%Registrar pago%'; end;
  assert rejected,'Alternate expense path allowed merchandise duplication';
  insert into pg_temp.importb2b_expenses(id,order_id,expense_type,amount_ars,provider,description) values(2,1,'Envío',20000,'Transportista','Guía A');
  rejected:=false;
  begin
    insert into pg_temp.importb2b_expenses(id,order_id,expense_type,amount_ars,provider,description) values(3,1,'Envío',20000,' transportista ','guía a');
  exception when raise_exception then rejected:=sqlerrm like '%ya está registrado%'; end;
  assert rejected,'Duplicate linked expense accepted';
  insert into pg_temp.importb2b_expenses(id,order_id,expense_type,amount_ars,provider,description) values(4,1,'Impuesto',1000,'Aduana','Tasa');
  assert (select count(*) from pg_temp.importb2b_expenses)=2,'Additional expenses blocked';
  assert (select total_ars from pg_temp.importb2b_purchase_payment_status where order_id=1)=100000,'Shipping incorrectly included in merchandise';
end;$test$;
select 'PASS: partial ARS/USDT, retry, payload conflict, overpayment, merchandise duplication, extra expense duplication, distinct extra costs' result;
rollback;`);
