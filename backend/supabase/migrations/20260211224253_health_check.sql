CREATE OR REPLACE FUNCTION health_check() RETURNS boolean
LANGUAGE sql AS $$ SELECT true $$;
