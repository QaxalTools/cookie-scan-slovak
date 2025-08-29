-- Phase 0: Create audit_logs table for persistent debugging
CREATE TABLE public.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  trace_id UUID NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB,
  ts TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Allow service role to insert logs
CREATE POLICY "Service role can insert audit logs" 
ON public.audit_logs 
FOR INSERT 
TO service_role
WITH CHECK (true);

-- Allow authenticated users to read their logs (optional, for debugging)
CREATE POLICY "Users can read all audit logs" 
ON public.audit_logs 
FOR SELECT 
TO authenticated
USING (true);

-- Index for efficient trace_id queries
CREATE INDEX idx_audit_logs_trace_id ON public.audit_logs(trace_id);
CREATE INDEX idx_audit_logs_ts ON public.audit_logs(ts DESC);