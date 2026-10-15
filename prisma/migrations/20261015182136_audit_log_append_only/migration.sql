-- Audit log is append-only: the database refuses UPDATE and DELETE on "AuditLog",
-- so neither the app nor a bug in it can rewrite history.
-- (TRUNCATE is still possible for whoever owns the database, e.g. to reset a demo.)

CREATE OR REPLACE FUNCTION credflow_audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_or_delete
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION credflow_audit_log_append_only();
