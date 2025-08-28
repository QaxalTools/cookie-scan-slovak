// Quality checks and INCOMPLETE banner generation
import { InternalAuditJson } from '@/types/audit';

export function addQualityChecks(
  managementSummary: any,
  renderData: any,
  internalJson: InternalAuditJson
): any {
  const issues: string[] = [];
  let isIncomplete = false;

  // Quality Check 1: Network capture validation
  const reqsPre = renderData?.requests_pre?.length || 0;
  const reqsPostAccept = renderData?.requests_post_accept?.length || 0;
  const reqsPostReject = renderData?.requests_post_reject?.length || 0;
  
  if (reqsPre === 0 && reqsPostAccept === 0 && reqsPostReject === 0) {
    issues.push('Network capture empty (CDP not bound)');
    isIncomplete = true;
  }

  // Quality Check 2: Cookie enumeration consistency
  const cookiesSummaryCount = (renderData?.cookies_pre?.length || 0) + 
                             (renderData?.cookies_post_accept?.length || 0) + 
                             (renderData?.cookies_post_reject?.length || 0);
  const cookiesTableCount = internalJson.cookies.length;
  
  if (cookiesSummaryCount !== cookiesTableCount) {
    issues.push('Cookie enumeration mismatch');
    isIncomplete = true;
  }

  // Quality Check 3: Third parties consistency  
  const firstPartyDomain = getDomain(internalJson.final_url);
  const thirdPartyDomains = new Set(
    [...(renderData?.requests_pre || []), ...(renderData?.requests_post_accept || []), ...(renderData?.requests_post_reject || [])]
      .map((req: any) => getDomain(req.url))
      .filter((domain: string) => {
        if (domain === 'unknown') return false;
        // Exclude first-party and its subdomains
        return domain !== firstPartyDomain && !domain.endsWith('.' + firstPartyDomain);
      })
  );
  
  console.log(`🔍 Quality check - Third parties: render=${thirdPartyDomains.size}, internal=${internalJson.third_parties.length}`);
  
  if (thirdPartyDomains.size !== internalJson.third_parties.length) {
    issues.push('Host enumeration mismatch');
    isIncomplete = true;
  }

  // Quality Check 4: Data sending validation (only flag for third-party tracking)
  const hasThirdPartyTracking = internalJson.beacons.some(beacon => {
    const beaconDomain = getDomain(beacon.sample_url);
    return beacon.params.length > 0 && 
           beaconDomain !== firstPartyDomain && 
           !beaconDomain.endsWith('.' + firstPartyDomain) &&
           beaconDomain !== 'unknown';
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

// Helper function to extract domain
function getDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}