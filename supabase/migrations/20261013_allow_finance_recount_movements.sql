-- Keep automatic balance recount movements separate from operational revenue.
ALTER TABLE public.movements DROP CONSTRAINT movements_source_type_check;
ALTER TABLE public.movements ADD CONSTRAINT movements_source_type_check
CHECK (source_type IS NULL OR source_type = ANY (ARRAY[
  'manual','settlement','receivable','internal_transfer',
  'internal_conversion','sale','purchase_order','finance_recount'
]::text[]));
