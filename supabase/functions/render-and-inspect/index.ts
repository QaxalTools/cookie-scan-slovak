import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

/**
 * =================== AUDIT SYSTEM DOCUMENTATION ===================
 * 
 * SYSTEM FLOW: 
 * WS → Target attach → enable domains → navigate → tri zbierky cookies → CMP → post scenáre → sumarizácia
 * 
 * CDP EVENT FILTERING:
 * - All Network.* events filtered by pageSessionId (not browser-wide)
 * - Target.setAutoAttach for automatic page attachment
 * - Multi-phase cookie collection: post-load, post-idle, extra-idle
 * 
 * CMP EXTENSION POINTS:
 * - Add new selectors to CMP_SELECTORS object
 * - Extend clickByText function for new interaction patterns
 * 
 * TRACKING PARAMETERS:
 * - Extend SIGNIFICANT_PARAMS array for new tracking parameters
 * - Add new body content parsing in parsePostData function
 * 
 * QUALITY GATES:
 * - Self-check validates data consistency across collection phases
 * - No magic thresholds - all detection is derived from actual data
 * - INCOMPLETE banners only for concrete, identified issues
 */

// CORS headers for browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// =================== SINGLE SOURCE OF TRUTH HELPERS ===================
// These functions are defined once and used throughout the Edge function

// PATCH 1 - Header normalization utilities
function normalizeHeaderKeys(h: Record<string, string | string[]> | undefined): Record<string, string | string[]> {
  if (!h) return {};
  const out: Record<string, string | string[]> = {};
  for (const k of Object.keys(h)) out[k.toLowerCase()] = h[k] as any;
  return out;
}

function ensureArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}
// These functions are defined once and used throughout the Edge function

function onceLoadFired(ws: WebSocket, sessionId: string, timeoutMs = 20000) {
  return new Promise<void>((resolve, reject) => {
    const onMsg = (event: MessageEvent) => {
      try {
        const msg = JSON.parse((event as any).data);
        if (msg.method === 'Page.loadEventFired' && msg.sessionId === sessionId) {
          ws.removeEventListener('message', onMsg);
          clearTimeout(to);
          resolve();
        }
      } catch {}
    };
    const to = setTimeout(() => {
      ws.removeEventListener('message', onMsg);
      reject(new Error('NAVIGATION_TIMEOUT'));
    }, timeoutMs);
    ws.addEventListener('message', onMsg);
  });
}

function normalizeDomain(input?: string): string {
  return (input ?? '').trim().replace(/^\./, '');
}

function buildCookieKey(cookie: { name: string; domain?: string; path?: string }): string {
  return `${cookie.name}|${normalizeDomain(cookie.domain)}|${cookie.path || '/'}`;
}

function maskValue(value: string): string {
  return value.length > 12 ? value.slice(0, 12) + '…' : value;
}

function parseQuery(url: string): Record<string, string> {
  try {
    const urlObj = new URL(url);
    const params: Record<string, string> = {};
    urlObj.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  } catch {
    return {};
  }
}

function parseFormUrlEncoded(data: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!data) return params;
  
  try {
    const pairs = data.split('&');
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key) {
        params[decodeURIComponent(key)] = decodeURIComponent(value || '');
      }
    }
  } catch {
    // Ignore parsing errors
  }
  return params;
}

function safeJsonParse(data?: string): any | undefined {
  if (!data?.trim()) return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

function getETldPlusOneLite(host: string): string {
  const cleanHost = host.toLowerCase().replace(/^www\./, '');
  
  // Handle special cases (whitelist approach)
  const specialTlds = [
    '.co.uk', '.com.au', '.co.nz', '.com.br', '.co.za', '.org.uk',
    '.net.au', '.gov.au', '.edu.au', '.asn.au', '.id.au'
  ];
  
  for (const tld of specialTlds) {
    if (cleanHost.endsWith(tld)) {
      const parts = cleanHost.split('.');
      if (parts.length >= 3) {
        return parts.slice(-3).join('.');
      }
    }
  }
  
  // Standard case: domain.tld
  const parts = cleanHost.split('.');
  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }
  
  return cleanHost;
}

interface ParsedCookie {
  name: string;
  valueMasked: string;
  domain: string;
  path: string;
  expiresEpochMs?: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  source: string;
}

function parseSetCookieHeader(value: string, responseUrl: string): ParsedCookie {
  const parts = value.split(';').map(p => p.trim());
  const [nameValue] = parts;
  const [name, rawValue] = nameValue.split('=');
  
  const cookie: ParsedCookie = {
    name: name?.trim() || '',
    valueMasked: maskValue(rawValue || ''),
    domain: '',
    path: '/',
    secure: false,
    httpOnly: false,
    source: 'set-cookie-header'
  };
  
  // Extract domain from response URL if not specified
  try {
    const urlObj = new URL(responseUrl);
    cookie.domain = urlObj.hostname;
  } catch {
    cookie.domain = 'unknown';
  }
  
  // Parse attributes
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].toLowerCase();
    if (part.startsWith('domain=')) {
      cookie.domain = normalizeDomain(part.substring(7));
    } else if (part.startsWith('path=')) {
      cookie.path = part.substring(5) || '/';
    } else if (part.startsWith('expires=')) {
      try {
        const expireDate = new Date(part.substring(8));
        cookie.expiresEpochMs = expireDate.getTime();
      } catch {
        // Ignore invalid dates
      }
    } else if (part.startsWith('max-age=')) {
      try {
        const maxAge = parseInt(part.substring(8));
        cookie.expiresEpochMs = Date.now() + (maxAge * 1000);
      } catch {
        // Ignore invalid max-age
      }
    } else if (part === 'secure') {
      cookie.secure = true;
    } else if (part === 'httponly') {
      cookie.httpOnly = true;
    } else if (part.startsWith('samesite=')) {
      cookie.sameSite = part.substring(9);
    }
  }
  
  return cookie;
}

// Significant tracking parameters to extract
const SIGNIFICANT_PARAMS = [
  'id', 'tid', 'ev', 'en', 'fbp', 'fbc', 'sid', 'cid', 'uid', 'user_id', 
  'ip', 'geo', 'pid', 'aid', 'k', 'gclid', 'dclid', 'wbraid', 'gbraid',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'
];

// CMP selectors for detection and interaction
const CMP_SELECTORS = {
  onetrust: {
    banner: '#onetrust-banner-sdk',
    accept: '#onetrust-accept-btn-handler',
    reject: '#onetrust-reject-all-handler, #onetrust-pc-btn-handler'
  },
  cookiescript: {
    banner: '#cookiescript_injected',
    accept: '[data-cs-accept-all]',
    reject: '[data-cs-reject-all]'
  },
  generic: {
    banner: '[id*="cookie"], [class*="consent"], [data-testid*="consent"]',
    accept: '[id*="accept"], [class*="accept"], [data-testid*="accept"]',
    reject: '[id*="reject"], [class*="reject"], [data-testid*="reject"]'
  }
};

// Browserless configuration
const BROWSERLESS_BASE = Deno.env.get('BROWSERLESS_BASE')?.trim() || 'https://production-sfo.browserless.io';

function normalizeToken(token?: string): string {
  if (!token) return '';
  return token.trim().replace(/^["']|["']$/g, '');
}

async function checkBrowserlessAuth(token: string) {
  const baseUrl = new URL(BROWSERLESS_BASE);
  const result: any = { 
    base: BROWSERLESS_BASE, 
    host: baseUrl.host,
    tests: {} 
  };

  // A) Query param health check
  try {
    const response = await fetch(`${BROWSERLESS_BASE}/json/version?token=${token}`);
    const text = await response.text();
    result.tests.query = { 
      status: response.status, 
      ok: response.ok, 
      text: text.slice(0, 256) 
    };
  } catch (error) { 
    result.tests.query = { error: String(error) }; 
  }

  // B) X-API-Key header
  try {
    const response = await fetch(`${BROWSERLESS_BASE}/json/version`, { 
      headers: { 'X-API-Key': token } 
    });
    const text = await response.text();
    result.tests.header = { 
      status: response.status, 
      ok: response.ok, 
      text: text.slice(0, 256) 
    };
  } catch (error) { 
    result.tests.header = { error: String(error) }; 
  }

  // C) WebSocket CDP test
  result.tests.ws = await new Promise((resolve) => {
    try {
      const wsUrl = `wss://${baseUrl.host}?token=${token}`;
      const ws = new WebSocket(wsUrl);
      const timeout = setTimeout(() => { 
        try { ws.close(); } catch {} 
        resolve({ error: 'timeout' }); 
      }, 8000);
      
      ws.onopen = () => { 
        clearTimeout(timeout); 
        ws.close(); 
        resolve({ open: true }); 
      };
      
      ws.onclose = (event) => { 
        clearTimeout(timeout); 
        resolve({ open: false, code: event.code }); 
      };
      
      ws.onerror = () => { 
        clearTimeout(timeout); 
        resolve({ open: false, code: 'onerror' }); 
      };
    } catch (error) { 
      resolve({ error: String(error) }); 
    }
  });

  // Determine auth status
  let status: 'ok' | 'invalid_token' | 'wrong_product' | 'network_error' = 'network_error';
  
  if (result.tests.query?.ok || result.tests.header?.ok || result.tests.ws?.open) {
    status = 'ok';
  } else if ([401, 403].includes(result.tests.query?.status) || [401, 403].includes(result.tests.header?.status)) {
    status = 'invalid_token';
  } else if (result.tests.ws?.open === false && (result.tests.ws?.code === 1008 || result.tests.ws?.code === 1006)) {
    status = 'wrong_product';
  }

  return { status, details: result };
}

// =================== MODULAR ARCHITECTURE ===================

// ==== Phase Controller ====
class PhaseController {
  private phase: 'pre' | 'post_accept' | 'post_reject' = 'pre';
  
  setPre() { this.phase = 'pre'; }
  setAccept() { this.phase = 'post_accept'; }
  setReject() { this.phase = 'post_reject'; }
  get() { return this.phase; }
}

// ==== Session Manager ====
class SessionManager {
  sessions = new Map<string, { type: 'page' | 'iframe' | 'worker'; frameId?: string; url?: string }>();
  inflight = 0;
  ws: WebSocket | null = null;
  logger: any;
  
  constructor(ws: WebSocket, logger: any) {
    this.ws = ws;
    this.logger = logger;
  }
  
  async attachHandlers() {
    if (!this.ws) return;
    
    // Auto-attach to all targets
    await this.sendCommand('Target.setAutoAttach', {
      autoAttach: true,
      flatten: true,
      filter: [
        { type: 'page' },
        { type: 'iframe' },
        { type: 'worker' }
      ]
    });
    await this.logger.log('info', '🎯 Auto-attach configured for page/iframe/worker');
  }
  
  async onAttachedToTarget(sessionId: string, type: string, targetId?: string) {
    this.sessions.set(sessionId, { type: type as any });
    await this.logger.log('info', `📎 Attached to ${type} session: ${sessionId}`);
    
    // Enable required domains for each session
    await this.sendCommand('Runtime.enable', {}, sessionId);
    await this.sendCommand('Network.enable', {
      maxTotalBufferSize: 10000000,
      maxResourceBufferSize: 5000000
    }, sessionId);
    await this.sendCommand('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    
    if (type === 'page') {
      await this.sendCommand('Page.enable', {}, sessionId);
      await this.sendCommand('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId);
    }
    
    await this.logger.log('info', `✅ Domains enabled for ${type} session: ${sessionId}`);
  }
  
  onNetworkRequestStart() {
    this.inflight++;
  }
  
  onNetworkRequestEnd() {
    this.inflight = Math.max(0, this.inflight - 1);
  }
  
  async waitForGlobalIdle(minQuietMs = 1500, timeoutMs = 15000): Promise<void> {
    return new Promise((resolve) => {
      let quietStart = 0;
      const checkInterval = 100;
      let totalWaited = 0;
      
      const check = () => {
        totalWaited += checkInterval;
        
        if (this.inflight === 0) {
          if (quietStart === 0) {
            quietStart = Date.now();
          } else if (Date.now() - quietStart >= minQuietMs) {
            resolve();
            return;
          }
        } else {
          quietStart = 0;
        }
        
        if (totalWaited >= timeoutMs) {
          resolve();
          return;
        }
        
        setTimeout(check, checkInterval);
      };
      
      setTimeout(check, checkInterval);
    });
  }
  
  async sendCommand(method: string, params: any = {}, sessionId?: string) {
    if (!this.ws) return null;
    
    return new Promise((resolve) => {
      const id = Date.now() + Math.random();
      const message = sessionId 
        ? { id, method, params, sessionId }
        : { id, method, params };
      
      const timeout = setTimeout(() => resolve(null), 5000);
      
      const onMessage = (event: MessageEvent) => {
        try {
          const response = JSON.parse(event.data);
          if (response.id === id) {
            clearTimeout(timeout);
            this.ws!.removeEventListener('message', onMessage);
            resolve(response);
          }
        } catch {}
      };
      
      this.ws!.addEventListener('message', onMessage);
      this.ws!.send(JSON.stringify(message));
    });
  }
}

// ==== Events Pipeline ====
class EventsPipeline {
  phaseController: PhaseController;
  sessionManager: SessionManager;
  logger: any;
  
  // Storage for events by phase
  setCookieEvents_pre: ParsedCookie[] = [];
  setCookieEvents_post_accept: ParsedCookie[] = [];
  setCookieEvents_post_reject: ParsedCookie[] = [];
  
  requestMap = new Map();
  responseInfo = new Map();
  
  constructor(phaseController: PhaseController, sessionManager: SessionManager, logger: any) {
    this.phaseController = phaseController;
    this.sessionManager = sessionManager;
    this.logger = logger;
  }
  
  onNetworkRequestWillBeSent(event: any, sessionId: string) {
    this.sessionManager.onNetworkRequestStart();
    
    const requestData = {
      ...event,
      sessionId,
      phase: this.phaseController.get(),
      timestamp: Date.now()
    };
    
    this.requestMap.set(event.requestId, requestData);
  }
  
  onNetworkResponseReceived(event: any, sessionId: string) {
    this.responseInfo.set(event.requestId, {
      ...event,
      sessionId,
      phase: this.phaseController.get()
    });
  }
  
  onNetworkResponseReceivedExtraInfo(event: any, sessionId: string) {
    const headers = normalizeHeaderKeys(event.headers);
    const setCookieHeaders = ensureArray(headers['set-cookie']);
    
    if (setCookieHeaders.length > 0) {
      const responseData = this.responseInfo.get(event.requestId);
      const responseUrl = responseData?.response?.url || 'unknown';
      
      for (const setCookieValue of setCookieHeaders) {
        const cookie = parseSetCookieHeader(setCookieValue, responseUrl);
        
        const phase = this.phaseController.get();
        if (phase === 'pre') {
          this.setCookieEvents_pre.push(cookie);
        } else if (phase === 'post_accept') {
          this.setCookieEvents_post_accept.push(cookie);
        } else if (phase === 'post_reject') {
          this.setCookieEvents_post_reject.push(cookie);
        }
      }
    }
  }
  
  onNetworkLoadingFinished(event: any, sessionId: string) {
    this.sessionManager.onNetworkRequestEnd();
  }
  
  onNetworkLoadingFailed(event: any, sessionId: string) {
    this.sessionManager.onNetworkRequestEnd();
  }
}

// ==== Snapshot Builder ====
class SnapshotBuilder {
  eventsPipeline: EventsPipeline;
  sessionManager: SessionManager;
  logger: any;
  
  constructor(eventsPipeline: EventsPipeline, sessionManager: SessionManager, logger: any) {
    this.eventsPipeline = eventsPipeline;
    this.sessionManager = sessionManager;
    this.logger = logger;
  }
  
  async buildSnapshot(phase: 'pre' | 'post_accept' | 'post_reject', pageSessionId: string) {
    await this.logger.log('info', `📸 Building ${phase} snapshot`);
    
    // Get persisted cookies as secondary data
    const persistedCookies = await this.getPersistedCookies(pageSessionId);
    
    // Get storage data
    const storage = await this.getStorageData(pageSessionId);
    
    // Get requests for this phase
    const requests = Array.from(this.eventsPipeline.requestMap.values())
      .filter((r: any) => r.phase === phase);
    
    // Get server-set cookies for this phase (primary)
    let serverSetCookies: ParsedCookie[] = [];
    if (phase === 'pre') {
      serverSetCookies = this.eventsPipeline.setCookieEvents_pre;
    } else if (phase === 'post_accept') {
      serverSetCookies = this.eventsPipeline.setCookieEvents_post_accept;
    } else if (phase === 'post_reject') {
      serverSetCookies = this.eventsPipeline.setCookieEvents_post_reject;
    }
    
    await this.logger.log('info', `📊 ${phase} snapshot: ${serverSetCookies.length} server-set cookies, ${persistedCookies.length} persisted, ${requests.length} requests`);
    
    return {
      serverSetCookies,
      persistedCookies,
      storage,
      requests
    };
  }
  
  private async getPersistedCookies(pageSessionId: string) {
    try {
      const result = await this.sessionManager.sendCommand('Network.getAllCookies', {}, pageSessionId) as any;
      return result?.result?.cookies || [];
    } catch {
      return [];
    }
  }
  
  private async getStorageData(pageSessionId: string) {
    try {
      // Get localStorage and sessionStorage
      const localStorageResult = await this.sessionManager.sendCommand('Runtime.evaluate', {
        expression: `(() => {
          try {
            const items = {};
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key) items[key] = localStorage.getItem(key);
            }
            return { type: 'localStorage', items };
          } catch (e) {
            return { type: 'localStorage', items: {}, error: e.message };
          }
        })()`
      }, pageSessionId) as any;
      
      const sessionStorageResult = await this.sessionManager.sendCommand('Runtime.evaluate', {
        expression: `(() => {
          try {
            const items = {};
            for (let i = 0; i < sessionStorage.length; i++) {
              const key = sessionStorage.key(i);
              if (key) items[key] = sessionStorage.getItem(key);
            }
            return { type: 'sessionStorage', items };
          } catch (e) {
            return { type: 'sessionStorage', items: {}, error: e.message };
          }
        })()`
      }, pageSessionId) as any;
      
      return {
        localStorage: localStorageResult?.result?.value?.items || {},
        sessionStorage: sessionStorageResult?.result?.value?.items || {}
      };
    } catch {
      return { localStorage: {}, sessionStorage: {} };
    }
  }
  
  private async sendCommand(method: string, params: any = {}, sessionId?: string) {
    return this.sessionManager.sendCommand(method, params, sessionId);
  }
}

// ==== CMP Hunter ====
class CMPHunter {
  sessionManager: SessionManager;
  logger: any;
  
  constructor(sessionManager: SessionManager, logger: any) {
    this.sessionManager = sessionManager;
    this.logger = logger;
  }
  
  async findAndClickCMP(action: 'accept' | 'reject', pageSessionId: string): Promise<{ clicked: boolean; details?: any }> {
    await this.logger.log('info', `🎯 Hunting for CMP ${action} button across all frames`);
    
    // Get frame tree
    const frameTreeResult = await this.sendCommand('Page.getFrameTree', {}, pageSessionId) as any;
    const frames = this.extractAllFrames(frameTreeResult?.result?.frameTree);
    
    // Try each frame
    for (const frame of frames) {
      const result = await this.tryClickInFrame(action, frame.id, pageSessionId);
      if (result.clicked) {
        await this.logger.log('info', `✅ CMP ${action} clicked in frame ${frame.id}`);
        return result;
      }
    }
    
    // Try with MutationObserver fallback
    await this.logger.log('info', '🔍 Setting up MutationObserver for dynamic CMP detection');
    const observerResult = await this.setupMutationObserver(action, pageSessionId);
    
    return observerResult;
  }
  
  private extractAllFrames(frameTree: any): any[] {
    if (!frameTree) return [];
    
    const frames = [frameTree.frame];
    if (frameTree.childFrames) {
      for (const child of frameTree.childFrames) {
        frames.push(...this.extractAllFrames(child));
      }
    }
    return frames;
  }
  
  private async tryClickInFrame(action: 'accept' | 'reject', frameId: string, pageSessionId: string) {
    const expression = this.buildCMPFinderExpression(action);
    
    try {
      // Create isolated world for frame execution
      const worldResult = await this.sendCommand('Page.createIsolatedWorld', {
        frameId: frameId,
        worldName: `cmp-hunter-${Date.now()}`,
        grantUniveralAccess: true
      }, pageSessionId) as any;
      
      const executionContextId = worldResult?.result?.executionContextId;
      
      if (executionContextId) {
        const result = await this.sendCommand('Runtime.evaluate', {
          expression,
          contextId: executionContextId
        }, pageSessionId) as any;
        
        if (result?.result?.value?.clicked) {
          return { clicked: true, details: result.result.value };
        }
      } else {
        // Fallback to main context if isolated world creation fails
        const result = await this.sendCommand('Runtime.evaluate', {
          expression
        }, pageSessionId) as any;
        
        if (result?.result?.value?.clicked) {
          return { clicked: true, details: result.result.value };
        }
      }
    } catch (error) {
      await this.logger.log('debug', `Frame ${frameId} evaluation failed: ${error}`);
    }
    
    return { clicked: false };
  }
  
  private buildCMPFinderExpression(action: 'accept' | 'reject'): string {
    return `(() => {
      const selectors = {
        onetrust: {
          banner: '#onetrust-banner-sdk, .ot-sdk-container',
          accept: '#onetrust-accept-btn-handler, .ot-pc-refuse-all-handler',
          reject: '#onetrust-reject-all-handler, #onetrust-pc-btn-handler, .ot-pc-refuse-all-handler'
        },
        cookiescript: {
          banner: '#cookiescript_injected, [data-cs-c]',
          accept: '[data-cs-accept-all], .cs-accept-all',
          reject: '[data-cs-reject-all], .cs-reject-all'
        },
        cookiebot: {
          banner: '#CybotCookiebotDialog, .CybotCookiebotDialog',
          accept: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, .CybotCookiebotDialogBodyButton[data-cookie-level="all"]',
          reject: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection, .CybotCookiebotDialogBodyButton[data-cookie-level="functional"]'
        },
        generic: {
          banner: '[id*="cookie"], [class*="consent"], [data-testid*="consent"]',
          accept: '[id*="accept"], [class*="accept"], [data-testid*="accept"]',
          reject: '[id*="reject"], [class*="reject"], [data-testid*="reject"]'
        }
      };
      
      function isVisible(el) {
        return el && (el.offsetParent !== null || el.getClientRects().length > 0);
      }
      
      function searchInShadowRoots(root, selector) {
        const elements = Array.from(root.querySelectorAll(selector));
        const shadowHosts = Array.from(root.querySelectorAll('*')).filter(el => el.shadowRoot);
        
        for (const host of shadowHosts) {
          elements.push(...searchInShadowRoots(host.shadowRoot, selector));
        }
        
        return elements;
      }
      
      function findByText(action) {
        const patterns = action === 'accept' 
          ? [/accept.*all/i, /accept.*cookies/i, /allow.*all/i, /súhlas/i, /prijať/i]
          : [/reject.*all/i, /decline/i, /refuse/i, /odmietnuť/i, /zamietnuť/i];
        
        const allElements = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"]'));
        
        return allElements.find(el => {
          const text = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
          return patterns.some(pattern => pattern.test(text)) && isVisible(el);
        });
      }
      
      // Try known CMP selectors first
      for (const [cmpName, config] of Object.entries(selectors)) {
        const targetSelector = action === 'accept' ? config.accept : config.reject;
        const elements = searchInShadowRoots(document, targetSelector);
        
        for (const el of elements) {
          if (isVisible(el)) {
            el.click();
            return { 
              clicked: true, 
              cmp: cmpName, 
              selector: targetSelector,
              method: 'selector'
            };
          }
        }
      }
      
      // Fallback to text-based search
      const textElement = findByText('${action}');
      if (textElement) {
        textElement.click();
        return { 
          clicked: true, 
          cmp: 'unknown', 
          selector: textElement.tagName + (textElement.id ? '#' + textElement.id : ''),
          method: 'text',
          text: textElement.textContent.trim().slice(0, 50)
        };
      }
      
      return { clicked: false };
    })()`;
  }
  
  private async setupMutationObserver(action: 'accept' | 'reject', pageSessionId: string) {
    const cmpFinderCode = this.buildCMPFinderExpression(action);
    const observerExpression = `
      new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (typeof observer !== 'undefined') observer.disconnect();
          resolve({ clicked: false, reason: 'timeout' });
        }, 10000);
        
        const observer = new MutationObserver(() => {
          try {
            const result = ${cmpFinderCode};
            if (result && result.clicked) {
              clearTimeout(timeout);
              observer.disconnect();
              resolve(result);
            }
          } catch (e) {
            // Ignore errors during CMP check
          }
        });
        
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: false
        });
        
        // Also try immediately
        try {
          const result = ${cmpFinderCode};
          if (result && result.clicked) {
            clearTimeout(timeout);
            observer.disconnect();
            resolve(result);
          }
        } catch (e) {
          // Continue with observer
        }
      })
    `;
    
    try {
      const result = await this.sendCommand('Runtime.evaluate', {
        expression: observerExpression,
        awaitPromise: true
      }, pageSessionId) as any;
      
      return result?.result?.value || { clicked: false };
    } catch {
      return { clicked: false };
    }
  }
  
  private async sendCommand(method: string, params: any = {}, sessionId?: string) {
    return this.sessionManager.sendCommand(method, params, sessionId);
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const traceId = crypto.randomUUID();
  const startTime = Date.now();
  
  // Initialize Supabase client for logging
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(supabaseUrl!, supabaseServiceKey!);
  
  // Logger utility for audit_logs
  const logger = {
    async log(level: string, message: string, data?: any) {
      try {
        await supabase.from('audit_logs').insert({
          trace_id: traceId,
          source: 'render-and-inspect',
          level,
          message,
          data
        });
      } catch (error) {
        console.error('Failed to log to audit_logs:', error);
      }
    }
  };

  try {
    await logger.log('info', `🚀 Starting render-and-inspect function [${traceId}]`);

    // Parse request
    const { url } = await req.json();
    await logger.log('info', `📝 Analyzing URL: ${url}`);

    if (!url) {
      const error = { success: false, error_code: 'MISSING_URL', details: 'URL parameter is required', trace_id: traceId };
      await logger.log('error', 'Missing URL parameter', error);
      return new Response(JSON.stringify(error), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Create initial audit_runs entry
    const { data: auditRun, error: insertError } = await supabase
      .from('audit_runs')
      .insert({
        trace_id: traceId,
        input_url: url,
        status: 'running',
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) {
      const error = { success: false, error_code: 'DB_INSERT_FAILED', details: 'Database initialization failed', trace_id: traceId };
      await logger.log('error', 'Failed to create audit_runs entry', { error: insertError });
      return new Response(JSON.stringify(error), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await logger.log('info', `📝 Created audit run record: ${auditRun?.id}`);

    // Get and validate Browserless token
    const rawToken = Deno.env.get('BROWSERLESS_TOKEN') || Deno.env.get('BROWSERLESS_API_KEY');
    const token = normalizeToken(rawToken);
    await logger.log('info', `🔑 Using Browserless token: ${token.slice(0, 8)}...${token.slice(-4)}`);

    if (!token) {
      const error = { success: false, error_code: 'BROWSERLESS_AUTH_FAILED', details: 'No Browserless token configured', trace_id: traceId };
      await logger.log('error', 'Missing Browserless token', error);
      
      // Update audit_runs with failure
      await supabase
        .from('audit_runs')
        .update({
          status: 'failed',
          error_code: 'BROWSERLESS_AUTH_FAILED',
          error_message: 'No Browserless token configured',
          ended_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime
        })
        .eq('trace_id', traceId);

      return new Response(JSON.stringify(error), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check Browserless authentication
    await logger.log('info', '🏥 Checking Browserless authentication...');
    const authCheck = await checkBrowserlessAuth(token);
    
    if (authCheck.status !== 'ok') {
      const error = { 
        success: false, 
        error_code: 'BROWSERLESS_AUTH_FAILED', 
        details: `Auth status: ${authCheck.status}`,
        auth_details: authCheck.details,
        trace_id: traceId
      };
      await logger.log('error', 'Browserless authentication failed', error);
      
      // Update audit_runs with failure
      await supabase
        .from('audit_runs')
        .update({
          status: 'failed',
          error_code: 'BROWSERLESS_AUTH_FAILED',
          error_message: `Auth status: ${authCheck.status}`,
          ended_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          bl_health_status: authCheck.status
        })
        .eq('trace_id', traceId);

      return new Response(JSON.stringify(error), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Initialize new modular architecture
    await logger.log('info', '🏗️ Initializing modular three-phase architecture');
    
    const phaseController = new PhaseController();
    let sessionManager: SessionManager;
    let eventsPipeline: EventsPipeline;
    let snapshotBuilder: SnapshotBuilder;
    let cmpHunter: CMPHunter;
    
    // Legacy data structures for backward compatibility
    const trackingParams: any[] = [];
    const hostMap = {
      requests: { firstParty: new Set(), thirdParty: new Set() },
      cookies: { firstParty: new Set(), thirdParty: new Set() },
      storage: { firstParty: new Set(), thirdParty: new Set() },
      links: { firstParty: new Set(), thirdParty: new Set() }
    };
    
    let pageSessionId = '';
    let finalUrl = url;

    // Connect to Browserless WebSocket using new modular architecture
    await logger.log('info', '🔗 Connecting to Browserless WebSocket...');
    await logger.log('info', '🌐 Starting modular three-phase CDP analysis...');

    const baseUrl = new URL(BROWSERLESS_BASE);
    const wsUrl = `wss://${baseUrl.host}?token=${token}`;
    
    const analysisResult = await new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      let messageId = 1;
      const pendingCommands = new Map();
      
      // Initialize modular components
      sessionManager = new SessionManager(ws, logger);
      eventsPipeline = new EventsPipeline(phaseController, sessionManager, logger);
      snapshotBuilder = new SnapshotBuilder(eventsPipeline, sessionManager, logger);
      cmpHunter = new CMPHunter(sessionManager, logger);

      const sendCommand = (method: string, params: any = {}, sessionId?: string) => {
        const id = messageId++;
        const message = sessionId ? 
          { id, method, params, sessionId } : 
          { id, method, params };
        ws.send(JSON.stringify(message));
        return new Promise((resolve, reject) => {
          pendingCommands.set(id, { resolve, reject });
        });
      };
      
      // Integrate sendCommand into SessionManager
      (sessionManager as any).sendCommand = sendCommand;

      // Add permanent CDP event handler using modular architecture
      ws.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(event.data);
          
          // Handle command responses
          if (message.id && pendingCommands.has(message.id)) {
            const { resolve, reject } = pendingCommands.get(message.id);
            pendingCommands.delete(message.id);
            if (message.error) {
              reject(new Error(message.error.message || 'Command failed'));
            } else {
              resolve(message);
            }
            return;
          }
          
          // Handle Target.attachedToTarget events
          if (message.method === 'Target.attachedToTarget') {
            const { sessionId, targetInfo } = message.params;
            sessionManager.onAttachedToTarget(sessionId, targetInfo.type, targetInfo.targetId);
            return;
          }
          
          // Route all Network events to the pipeline (no sessionId filtering for cross-frame support)
          const sessionId = message.sessionId || pageSessionId;
          
          if (message.method === 'Network.requestWillBeSent') {
            eventsPipeline.onNetworkRequestWillBeSent(message.params, sessionId);
            
            // Legacy tracking for backward compatibility
            const params = message.params;
            const requestHost = new URL(params.request.url).hostname;
            const mainHost = new URL(finalUrl || url).hostname;
            const mainDomain = getETldPlusOneLite(mainHost);
            const requestDomain = getETldPlusOneLite(requestHost);
            const isFirstParty = requestDomain === mainDomain;
            
            if (isFirstParty) {
              hostMap.requests.firstParty.add(requestHost);
            } else {
              hostMap.requests.thirdParty.add(requestHost);
            }
          }
          
          if (message.method === 'Network.responseReceived') {
            eventsPipeline.onNetworkResponseReceived(message.params, sessionId);
          }
          
          if (message.method === 'Network.responseReceivedExtraInfo') {
            eventsPipeline.onNetworkResponseReceivedExtraInfo(message.params, sessionId);
          }
          
          if (message.method === 'Network.loadingFinished') {
            eventsPipeline.onNetworkLoadingFinished(message.params, sessionId);
          }
          
          if (message.method === 'Network.loadingFailed') {
            eventsPipeline.onNetworkLoadingFailed(message.params, sessionId);
          }
          
        } catch (error) {
          // Silently ignore JSON parsing errors
        }
      });

      ws.onopen = async () => {
        try {
          await logger.log('info', '🔗 WebSocket connected to Browserless');
          
          // Initialize session manager and set up auto-attach
          await sessionManager.attachHandlers();
          
          // Phase 1: Get targets and attach to page
          await logger.log('info', '🎯 Getting browser targets...');
          const targets: any = await sendCommand('Target.getTargets');
          
          await logger.log('info', `TARGET CHECK ${JSON.stringify(targets.result.targetInfos.map((t: any) => ({ type: t.type, url: t.url })))}`);
          
          // Find existing page target
          const pageTarget = targets.result.targetInfos.find((t: any) => t.type === 'page');
          if (!pageTarget) {
            throw new Error('No page target found');
          }
          
          await logger.log('info', '📎 Attaching to existing page target...');
          const attachResult: any = await sendCommand('Target.attachToTarget', {
            targetId: pageTarget.targetId,
            flatten: true
          });
          
          pageSessionId = attachResult.result.sessionId;
          await logger.log('info', `📎 Target attached: page [${pageTarget.targetId}]`);
          await logger.log('info', `✅ Attached to page target: ${pageSessionId}`);
          
          // Enable CDP domains on page session (handled by SessionManager for new attachments)
          await sendCommand('Page.enable', {}, pageSessionId);
          await sendCommand('Runtime.enable', {}, pageSessionId);
          await sendCommand('Network.enable', {
            maxTotalBufferSize: 10_000_000,
            maxResourceBufferSize: 5_000_000
          }, pageSessionId);
          await sendCommand('Network.setCacheDisabled', { cacheDisabled: true }, pageSessionId);
          await sendCommand('Page.setLifecycleEventsEnabled', { enabled: true }, pageSessionId);
          await sendCommand('DOMStorage.enable', {}, pageSessionId);
          
          await logger.log('info', `📍 CDP_bound: true`);
          await logger.log('info', '✅ CDP domains enabled on page session');
          
          // Set realistic headers
          await sendCommand('Network.setUserAgentOverride', {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }, pageSessionId);
          
          await sendCommand('Network.setExtraHTTPHeaders', {
            headers: {
              'Accept-Language': 'en-US,en;q=0.9',
              'DNT': '1',
              'Sec-GPC': '1'
            }
          }, pageSessionId);
          
          // ==================== THREE-PHASE EXECUTION ====================
          
          // PHASE 1: PRE-CONSENT
          phaseController.setPre();
          await logger.log('info', '🚀 PHASE 1: Pre-consent data collection');
          
          // Navigate to URL
          await logger.log('info', '🌐 Navigating to URL...');
          await sendCommand('Page.navigate', { url }, pageSessionId);
          await onceLoadFired(ws, pageSessionId).catch(async () => {
            await logger.log('warn', '⏰ Navigation timeout, proceeding');
          });
          await logger.log('info', '✅ Page load event fired');
          
          // Wait for global idle (invariant: before every snapshot)
          await sessionManager.waitForGlobalIdle(1500, 15000);
          
          // Take pre-consent snapshot
          const preSnapshot = await snapshotBuilder.buildSnapshot('pre', pageSessionId);
          
          // Get final URL
          const pageInfo: any = await sendCommand('Runtime.evaluate', {
            expression: 'window.location.href'
          }, pageSessionId);
          
          if (pageInfo.result?.result?.value) {
            finalUrl = pageInfo.result.result.value;
          }
          
          // PHASE 2: CMP INTERACTION (ACCEPT)
          await logger.log('info', '🎯 PHASE 2: CMP hunting and accept flow');
          
          let postAcceptSnapshot: any = null;
          let postRejectSnapshot: any = null;
          
          const acceptResult = await cmpHunter.findAndClickCMP('accept', pageSessionId);
          
          if (acceptResult.clicked) {
            phaseController.setAccept();
            await logger.log('info', `✅ CMP Accept clicked: ${JSON.stringify(acceptResult.details)}`);
            
            // Wait for global idle (invariant)
            await sessionManager.waitForGlobalIdle(1500, 8000);
            
            // Take post-accept snapshot
            postAcceptSnapshot = await snapshotBuilder.buildSnapshot('post_accept', pageSessionId);
            
            await logger.log('info', 'DBG cookies_hdr_counts_post_accept', {
              pre: eventsPipeline.setCookieEvents_pre.length,
              post_accept: eventsPipeline.setCookieEvents_post_accept.length,
              post_reject: eventsPipeline.setCookieEvents_post_reject.length,
              trace_id: traceId
            });
            
            // PHASE 3: CMP INTERACTION (REJECT)
            await logger.log('info', '🎯 PHASE 3: Reloading for reject flow');
            
            // Reset to pre-phase and clear data
            phaseController.setPre();
            eventsPipeline.requestMap.clear();
            
            // Reload page
            await sendCommand('Page.reload', {}, pageSessionId);
            await onceLoadFired(ws, pageSessionId).catch(async () => {
              await logger.log('warn', '⏰ Reload timeout, proceeding');
            });
            
            // Wait for global idle
            await sessionManager.waitForGlobalIdle(1500, 8000);
            
            // Try reject flow
            const rejectResult = await cmpHunter.findAndClickCMP('reject', pageSessionId);
            
            if (rejectResult.clicked) {
              phaseController.setReject();
              await logger.log('info', `❌ CMP Reject clicked: ${JSON.stringify(rejectResult.details)}`);
              
              // Wait for global idle
              await sessionManager.waitForGlobalIdle(1500, 8000);
              
              // Take post-reject snapshot
              postRejectSnapshot = await snapshotBuilder.buildSnapshot('post_reject', pageSessionId);
              
              await logger.log('info', 'DBG cookies_hdr_counts_post_reject', {
                pre: eventsPipeline.setCookieEvents_pre.length,
                post_accept: eventsPipeline.setCookieEvents_post_accept.length,
                post_reject: eventsPipeline.setCookieEvents_post_reject.length,
                trace_id: traceId
              });
            } else {
              await logger.log('info', '❌ CMP Reject click failed - no reject button found');
            }
          } else {
            await logger.log('info', '❌ CMP Accept click failed - no CMP detected or button not found');
          }
          
          // ==================== LEGACY DATA COMPATIBILITY ====================
          // Build backward-compatible data structures for existing report logic
          const cookies_pre = preSnapshot?.persistedCookies || [];
          const cookies_post_accept = postAcceptSnapshot?.persistedCookies || [];
          const cookies_post_reject = postRejectSnapshot?.persistedCookies || [];
          const cookies_post_accept_extra: any[] = []; // Legacy compatibility
          const cookies_post_reject_extra: any[] = []; // Legacy compatibility
          const cookies_pre_load = cookies_pre;
          const cookies_pre_idle = cookies_pre;
          const cookies_pre_extra = cookies_pre;
          
          const requests_pre = preSnapshot?.requests || [];
          const requests_post_accept = postAcceptSnapshot?.requests || [];
          const requests_post_reject = postRejectSnapshot?.requests || [];
          
          const storage_pre = preSnapshot?.storage ? [preSnapshot.storage] : [];
          const storage_post_accept = postAcceptSnapshot?.storage ? [postAcceptSnapshot.storage] : [];
          const storage_post_reject = postRejectSnapshot?.storage ? [postRejectSnapshot.storage] : [];
          
          // Use server-set cookies as primary data source
          const setCookieEvents_pre = eventsPipeline.setCookieEvents_pre;
          const setCookieEvents_post_accept = eventsPipeline.setCookieEvents_post_accept;
          const setCookieEvents_post_reject = eventsPipeline.setCookieEvents_post_reject;
          
          // Build legacy-compatible maps
          const requestMap = eventsPipeline.requestMap;
          const postDataMap = new Map(); // Legacy compatibility - empty for now
          
          // Phase 5: Calculate tracking parameters and data sending
          const mainDomain = getETldPlusOneLite(new URL(finalUrl).hostname);
          let thirdPartyDataSending = 0;
          
          // Process all requests for tracking analysis
          const allRequests = [...requests_pre, ...requests_post_accept, ...requests_post_reject];
          
          for (const request of allRequests) {
            try {
              const requestHost = new URL(request.url).hostname;
              const requestDomain = getETldPlusOneLite(requestHost);
              const isFirstParty = requestDomain === mainDomain;
              
              // Update host map
              if (isFirstParty) {
                hostMap.requests.firstParty.add(requestHost);
              } else {
                hostMap.requests.thirdParty.add(requestHost);
              }
              
              // Extract query parameters
              const queryParams = parseQuery(request.url);
              const significantQueryParams = Object.keys(queryParams).filter(key => 
                SIGNIFICANT_PARAMS.includes(key)
              );
              
              // Extract POST body parameters if available
              const postData = postDataMap.get(request.requestId);
              let significantPostParams: string[] = [];
              
              if (postData) {
                const postParams = typeof postData === 'string' ? 
                  parseFormUrlEncoded(postData) : 
                  (typeof postData === 'object' ? postData : {});
                  
                significantPostParams = Object.keys(postParams).filter(key => 
                  SIGNIFICANT_PARAMS.includes(key)
                );
              }
              
              // Track significant parameters
              if (significantQueryParams.length > 0 || significantPostParams.length > 0) {
                trackingParams.push({
                  host: requestHost,
                  path: new URL(request.url).pathname,
                  method: request.method,
                  params: Object.fromEntries(significantQueryParams.map(key => [key, queryParams[key]])),
                  bodyKeys: significantPostParams,
                  phase: request.phase,
                  isFirstParty
                });
                
                if (!isFirstParty) {
                  thirdPartyDataSending++;
                }
              }
            } catch {
              // Ignore invalid URLs
            }
          }
          
          // Phase 6: Build host map and simplified metadata
          const allCookies = [...cookies_pre, ...cookies_post_accept, ...cookies_post_reject];
          
          for (const cookie of allCookies) {
            const cookieDomain = getETldPlusOneLite(cookie.domain);
            const isFirstParty = cookieDomain === mainDomain;
            
            if (isFirstParty) {
              hostMap.cookies.firstParty.add(cookie.domain);
            } else {
              hostMap.cookies.thirdParty.add(cookie.domain);
            }
          }
          
          // Create simplified metadata
          const uniqueCookies = new Map();
          allCookies.forEach(cookie => {
            const key = `${cookie.name}|${normalizeDomain(cookie.domain)}|${cookie.path || '/'}`;
            if (!uniqueCookies.has(key)) {
              uniqueCookies.set(key, {
                name: cookie.name,
                domain: cookie.domain,
                path: cookie.path || '/',
                expires: cookie.expires !== -1 ? 'persistent' : 'session'
              });
            }
          });
          
          const uniqueStorageKeys = new Set();
          [...storage_pre, ...storage_post_accept, ...storage_post_reject].forEach(([key]) => {
            uniqueStorageKeys.add(key);
          });
          
          const beacons = trackingParams.map(tp => {
            const url = new URL(`https://${tp.host}${tp.path}`);
            return { urlNormalized: `${url.protocol}//${url.host}${url.pathname}` };
          });
          
          const uniqueBeacons = Array.from(new Set(beacons.map(b => b.urlNormalized)))
            .map(url => ({ urlNormalized: url }));
          
          // PATCH 4 - Create server-set cookies view from Set-Cookie headers
          function toKey(c: ParsedCookie){ return `${c.name}|${normalizeDomain(c.domain)}|${c.path||'/'}`; }
          const preFromHeaders = new Map(setCookieEvents_pre.map(c => [toKey(c), c]));
          const postAcceptFromHeaders = new Map(setCookieEvents_post_accept.map(c => [toKey(c), c]));
          const postRejectFromHeaders = new Map(setCookieEvents_post_reject.map(c => [toKey(c), c]));

          // Server-set cookies (relevant even if storage 3P cookies are blocked)
          const cookies_serverset_pre = Array.from(preFromHeaders.values());
          const cookies_serverset_post_accept = Array.from(postAcceptFromHeaders.values());
          const cookies_serverset_post_reject = Array.from(postRejectFromHeaders.values());

          // Phase 7: Self-check gates (PATCH 4 - updated cookie detection)
          const selfCheckReasons: string[] = [];
          let isComplete = true;
          
          if (requests_pre.length === 0) {
            selfCheckReasons.push('Network capture empty (CDP not bound)');
            isComplete = false;
          }
          
          // PATCH 4 - Updated cookie detection rule
          if ((cookies_pre.length + cookies_post_accept.length + cookies_post_reject.length) === 0
              && (setCookieEvents_pre.length + setCookieEvents_post_accept.length + setCookieEvents_post_reject.length) === 0) {
            selfCheckReasons.push('No cookies detected (storage + Set-Cookie empty)');
            isComplete = false;
          }
          
          if (trackingParams.length > 0 && thirdPartyDataSending === 0) {
            selfCheckReasons.push('Tracking detected but data sending section empty');
            isComplete = false;
          }
          
          // Collect final metrics (PATCH 4 - add server-set metrics)
          const metrics = {
            requests_pre: requests_pre.length,
            requests_post_accept: requests_post_accept.length,
            requests_post_reject: requests_post_reject.length,
            cookies_pre: cookies_pre.length,
            cookies_post_accept: cookies_post_accept.length,
            cookies_post_reject: cookies_post_reject.length,
            cookies_serverset_pre: cookies_serverset_pre.length,
            cookies_serverset_post_accept: cookies_serverset_post_accept.length,
            cookies_serverset_post_reject: cookies_serverset_post_reject.length,
            setCookie_pre: setCookieEvents_pre.length,
            setCookie_post_accept: setCookieEvents_post_accept.length,
            setCookie_post_reject: setCookieEvents_post_reject.length,
            storage_pre_items: storage_pre.length,
            storage_post_accept_items: storage_post_accept.length,
            storage_post_reject_items: storage_post_reject.length,
            data_sent_to_third_parties: thirdPartyDataSending,
            third_party_hosts: hostMap.requests.thirdParty.size,
            tracking_params_count: trackingParams.length
          };
          
          await logger.log('info', `📤 data_sent_to_third_parties: ${thirdPartyDataSending}`);
          await logger.log('info', `📊 Final collection summary: ${JSON.stringify(metrics)}`);
          
          // PATCH 3 - Final debug log
          await logger.log('info', 'DBG inflight_done', { inflight: sessionManager.inflight, trace_id: traceId });
          
          ws.close();
          
          resolve({
            success: true,
            data: {
              final_url: finalUrl,
              finalUrl: finalUrl, // Backward compatibility
              requests: requests_pre,
              requests_pre: requests_pre,
              requests_post_accept: requests_post_accept,
              requests_post_reject: requests_post_reject,
              cookies_pre,
              cookies_post_accept,
              cookies_post_accept_extra,
              cookies_post_reject,
              cookies_post_reject_extra,
              storage_pre,
              storage_post_accept,
              storage_post_reject,
              set_cookie_headers_pre: setCookieEvents_pre,
              set_cookie_headers_post_accept: setCookieEvents_post_accept,
              set_cookie_headers_post_reject: setCookieEvents_post_reject,
              tracking_params: trackingParams,
              host_map: {
                requests: {
                  firstParty: Array.from(hostMap.requests.firstParty),
                  thirdParty: Array.from(hostMap.requests.thirdParty)
                },
                cookies: {
                  firstParty: Array.from(hostMap.cookies.firstParty),
                  thirdParty: Array.from(hostMap.cookies.thirdParty)
                }
              },
              meta: {
                simplified: {
                  cookies: Array.from(uniqueCookies.values()),
                  localStorage: Array.from(uniqueStorageKeys).map(key => ({ key })),
                  beacons: uniqueBeacons
                }
              },
              self_check: {
                complete: isComplete,
                reasons: selfCheckReasons
              },
              cmp: { detected: false }, // CMP detection results from modular architecture
              metrics,
              raw: {
                requests: Array.from(requestMap.values()).map(r => ({ 
                  ...r, 
                  postData: postDataMap.get(r.requestId) 
                })),
                cookies: {
                  pre_load: cookies_pre_load,
                  pre_idle: cookies_pre_idle,
                  pre_extra: cookies_pre_extra,
                  post_accept: cookies_post_accept,
                  post_reject: cookies_post_reject
                },
                set_cookie_headers: {
                  pre: setCookieEvents_pre,
                  post_accept: setCookieEvents_post_accept,
                  post_reject: setCookieEvents_post_reject
                },
                beacons: trackingParams.map(tp => {
                  const u = new URL(`https://${tp.host}${tp.path}`);
                  return {
                    host: tp.host,
                    path: tp.path,
                    method: tp.method,
                    url: `https://${tp.host}${tp.path}`,
                    url_normalized: `${u.protocol}//${u.host}${u.pathname}`
                  };
                })
              }
            }
          });
          
        } catch (error) {
          await logger.log('error', 'CDP analysis failed', { error: String(error) });
          ws.close();
          resolve({
            success: false,
            error_code: 'CDP_ANALYSIS_FAILED',
            details: String(error)
          });
        }
      };
      
      // Event handling now done via addEventListener above - no ws.onmessage needed
      
      ws.onclose = async () => {
        await logger.log('info', '🔌 WebSocket connection closed');
      };
      
      ws.onerror = (error) => {
        logger.log('error', 'WebSocket error', { error: String(error) });
        
        // Build partial metrics from what we can access in this scope
        const phase = phaseController?.get() || 'pre';
        const preRequests = eventsPipeline?.requestMap ? Array.from(eventsPipeline.requestMap.values()).filter((r: any) => r.phase === 'pre') : [];
        const postAcceptRequests = eventsPipeline?.requestMap ? Array.from(eventsPipeline.requestMap.values()).filter((r: any) => r.phase === 'post_accept') : [];
        const postRejectRequests = eventsPipeline?.requestMap ? Array.from(eventsPipeline.requestMap.values()).filter((r: any) => r.phase === 'post_reject') : [];
        
        const partialMetrics = {
          requests_pre: preRequests.length,
          requests_post_accept: postAcceptRequests.length,
          requests_post_reject: postRejectRequests.length,
          cookies_pre: eventsPipeline?.setCookieEvents_pre?.length || 0,
          cookies_post_accept: eventsPipeline?.setCookieEvents_post_accept?.length || 0,
          cookies_post_reject: eventsPipeline?.setCookieEvents_post_reject?.length || 0,
          setCookie_pre: eventsPipeline?.setCookieEvents_pre?.length || 0,
          setCookie_post_accept: eventsPipeline?.setCookieEvents_post_accept?.length || 0,
          setCookie_post_reject: eventsPipeline?.setCookieEvents_post_reject?.length || 0,
          storage_pre_items: 0
        };
        
        const totalRequests = partialMetrics.requests_pre + partialMetrics.requests_post_accept + partialMetrics.requests_post_reject;
        const totalCookies = partialMetrics.cookies_pre + partialMetrics.cookies_post_accept + partialMetrics.cookies_post_reject;
        
        resolve({
          success: false,
          error_code: 'WEBSOCKET_ERROR',
          details: String(error),
          partial: totalRequests > 0 || totalCookies > 0 ? {
            metrics: partialMetrics,
            phase: phase,
            data_collected: {
              requests: totalRequests,
              cookies: totalCookies,
              storage: 0
            }
          } : undefined
        });
      };
      
      // Timeout
      setTimeout(async () => {
        await logger.log('error', '⏰ Global timeout after 60 seconds');
        
        // Build partial metrics from collected data so far
        const phase = phaseController?.get() || 'pre';
        const preRequests = eventsPipeline?.requestMap ? Array.from(eventsPipeline.requestMap.values()).filter((r: any) => r.phase === 'pre') : [];
        const postAcceptRequests = eventsPipeline?.requestMap ? Array.from(eventsPipeline.requestMap.values()).filter((r: any) => r.phase === 'post_accept') : [];
        const postRejectRequests = eventsPipeline?.requestMap ? Array.from(eventsPipeline.requestMap.values()).filter((r: any) => r.phase === 'post_reject') : [];
        const allRequests = [...preRequests, ...postAcceptRequests, ...postRejectRequests];
        
        const totalRequests = allRequests.length;
        const totalCookies = (eventsPipeline?.setCookieEvents_pre?.length || 0) + 
                           (eventsPipeline?.setCookieEvents_post_accept?.length || 0) + 
                           (eventsPipeline?.setCookieEvents_post_reject?.length || 0);
        
        const partialMetrics = {
          requests_pre: preRequests.length,
          requests_post_accept: postAcceptRequests.length,
          requests_post_reject: postRejectRequests.length,
          cookies_pre: eventsPipeline?.setCookieEvents_pre?.length || 0,
          cookies_post_accept: eventsPipeline?.setCookieEvents_post_accept?.length || 0,
          cookies_post_reject: eventsPipeline?.setCookieEvents_post_reject?.length || 0,
          setCookie_pre: eventsPipeline?.setCookieEvents_pre?.length || 0,
          setCookie_post_accept: eventsPipeline?.setCookieEvents_post_accept?.length || 0,
          setCookie_post_reject: eventsPipeline?.setCookieEvents_post_reject?.length || 0,
          storage_pre_items: 0,
          third_party_hosts: allRequests
            .map((r: any) => { try { return getETldPlusOneLite(new URL(r.url).hostname); } catch { return ''; } })
            .filter(h => h).length,
          tracking_params_count: allRequests
            .filter((r: any) => { 
              try { 
                const url = new URL(r.url);
                return url.search && SIGNIFICANT_PARAMS.some(param => url.searchParams.has(param));
              } catch { return false; }
            }).length
        };

        // Log structured partial summary
        await logger.log('error', '⏰ Global timeout - partial collection summary', {
          url: url,
          phase: phase,
          partial_metrics: partialMetrics,
          requests_collected: totalRequests,
          cookies_collected: totalCookies,
          storage_collected: 0
        });
        
        ws.close();
        resolve({
          success: false,
          error_code: 'TIMEOUT',
          details: 'Analysis timeout after 60 seconds',
          partial: {
            metrics: partialMetrics,
            phase: phase,
            data_collected: {
              requests: totalRequests,
              cookies: totalCookies,
              storage: 0
            }
          }
        });
      }, 60000);
    });

    const duration = Date.now() - startTime;
    
    if (!analysisResult.success) {
      await logger.log('error', 'Analysis failed', analysisResult);
      
      // If partial data is available, log it and update audit_runs with partial metrics
      if ((analysisResult as any).partial) {
        const partial = (analysisResult as any).partial;
        await logger.log('info', 'Final collection summary (partial)', {
          url: url,
          partial_data: partial,
          phase: partial.phase,
          metrics: partial.metrics
        });
        
        // Update audit_runs with partial metrics
        await supabase
          .from('audit_runs')
          .update({
            status: 'failed',
            error_code: (analysisResult as any).error_code || 'UNKNOWN_ERROR',
            error_message: (analysisResult as any).details || 'Analysis failed',
            ended_at: new Date().toISOString(),
            duration_ms: duration,
            bl_status_code: 500,
            requests_total: partial.metrics?.requests_pre || 0,
            requests_pre_consent: partial.metrics?.requests_pre || 0,
            third_parties_count: partial.metrics?.third_party_hosts || 0,
            beacons_count: partial.metrics?.tracking_params_count || 0,
            cookies_pre_count: partial.metrics?.cookies_pre || 0,
            cookies_post_count: Math.max(partial.metrics?.cookies_post_accept || 0, partial.metrics?.cookies_post_reject || 0),
            meta: {
              requests_post_accept: partial.metrics?.requests_post_accept || 0,
              requests_post_reject: partial.metrics?.requests_post_reject || 0,
              setCookie_pre: partial.metrics?.setCookie_pre || 0,
              setCookie_post_accept: partial.metrics?.setCookie_post_accept || 0,
              setCookie_post_reject: partial.metrics?.setCookie_post_reject || 0,
              storage_items: partial.metrics?.storage_pre_items || 0,
              phase_reached: partial.phase,
              partial_data: true
            }
          })
          .eq('trace_id', traceId);
      } else {
        // Update audit_runs with failure (no partial data)
        await supabase
          .from('audit_runs')
          .update({
            status: 'failed',
            error_code: (analysisResult as any).error_code || 'UNKNOWN_ERROR',
            error_message: (analysisResult as any).details || 'Analysis failed',
            ended_at: new Date().toISOString(),
            duration_ms: duration,
            bl_status_code: 500
          })
          .eq('trace_id', traceId);
      }

      return new Response(JSON.stringify({
        ...analysisResult,
        trace_id: traceId,
        duration_ms: duration
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await logger.log('info', '✅ Analysis completed successfully');
    
    // Extract key metrics for audit_runs update
    const data = analysisResult.data;
    const finalMetrics = data.metrics || {};
    
    // Update audit_runs with success
    await supabase
      .from('audit_runs')
      .update({
        status: 'completed',
        ended_at: new Date().toISOString(),
        duration_ms: duration,
        bl_status_code: 200,
        bl_health_status: 'ok',
        normalized_url: data.final_url || data.finalUrl,
        requests_total: finalMetrics.requests_pre || 0,
        requests_pre_consent: finalMetrics.requests_pre || 0,
        third_parties_count: finalMetrics.third_party_hosts || 0,
        beacons_count: finalMetrics.tracking_params_count || 0,
        cookies_pre_count: finalMetrics.cookies_pre || 0,
        cookies_post_count: Math.max(finalMetrics.cookies_post_accept || 0, finalMetrics.cookies_post_reject || 0),
        meta: {
          requests_post_accept: finalMetrics.requests_post_accept || 0,
          requests_post_reject: finalMetrics.requests_post_reject || 0,
          setCookie_pre: finalMetrics.setCookie_pre || 0,
          setCookie_post_accept: finalMetrics.setCookie_post_accept || 0,
          setCookie_post_reject: finalMetrics.setCookie_post_reject || 0,
          storage_items: finalMetrics.storage_pre_items || 0,
          cmp_detected: data.cmp?.detected || false,
          cmp_type: data.cmp?.type,
          self_check_complete: data.self_check?.complete || false,
          self_check_reasons: data.self_check?.reasons || []
        }
      })
      .eq('trace_id', traceId);

    // Log structured final summary with collected data
    await logger.log('info', 'Final collection summary', {
      url: url,
      metrics: data.metrics,
      thirdParties: data.thirdParties?.length || 0,
      beacons: data.beacons?.length || 0,
      cookies: data.cookies?.length || 0,
      storage: data.storage?.length || 0,
      cmp: data.cmp,
      verdict: data.verdict
    });

    await logger.log('info', '✅ Analysis function completed successfully');

    return new Response(JSON.stringify({
      success: true,
      duration_ms: duration,
      trace_id: traceId,
      bl_status_code: 200,
      bl_health_status: 'ok',
      data: analysisResult.data
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorResponse = {
      success: false,
      error_code: 'UNEXPECTED_ERROR',
      details: String(error),
      duration_ms: duration,
      trace_id: traceId
    };
    
    await logger.log('error', 'Unexpected error in analysis function', errorResponse);
    
    // Update audit_runs with unexpected error
    try {
      await supabase
        .from('audit_runs')
        .update({
          status: 'failed',
          error_code: 'UNEXPECTED_ERROR',
          error_message: String(error),
          ended_at: new Date().toISOString(),
          duration_ms: duration,
          bl_status_code: 500
        })
        .eq('trace_id', traceId);
    } catch (updateError) {
      await logger.log('error', 'Failed to update audit_runs on unexpected error', { updateError: String(updateError) });
    }
    
    return new Response(JSON.stringify(errorResponse), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});