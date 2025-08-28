// Unified consent banner capture service using Supabase Edge Function
import { supabase } from '@/integrations/supabase/client';

export interface AutoCaptureResult {
  success: boolean;
  screenshot?: string;
  error?: string;
}

export interface EdgeFunctionResponse {
  success: boolean;
  screenshot?: string;
  error?: string;
}

// Main auto-capture function using Supabase Edge Function
export async function autoCaptureConsent(
  url: string,
  options?: {
    delay?: number;
    viewport?: { width: number; height: number };
    locale?: string;
  }
): Promise<AutoCaptureResult> {
  const { delay = 3000, viewport = { width: 1920, height: 1080 }, locale = 'sk-SK' } = options || {};

  try {
    const { data, error } = await supabase.functions.invoke('capture-consent-banner', {
      body: {
        url,
        delay,
        viewport,
        locale,
      },
    });

    if (error) {
      throw error;
    }

    const result: EdgeFunctionResponse = data;
    return {
      success: result.success,
      screenshot: result.screenshot,
      error: result.error,
    };
  } catch (error) {
    console.error('Consent banner capture failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Screenshot capture failed',
    };
  }
}