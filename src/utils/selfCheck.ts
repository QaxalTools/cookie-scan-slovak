// Self-check implementation with 7 quality gates
import { AuditSelfCheck, AuditQualityGate, InternalAuditJson } from '@/types/audit';
import { getETldPlusOne, isFirstParty, getHostFromUrl, normalizeDomain } from './domain';

interface MergedCookie {
  name: string;
  normalizedDomain: string;
  path: string;
  expiryDays: number | null;
  category: 'technical' | 'analytics' | 'marketing' | 'unknown';
  isFirstParty: boolean;
  sources: {
    jar: boolean;
    setCookie: boolean;
    document: boolean;
  };
  persisted: boolean;
}

interface ThirdPartyHost {
  host: string;
  count: number;
  sampleUrls: string[];
}

interface TrackerRequest {
  url: string;
  hasParams: boolean;
  isThirdParty: boolean;
}

/**
 * Perform comprehensive self-check on audit data
 */
export function performSelfCheck(
  renderData: any,
  internalJson: InternalAuditJson
): AuditSelfCheck {
  const mainHost = getHostFromUrl(internalJson.final_url);
  const mainDomain = getETldPlusOne(mainHost);

  // Merge and analyze cookies
  const mergedCookies = mergeCookieSources(renderData, mainDomain);
  const cookieStats = computeCookieStats(mergedCookies);

  // Analyze third parties
  const thirdParties = analyzeThirdParties(renderData, mainDomain);
  
  // Analyze tracking requests
  const trackerAnalysis = analyzeTrackers(renderData, internalJson, mainDomain);

  // Build summary - use metrics if available
  const metrics = renderData?.metrics;
  const requestsPreCount = metrics?.requests_pre || renderData?.requests_pre?.length || 0;
  
  const summary = {
    requests_pre_cdp: requestsPreCount,
    requests_pre_fallback: renderData?.requests_fallback?.length || 0,
    requests_post_accept: renderData?.requests_post_accept?.length,
    requests_post_reject: renderData?.requests_post_reject?.length,
    cookies_total: mergedCookies.length,
    cookies_1p: mergedCookies.filter(c => c.isFirstParty).length,
    cookies_3p: mergedCookies.filter(c => !c.isFirstParty).length,
    cookies_3p_persisted: mergedCookies.filter(c => !c.isFirstParty && c.persisted).length,
    cookies_3p_attempted: mergedCookies.filter(c => !c.isFirstParty).length,
    third_parties_unique: thirdParties.length
  };

  // Run quality gates
  const gates = runQualityGates(summary, internalJson, thirdParties, trackerAnalysis, cookieStats, mergedCookies);

  return {
    summary,
    gates,
    stats: {
      cookies_expiry_days: cookieStats,
      trackers_with_params: trackerAnalysis.trackersWithParams,
      cookies_3p_persisted: summary.cookies_3p_persisted,
      cookies_3p_attempted: summary.cookies_3p_attempted
    }
  };
}

/**
 * Merge cookies from multiple sources (CDP, Set-Cookie headers, document.cookie)
 */
function mergeCookieSources(renderData: any, mainDomain: string): MergedCookie[] {
  const cookieMap = new Map<string, MergedCookie>();

  // Helper to add/update cookie in map
  const addOrUpdateCookie = (name: string, domain: string, path: string, expires: number | null, sourceType: 'jar' | 'setCookie' | 'document') => {
    const normalizedDomain = normalizeDomain(domain || mainDomain);
    const key = `${name}|${normalizedDomain}|${path}`;
    
    const expiryDays = expires ? Math.ceil((expires - Date.now()) / 86400000) : null;
    const category = categorizeCookie(name);
    const cookieIsFirstParty = isFirstParty(normalizedDomain, mainDomain);

    const existing = cookieMap.get(key);
    if (existing) {
      // Update existing cookie
      existing.sources[sourceType] = true;
      if (sourceType === 'jar') {
        existing.persisted = true;
      }
      // Update expiry if this one is longer
      if (expires && (!existing.expiryDays || expiryDays > existing.expiryDays)) {
        existing.expiryDays = expiryDays;
      }
    } else {
      // Create new cookie
      cookieMap.set(key, {
        name,
        normalizedDomain,
        path,
        expiryDays,
        category,
        isFirstParty: cookieIsFirstParty,
        sources: {
          jar: sourceType === 'jar',
          setCookie: sourceType === 'setCookie',
          document: sourceType === 'document'
        },
        persisted: sourceType === 'jar'
      });
    }
  };

  // Process CDP cookies (jar cookies)
  const allJarCookies = [
    ...(renderData?.cookies_pre || []),
    ...(renderData?.cookies_post_accept || []),
    ...(renderData?.cookies_post_reject || [])
  ];

  allJarCookies.forEach((cookie: any) => {
    addOrUpdateCookie(
      cookie.name,
      cookie.domain,
      cookie.path || '/',
      cookie.expires ? cookie.expires * 1000 : null,
      'jar'
    );
  });

  // Process Set-Cookie headers
  const allSetCookieHeaders = [
    ...(renderData?.set_cookie_headers_pre || []),
    ...(renderData?.set_cookie_headers_post_accept || []),
    ...(renderData?.set_cookie_headers_post_reject || [])
  ];

  allSetCookieHeaders.forEach((cookie: any) => {
    addOrUpdateCookie(
      cookie.name,
      cookie.domain,
      cookie.path || '/',
      cookie.expiresEpochMs || null,
      'setCookie'
    );
  });

  // Process document.cookie (names only)
  (renderData?.document_cookies || []).forEach((cookieName: string) => {
    addOrUpdateCookie(cookieName, mainDomain, '/', null, 'document');
  });

  return Array.from(cookieMap.values());
}

/**
 * Categorize cookie by name patterns
 */
function categorizeCookie(name: string): 'technical' | 'analytics' | 'marketing' | 'unknown' {
  const lowerName = name.toLowerCase();

  // Marketing patterns
  if (lowerName.match(/^(_fbp|fbc|li_|ajs_|fr|_gcl_)/)) {
    return 'marketing';
  }

  // Analytics patterns
  if (lowerName.match(/^(_ga|_gid|_gat|_pin_unauth|_sp_|_clck|_clsk)/)) {
    return 'analytics';
  }

  // Technical/CMP patterns
  if (lowerName.match(/^(euconsent|cookiescriptconsent|optanonconsent|cookieyes|didomi_token|borlabs)/)) {
    return 'technical';
  }

  return 'unknown';
}

/**
 * Compute cookie retention statistics
 */
function computeCookieStats(cookies: MergedCookie[]) {
  const computePercentiles = (values: number[]) => {
    if (values.length === 0) return {};
    if (values.length < 3) return { max: Math.max(...values) };

    values.sort((a, b) => a - b);
    const n = values.length;
    
    return {
      min: values[0],
      p50: values[Math.floor(n * 0.5)],
      p95: values[Math.floor(n * 0.95)],
      max: values[n - 1]
    };
  };

  // Filter out session cookies
  const nonSessionCookies = cookies.filter(c => c.expiryDays !== null);
  const overall = computePercentiles(nonSessionCookies.map(c => c.expiryDays!));

  const result: any = { overall };

  // Per-category stats (only if >= 3 items)
  ['technical', 'analytics', 'marketing'].forEach(category => {
    const categoryValues = cookies
      .filter(c => c.category === category && c.expiryDays !== null)
      .map(c => c.expiryDays!);
    
    if (categoryValues.length >= 3) {
      result[category] = computePercentiles(categoryValues);
    }
  });

  return result;
}

/**
 * Analyze third-party hosts from requests
 */
function analyzeThirdParties(renderData: any, mainDomain: string): ThirdPartyHost[] {
  const hostMap = new Map<string, { count: number; sampleUrls: string[] }>();

  const allRequests = [
    ...(renderData?.requests_pre || []),
    ...(renderData?.requests_post_accept || []),
    ...(renderData?.requests_post_reject || []),
    ...(renderData?.requests_fallback || [])
  ];

  allRequests.forEach((req: any) => {
    const host = getHostFromUrl(req.url);
    if (host === 'unknown') return;

    const hostDomain = getETldPlusOne(host);
    if (hostDomain === mainDomain) return; // Skip first-party

    const existing = hostMap.get(host) || { count: 0, sampleUrls: [] };
    existing.count++;
    if (existing.sampleUrls.length < 3) {
      existing.sampleUrls.push(req.url);
    }
    hostMap.set(host, existing);
  });

  return Array.from(hostMap.entries()).map(([host, data]) => ({
    host,
    count: data.count,
    sampleUrls: data.sampleUrls
  }));
}

/**
 * Analyze tracking requests with parameters
 */
function analyzeTrackers(renderData: any, internalJson: InternalAuditJson, mainDomain: string) {
  let trackersWithParams = 0;

  // Count beacons with parameters that are third-party
  internalJson.beacons.forEach(beacon => {
    const beaconHost = getHostFromUrl(beacon.sample_url);
    const beaconDomain = getETldPlusOne(beaconHost);
    
    if (beacon.params.length > 0 && 
        beaconDomain !== mainDomain && 
        beaconHost !== 'unknown') {
      trackersWithParams++;
    }
  });

  return { trackersWithParams };
}

/**
 * Run all 7 quality gates
 */
function runQualityGates(
  summary: any,
  internalJson: InternalAuditJson,
  thirdParties: ThirdPartyHost[],
  trackerAnalysis: any,
  cookieStats: any,
  mergedCookies: MergedCookie[]
): AuditQualityGate[] {
  const gates: AuditQualityGate[] = [];

  // G1 - Network capture present
  const hasNetworkCapture = summary.requests_pre_cdp + summary.requests_pre_fallback > 0;
  gates.push({
    id: 'network_capture',
    level: 'error',
    passed: hasNetworkCapture,
    message: hasNetworkCapture ? 
      'Network capture successful' : 
      'INCOMPLETE – network capture empty (CDP not bound)',
    details: {
      pre_cdp: summary.requests_pre_cdp,
      pre_fallback: summary.requests_pre_fallback
    }
  });

  // G2 - Hosts consistency
  const hostsMatch = summary.third_parties_unique === internalJson.third_parties.length;
  gates.push({
    id: 'hosts_consistency',
    level: 'warn',
    passed: hostsMatch,
    message: hostsMatch ?
      'Host enumeration consistent' :
      'INCOMPLETE – host enumeration mismatch',
    details: {
      counted: summary.third_parties_unique,
      listed: internalJson.third_parties.length,
      diff: hostsMatch ? null : {
        missingInTable: Math.max(0, summary.third_parties_unique - internalJson.third_parties.length),
        extraInTable: Math.max(0, internalJson.third_parties.length - summary.third_parties_unique)
      }
    }
  });

  // G3 - Cookies consistency
  const cookiesMatch = summary.cookies_total === internalJson.cookies.length &&
                      summary.cookies_1p + summary.cookies_3p === summary.cookies_total;
  gates.push({
    id: 'cookies_consistency',
    level: 'warn',
    passed: cookiesMatch,
    message: cookiesMatch ?
      'Cookie enumeration consistent' :
      'INCOMPLETE – cookie enumeration mismatch',
    details: {
      total: summary.cookies_total,
      table: internalJson.cookies.length,
      firstParty: summary.cookies_1p,
      thirdParty: summary.cookies_3p,
      persisted: summary.cookies_3p_persisted,
      attempted: summary.cookies_3p_attempted
    }
  });

  // G3P: Third-party cookies probably blocked (check only)
  const hasThirdPartiesForCheck = summary.third_parties_unique > 0;
  const cookies3pBlocked = hasThirdPartiesForCheck && 
                          summary.cookies_3p_persisted === 0 && 
                          summary.cookies_3p_attempted > 0;
  gates.push({
    id: 'third_party_cookies_blocked',
    level: 'warn',
    passed: !cookies3pBlocked,
    message: cookies3pBlocked ?
      'Pravdepodobne zablokované 3P cookies' :
      'Third-party cookies not blocked',
    details: {
      third_parties: summary.third_parties_unique,
      cookies_3p_attempted: summary.cookies_3p_attempted,
      cookies_3p_persisted: summary.cookies_3p_persisted
    }
  });

  // G4 - Data-to-third-parties not empty when expected
  const hasThirdPartyTracking = trackerAnalysis.trackersWithParams > 0;
  const hasDataSending = internalJson.beacons.some(b => b.params.length > 0);
  const dataExtractionOk = !hasThirdPartyTracking || hasDataSending;
  gates.push({
    id: 'data_extraction',
    level: 'warn',
    passed: dataExtractionOk,
    message: dataExtractionOk ?
      'Parameter extraction complete' :
      'Parameter extraction missing – trackers present but no parameters listed',
    details: {
      trackers_with_params: trackerAnalysis.trackersWithParams
    }
  });

  // G5 - Retention contradiction
  const maxRetention = cookieStats.overall.max || 0;
  const retentionOk = maxRetention <= 365;
  gates.push({
    id: 'retention_contradiction',
    level: 'error',
    passed: retentionOk,
    message: retentionOk ?
      'Retention periods valid' :
      'Retention summary contradicts data (max expiry > 365 days)',
    details: {
      max_days: maxRetention,
      offenders: [] // Would need actual cookie data to populate
    }
  });

  // G6 - 1P/3P additivity
  const additivityOk = summary.cookies_1p + summary.cookies_3p === summary.cookies_total;
  gates.push({
    id: 'party_classification',
    level: 'error',
    passed: additivityOk,
    message: additivityOk ?
      'First/Third-party classification consistent' :
      'First/Third-party classification inconsistent',
    details: {
      total: summary.cookies_total,
      firstParty: summary.cookies_1p,
      thirdParty: summary.cookies_3p
    }
  });

  // G7 - Scenario diffs
  const hasPostData = (summary.requests_post_accept || 0) > 0 || (summary.requests_post_reject || 0) > 0;
  const scenarioOk = !hasPostData || (summary.requests_post_accept || 0) >= summary.requests_pre_cdp;
  gates.push({
    id: 'consent_scenarios',
    level: 'info',
    passed: scenarioOk,
    message: scenarioOk ?
      'Consent scenarios conclusive' :
      'Consent scenarios inconclusive (no measurable delta)',
    details: {
      pre: summary.requests_pre_cdp,
      post_accept: summary.requests_post_accept,
      post_reject: summary.requests_post_reject
    }
  });

  return gates;
}