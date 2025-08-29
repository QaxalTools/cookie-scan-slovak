// Quality checks and INCOMPLETE banner generation using proper data sources
import { InternalAuditJson } from '@/types/audit';
import { getETldPlusOne, getHostFromUrl } from './domain';

export function addQualityChecks(
  managementSummary: any,
  renderData: any,
  internalJson: InternalAuditJson
): any {
  const issues: string[] = [];
  let isIncomplete = false;

  // Quality Check 1: Network capture validation - use proper metrics
  const reqsPre = renderData?.requests_pre?.length || 0;
  const requestsTotal = renderData?.requests?.length || 0;
  const networkOk = reqsPre > 0 || requestsTotal > 0;
  
  if (!networkOk) {
    issues.push('Network capture empty (CDP not bound)');
    isIncomplete = true;
  }

  // Quality Check 2: Cookie enumeration consistency - normalized counting
  const norm = (d?: string) => (d || '').replace(/^\./, '');
  const mergedCookieMap = new Map<string, any>();
  
  // Merge cookies with normalized domains
  [...(renderData?.cookies_pre || []), ...(renderData?.cookies_post_accept || []), ...(renderData?.cookies_post_reject || [])]
    .forEach(cookie => {
      const key = `${cookie.name}|${norm(cookie.domain)}|${cookie.path || '/'}`;
      mergedCookieMap.set(key, cookie);
    });
  
  const cookiesSummaryCount = mergedCookieMap.size;
  const cookiesTableCount = internalJson.cookies.length;
  
  if (cookiesSummaryCount !== cookiesTableCount) {
    issues.push('Cookie enumeration mismatch');
    isIncomplete = true;
  }

  // Quality Check 3: Third parties consistency using eTLD+1
  const mainHost = getHostFromUrl(internalJson.final_url);
  const mainDomain = getETldPlusOne(mainHost);
  const thirdPartyDomains = new Set(
    [...(renderData?.requests_pre || []), ...(renderData?.requests_post_accept || []), ...(renderData?.requests_post_reject || [])]
      .map((req: any) => getHostFromUrl(req.url))
      .filter((host: string) => {
        if (host === 'unknown') return false;
        const hostDomain = getETldPlusOne(host);
        return hostDomain !== mainDomain;
      })
  );
  
  console.log(`🔍 Quality check - Third parties: render=${thirdPartyDomains.size}, internal=${internalJson.third_parties.length}`);
  
  if (thirdPartyDomains.size !== internalJson.third_parties.length) {
    issues.push('Host enumeration mismatch');
    isIncomplete = true;
  }

  // Quality Check 4: Data sending validation (only flag for third-party tracking)
  const hasThirdPartyTracking = internalJson.beacons.some(beacon => {
    const beaconHost = getHostFromUrl(beacon.sample_url);
    const beaconDomain = getETldPlusOne(beaconHost);
    return beacon.params.length > 0 && 
           beaconDomain !== mainDomain &&
           beaconHost !== 'unknown';
  });
  const hasDataSending = renderData?.data_sent_to_third_parties?.length > 0;
  
  console.log(`🔍 Quality check - Data sending: hasThirdPartyTracking=${hasThirdPartyTracking}, hasDataSending=${hasDataSending}`);
  
  if (hasThirdPartyTracking && !hasDataSending) {
    issues.push('Data sending section empty despite third-party tracking requests with parameters');
    isIncomplete = true;
  }

  // Add INCOMPLETE banner if issues found
  if (isIncomplete) {
    const banner = `INCOMPLETE – ${issues.join('; ')}`;
    managementSummary.overall = `${banner}\n\n${managementSummary.overall}`;
    managementSummary.verdict = 'neúplné dáta';
  }

  return managementSummary;
}

// Helper function to extract domain - REMOVED, using domain.ts utilities