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

    // Direct WebSocket CDP implementation with session-aware commands
    console.log('🌐 Starting CDP WebSocket analysis...');
    
    // Create WebSocket connection to Browserless
    const WSE = `wss://production-sfo.browserless.io?token=${browserlessApiKey}`;
    
    let wsSocket;
    let browserlessData = null;
    
    try {
      // Initialize WebSocket connection
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
      let pageSessionId = null;
      
      // Session-aware CDP command wrapper
      const sendCDPCommand = (method, params = {}, sessionId = null) => {
        return new Promise((resolve, reject) => {
          const id = requestId++;
          const message = JSON.stringify({ 
            id, 
            method, 
            params: sessionId ? { ...params } : params,
            sessionId
          });
          
          const timeout = setTimeout(() => {
            delete cdpResults[id];
            reject(new Error(`CDP command timeout: ${method}`));
          }, 15000);
          
          cdpResults[id] = { resolve, reject, timeout };
          wsSocket.send(message);
        });
      };
      
      // Storage for network events and data
      const networkData = {
        requests: [],
        responses: [],
        cookies_pre: [],
        cookies_post_accept: [],
        cookies_post_reject: [],
        storage_pre: {},
        storage_post_accept: {},
        storage_post_reject: {},
        isPreConsent: true
      };
      
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
              
              // Enable domains for new session
              if (targetInfo.type === 'page' || targetInfo.type === 'iframe') {
                sendCDPCommand('Page.enable', {}, targetSessionId).catch(e => console.log('Page.enable failed:', e.message));
                sendCDPCommand('Runtime.enable', {}, targetSessionId).catch(e => console.log('Runtime.enable failed:', e.message));
                sendCDPCommand('Network.enable', {
                  maxTotalBufferSize: 10_000_000,
                  maxResourceBufferSize: 5_000_000
                }, targetSessionId).catch(e => console.log('Network.enable failed:', e.message));
              }
            }
            
            // Network event handling (filter by main page session)
            if (data.method === 'Network.requestWillBeSent') {
              const request = {
                id: data.params.requestId,
                url: data.params.request.url,
                method: data.params.request.method,
                headers: data.params.request.headers,
                timestamp: data.params.timestamp,
                phase: networkData.isPreConsent ? 'pre' : 'post',
                sessionId: sessionId,
                query: {},
                trackingParams: {}
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
                  } catch (e) {
                    console.log('JSON parse error:', e.message);
                  }
                }
              }
              
              networkData.requests.push(request);
              
            } else if (data.method === 'Network.responseReceived') {
              const response = {
                requestId: data.params.requestId,
                status: data.params.response.status,
                mimeType: data.params.response.mimeType,
                resourceType: data.params.type,
                sessionId: sessionId
              };
              networkData.responses.push(response);
            }
          }
        } catch (e) {
          // Ignore non-JSON messages
        }
      };
      
      // Initialize CDP session
      console.log('🚀 Initializing CDP session...');
      
      // Get browser targets
      const targets = await sendCDPCommand('Target.getTargets');
      const pageTarget = targets.targetInfos?.find(t => t.type === 'page') || targets.targetInfos?.[0];
      
      if (!pageTarget) {
        throw new Error('No page target available');
      }
      
      const targetId = pageTarget.targetId;
      console.log('🎯 Using target:', targetId);
      
      // Attach to page target to get session ID
      const attachResult = await sendCDPCommand('Target.attachToTarget', {
        targetId,
        flatten: true
      });
      
      pageSessionId = attachResult.sessionId;
      sessions.set(pageSessionId, pageTarget);
      console.log('📎 Page session ID:', pageSessionId);
      
      // Auto-attach to all targets with flattening
      await sendCDPCommand('Target.setAutoAttach', {
        autoAttach: true,
        flatten: true,
        waitForDebuggerOnStart: false
      });
      
      // Enable CDP domains on the page session
      await sendCDPCommand('Page.enable', {}, pageSessionId);
      await sendCDPCommand('Runtime.enable', {}, pageSessionId);
      await sendCDPCommand('Network.enable', {
        maxTotalBufferSize: 10_000_000,
        maxResourceBufferSize: 5_000_000
      }, pageSessionId);
      await sendCDPCommand('DOMStorage.enable', {}, pageSessionId);
      
      console.log('✅ CDP domains enabled on page session:', pageSessionId);
      console.log('📍 CDP_bound: true');
      
      // Set additional headers
      await sendCDPCommand('Network.setUserAgentOverride', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }, pageSessionId);
      
      // Helper functions for data collection
      const collectCookies = async (label) => {
        const cookies = [];
        
        try {
          const cdpCookies = await sendCDPCommand('Network.getAllCookies', {}, pageSessionId);
          if (cdpCookies.cookies) {
            cookies.push(...cdpCookies.cookies.map(c => ({
              ...c,
              expiry_days: c.expires ? Math.round((c.expires - Date.now() / 1000) / (24 * 60 * 60)) : null
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
            const docCookies = docCookie.split('; ').map(c => {
              const [name, ...rest] = c.split('=');
              return { name, value: rest.join('='), source: 'document.cookie' };
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
          const origin = new URL(url).origin;
          
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
                      res.local[k] = localStorage.getItem(k); 
                    } 
                  } catch {}
                  try { 
                    for (let i = 0; i < sessionStorage.length; i++) { 
                      const k = sessionStorage.key(i); 
                      res.session[k] = sessionStorage.getItem(k); 
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
      
      // Navigate to the URL
      console.log('📄 Navigating to URL...');
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
      
      console.log('🌐 Final URL:', finalUrl);
      console.log('📄 readyState:', readyState);
      
      // DEBUG: Check request counts with fallback
      const cdpRequestsCount = networkData.requests.filter(r => r.phase === 'pre').length;
      
      // Add fetch/XHR monkeypatch as fallback
      const fallbackRequests = [];
      try {
        const monkeypatchResult = await sendCDPCommand('Runtime.evaluate', {
          expression: `
            (() => {
              const requests = [];
              const trackingKeys = ['id', 'tid', 'ev', 'en', 'fbp', 'fbc', 'sid', 'cid', 'uid', 'user_id', 'ip', 'geo', 'pid', 'aid', 'k'];
              
              // Monkeypatch fetch
              const originalFetch = window.fetch;
              window.fetch = function(...args) {
                const [resource, options] = args;
                const url = typeof resource === 'string' ? resource : resource.url;
                const method = options?.method || 'GET';
                
                const request = {
                  url,
                  method,
                  phase: 'pre-fallback',
                  timestamp: Date.now(),
                  query: {},
                  trackingParams: {}
                };
                
                try {
                  const urlObj = new URL(url, window.location.href);
                  urlObj.searchParams.forEach((value, key) => {
                    request.query[key] = value;
                    if (trackingKeys.some(tk => key.toLowerCase().includes(tk))) {
                      request.trackingParams[key] = value;
                    }
                  });
                } catch (e) {}
                
                requests.push(request);
                return originalFetch.apply(this, args);
              };
              
              // Monkeypatch XMLHttpRequest
              const originalXHR = window.XMLHttpRequest;
              const XHRopen = originalXHR.prototype.open;
              originalXHR.prototype.open = function(method, url, ...args) {
                const request = {
                  url,
                  method,
                  phase: 'pre-fallback',
                  timestamp: Date.now(),
                  query: {},
                  trackingParams: {}
                };
                
                try {
                  const urlObj = new URL(url, window.location.href);
                  urlObj.searchParams.forEach((value, key) => {
                    request.query[key] = value;
                    if (trackingKeys.some(tk => key.toLowerCase().includes(tk))) {
                      request.trackingParams[key] = value;
                    }
                  });
                } catch (e) {}
                
                requests.push(request);
                return XHRopen.apply(this, [method, url, ...args]);
              };
              
              return { monkeypatchEnabled: true };
            })()
          `
        }, pageSessionId);
        
        console.log('🐒 Fetch/XHR monkeypatch enabled');
      } catch (e) {
        console.log('Monkeypatch failed:', e.message);
      }
      
      console.log('🔍 DEBUG - Requests captured:', {
        cdp: cdpRequestsCount,
        fallback: fallbackRequests.length
      });
      
      console.log('🎯 TARGET CHECK:', {
        url: finalUrl,
        sessionId: pageSessionId,
        readyState
      });
      
      // Quality check: if no requests captured, return INCOMPLETE
      if (cdpRequestsCount === 0 && fallbackRequests.length === 0) {
        console.log('⚠️ WARNING: No network requests captured - CDP not bound properly');
        
        return new Response(JSON.stringify({
          success: true,
          trace_id: traceId,
          data: {
            finalUrl,
            cookies_pre: [],
            cookies_post_accept: [],
            cookies_post_reject: [],
            requests_pre: [],
            requests_post_accept: [],
            requests_post_reject: [],
            storage_pre: {},
            storage_post_accept: {},
            storage_post_reject: {},
            cmp_detected: false,
            cmp_cookie_name: '',
            cmp_cookie_value: '',
            consent_clicked: false,
            scenarios: { baseline: true, accept: false, reject: false },
            _quality: { 
              incomplete: true, 
              reason: 'NETWORK_CAPTURE_EMPTY_CDP_AND_FALLBACK',
              debug: {
                target_id: targetId,
                page_session_id: pageSessionId,
                cdp_requests: cdpRequestsCount,
                fallback_requests: fallbackRequests.length,
                ready_state: readyState
              }
            }
          }
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      // Phase 1: Collect pre-consent data
      console.log('📊 Phase 1: Collecting pre-consent data...');
      networkData.cookies_pre = await collectCookies('pre-consent');
      networkData.storage_pre = await collectStorage('pre-consent');
      
      // Phase 2: CMP Detection and interaction
      console.log('🍪 Phase 2: CMP detection...');
      
      const cmpDetection = await sendCDPCommand('Runtime.evaluate', {
        expression: `
          (() => {
            let cmpDetected = false;
            let foundButton = null;
            
            // Check for CMP indicators in cookies
            const cmpIndicators = [
              'CookieScriptConsent', 'OptanonConsent', 'euconsent-v2', 
              'CookieConsent', 'tarteaucitron', 'cookieyes-consent'
            ];
            
            cmpIndicators.forEach(indicator => {
              if (document.cookie.includes(indicator)) {
                cmpDetected = true;
              }
            });
            
            // Check DOM for CMP elements
            const cmpElements = document.querySelectorAll([
              '[id*="cookie"], [class*="cookie"]',
              '[id*="consent"], [class*="consent"]',
              '[id*="gdpr"], [class*="gdpr"]'
            ].join(', '));
            
            if (cmpElements.length > 0) cmpDetected = true;
            
            // Find accept button (Slovak/English)
            const acceptTexts = ['súhlasím', 'prijať', 'akceptovať', 'povoliť', 'accept', 'allow', 'agree'];
            const buttons = Array.from(document.querySelectorAll('button'));
            
            foundButton = buttons.find(btn => 
              btn.textContent && acceptTexts.some(text => 
                btn.textContent.toLowerCase().includes(text)
              )
            );
            
            if (!foundButton) {
              // Try generic selectors
              foundButton = document.querySelector([
                'button[id*="accept"], button[class*="accept"]',
                '.cookie-accept, .consent-accept, #cookie-accept'
              ].join(', '));
            }
            
            return { cmpDetected, hasAcceptButton: !!foundButton };
          })()
        `
      }, pageSessionId);
      
      const cmpInfo = cmpDetection.result?.value || { cmpDetected: false, hasAcceptButton: false };
      console.log('🔍 CMP Detection Result:', cmpInfo);
      
      let consentClicked = false;
      
      if (cmpInfo.cmpDetected && cmpInfo.hasAcceptButton) {
        console.log('✅ CMP detected, attempting to click accept...');
        
        // Switch to post-consent tracking
        networkData.isPreConsent = false;
        
        // Click accept button
        const clickResult = await sendCDPCommand('Runtime.evaluate', {
          expression: `
            (() => {
              const acceptTexts = ['súhlasím', 'prijať', 'akceptovať', 'povoliť', 'accept', 'allow', 'agree'];
              const buttons = Array.from(document.querySelectorAll('button'));
              
              // Try text-based search first
              const textButton = buttons.find(btn => 
                btn.textContent && acceptTexts.some(text => 
                  btn.textContent.toLowerCase().includes(text)
                )
              );
              
              if (textButton) {
                textButton.click();
                return { clicked: true, method: 'text-search' };
              }
              
              // Try selector-based search
              const selectorButton = document.querySelector([
                'button[id*="accept"], button[class*="accept"]',
                '.cookie-accept, .consent-accept, #cookie-accept'
              ].join(', '));
              
              if (selectorButton) {
                selectorButton.click();
                return { clicked: true, method: 'selector' };
              }
              
              return { clicked: false, method: 'none' };
            })()
          `
        }, pageSessionId);
        
        const clickInfo = clickResult.result?.value || { clicked: false };
        consentClicked = clickInfo.clicked;
        
        if (consentClicked) {
          console.log('✅ Accept button clicked:', clickInfo.method);
          
          // Wait for consent processing
          await new Promise(resolve => setTimeout(resolve, 4000));
          
          // Collect post-consent data
          console.log('📊 Phase 3: Collecting post-consent data...');
          networkData.cookies_post_accept = await collectCookies('post-accept');
          networkData.storage_post_accept = await collectStorage('post-accept');
        } else {
          console.log('⚠️ Failed to click accept button');
        }
      } else {
        console.log('ℹ️ No CMP detected or no accept button found');
      }
      
      // Final data compilation
      const preConsentRequests = networkData.requests.filter(r => r.phase === 'pre');
      const postConsentRequests = networkData.requests.filter(r => r.phase === 'post');
      
      console.log('📊 Final Summary:');
      console.log(`Cookies: pre=${networkData.cookies_pre.length}, post=${networkData.cookies_post_accept.length}`);
      console.log(`Requests: pre=${preConsentRequests.length}, post=${postConsentRequests.length}`);
      console.log(`Final URL: ${finalUrl}`);
      
      browserlessData = {
        finalUrl,
        cookies_pre: networkData.cookies_pre,
        cookies_post_accept: networkData.cookies_post_accept,
        cookies_post_reject: [],
        requests_pre: preConsentRequests,
        requests_post_accept: postConsentRequests,
        requests_post_reject: [],
        storage_pre: networkData.storage_pre,
        storage_post_accept: networkData.storage_post_accept,
        storage_post_reject: {},
        cmp_detected: cmpInfo.cmpDetected,
        cmp_cookie_name: '',
        cmp_cookie_value: '',
        consent_clicked: consentClicked,
        scenarios: { 
          baseline: true, 
          accept: consentClicked, 
          reject: false 
        }
      };
      
      console.log('✅ CDP WebSocket analysis complete');
      
    } catch (wsError) {
      console.error('❌ WebSocket CDP analysis failed:', wsError.message);
      
      await logToDatabase('error', '❌ WebSocket CDP analysis failed', {
        error: wsError.message
      });
      
      return new Response(JSON.stringify({
        success: false,
        trace_id: traceId,
        error_code: 'WEBSOCKET_CDP_ERROR',
        error_message: `WebSocket CDP analysis failed: ${wsError.message}`,
        data: {
          _error: wsError.message,
          debug: {
            websocket_url: WSE
          }
        }
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        status: 200
      });
      
    } finally {
      // Clean up WebSocket connection
      if (wsSocket && wsSocket.readyState === WebSocket.OPEN) {
        wsSocket.close();
        console.log('🔌 WebSocket connection closed');
      }
    }

    if (!browserlessData) {
      throw new Error('Failed to get data from WebSocket CDP analysis');
    }

    // Log successful completion to database
    await logToDatabase('info', '✅ Analysis completed successfully', {
      final_url: browserlessData.finalUrl,
      cookies_pre_count: browserlessData.cookies_pre?.length || 0,
      cookies_post_count: browserlessData.cookies_post_accept?.length || 0,
      requests_pre_count: browserlessData.requests_pre?.length || 0,
      requests_post_count: browserlessData.requests_post_accept?.length || 0,
      cmp_detected: browserlessData.cmp_detected,
      consent_clicked: browserlessData.consent_clicked
    });

    // Insert audit run record
    try {
      await supabase.from('audit_runs').insert({
        trace_id: traceId,
        url: url,
        final_url: browserlessData.finalUrl,
        status: 'completed',
        bl_status_code: 200,
        bl_health_status: healthStatus,
        cookies_pre_count: browserlessData.cookies_pre?.length || 0,
        cookies_post_count: browserlessData.cookies_post_accept?.length || 0,
        requests_pre_count: browserlessData.requests_pre?.length || 0,
        requests_post_count: browserlessData.requests_post_accept?.length || 0,
        cmp_detected: browserlessData.cmp_detected,
        consent_clicked: browserlessData.consent_clicked,
        duration_ms: Date.now() - startedAt
      });
    } catch (dbError) {
      console.error('Failed to insert audit run:', dbError.message);
    }

    return new Response(JSON.stringify({
      success: true,
      trace_id: traceId,
      bl_status_code: 200,
      bl_health_status: healthStatus,
      timestamp: new Date().toISOString(),
      data: browserlessData
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (error) {
    console.error(`❌ Function error [${traceId}]:`, error);
    
    await logToDatabase('error', '❌ Function error', {
      error: error.message,
      stack: error.stack
    });

    // Insert failed audit run record
    try {
      await supabase.from('audit_runs').insert({
        trace_id: traceId,
        url: url,
        final_url: url,
        status: 'failed',
        error_code: 'FUNCTION_ERROR',
        error_message: error.message,
        duration_ms: Date.now() - startedAt
      });
    } catch (dbError) {
      console.error('Failed to insert failed audit run:', dbError.message);
    }

    // Never return 500, always return 200 with success:false
    return new Response(JSON.stringify({
      success: false,
      trace_id: traceId,
      error_code: 'FUNCTION_ERROR',
      error_message: error.message,
      data: {
        _error: error.message,
        debug: {
          req_pre: 0,
          req_post_accept: 0,
          req_post_reject: 0,
          cookies_pre_count: 0,
          cookies_post_count: 0
        }
      }
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 200
    });
  }
});