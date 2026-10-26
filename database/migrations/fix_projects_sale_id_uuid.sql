-- projects.sale_id was created as INTEGER, but sales.id is a UUID. Comparing the
-- two failed ("operator does not exist: integer = uuid"), which broke the
-- "Converting a client?" picker on the new-ticket page, and a ticket could never
-- be linked to a sale. No ticket can hold a valid sale id yet, so existing values
-- are dropped. Idempotent: does nothing once the column is already UUID.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'sale_id' AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE projects ALTER COLUMN sale_id TYPE UUID USING NULL;
  END IF;
END
$$;
