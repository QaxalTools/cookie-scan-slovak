import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

interface FetchRequest {
  url: string;
}

interface FetchResponse {
  success: boolean;
  html?: string;
  finalUrl?: string;
  error?: string;
}

// Basic SSRF protection
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    
    // Only allow http/https
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }
    
    // Block IP literals and private IP ranges
    const hostname = url.hostname.toLowerCase();
    
    // Block localhost, IP literals, and private ranges
    const blockedPatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^169\.254\./,
      /^\[/,  // IPv6 literal
    ];
    
    return !blockedPatterns.some(pattern => pattern.test(hostname));
  } catch {
    return false;
  }
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

    // Parse request body
    const body: FetchRequest = await req.json();
    const { url } = body;

    // Validate URL
    if (!url || typeof url !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required and must be a string' }),
        { 
          status: 400, 
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        }
      );
    }

    // Check URL length limit
    if (url.length > 2000) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL too long' }),
        { 
          status: 400, 
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        }
      );
    }

    // SSRF protection
    if (!isValidUrl(url)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid or blocked URL' }),
        { 
          status: 400, 
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('Fetching HTML for:', url);

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    try {
      // Fetch HTML with timeout and size limit
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'sk-SK,sk;q=0.9,cs;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        redirect: 'follow',
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Check content type
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        throw new Error('Response is not HTML');
      }

      // Read response with size limit (1.5MB)
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Cannot read response body');
      }

      const chunks: Uint8Array[] = [];
      let totalSize = 0;
      const maxSize = 1.5 * 1024 * 1024; // 1.5MB

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalSize += value.length;
        if (totalSize > maxSize) {
          reader.releaseLock();
          throw new Error('Response too large');
        }

        chunks.push(value);
      }

      // Combine chunks and decode
      const combined = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const html = new TextDecoder('utf-8').decode(combined);
      const finalUrl = response.url;

      console.log('Successfully fetched HTML, size:', html.length, 'final URL:', finalUrl);

      const result: FetchResponse = {
        success: true,
        html,
        finalUrl
      };

      return new Response(
        JSON.stringify(result),
        { 
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        }
      );

    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      
      throw fetchError;
    }

  } catch (error) {
    console.error('HTML fetch failed:', error);
    
    const result: FetchResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };

    return new Response(
      JSON.stringify(result),
      { 
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      }
    );
  }
});