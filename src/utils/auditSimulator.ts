import { AuditData, InternalAuditJson } from '@/types/audit';

export interface ProgressCallback {
  (stepIndex: number, totalSteps: number): void;
}

// Known service mappings for deterministic detection
const SERVICE_PATTERNS = {
  'facebook.com': 'Facebook Pixel',
  'connect.facebook.net': 'Facebook SDK',
  'google-analytics.com': 'Google Analytics',
  'googletagmanager.com': 'Google Tag Manager',
  'googlesyndication.com': 'Google Ads',
  'googleadservices.com': 'Google Ads',
  'doubleclick.net': 'Google DoubleClick',
  'linkedin.com': 'LinkedIn Insights',
  'platform.linkedin.com': 'LinkedIn Platform',
  'pinterest.com': 'Pinterest Tag',
  'ct.pinterest.com': 'Pinterest Conversion',
  'analytics.tiktok.com': 'TikTok Pixel',
  'clarity.ms': 'Microsoft Clarity',
  'bing.com': 'Bing Ads',
  't.leady.com': 'Leady',
  'events.getsitectrl.com': 'GetSiteControl',
  'collector.snowplow.io': 'Snowplow',
  'd2dpiwfhf3tz0r.cloudfront.net': 'Snowplow',
  'etarget.sk': 'eTarget',
  'matomo.org': 'Matomo',
  'gstatic.com': 'Google Static',
  'recaptcha.net': 'reCAPTCHA',
  'google.com/recaptcha': 'reCAPTCHA'
};

// Pre-consent beacon patterns (critical for GDPR compliance)
const PRE_CONSENT_PATTERNS = [
  { pattern: /facebook\.com\/tr.*ev=PageView/, service: 'Facebook Pixel' },
  { pattern: /pagead2\.googlesyndication\.com\/ccm\/collect.*en=page_view/, service: 'Google Ads' },
  { pattern: /region1\.google-analytics\.com\/g\/collect/, service: 'Google Analytics' },
  { pattern: /ct\.pinterest\.com\/v3.*event=init/, service: 'Pinterest' },
  { pattern: /ct\.pinterest\.com\/user/, service: 'Pinterest' },
  { pattern: /t\.leady\.com\/L\?/, service: 'Leady' },
  { pattern: /events\.getsitectrl\.com\/api\/v1\/events/, service: 'GetSiteControl' },
  { pattern: /collector\.snowplow\.io.*\/i\?.*e=pv/, service: 'Snowplow' },
  { pattern: /d2dpiwfhf3tz0r\.cloudfront\.net.*\/i\?.*e=pv/, service: 'Snowplow' },
  { pattern: /clarity\.ms.*collect/, service: 'Microsoft Clarity' },
  { pattern: /analytics\.tiktok\.com.*track/, service: 'TikTok' }
];

// Cookie classification patterns
const COOKIE_PATTERNS = {
  technical: [
    'PHPSESSID', 'laravel_session', 'XSRF-TOKEN', 'csrftoken', 'sessionid',
    'CookieScriptConsent', 'CookieConsent', 'OptanonConsent', 'cookieyes-consent',
    '_GRECAPTCHA', '__cf_bm', 'cf_clearance'
  ],
  analytics: [
    '_ga', '_gid', '_gat', '__utma', '__utmb', '__utmc', '__utmt', '__utmz',
    '_sp_id', '_sp_ses', '_pk_id', '_pk_ses', 'vuid', '_hjid', '_hjSessionUser'
  ],
  marketing: [
    '_fbp', '_fbc', 'fr', '_gcl_au', '_gcl_aw', '_gcl_dc', '_gcl_gf', '_gcl_ha',
    '_uetsid', '_uetvid', '_tt_enable_cookie', '_ttp', '_pin_unauth',
    'li_sugr', 'li_oatml', 'bcookie', 'lidc', 'IDE', 'test_cookie', 'MR',
    'leady_session_id', 'leady_track_id', '_sp_user_id'
  ]
};

// LocalStorage patterns that indicate personal data
const PERSONAL_DATA_PATTERNS = [
  /user_?id/i, /client_?id/i, /visitor_?id/i, /session_?id/i,
  /ip_?address/i, /location/i, /geo/i, /latitude/i, /longitude/i,
  /email/i, /phone/i, /identifier/i, /tracking/i
];

export async function simulateAudit(
  input: string, 
  isHtml: boolean = false, 
  onProgress?: ProgressCallback,
  minDurationMs: number = 3000
): Promise<AuditData> {
  const startTime = Date.now();
  const totalSteps = 8;
  
  // Helper function to update progress and add artificial delay
  const updateProgress = async (stepIndex: number) => {
    onProgress?.(stepIndex, totalSteps);
    
    // Add realistic delays between steps
    const stepDelay = isHtml ? 200 : 400;
    await new Promise(resolve => setTimeout(resolve, stepDelay));
  };

  // Step 1: Fetch/Parse
  await updateProgress(0);
  
  // Generate internal JSON structure with progress updates
  const internalJson = await generateInternalAuditJson(input, isHtml, updateProgress);
  
  // Final step: Generate results
  await updateProgress(7);
  
  // Convert internal JSON to display format
  const auditData = convertToDisplayFormat(internalJson, input);
  
  // Ensure minimum duration for credibility
  const elapsed = Date.now() - startTime;
  if (elapsed < minDurationMs) {
    await new Promise(resolve => setTimeout(resolve, minDurationMs - elapsed));
  }
  
  return auditData;
}

async function generateInternalAuditJson(
  input: string, 
  isHtml: boolean, 
  updateProgress?: (stepIndex: number) => Promise<void>
): Promise<InternalAuditJson> {
  let htmlContent = input;
  let finalUrl = input;

  if (!isHtml) {
    // For URL input, we can only do limited analysis due to CORS
    finalUrl = normalizeUrl(input);
    // In a real implementation, this would fetch the page
    // For simulation, we'll use deterministic patterns based on domain
    htmlContent = generateSimulatedHtml(getDomain(finalUrl));
  } else {
    // Extract final URL from HTML if possible
    const urlMatch = htmlContent.match(/<base\s+href=["']([^"']+)["']/i) ||
                    htmlContent.match(/window\.location\s*=\s*["']([^"']+)["']/);
    if (urlMatch) {
      finalUrl = urlMatch[1];
    } else {
      finalUrl = 'unknown';
    }
  }

  // Analyze third parties from HTML with progress updates
  await updateProgress?.(1); // HTTPS check
  const https = { supports: finalUrl.startsWith('https://'), redirects_http_to_https: true };
  
  await updateProgress?.(2); // Third parties
  const thirdParties = extractThirdParties(htmlContent, finalUrl);
  
  await updateProgress?.(3); // Trackers
  const beacons = extractBeacons(htmlContent);
  
  await updateProgress?.(4); // Cookies
  const cookies = generateCookiesFromServices(thirdParties, beacons);
  
  await updateProgress?.(5); // Storage
  const storage = extractStorage(htmlContent);
  
  await updateProgress?.(6); // Consent
  const cmp = analyzeCMP(htmlContent, beacons);
  
  // Determine verdict with validation safeguards
  const { verdict, reasons } = determineVerdict(thirdParties, beacons, cookies, storage, cmp);

  return {
    final_url: finalUrl,
    https,
    third_parties: thirdParties,
    beacons: beacons,
    cookies: cookies,
    storage: storage,
    cmp: cmp,
    verdict: verdict,
    reasons: reasons
  };
}

function extractThirdParties(html: string, finalUrl: string): Array<{ host: string; service: string }> {
  const baseDomain = getDomain(finalUrl);
  const hosts = new Set<string>();
  
  // Extract from script src attributes
  const scriptMatches = html.matchAll(/<script[^>]*src=["']([^"']+)["']/gi);
  for (const match of scriptMatches) {
    const url = match[1];
    if (url.startsWith('http')) {
      hosts.add(getDomain(url));
    }
  }
  
  // Extract from iframe src attributes
  const iframeMatches = html.matchAll(/<iframe[^>]*src=["']([^"']+)["']/gi);
  for (const match of iframeMatches) {
    const url = match[1];
    if (url.startsWith('http')) {
      hosts.add(getDomain(url));
    }
  }
  
  // Extract from img src (tracking pixels)
  const imgMatches = html.matchAll(/<img[^>]*src=["']([^"']+)["']/gi);
  for (const match of imgMatches) {
    const url = match[1];
    if (url.startsWith('http')) {
      hosts.add(getDomain(url));
    }
  }
  
  // Extract from link href
  const linkMatches = html.matchAll(/<link[^>]*href=["']([^"']+)["']/gi);
  for (const match of linkMatches) {
    const url = match[1];
    if (url.startsWith('http')) {
      hosts.add(getDomain(url));
    }
  }

  // Filter out first-party and map to services
  const thirdParties: Array<{ host: string; service: string }> = [];
  for (const host of hosts) {
    if (host !== baseDomain && host !== 'unknown') {
      const service = getServiceForHost(host);
      thirdParties.push({ host, service });
    }
  }

  return thirdParties;
}

function extractBeacons(html: string): Array<{ host: string; sample_url: string; params: string[]; service: string; pre_consent: boolean }> {
  const beacons: Array<{ host: string; sample_url: string; params: string[]; service: string; pre_consent: boolean }> = [];
  
  // Look for tracking calls in inline scripts
  const scriptContent = html.replace(/<script[^>]*>(.*?)<\/script>/gis, (match, content) => {
    // Check for Facebook Pixel
    if (content.includes('fbq(') || content.includes("facebook.com/tr")) {
      const fbId = content.match(/fbq\(['"]init['"],\s*['"](\d+)['"]/) || content.match(/id=(\d+)/);
      beacons.push({
        host: 'facebook.com',
        sample_url: `facebook.com/tr?id=${fbId?.[1] || 'XXXXXXXXX'}&ev=PageView&noscript=1`,
        params: ['id', 'ev', 'noscript'],
        service: 'Facebook Pixel',
        pre_consent: true
      });
    }
    
    // Check for Google Analytics/GTM
    if (content.includes('gtag(') || content.includes('ga(')) {
      const gaId = content.match(/GA_MEASUREMENT_ID.*?['"]([^'"]+)['"]/) || content.match(/gtag\(['"]config['"],\s*['"]([^'"]+)['"]/) || ['', 'GA_MEASUREMENT_ID'];
      beacons.push({
        host: 'google-analytics.com',
        sample_url: `region1.google-analytics.com/g/collect?tid=${gaId[1]}&t=pageview`,
        params: ['tid', 't', 'cid'],
        service: 'Google Analytics',
        pre_consent: true
      });
    }
    
    // Check for Google Ads
    if (content.includes('googletag') || content.includes('googlesyndication')) {
      beacons.push({
        host: 'googlesyndication.com',
        sample_url: 'pagead2.googlesyndication.com/ccm/collect?en=page_view&gct=UA-XXXXXXXX-X',
        params: ['en', 'gct'],
        service: 'Google Ads',
        pre_consent: true
      });
    }
    
    // Check for Pinterest
    if (content.includes('pintrk(') || content.includes('pinterest.com')) {
      beacons.push({
        host: 'ct.pinterest.com',
        sample_url: 'ct.pinterest.com/v3/?event=init&tid=XXXXXXXXX',
        params: ['event', 'tid'],
        service: 'Pinterest',
        pre_consent: true
      });
    }
    
    return match;
  });

  // Check for tracking pixels in img tags
  const pixelMatches = html.matchAll(/<img[^>]*src=["']([^"']*(?:facebook\.com\/tr|analytics|collect|track)[^"']*)["']/gi);
  for (const match of pixelMatches) {
    const url = match[1];
    const host = getDomain(url);
    const service = getServiceForHost(host);
    
    beacons.push({
      host: host,
      sample_url: url,
      params: extractUrlParams(url),
      service: service,
      pre_consent: true
    });
  }

  return beacons;
}

function generateCookiesFromServices(thirdParties: Array<{ host: string; service: string }>, beacons: Array<{ host: string; sample_url: string; params: string[]; service: string; pre_consent: boolean }>): Array<{ name: string; party: '1P' | '3P'; type: 'technical' | 'analytics' | 'marketing'; expiry_days: number | null }> {
  const cookies: Array<{ name: string; party: '1P' | '3P'; type: 'technical' | 'analytics' | 'marketing'; expiry_days: number | null }> = [];
  
  // Add standard technical cookies
  cookies.push(
    { name: 'PHPSESSID', party: '1P', type: 'technical', expiry_days: null },
    { name: 'CookieScriptConsent', party: '1P', type: 'technical', expiry_days: 365 }
  );

  // Generate cookies based on detected services
  const services = new Set([...thirdParties.map(tp => tp.service), ...beacons.map(b => b.service)]);
  
  if (services.has('Facebook Pixel')) {
    cookies.push(
      { name: '_fbp', party: '1P', type: 'marketing', expiry_days: 90 },
      { name: '_fbc', party: '1P', type: 'marketing', expiry_days: 90 },
      { name: 'fr', party: '3P', type: 'marketing', expiry_days: 90 }
    );
  }
  
  if (services.has('Google Analytics')) {
    cookies.push(
      { name: '_ga', party: '1P', type: 'analytics', expiry_days: 730 },
      { name: '_gid', party: '1P', type: 'analytics', expiry_days: 1 },
      { name: '_gat_gtag_UA_XXXXXXXX_X', party: '1P', type: 'analytics', expiry_days: 1 }
    );
  }
  
  if (services.has('Google Ads')) {
    cookies.push(
      { name: '_gcl_au', party: '1P', type: 'marketing', expiry_days: 90 },
      { name: 'IDE', party: '3P', type: 'marketing', expiry_days: 390 }
    );
  }
  
  if (services.has('Pinterest')) {
    cookies.push(
      { name: '_pin_unauth', party: '1P', type: 'marketing', expiry_days: 365 }
    );
  }
  
  if (services.has('LinkedIn Insights')) {
    cookies.push(
      { name: 'li_sugr', party: '3P', type: 'marketing', expiry_days: 90 },
      { name: 'bcookie', party: '3P', type: 'marketing', expiry_days: 730 }
    );
  }
  
  if (services.has('Leady')) {
    cookies.push(
      { name: 'leady_session_id', party: '1P', type: 'marketing', expiry_days: 30 },
      { name: 'leady_track_id', party: '1P', type: 'marketing', expiry_days: 365 }
    );
  }
  
  if (services.has('Snowplow')) {
    cookies.push(
      { name: '_sp_id.xxxx', party: '1P', type: 'analytics', expiry_days: 730 },
      { name: '_sp_ses.xxxx', party: '1P', type: 'analytics', expiry_days: null }
    );
  }

  return cookies;
}

function extractStorage(html: string): Array<{ scope: 'local' | 'session'; key: string; sample_value: string; contains_personal_data: boolean }> {
  const storage: Array<{ scope: 'local' | 'session'; key: string; sample_value: string; contains_personal_data: boolean }> = [];
  
  // Look for localStorage/sessionStorage usage in scripts
  const localStorageMatches = html.matchAll(/localStorage\.setItem\(['"]([^'"]+)['"],\s*['"]?([^'"]*?)['"]?\)/g);
  for (const match of localStorageMatches) {
    const key = match[1];
    const value = match[2] || 'unknown';
    const containsPersonalData = PERSONAL_DATA_PATTERNS.some(pattern => pattern.test(key) || pattern.test(value));
    
    storage.push({
      scope: 'local',
      key: key,
      sample_value: value.length > 50 ? value.substring(0, 50) + '...' : value,
      contains_personal_data: containsPersonalData
    });
  }
  
  const sessionStorageMatches = html.matchAll(/sessionStorage\.setItem\(['"]([^'"]+)['"],\s*['"]?([^'"]*?)['"]?\)/g);
  for (const match of sessionStorageMatches) {
    const key = match[1];
    const value = match[2] || 'unknown';
    const containsPersonalData = PERSONAL_DATA_PATTERNS.some(pattern => pattern.test(key) || pattern.test(value));
    
    storage.push({
      scope: 'session',
      key: key,
      sample_value: value.length > 50 ? value.substring(0, 50) + '...' : value,
      contains_personal_data: containsPersonalData
    });
  }
  
  // Add common problematic storage items based on detected services
  if (html.includes('gscs') || html.includes('GetSiteControl')) {
    storage.push({
      scope: 'local',
      key: 'gscs',
      sample_value: '{"ip":"1.2.3.4","geo":"SK","user_id":"abc123"}',
      contains_personal_data: true
    });
  }

  return storage;
}

function analyzeCMP(html: string, beacons: Array<{ host: string; sample_url: string; params: string[]; service: string; pre_consent: boolean }>): { present: boolean; cookie_name: string; raw_value: string; pre_consent_fires: boolean } {
  const cmpPatterns = [
    'CookieScriptConsent', 'OptanonConsent', 'CookieConsent', 'cookieyes-consent',
    'Cookiebot', 'OneTrust', 'CookieYes'
  ];
  
  let cmpPresent = false;
  let cookieName = '';
  
  for (const pattern of cmpPatterns) {
    if (html.toLowerCase().includes(pattern.toLowerCase())) {
      cmpPresent = true;
      cookieName = pattern;
      break;
    }
  }
  
  // Check if marketing/analytics beacons fire before consent
  const preConsentFires = beacons.some(beacon => 
    beacon.pre_consent && 
    (beacon.service.includes('Facebook') || 
     beacon.service.includes('Google') || 
     beacon.service.includes('Pinterest') ||
     beacon.service.includes('Leady'))
  );

  return {
    present: cmpPresent,
    cookie_name: cookieName,
    raw_value: cmpPresent ? 'accept:false,analytics:false,marketing:false' : '',
    pre_consent_fires: preConsentFires
  };
}

function determineVerdict(
  thirdParties: Array<{ host: string; service: string }>,
  beacons: Array<{ host: string; sample_url: string; params: string[]; service: string; pre_consent: boolean }>,
  cookies: Array<{ name: string; party: '1P' | '3P'; type: 'technical' | 'analytics' | 'marketing'; expiry_days: number | null }>,
  storage: Array<{ scope: 'local' | 'session'; key: string; sample_value: string; contains_personal_data: boolean }>,
  cmp: { present: boolean; cookie_name: string; raw_value: string; pre_consent_fires: boolean }
): { verdict: 'COMPLIANT' | 'NON_COMPLIANT' | 'INCOMPLETE'; reasons: string[] } {
  const reasons: string[] = [];

  // SIMULATION SAFEGUARDS: For simulated mode, lean towards INCOMPLETE rather than false compliance
  // This prevents false confidence in compliance status
  if (!thirdParties.length && !beacons.length && !cookies.length) {
    return {
      verdict: 'INCOMPLETE',
      reasons: ['Simulačný režim: Nedostatok dát pre spoľahlivý verdikt', 'Potrebná reálna analýza webovej stránky']
    };
  }

  // Validation safeguards (Poistky A-D)
  
  // Poistka A - Data consistency
  const marketingCookies = cookies.filter(c => c.type === 'marketing').length;
  const analyticsCookies = cookies.filter(c => c.type === 'analytics').length;
  if (thirdParties.length === 0 && beacons.length > 0) {
    reasons.push('Nekonzistentné dáta: Zistené trackery bez tretích strán');
    return { verdict: 'INCOMPLETE', reasons };
  }

  // Poistka B - Pre-consent violations
  const preConsentBeacons = beacons.filter(b => b.pre_consent);
  if (preConsentBeacons.length > 0) {
    reasons.push(`Pred-súhlasové volania: ${preConsentBeacons.map(b => b.service).join(', ')}`);
  }

  // Poistka C - LocalStorage PII
  const personalDataInStorage = storage.filter(s => s.contains_personal_data);
  if (personalDataInStorage.length > 0) {
    reasons.push(`Osobné údaje v storage: ${personalDataInStorage.map(s => s.key).join(', ')}`);
  }

  // Poistka D - CMP ineffectiveness
  if (cmp.present && cmp.pre_consent_fires) {
    reasons.push('CMP neblokuje trackery pred súhlasom');
  }

  // SIMULATION ENHANCED SAFEGUARDS: Add uncertainty for simulation
  if (thirdParties.length > 2 || beacons.length > 1) {
    reasons.push('Simulačný režim: Komplexná stránka vyžaduje detailnú analýzu');
  }

  // Determine final verdict
  if (reasons.length === 0) {
    // Additional checks for compliance
    if (marketingCookies === 0 && analyticsCookies === 0 && preConsentBeacons.length === 0) {
      return { verdict: 'COMPLIANT', reasons: ['Žiadne porušenia GDPR/ePrivacy'] };
    }
  }

  return { verdict: 'NON_COMPLIANT', reasons };
}

function convertToDisplayFormat(internalJson: InternalAuditJson, originalInput: string): AuditData {
  const timestamp = new Date().toISOString();
  const finalUrl = internalJson.final_url;
  
  // Map verdict
  const verdictMap = {
    'COMPLIANT': 'súlad' as const,
    'NON_COMPLIANT': 'nesúlad' as const,
    'INCOMPLETE': 'neúplné dáta' as const
  };

  const verdict = verdictMap[internalJson.verdict];

  // Generate management summary
  const managementSummary = {
    verdict,
    overall: generateOverallSummary(internalJson),
    risks: generateRiskSummary(internalJson)
  };

  // Convert detailed analysis
  const detailedAnalysis = {
    https: {
      status: internalJson.https.supports ? 'ok' as const : 'warning' as const,
      comment: internalJson.https.supports ? 'HTTPS je správne nakonfigurované' : 'HTTPS nie je nakonfigurované'
    },
    thirdParties: {
      total: internalJson.third_parties.length,
      list: internalJson.third_parties.map(tp => ({
        domain: tp.host,
        requests: Math.floor(Math.random() * 10) + 1 // Simulated
      }))
    },
    trackers: internalJson.beacons.map(beacon => ({
      service: beacon.service,
      host: beacon.host,
      evidence: beacon.sample_url,
      status: beacon.pre_consent ? 'error' as const : 'ok' as const,
      spamsBeforeConsent: beacon.pre_consent
    })),
    cookies: {
      total: internalJson.cookies.length,
      details: internalJson.cookies.map(cookie => ({
        name: cookie.name,
        type: cookie.party === '1P' ? 'first-party' as const : 'third-party' as const,
        category: cookie.type === 'technical' ? 'technické' as const : 
                 cookie.type === 'analytics' ? 'analytické' as const : 'marketingové' as const,
        expiration: cookie.expiry_days ? `${cookie.expiry_days} dní` : 'session',
        status: cookie.type === 'marketing' ? 'error' as const : 'ok' as const
      }))
    },
    storage: internalJson.storage.map(item => ({
      key: item.key,
      type: item.scope === 'local' ? 'localStorage' as const : 'sessionStorage' as const,
      valuePattern: item.sample_value,
      note: item.contains_personal_data ? 'Obsahuje osobné údaje' : 'Technické údaje'
    })),
    consentManagement: {
      hasConsentTool: internalJson.cmp.present,
      trackersBeforeConsent: internalJson.beacons.filter(b => b.pre_consent).length,
      evidence: internalJson.cmp.pre_consent_fires ? 'Trackery sa spúšťajú pred súhlasom' : 'CMP správne blokuje'
    },
    legalSummary: generateLegalSummary(internalJson)
  };

  // Generate risk table
  const riskTable = generateRiskTable(internalJson);

  // Generate recommendations
  const recommendations = generateRecommendations(internalJson);

  return {
    url: originalInput,
    finalUrl: finalUrl,
    hasRedirect: !originalInput.startsWith('https://'),
    timestamp,
    managementSummary,
    detailedAnalysis,
    riskTable,
    recommendations,
    // Backward compatibility
    summary: {
      overall: managementSummary.overall,
      risks: managementSummary.risks
    },
    https: {
      status: detailedAnalysis.https.status,
      description: detailedAnalysis.https.comment
    },
    cookies: {
      total: internalJson.cookies.length,
      technical: internalJson.cookies.filter(c => c.type === 'technical').length,
      analytical: internalJson.cookies.filter(c => c.type === 'analytics').length,
      marketing: internalJson.cookies.filter(c => c.type === 'marketing').length
    },
    trackers: internalJson.beacons.map(b => ({
      name: b.service,
      status: b.pre_consent ? 'error' as const : 'ok' as const
    })),
    thirdParties: internalJson.third_parties.map(tp => ({
      domain: tp.host,
      requests: Math.floor(Math.random() * 10) + 1
    })),
    _internal: internalJson
  };
}

// Helper functions
function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    if (url.includes('.')) {
      return url.split('/')[0];
    }
    return 'unknown';
  }
}

function getServiceForHost(host: string): string {
  for (const [pattern, service] of Object.entries(SERVICE_PATTERNS)) {
    if (host.includes(pattern)) {
      return service;
    }
  }
  return 'Unknown Service';
}

function extractUrlParams(url: string): string[] {
  try {
    const urlObj = new URL(url);
    return Array.from(urlObj.searchParams.keys());
  } catch {
    const params = url.split('?')[1];
    if (params) {
      return params.split('&').map(p => p.split('=')[0]);
    }
    return [];
  }
}

function normalizeUrl(url: string): string {
  if (!url.startsWith('http')) {
    url = 'https://' + url;
  }
  return url;
}

function generateSimulatedHtml(domain: string): string {
  // Generate realistic HTML based on domain for demo purposes
  return `<html><head><title>Demo</title></head><body><script src="https://www.googletagmanager.com/gtag/js"></script></body></html>`;
}

function generateOverallSummary(internalJson: InternalAuditJson): string {
  if (internalJson.verdict === 'COMPLIANT') {
    return 'Webová stránka je v súlade s GDPR a ePrivacy direktívou. Boli implementované potrebné opatrenia na ochranu osobných údajov.';
  } else if (internalJson.verdict === 'INCOMPLETE') {
    return 'Audit nemohol byť dokončený z dôvodu neúplných dát. Pre presné vyhodnotenie je potrebná hlbšia analýza.';
  } else {
    const violations = internalJson.reasons.length;
    return `Webová stránka nie je v súlade s GDPR a ePrivacy direktívou. Identifikované boli ${violations} porušenia, ktoré vyžadujú okamžité riešenie.`;
  }
}

function generateRiskSummary(internalJson: InternalAuditJson): string {
  const risks: string[] = [];
  
  if (internalJson.beacons.some(b => b.pre_consent)) {
    risks.push('Pred-súhlasové spúšťanie trackerov');
  }
  
  if (internalJson.storage.some(s => s.contains_personal_data)) {
    risks.push('Ukladanie osobných údajov bez súhlasu');
  }
  
  if (internalJson.cmp.pre_consent_fires) {
    risks.push('Neefektívny consent management');
  }
  
  if (risks.length === 0) {
    return 'Neboli identifikované žiadne významné riziká súvisiace s ochranou osobných údajov.';
  }
  
  return `Hlavné riziká: ${risks.join(', ')}.`;
}

function generateLegalSummary(internalJson: InternalAuditJson): string {
  const violations: string[] = [];
  
  if (internalJson.beacons.some(b => b.pre_consent && b.service.includes('Facebook'))) {
    violations.push('Facebook Pixel sa spúšťa pred súhlasom (porušenie ePrivacy)');
  }
  
  if (internalJson.beacons.some(b => b.pre_consent && b.service.includes('Google'))) {
    violations.push('Google Analytics/Ads sa spúšťa pred súhlasom (porušenie ePrivacy)');
  }
  
  if (internalJson.storage.some(s => s.contains_personal_data)) {
    violations.push('Osobné údaje v LocalStorage bez právneho základu (porušenie GDPR)');
  }
  
  if (violations.length === 0) {
    return 'Zo základnej analýzy nevyplývajú zjavné porušenia GDPR alebo ePrivacy direktívy.';
  }
  
  return `Právne riziká: ${violations.join('; ')}.`;
}

function generateRiskTable(internalJson: InternalAuditJson): Array<{ area: string; status: 'ok' | 'warning' | 'error'; comment: string }> {
  return [
    {
      area: 'HTTPS',
      status: internalJson.https.supports ? 'ok' : 'warning',
      comment: internalJson.https.supports ? 'Podporované' : 'Chýba HTTPS'
    },
    {
      area: 'CMP',
      status: internalJson.cmp.present ? (internalJson.cmp.pre_consent_fires ? 'warning' : 'ok') : 'error',
      comment: internalJson.cmp.present ? 
        (internalJson.cmp.pre_consent_fires ? 'Prítomné, ale neblokuje' : 'Správne nakonfigurované') : 
        'Chýba consent management'
    },
    {
      area: 'Tretie strany',
      status: internalJson.third_parties.length > 0 ? 'warning' : 'ok',
      comment: `${internalJson.third_parties.length} tretích strán`
    },
    {
      area: 'Beacony',
      status: internalJson.beacons.some(b => b.pre_consent) ? 'error' : 'ok',
      comment: internalJson.beacons.some(b => b.pre_consent) ? 'Pred-súhlasové volania' : 'V súlade'
    },
    {
      area: 'Cookies',
      status: internalJson.cookies.some(c => c.type === 'marketing') ? 'warning' : 'ok',
      comment: `${internalJson.cookies.length} cookies celkom`
    },
    {
      area: 'Storage',
      status: internalJson.storage.some(s => s.contains_personal_data) ? 'error' : 'ok',
      comment: internalJson.storage.some(s => s.contains_personal_data) ? 'Obsahuje osobné údaje' : 'Bez osobných údajov'
    }
  ];
}

function generateRecommendations(internalJson: InternalAuditJson): Array<{ title: string; description: string }> {
  const recommendations: Array<{ title: string; description: string }> = [];
  
  if (internalJson.beacons.some(b => b.pre_consent && b.service.includes('Google'))) {
    recommendations.push({
      title: 'Google Tag Manager - Consent Mode v2',
      description: 'Implementujte Consent Mode v2 s default denied pre ad_storage, analytics_storage, ad_user_data a ad_personalization. Triggery spúšťajte až po udelení súhlasu.'
    });
  }
  
  if (internalJson.cmp.present && internalJson.cmp.pre_consent_fires) {
    recommendations.push({
      title: 'Vylepšenie Consent Management Platform',
      description: 'Nakonfigurujte CMP tak, aby blokovala všetky marketing a analytics skripty do udelenia súhlasu. Otestujte, že sa cookies _fbp, _gcl_*, _pin_* neukladajú pred súhlasom.'
    });
  }
  
  if (!internalJson.cmp.present) {
    recommendations.push({
      title: 'Implementácia Consent Management',
      description: 'Nainštalujte CMP riešenie (Cookiebot, OneTrust, CookieYes) pre správu súhlasov. Mapujte kategórie cookies a blokujte ich podľa preferencií používateľa.'
    });
  }
  
  if (internalJson.beacons.some(b => b.pre_consent && b.service.includes('Facebook'))) {
    recommendations.push({
      title: 'Facebook Pixel - Blokovaná pred súhlasom',
      description: 'Presuňte Facebook Pixel pod správu GTM alebo CMP. Zabezpečte, aby sa volania facebook.com/tr nevykonávali pred udelením súhlasu pre marketing cookies.'
    });
  }
  
  if (internalJson.storage.some(s => s.contains_personal_data)) {
    recommendations.push({
      title: 'LocalStorage - Ochrana osobných údajov',
      description: 'Neukladajte identifikátory používateľov, IP adresy alebo geo údaje do LocalStorage pred súhlasom. Pri "deny" súhlase existujúce údaje vymažte.'
    });
  }
  
  recommendations.push({
    title: 'Cookie Policy - Aktualizácia',
    description: 'Zosúlaďte Cookie Policy s reálnym stavom. Uveďte presné názvy cookies, ich účely, doby uchovávania a tretie strany, ktoré ich používajú.'
  });
  
  recommendations.push({
    title: 'Logovanie súhlasov',
    description: 'Implementujte záznamy o súhlasoch s timestamp, verziou CMP a preferenciami používateľa. Tieto záznamy slúžia ako dôkaz pri kontrolách.'
  });

  return recommendations;
}

export function generateEmailDraft(auditData: AuditData, clientEmail: string): string {
  return `Vážený/á ${clientEmail},

vykonali sme audit súladu vašej webovej stránky ${auditData.finalUrl} s GDPR a ePrivacy direktívou.

**VÝSLEDKY AUDITU:**

• **Celkové hodnotenie:** ${auditData.managementSummary.verdict.toUpperCase()}
• **Tretie strany:** ${auditData.detailedAnalysis.thirdParties.total} externých služieb
• **Cookies:** ${auditData.detailedAnalysis.cookies.total} celkom (${auditData.cookies.marketing} marketing)
• **Pred-súhlasové trackery:** ${auditData.detailedAnalysis.consentManagement.trackersBeforeConsent}

**HLAVNÉ ZISTENIA:**
${auditData._internal.reasons.map(reason => `• ${reason}`).join('\n')}

**AKČNÝ PLÁN:**
${auditData.recommendations.slice(0, 6).map((rec, i) => `${i + 1}. ${rec.title}: ${rec.description}`).join('\n\n')}

**PRÁVNE RIZIKÁ:**
${auditData.detailedAnalysis.legalSummary}

Pre detailnú analýzu a implementačný plán ma kontaktujte.

S pozdravom,
GDPR Audit Team`;
}