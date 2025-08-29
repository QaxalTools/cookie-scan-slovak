import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

// Browserless configuration
const BROWSERLESS_BASE = Deno.env.get('BROWSERLESS_BASE')?.trim() || 'https://production-sfo.browserless.io';

function normalizeToken(token?: string): string {
  if (!token) return '';
  return token.trim().replace(/^["']|["']$/g, '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🔍 Running Browserless diagnostics...');

    // Get and normalize tokens
    const rawBrowserlessToken = Deno.env.get('BROWSERLESS_TOKEN');
    const rawBrowserlessApiKey = Deno.env.get('BROWSERLESS_API_KEY');
    const browserlessToken = normalizeToken(rawBrowserlessToken);
    const browserlessApiKey = normalizeToken(rawBrowserlessApiKey);
    
    const diagnostics = {
      timestamp: new Date().toISOString(),
      base: BROWSERLESS_BASE,
      tokens: {
        BROWSERLESS_TOKEN: browserlessToken ? {
          present: true,
          masked: `${browserlessToken.slice(0, 4)}...${browserlessToken.slice(-4)}`,
          length: browserlessToken.length
        } : { present: false },
        BROWSERLESS_API_KEY: browserlessApiKey ? {
          present: true,
          masked: `${browserlessApiKey.slice(0, 4)}...${browserlessApiKey.slice(-4)}`,
          length: browserlessApiKey.length
        } : { present: false }
      },
      health_checks: []
    };

    const activeToken = browserlessToken || browserlessApiKey;
    
    if (!activeToken) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No Browserless token found in either BROWSERLESS_TOKEN or BROWSERLESS_API_KEY',
        diagnostics
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Test 1: Query parameter authentication
    try {
      console.log('Testing query parameter authentication...');
      const queryParamResponse = await fetch(`${BROWSERLESS_BASE}/json/version?token=${activeToken}`);
      const responseText = await queryParamResponse.text();
      
      diagnostics.health_checks.push({
        method: 'query_param',
        status: queryParamResponse.status,
        ok: queryParamResponse.ok,
        statusText: queryParamResponse.statusText,
        responseText: responseText.slice(0, 256)
      });
      
      console.log(`Query param auth: ${queryParamResponse.status}`);
    } catch (error) {
      diagnostics.health_checks.push({
        method: 'query_param',
        error: error.message
      });
    }

    // Test 2: X-API-Key header authentication
    try {
      console.log('Testing X-API-Key header authentication...');
      const headerResponse = await fetch(`${BROWSERLESS_BASE}/json/version`, {
        headers: { 'X-API-Key': activeToken }
      });
      const responseText = await headerResponse.text();
      
      diagnostics.health_checks.push({
        method: 'x_api_key',
        status: headerResponse.status,
        ok: headerResponse.ok,
        statusText: headerResponse.statusText,
        responseText: responseText.slice(0, 256)
      });
      
      console.log(`X-API-Key auth: ${headerResponse.status}`);
    } catch (error) {
      diagnostics.health_checks.push({
        method: 'x_api_key',
        error: error.message
      });
    }

    // Test 3: WebSocket connection test
    try {
      console.log('Testing WebSocket connection...');
      const wsTestPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve({ error: 'WebSocket connection timeout after 5 seconds' });
        }, 5000);

        try {
          const baseUrl = new URL(BROWSERLESS_BASE);
          const wsSocket = new WebSocket(`wss://${baseUrl.host}?token=${activeToken}`);
          
          wsSocket.onopen = () => {
            clearTimeout(timeout);
            wsSocket.close();
            resolve({ success: true, message: 'WebSocket connection successful' });
          };
          
          wsSocket.onerror = (error) => {
            clearTimeout(timeout);
            resolve({ error: `WebSocket error: ${error}` });
          };
          
          wsSocket.onclose = (event) => {
            clearTimeout(timeout);
            if (event.code === 1008 || event.code === 1006) {
              resolve({ error: `WebSocket authentication failed: ${event.code}` });
            } else if (event.wasClean) {
              resolve({ success: true, message: 'WebSocket connection successful (clean close)' });
            } else {
              resolve({ error: `WebSocket closed unexpectedly: ${event.code}` });
            }
          };
        } catch (error) {
          clearTimeout(timeout);
          resolve({ error: `WebSocket creation failed: ${error.message}` });
        }
      });

      const wsResult = await wsTestPromise;
      diagnostics.health_checks.push({
        method: 'websocket',
        ...wsResult
      });
      
    } catch (error) {
      diagnostics.health_checks.push({
        method: 'websocket',
        error: error.message
      });
    }

    // Analyze results and provide recommendations
    const hasWorkingAuth = diagnostics.health_checks.some(check => check.ok === true);
    const hasTokenError = diagnostics.health_checks.some(check => 
      check.status === 401 || check.status === 403
    );

    let recommendation = '';
    let status = 'unknown';

    if (hasWorkingAuth) {
      status = 'working';
      recommendation = '✅ Browserless token funguje správne!';
    } else if (hasTokenError) {
      status = 'token_error';
      recommendation = '❌ Token je neplatný alebo pre nesprávny produkt. Skontrolujte nastavenie v Browserless dashboard.';
    } else {
      status = 'connection_error';
      recommendation = '🔧 Problém s pripojením k Browserless službe.';
    }

    return new Response(JSON.stringify({
      success: true,
      status,
      recommendation,
      diagnostics,
      active_token_source: browserlessToken ? 'BROWSERLESS_TOKEN' : 'BROWSERLESS_API_KEY'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Diagnostics error:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});