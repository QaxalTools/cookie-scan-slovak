import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🔍 Running Browserless diagnostics...');

    // Get tokens from both possible variables
    const browserlessToken = Deno.env.get('BROWSERLESS_TOKEN');
    const browserlessApiKey = Deno.env.get('BROWSERLESS_API_KEY');
    
    const diagnostics = {
      timestamp: new Date().toISOString(),
      tokens: {
        BROWSERLESS_TOKEN: browserlessToken ? {
          present: true,
          masked: `${browserlessToken.slice(0, 8)}...${browserlessToken.slice(-4)}`,
          length: browserlessToken.length
        } : { present: false },
        BROWSERLESS_API_KEY: browserlessApiKey ? {
          present: true,
          masked: `${browserlessApiKey.slice(0, 8)}...${browserlessApiKey.slice(-4)}`,
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
      const queryParamResponse = await fetch(`https://chrome.browserless.io/health?token=${activeToken}`);
      
      diagnostics.health_checks.push({
        method: 'query_param',
        status: queryParamResponse.status,
        ok: queryParamResponse.ok,
        statusText: queryParamResponse.statusText
      });
      
      console.log(`Query param auth: ${queryParamResponse.status}`);
    } catch (error) {
      diagnostics.health_checks.push({
        method: 'query_param',
        error: error.message
      });
    }

    // Test 2: Header-based authentication
    try {
      console.log('Testing header-based authentication...');
      const headerResponse = await fetch('https://chrome.browserless.io/health', {
        headers: { 'Authorization': `Bearer ${activeToken}` }
      });
      
      diagnostics.health_checks.push({
        method: 'header_auth',
        status: headerResponse.status,
        ok: headerResponse.ok,
        statusText: headerResponse.statusText
      });
      
      console.log(`Header auth: ${headerResponse.status}`);
    } catch (error) {
      diagnostics.health_checks.push({
        method: 'header_auth',
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
          const wsSocket = new WebSocket(`wss://chrome.browserless.io?token=${activeToken}`);
          
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