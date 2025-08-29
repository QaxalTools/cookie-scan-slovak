-- Add mode column to audit_runs table for tracking accept/reject paths
ALTER TABLE audit_runs ADD COLUMN mode TEXT;

-- Add index for efficient querying by trace_id and mode
CREATE INDEX idx_audit_runs_trace_mode ON audit_runs(trace_id, mode);