import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

interface CaptureRequest {
  url: string;
  delay?: number;
  viewport?: { width: number; height: number };
  locale?: string;
}

interface CaptureResponse {
  success: boolean;
  screenshot?: string;
  error?: string;
}

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: 'Method not allowed' }),
        { 
          status: 405, 
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        }
      );
    }

    // Get the Browserless API key from Supabase secrets
    const BROWSERLESS_API_KEY = Deno.env.get('BROWSERLESS_API_KEY');
    if (!BROWSERLESS_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'Browserless API key not configured' }),
        { 
          status: 500, 
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        }
      );
    }

    // Parse request body
    const body: CaptureRequest = await req.json();
    const { url, delay = 3000, viewport = { width: 1920, height: 1080 }, locale = 'sk-SK' } = body;

    // Validate URL
    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required' }),
        { 
          status: 400, 
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        }
      );
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid URL format' }),
        { 
          status: 400, 
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        }
      );
    }

    // Configure screenshot request for consent banner detection
    const requestBody = {
      url,
      options: {
        fullPage: false,
        type: 'png',
        quality: 90,
        clip: {
          x: 0,
          y: 0,
          width: viewport.width,
          height: Math.min(600, viewport.height) // Focus on top area where banners usually appear
        }
      },
      gotoOptions: {
        waitUntil: 'networkidle2',
        timeout: 30000
      },
      viewport,
      // Wait for potential consent banners to load
      waitFor: delay,
      // Set EU locale to trigger GDPR banners
      locale,
      // Inject script to scroll to top and wait for banners
      evaluate: `
        // Scroll to top to ensure banner is visible
        window.scrollTo(0, 0);
        
        // Wait a bit more for dynamic banners
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Return true when ready
        true;
      `
    };

    // Call Browserless API
    const browserlessResponse = await fetch(`https://chrome.browserless.io/screenshot?token=${BROWSERLESS_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!browserlessResponse.ok) {
      throw new Error(`Browserless API error: ${browserlessResponse.status} ${browserlessResponse.statusText}`);
    }

    // Convert response to base64 data URL
    const buffer = await browserlessResponse.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    const dataUrl = `data:image/png;base64,${base64}`;

    const response: CaptureResponse = {
      success: true,
      screenshot: dataUrl
    };

    return new Response(
      JSON.stringify(response),
      { 
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Consent banner capture failed:', error);
    
    const response: CaptureResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };

    return new Response(
      JSON.stringify(response),
      { 
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      }
    );
  }
});