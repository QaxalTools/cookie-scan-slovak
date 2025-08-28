import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let traceId = crypto.randomUUID();
  let startedAt = Date.now();
  let requestData = null;
  let url = '';
  let supabase, browserlessApiKey;

  // Set-Cookie header parsers
  const parseSetCookieHeader = (setCookieValue: string) => {
    const parts = setCookieValue.split(';').map(p => p.trim());
    const [nameValue, ...attributes] = parts;
    const [name, value] = nameValue.split('=', 2);
    
    const cookie = {
      name: name?.trim() || '',
      value: value?.trim() || '',
      domain: '',
      path: '/',
      expires: null as number | null,
      maxAge: null as number | null,
      secure: false,
      httpOnly: false,
      sameSite: 'Lax'
    };
    
    attributes.forEach(attr => {
      const [key, val] = attr.split('=', 2);
      const lowerKey = key?.toLowerCase();
      
      if (lowerKey === 'domain') {
        cookie.domain = val?.trim() || '';
      } else if (lowerKey === 'path') {
        cookie.path = val?.trim() || '/';
      } else if (lowerKey === 'expires') {
        const expiresDate = new Date(val?.trim() || '');
        if (!isNaN(expiresDate.getTime())) {
          cookie.expires = Math.floor(expiresDate.getTime() / 1000);
        }
      } else if (lowerKey === 'max-age') {
        const maxAge = parseInt(val?.trim() || '0');
        if (!isNaN(maxAge)) {
          cookie.maxAge = maxAge;
          cookie.expires = Math.floor(Date.now() / 1000) + maxAge;
        }
      } else if (lowerKey === 'secure') {
        cookie.secure = true;
      } else if (lowerKey === 'httponly') {
        cookie.httpOnly = true;
      } else if (lowerKey === 'samesite') {
        cookie.sameSite = val?.trim() || 'Lax';
      }
    });
    
    return cookie;
  };
  
  // Parse request body once at the start
  try {
    requestData = await req.json();
    url = requestData?.url || '';
  } catch (parseError) {
    console.error(`❌ Failed to parse request body [${traceId}]:`, parseError.message);
    return new Response(JSON.stringify({
      success: false,
      trace_id: traceId,
      error_code: 'PARSE_ERROR',
      error_message: 'Invalid request format',
      data: { _error: parseError.message }
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 200
    });
  }

  if (!url) {
    return new Response(JSON.stringify({
      success: false,
      trace_id: traceId,
      error_code: 'MISSING_URL',
      error_message: 'URL is required',
      data: { _error: 'URL parameter is missing' }
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 200
    });
  }

  // Initialize Supabase client
  supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // Helper function to log to database
  const logToDatabase = async (level: string, message: string, data?: any) => {
    try {
      await supabase.from('audit_logs').insert({
        trace_id: traceId,
        level,
        message,
        source: 'render-and-inspect',
        data: data || null
      });
    } catch (logError) {
      console.error('Failed to log to database:', logError.message);
    }
  };

  try {
    console.log(`🚀 Starting render-and-inspect function [${traceId}]`);
    await logToDatabase('info', '🚀 Starting render-and-inspect function', { url });
    
    console.log(`📝 Analyzing URL: ${url}`);

    browserlessApiKey = Deno.env.get('BROWSERLESS_API_KEY');
    if (!browserlessApiKey) {
      throw new Error('BROWSERLESS_API_KEY not configured');
    }

    // Log masked token for verification
    const maskedToken = `${browserlessApiKey.substring(0, 8)}...${browserlessApiKey.substring(browserlessApiKey.length - 4)}`;
    console.log(`🔑 Using Browserless token: ${maskedToken}`);
    await logToDatabase('info', '🔑 Token verification', { masked_token: maskedToken });

    // Health check Browserless first
    console.log('🏥 Checking Browserless health...');
    let healthStatus = 'unknown';
    
    try {
      const healthResponse = await fetch(`https://production-sfo.browserless.io/json/version?token=${browserlessApiKey}`, {
        method: 'GET'
      });
      
      healthStatus = healthResponse.ok ? 'healthy' : 'unhealthy';
      
      if (healthResponse.ok) {
        console.log('✅ Browserless health check passed');
      } else {
        console.log(`⚠️ Browserless health check failed: ${healthResponse.status}`);
      }
    } catch (healthError) {
      healthStatus = 'error';
      console.log(`❌ Browserless health check error: ${healthError.message}`);
    }
    
    await logToDatabase('info', '🏥 Browserless health check', { status: healthStatus });

    // Raw WebSocket CDP implementation
    console.log('🌐 Starting Raw WebSocket CDP analysis...');
    
    const WSE = `wss://production-sfo.browserless.io?token=${browserlessApiKey}`;
    
    let wsSocket;
    let browserlessData = {
      finalUrl: url,
      cookies_pre: [],
      cookies_post_accept: [],
      cookies_post_reject: [],
      set_cookie_headers_pre: [],
      set_cookie_headers_post_accept: [],
      set_cookie_headers_post_reject: [],
      storage_pre: { localStorage: {}, sessionStorage: {} },
      storage_post_accept: { localStorage: {}, sessionStorage: {} },
      storage_post_reject: { localStorage: {}, sessionStorage: {} },
      requests_pre: [],
      requests_post_accept: [],
      requests_post_reject: [],
      cmp_detected: false,
      consent_clicked: false,
      accept_clicked: false,
      reject_clicked: false,
      readyState: 'unknown',
      bl_status_code: 200,
      bl_health_status: healthStatus
    };
    
    try {
      // Initialize WebSocket connection to Browserless
      console.log('🔗 Connecting to Browserless WebSocket...');
      wsSocket = new WebSocket(WSE);
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 30000);
        
        wsSocket.onopen = () => {
          clearTimeout(timeout);
          console.log('🔗 WebSocket connected to Browserless');
          resolve(true);
        };
        
        wsSocket.onerror = (error) => {
          clearTimeout(timeout);
          reject(new Error(`WebSocket connection failed: ${error}`));
        };
      });
      
      // CDP session management
      let requestId = 1;
      const cdpResults = {};
      const sessions = new Map(); // sessionId -> target info
      let browserSessionId = null;
      let pageSessionId = null;
      let isPreConsent = true;
      
      // Session-aware CDP command wrapper
      const sendCDPCommand = (method, params = {}, sessionId = null) => {
        return new Promise((resolve, reject) => {
          const id = requestId++;
          const message = sessionId 
            ? JSON.stringify({ id, method, params, sessionId })
            : JSON.stringify({ id, method, params });
          
          const timeout = setTimeout(() => {
            delete cdpResults[id];
            reject(new Error(`CDP command timeout: ${method}`));
          }, 15000);
          
          cdpResults[id] = { resolve, reject, timeout };
          wsSocket.send(message);
        });
      };
      
      // Storage for network events and data
      const requests = [];
      const setCookieHeaders = [];
      
      // Handle CDP responses and events
      wsSocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle command responses
          if (data.id && cdpResults[data.id]) {
            const { resolve, timeout } = cdpResults[data.id];
            clearTimeout(timeout);
            delete cdpResults[data.id];
            
            if (data.error) {
              console.log(`CDP Error [${data.id}]:`, data.error);
            }
            resolve(data.result || data);
            return;
          }
          
          // Handle events from all sessions
          if (data.method) {
            const sessionId = data.sessionId;
            
            // Track new attached targets
            if (data.method === 'Target.attachedToTarget') {
              const targetSessionId = data.params.sessionId;
              const targetInfo = data.params.targetInfo;
              sessions.set(targetSessionId, targetInfo);
              console.log(`📎 Target attached: ${targetInfo.type} [${targetSessionId}]`);
              
              // Enable domains for new page sessions
              if (targetInfo.type === 'page' || targetInfo.type === 'iframe') {
                sendCDPCommand('Page.enable', {}, targetSessionId).catch(e => console.log('Page.enable failed:', e.message));
                sendCDPCommand('Runtime.enable', {}, targetSessionId).catch(e => console.log('Runtime.enable failed:', e.message));
                sendCDPCommand('Network.enable', {
                  maxTotalBufferSize: 10_000_000,
                  maxResourceBufferSize: 5_000_000
                }, targetSessionId).catch(e => console.log('Network.enable failed:', e.message));
              }
            }
            
            // Network event handling (filter by page session if available)
            if (data.method === 'Network.requestWillBeSent') {
              const request = {
                id: data.params.requestId,
                url: data.params.request.url,
                method: data.params.request.method,
                headers: data.params.request.headers,
                timestamp: data.params.timestamp,
                phase: isPreConsent ? 'pre' : 'post',
                sessionId: sessionId,
                query: {},
                trackingParams: {},
                isPreConsent: isPreConsent
              };
              
              // Parse query parameters with tracking detection
              try {
                const urlObj = new URL(data.params.request.url);
                const trackingKeys = ['id', 'tid', 'ev', 'en', 'fbp', 'fbc', 'sid', 'cid', 'uid', 'user_id', 'ip', 'geo', 'pid', 'aid', 'k'];
                
                urlObj.searchParams.forEach((value, key) => {
                  request.query[key] = value;
                  if (trackingKeys.some(tk => key.toLowerCase().includes(tk))) {
                    request.trackingParams[key] = value;
                  }
                });
              } catch (e) {
                console.log('URL parsing error:', e.message);
              }
              
              // Parse POST data
              if (data.params.request.postData) {
                const contentType = data.params.request.headers['content-type'] || '';
                request.postData = data.params.request.postData;
                
                if (contentType.includes('application/json')) {
                  try {
                    request.postDataParsed = JSON.parse(data.params.request.postData);
                    // Extract tracking params from POST data
                    if (typeof request.postDataParsed === 'object') {
                      const trackingKeys = ['id', 'tid', 'ev', 'en', 'fbp', 'fbc', 'sid', 'cid', 'uid', 'user_id', 'ip', 'geo', 'pid', 'aid', 'k'];
                      Object.entries(request.postDataParsed).forEach(([key, value]) => {
                        if (trackingKeys.some(tk => key.toLowerCase().includes(tk))) {
                          request.trackingParams[key] = value;
                        }
                      });
                    }
                  } catch (e) {
                    console.log('JSON parse error:', e.message);
                  }
                } else if (contentType.includes('application/x-www-form-urlencoded')) {
                  try {
                    const urlencoded = new URLSearchParams(data.params.request.postData);
                    const formData = {};
                    const trackingKeys = ['id', 'tid', 'ev', 'en', 'fbp', 'fbc', 'sid', 'cid', 'uid', 'user_id', 'ip', 'geo', 'pid', 'aid', 'k'];
                    urlencoded.forEach((value, key) => {
                      formData[key] = value;
                      if (trackingKeys.some(tk => key.toLowerCase().includes(tk))) {
                        request.trackingParams[key] = value;
                      }
                    });
                    request.postDataParsed = formData;
                  } catch (e) {
                    console.log('URLEncoded parse error:', e.message);
                  }
                }
              }
              
              requests.push(request);
            }
            
            // Capture Set-Cookie headers from responses
            if (data.method === 'Network.responseReceived') {
              const response = data.params.response;
              if (response.headers && response.headers['set-cookie']) {
                const setCookieValue = response.headers['set-cookie'];
                const setCookieArray = Array.isArray(setCookieValue) ? setCookieValue : [setCookieValue];
                
                setCookieArray.forEach(cookieHeader => {
                  try {
                    const parsedCookie = parseSetCookieHeader(cookieHeader);
                    if (parsedCookie.name) {
                      setCookieHeaders.push({
                        ...parsedCookie,
                        isPreConsent: isPreConsent,
                        timestamp: data.params.timestamp,
                        url: response.url
                      });
                    }
                  } catch (e) {
                    console.log('Set-Cookie parse error:', e.message);
                  }
                });
              }
            }
          }
        } catch (e) {
          // Ignore non-JSON messages
        }
      };
      
      // B) BROWSER-LEVEL CDP SESSION (before anything else)
      console.log('🌐 Setting up browser-level auto-attach...');
      await sendCDPCommand('Target.setAutoAttach', {
        autoAttach: true,
        flatten: true,
        waitForDebuggerOnStart: false,
      });
      await sendCDPCommand('Target.setDiscoverTargets', { discover: true });
      console.log('✅ Browser-level auto-attach enabled');
      
      // Get available targets
      console.log('🎯 Getting browser targets...');
      const targets = await sendCDPCommand('Target.getTargets');
      console.log('TARGET CHECK', targets.targetInfos?.map(t => ({ type: t.type, url: t.url })));
      
      const pageTarget = targets.targetInfos?.find(t => t.type === 'page');
      
      if (!pageTarget) {
        // Create a new page target
        console.log('📄 Creating new page target...');
        const createResult = await sendCDPCommand('Target.createTarget', {
          url: 'about:blank'
        });
        pageSessionId = createResult.targetId;
        console.log('✅ New page target created:', pageSessionId);
      } else {
        // Attach to existing page target
        console.log('📎 Attaching to existing page target...');
        const attachResult = await sendCDPCommand('Target.attachToTarget', {
          targetId: pageTarget.targetId,
          flatten: true
        });
        pageSessionId = attachResult.sessionId;
        sessions.set(pageSessionId, pageTarget);
        console.log('✅ Attached to page target:', pageSessionId);
      }
      
      // C) Enable CDP domains on the page session
      console.log('🔧 Enabling CDP domains on page session:', pageSessionId);
      await sendCDPCommand('Page.enable', {}, pageSessionId);
      await sendCDPCommand('Runtime.enable', {}, pageSessionId);
      await sendCDPCommand('Network.enable', {
        maxTotalBufferSize: 10_000_000,
        maxResourceBufferSize: 5_000_000
      }, pageSessionId);
      await sendCDPCommand('DOMStorage.enable', {}, pageSessionId);
      
      console.log('✅ CDP domains enabled on page session');
      console.log('📍 CDP_bound: true');
      
      // Set additional headers
      await sendCDPCommand('Network.setUserAgentOverride', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }, pageSessionId);
      
      await sendCDPCommand('Network.setExtraHTTPHeaders', {
        headers: {
          'Accept-Language': 'sk-SK,sk;q=0.9,en;q=0.8',
          'DNT': '1',
          'Sec-GPC': '1'
        }
      }, pageSessionId);
      
      // Helper functions for data collection
      const collectCookies = async (label) => {
        const cookies = [];
        
        try {
          const cdpCookies = await sendCDPCommand('Network.getAllCookies', {}, pageSessionId);
          if (cdpCookies.cookies) {
            cookies.push(...cdpCookies.cookies.map(c => ({
              ...c,
              expiry_days: c.expires ? Math.round((c.expires - Date.now() / 1000) / (24 * 60 * 60)) : null,
              source: 'cdp'
            })));
          }
        } catch (e) {
          console.log(`CDP cookies failed for ${label}:`, e.message);
        }
        
        // Fallback: document.cookie via Runtime.evaluate
        try {
          const docCookieResult = await sendCDPCommand('Runtime.evaluate', {
            expression: 'document.cookie'
          }, pageSessionId);
          
          const docCookie = docCookieResult.result?.value || '';
          if (docCookie) {
            const docCookies = docCookie.split('; ').filter(c => c.trim()).map(c => {
              const [name, ...rest] = c.split('=');
              return { 
                name: name?.trim(), 
                value: rest.join('='), 
                domain: 'document.cookie',
                source: 'document' 
              };
            });
            cookies.push(...docCookies);
          }
        } catch (e) {
          console.log(`Document cookie failed for ${label}:`, e.message);
        }
        
        console.log(`Cookies ${label}:`, cookies.length);
        return cookies;
      };
      
      const collectStorage = async (label) => {
        const storage = { localStorage: {}, sessionStorage: {} };
        
        try {
          // Get origin for DOMStorage
          const originResult = await sendCDPCommand('Runtime.evaluate', {
            expression: 'window.location.origin'
          }, pageSessionId);
          const origin = originResult.result?.value || new URL(url).origin;
          
          // Local storage
          try {
            const localStorage = await sendCDPCommand('DOMStorage.getDOMStorageItems', {
              storageId: { securityOrigin: origin, isLocalStorage: true }
            }, pageSessionId);
            if (localStorage.entries) {
              localStorage.entries.forEach(([key, value]) => {
                storage.localStorage[key] = value;
              });
            }
          } catch (e) {
            console.log(`Local storage failed for ${label}:`, e.message);
          }
          
          // Session storage
          try {
            const sessionStorage = await sendCDPCommand('DOMStorage.getDOMStorageItems', {
              storageId: { securityOrigin: origin, isLocalStorage: false }
            }, pageSessionId);
            if (sessionStorage.entries) {
              sessionStorage.entries.forEach(([key, value]) => {
                storage.sessionStorage[key] = value;
              });
            }
          } catch (e) {
            console.log(`Session storage failed for ${label}:`, e.message);
          }
          
          // Fallback: Runtime.evaluate for storage
          try {
            const storageResult = await sendCDPCommand('Runtime.evaluate', {
              expression: `
                (() => {
                  const res = { local: {}, session: {} };
                  try { 
                    for (let i = 0; i < localStorage.length; i++) { 
                      const k = localStorage.key(i); 
                      if (k) res.local[k] = localStorage.getItem(k); 
                    } 
                  } catch {}
                  try { 
                    for (let i = 0; i < sessionStorage.length; i++) { 
                      const k = sessionStorage.key(i); 
                      if (k) res.session[k] = sessionStorage.getItem(k); 
                    } 
                  } catch {}
                  return res;
                })()
              `
            }, pageSessionId);
            
            const runtimeStorage = storageResult.result?.value || { local: {}, session: {} };
            Object.assign(storage.localStorage, runtimeStorage.local);
            Object.assign(storage.sessionStorage, runtimeStorage.session);
          } catch (e) {
            console.log(`Runtime storage failed for ${label}:`, e.message);
          }
          
        } catch (e) {
          console.log(`Storage collection failed for ${label}:`, e.message);
        }
        
        const totalItems = Object.keys(storage.localStorage).length + Object.keys(storage.sessionStorage).length;
        console.log(`Storage ${label}:`, totalItems, 'items');
        return storage;
      };
      
      // E) NAVIGATION (now that everything is set up)
      console.log('🌐 Navigating to URL...');
      await sendCDPCommand('Page.navigate', { url }, pageSessionId);
      
      // Wait for page load event
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 10000);
        const messageHandler = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.method === 'Page.loadEventFired' && data.sessionId === pageSessionId) {
              clearTimeout(timeout);
              wsSocket.removeEventListener('message', messageHandler);
              resolve(true);
            }
          } catch (e) {
            // Ignore
          }
        };
        wsSocket.addEventListener('message', messageHandler);
      });
      
      console.log('✅ Page load event fired');
      
      // Wait for network idle (additional 6 seconds)
      await new Promise(resolve => setTimeout(resolve, 6000));
      
      // Get final URL and readyState
      const finalUrlResult = await sendCDPCommand('Runtime.evaluate', {
        expression: 'window.location.href'
      }, pageSessionId);
      const finalUrl = finalUrlResult.result?.value || url;
      
      const readyStateResult = await sendCDPCommand('Runtime.evaluate', {
        expression: 'document.readyState'
      }, pageSessionId);
      const readyState = readyStateResult.result?.value || 'unknown';
      
      console.log('CDP ok', { url: finalUrl, ready: readyState });
      browserlessData.finalUrl = finalUrl;
      browserlessData.readyState = readyState;
      
      // Check if we captured any network traffic
      const preCdp = requests.filter(r => r.phase === 'pre').length;
      console.log('REQUESTS PRE counts', { cdp: preCdp });
      
      if (preCdp === 0) {
        console.log('NO TRAFFIC – network capture empty (CDP not bound)');
        browserlessData._quality = {
          incomplete: true,
          reason: 'NETWORK_CAPTURE_EMPTY_CDP_AND_PAGE'
        };
        
        // Return early with empty data but success: true
        return new Response(JSON.stringify({
          success: true,
          trace_id: traceId,
          timestamp: Date.now(),
          data: browserlessData
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          status: 200
        });
      }
      
      // F) COOKIES & STORAGE - Phase 1: Pre-consent (multi-timing collection)
      console.log('🍪 Collecting pre-consent cookies and storage...');
      
      // Multi-timing pre-consent cookie collection
      const preLoadCookies = await collectCookies('pre-load');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Network idle wait
      const preIdleCookies = await collectCookies('pre-idle');
      await new Promise(resolve => setTimeout(resolve, 5000)); // Extra idle wait
      const preExtraCookies = await collectCookies('pre-extra');
      
      // Merge and deduplicate pre-consent cookies
      const allPreCookies = [...preLoadCookies, ...preIdleCookies, ...preExtraCookies];
      const uniquePreCookies = new Map();
      allPreCookies.forEach(cookie => {
        const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
        if (!uniquePreCookies.has(key) || 
            (cookie.expires && (!uniquePreCookies.get(key).expires || cookie.expires > uniquePreCookies.get(key).expires))) {
          uniquePreCookies.set(key, cookie);
        }
      });
      
      browserlessData.cookies_pre = Array.from(uniquePreCookies.values());
      browserlessData.storage_pre = await collectStorage('pre-consent');
      browserlessData.requests_pre = requests.filter(r => r.isPreConsent);
      
      // Store pre-consent Set-Cookie headers
      browserlessData.set_cookie_headers_pre = setCookieHeaders.filter(c => c.isPreConsent);
      
      console.log('✅ Pre-consent data collected');
      console.log('📊 Pre-consent stats:', {
        cookies: browserlessData.cookies_pre.length,
        setCookieHeaders: browserlessData.set_cookie_headers_pre.length,
        storage: Object.keys(browserlessData.storage_pre.localStorage).length + Object.keys(browserlessData.storage_pre.sessionStorage).length,
        requests: browserlessData.requests_pre.length
      });
      
      // G) CMP DETECTION AND INTERACTION
      console.log('🔍 Detecting CMP...');
      
      const cmpDetection = await sendCDPCommand('Runtime.evaluate', {
        expression: `
          (() => {
            const results = {
              cmpDetected: false,
              cmpType: '',
              cmpSelectors: [],
              acceptButton: null,
              rejectButton: null
            };
            
            // Common CMP detection patterns
            const cmpChecks = [
              { name: 'CookieScript', check: () => !!window.CookieScript || !!document.querySelector('[data-cs-i18n-read-more]') },
              { name: 'Cookiebot', check: () => !!window.Cookiebot || !!document.querySelector('#CybotCookiebotDialog') },
              { name: 'OneTrust', check: () => !!window.OneTrust || !!document.querySelector('#onetrust-banner-sdk') },
              { name: 'Quantcast', check: () => !!window.__qc || !!document.querySelector('.qc-cmp-ui') },
              { name: 'TrustArc', check: () => !!window.truste || !!document.querySelector('#truste-consent-track') },
              { name: 'Didomi', check: () => !!window.Didomi || !!document.querySelector('.didomi-consent-popup') },
              { name: 'Klaro', check: () => !!window.klaro || !!document.querySelector('.klaro') },
              { name: 'Cookie Yes', check: () => !!document.querySelector('.cky-consent-container') }
            ];
            
            // Detect CMP
            for (const cmp of cmpChecks) {
              try {
                if (cmp.check()) {
                  results.cmpDetected = true;
                  results.cmpType = cmp.name;
                  break;
                }
              } catch (e) {
                console.log('CMP check failed for ' + cmp.name + ':', e.message);
              }
            }
            
            // Generic CMP detection based on common selectors
            const genericCmpSelectors = [
              '[data-cs-i18n-read-more]',
              '#CybotCookiebotDialog',
              '#onetrust-banner-sdk',
              '.qc-cmp-ui',
              '#truste-consent-track',
              '.didomi-consent-popup',
              '.klaro',
              '.cky-consent-container',
              '[class*="cookie"][class*="banner"]',
              '[class*="consent"][class*="popup"]',
              '[id*="cookie"][id*="consent"]'
            ];
            
            for (const selector of genericCmpSelectors) {
              const element = document.querySelector(selector);
              if (element && element.offsetParent !== null) {
                results.cmpDetected = true;
                if (!results.cmpType) results.cmpType = 'Generic';
                results.cmpSelectors.push(selector);
              }
            }
            
            // Find accept/reject buttons
            if (results.cmpDetected) {
              const acceptSelectors = [
                '[data-cs-accept-all]',
                '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
                '#onetrust-accept-btn-handler',
                '.qc-cmp-button[mode="primary"]',
                '[class*="accept"]',
                '[class*="allow"]',
                '[id*="accept"]'
              ];
              
              const rejectSelectors = [
                '[data-cs-reject-all]',
                '#CybotCookiebotDialogBodyButtonDecline',
                '#onetrust-reject-all-handler',
                '.qc-cmp-button[mode="secondary"]',
                '[class*="reject"]',
                '[class*="decline"]',
                '[id*="reject"]'
              ];
              
              for (const selector of acceptSelectors) {
                const button = document.querySelector(selector);
                if (button && button.offsetParent !== null) {
                  results.acceptButton = selector;
                  break;
                }
              }
              
              for (const selector of rejectSelectors) {
                const button = document.querySelector(selector);
                if (button && button.offsetParent !== null) {
                  results.rejectButton = selector;
                  break;
                }
              }
            }
            
            return results;
          })()
        `
      }, pageSessionId);
      
      const cmpDetectionResult = cmpDetection.result?.value || {};
      browserlessData.cmp_detected = cmpDetectionResult.cmpDetected || false;
      
      console.log('🔍 CMP detection result:', {
        detected: cmpDetectionResult.cmpDetected,
        type: cmpDetectionResult.cmpType,
        acceptButton: !!cmpDetectionResult.acceptButton,
        rejectButton: !!cmpDetectionResult.rejectButton
      });
      
      // Try to click accept if CMP detected
      if (cmpDetectionResult.cmpDetected && cmpDetectionResult.acceptButton) {
        try {
          console.log('✅ Attempting to accept cookies...');
          
          // Switch to post-consent phase
          isPreConsent = false;
          
          // Click accept button
          await sendCDPCommand('Runtime.evaluate', {
            expression: `
              (() => {
                const button = document.querySelector('${cmpDetectionResult.acceptButton}');
                if (button) {
                  button.click();
                  return true;
                }
                return false;
              })()
            `
          }, pageSessionId);
          
          await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for consent processing
          
          browserlessData.consent_clicked = true;
          browserlessData.accept_clicked = true;
          
          console.log('✅ Accept clicked successfully');
          
          // Phase 2: Post-accept data collection (multi-timing)
          await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for tracking to fire
          
          const postAcceptCookies1 = await collectCookies('post-accept-1');
          await new Promise(resolve => setTimeout(resolve, 4000)); // Additional wait
          const postAcceptCookies2 = await collectCookies('post-accept-2');
          
          // Merge and deduplicate post-accept cookies
          const allPostAcceptCookies = [...postAcceptCookies1, ...postAcceptCookies2];
          const uniquePostAcceptCookies = new Map();
          allPostAcceptCookies.forEach(cookie => {
            const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
            if (!uniquePostAcceptCookies.has(key) || 
                (cookie.expires && (!uniquePostAcceptCookies.get(key).expires || cookie.expires > uniquePostAcceptCookies.get(key).expires))) {
              uniquePostAcceptCookies.set(key, cookie);
            }
          });
          
          browserlessData.cookies_post_accept = Array.from(uniquePostAcceptCookies.values());
          browserlessData.storage_post_accept = await collectStorage('post-accept');
          browserlessData.requests_post_accept = requests.filter(r => !r.isPreConsent);
          
          // Store post-accept Set-Cookie headers
          browserlessData.set_cookie_headers_post_accept = setCookieHeaders.filter(c => !c.isPreConsent);
          
          console.log('✅ Post-accept data collected');
          console.log('📊 Post-accept stats:', {
            cookies: browserlessData.cookies_post_accept.length,
            setCookieHeaders: browserlessData.set_cookie_headers_post_accept.length,
            storage: Object.keys(browserlessData.storage_post_accept.localStorage).length + Object.keys(browserlessData.storage_post_accept.sessionStorage).length,
            requests: browserlessData.requests_post_accept.length
          });
          
        } catch (clickError) {
          console.log('❌ Failed to click accept button:', clickError.message);
        }
    }
    
    console.log('✅ Analysis completed successfully');
    
    // H) POPULATE "Data Sent to Third Parties" Section  
    const normalizeHost = (hostname) => {
      try {
        return hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        return hostname || 'unknown';
      }
    };
    
    const getDomainFromUrl = (url) => {
      try {
        const urlObj = new URL(url);
        return normalizeHost(urlObj.hostname);
      } catch {
        return 'unknown';
      }
    };
    
    const firstPartyDomain = normalizeHost(getDomainFromUrl(browserlessData.finalUrl));
    const allRequests = [...(browserlessData.requests_pre || []), ...(browserlessData.requests_post_accept || []), ...(browserlessData.requests_post_reject || [])];
    
    const dataSentToThirdParties = [];
    const seenEntries = new Set();
    
    allRequests.forEach(request => {
      const requestHost = getDomainFromUrl(request.url);
      
      // Skip first-party and unknown hosts
      if (requestHost === firstPartyDomain || requestHost === 'unknown') return;
      
      // Extract parameters with preference for trackingParams
      const params = {};
      
      // Priority 1: trackingParams (already filtered for tracking data)
      if (request.trackingParams && typeof request.trackingParams === 'object') {
        Object.assign(params, request.trackingParams);
      }
      
      // Priority 2: query parameters
      if (request.query && typeof request.query === 'object') {
        Object.assign(params, request.query);
      }
      
      // Priority 3: POST data
      if (request.postDataParsed && typeof request.postDataParsed === 'object') {
        Object.assign(params, request.postDataParsed);
      }
      
      // Only include if there are parameters
      if (Object.keys(params).length > 0) {
        const entryKey = `${requestHost}:${Object.keys(params).sort().join(',')}`;
        
        if (!seenEntries.has(entryKey)) {
          seenEntries.add(entryKey);
          dataSentToThirdParties.push({
            host: requestHost,
            url: request.url.length > 100 ? request.url.substring(0, 100) + '...' : request.url,
            params: Object.keys(params).slice(0, 10), // Limit to 10 params per entry
            sample_values: Object.fromEntries(
              Object.entries(params).slice(0, 5).map(([k, v]) => [k, String(v).length > 50 ? String(v).substring(0, 50) + '...' : String(v)])
            )
          });
        }
      }
    });
    
    // Limit to 20 entries to avoid response bloat
    browserlessData.data_sent_to_third_parties = dataSentToThirdParties.slice(0, 20);
    console.log(`📤 data_sent_to_third_parties: ${browserlessData.data_sent_to_third_parties.length}`);
    
    } catch (cdpError) {
      console.error('❌ CDP analysis failed:', cdpError.message);
      browserlessData._error = cdpError.message;
      
      await logToDatabase('error', 'CDP analysis failed', {
        error: cdpError.message,
        url: url
      });
    } finally {
      // Cleanup
      if (wsSocket) {
        try {
          wsSocket.close();
          console.log('🔌 WebSocket connection closed');
        } catch (closeError) {
          console.log('WebSocket close warning:', closeError.message);
        }
      }
    }
    
    // Insert audit run record
    try {
      await supabase.from('audit_runs').insert({
        trace_id: traceId,
        url: url,
        status: browserlessData._error ? 'error' : 'completed',
        duration_ms: Date.now() - startedAt,
        data: browserlessData
      });
    } catch (insertError) {
      console.error('Failed to insert audit run:', insertError.message);
    }
    
    console.log('✅ Analysis function completed successfully');
    await logToDatabase('info', 'Analysis completed', {
      finalUrl: browserlessData.finalUrl,
      cookiesPre: browserlessData.cookies_pre?.length,
      requestsPre: browserlessData.requests_pre?.length,
      cmpDetected: browserlessData.cmp_detected,
      consentClicked: browserlessData.consent_clicked
    });
    
    return new Response(JSON.stringify({
      success: true,
      trace_id: traceId,
      timestamp: Date.now(),
      bl_status_code: 200,
      bl_health_status: healthStatus,
      data: browserlessData
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 200
    });

  } catch (error) {
    console.error(`❌ Function error [${traceId}]:`, error.message);
    
    await logToDatabase('error', 'Function error', {
      error: error.message,
      stack: error.stack,
      url: url
    });
    
    return new Response(JSON.stringify({
      success: false,
      trace_id: traceId,
      error_code: 'FUNCTION_ERROR',
      error_message: error.message,
      data: {
        _error: error.message,
        debug: {
          url: url,
          timestamp: Date.now(),
          duration_ms: Date.now() - startedAt
        }
      }
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 200
    });
  }
});