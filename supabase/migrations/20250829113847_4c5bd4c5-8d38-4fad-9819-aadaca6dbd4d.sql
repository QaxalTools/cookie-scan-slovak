-- Create audit_runs table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.audit_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trace_id UUID NOT NULL,
  input_url TEXT NOT NULL,
  normalized_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ended_at TIMESTAMP WITH TIME ZONE,
  duration_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  bl_status_code INTEGER,
  bl_health_status TEXT,
  requests_total INTEGER,
  requests_pre_consent INTEGER,
  third_parties_count INTEGER,
  beacons_count INTEGER,
  cookies_pre_count INTEGER,
  cookies_post_count INTEGER,
  data_source TEXT,
  meta JSONB
);

-- Enable RLS on audit_runs table
ALTER TABLE public.audit_runs ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access (since this is a public-facing audit tool)
CREATE POLICY "Allow public read access to audit_runs" 
ON public.audit_runs 
FOR SELECT 
USING (true);

-- Create policy for service role to insert/update
CREATE POLICY "Allow service role full access to audit_runs" 
ON public.audit_runs 
FOR ALL 
USING (auth.role() = 'service_role');

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_audit_runs_trace_id ON public.audit_runs(trace_id);
CREATE INDEX IF NOT EXISTS idx_audit_runs_status ON public.audit_runs(status);
CREATE INDEX IF NOT EXISTS idx_audit_runs_started_at ON public.audit_runs(started_at DESC);