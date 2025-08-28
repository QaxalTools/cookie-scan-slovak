import { AuditData } from '@/types/audit';

export interface RiskScore {
  area: string;
  score: number;
  note: string;
}

export function calculateRiskScoresFromDisplay(data: AuditData): RiskScore[] {
  const scores: RiskScore[] = [];
  
  // HTTPS
  const httpsSupported = data.detailedAnalysis.https.status === 'ok';
  const httpsScore = httpsSupported ? 0 : 3;
  let httpsNote = httpsSupported ? 'HTTPS je podporované - bezpečná komunikácia' :
                   'HTTPS nie je podporované - nezabezpečená komunikácia môže porušovať GDPR článok 32';
  scores.push({ area: 'HTTPS', score: httpsScore, note: httpsNote });
  
  // CMP (Consent Management Platform)
  const hasCmp = data.detailedAnalysis.consentManagement.hasConsentTool;
  const preConsentTrackers = data.detailedAnalysis.consentManagement.trackersBeforeConsent;
  const cmpScore = !hasCmp ? 5 : (preConsentTrackers > 0 ? 3 : 1);
  let cmpNote = !hasCmp ? 'Chýba consent management - porušenie transparency požiadaviek GDPR článku 12' :
                (preConsentTrackers > 0 ? 'CMP je prítomné ale neblokuje pred súhlasom - čiastočné porušenie ePrivacy' :
                'CMP správne blokuje trackery pred súhlasom - v súlade s ePrivacy direktívou');
  scores.push({ area: 'CMP', score: cmpScore, note: cmpNote });
  
  // Cookies
  const marketingCookies = data.detailedAnalysis.cookies.details.filter(c => c.category === 'marketingové');
  const preConsentCookies = marketingCookies.length; // Simplified for now
  const cookiesScore = preConsentCookies === 0 ? 1 : (preConsentCookies <= 2 ? 3 : 5);
  let cookiesNote = preConsentCookies === 0 ? 'Marketing cookies sa nevytvárajú pred súhlasom - v súlade s ePrivacy direktívou' :
                    (preConsentCookies <= 2 ? `${preConsentCookies} marketing cookies - stredné riziko pokút` :
                    `${preConsentCookies} marketing cookies - vysoké riziko GDPR pokút`);
  scores.push({ area: 'Cookies', score: cookiesScore, note: cookiesNote });
  
  // Storage
  const hasPreConsentStorage = data.detailedAnalysis.storage?.some(s => s.createdPreConsent) || false;
  const storageScore = hasPreConsentStorage ? 5 : 1;
  let storageNote = hasPreConsentStorage ? 'localStorage/sessionStorage sa zapisuje pred súhlasom - porušenie GDPR' :
                   'Lokálne úložisko sa nepoužíva bez súhlasu - v súlade s GDPR';
  scores.push({ area: 'Storage', score: storageScore, note: storageNote });
  
  // Trackers
  const trackerCount = data.detailedAnalysis.trackers.length;
  const trackersScore = trackerCount === 0 ? 0 : (trackerCount <= 2 ? 3 : 5);
  let trackersNote = trackerCount === 0 ? 'Žiadne trackery detegované - výborný súlad s ochranou súkromia' :
                    (trackerCount <= 2 ? `${trackerCount} trackery detegované - stredné riziko pre súkromie návštevníkov` :
                    `${trackerCount} trackerov detegovaných - vysoké riziko pre súkromie a potenciálne GDPR pokuty`);
  scores.push({ area: 'Trackery', score: trackersScore, note: trackersNote });
  
  // UX Banner (technical assessment only)
  const hasCmpTechnical = data.detailedAnalysis.consentManagement.hasConsentTool;
  const uxScore = hasCmpTechnical ? 1 : 3;
  let uxNote = hasCmpTechnical ? 'Technická kontrola cookie lišty prebehla úspešne' :
              'Chýba cookie lišta - porušenie transparency požiadaviek GDPR článku 12';
  scores.push({ area: 'UX lišta', score: uxScore, note: uxNote });
  
  return scores;
}

export function calculateOverallRiskFromScores(scores: RiskScore[]): {
  averageScore: number;
  riskLevel: string;
  riskColor: string;
} {
  const averageScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
  const riskLevel = averageScore <= 1.5 ? 'NÍZKE' : (averageScore <= 3 ? 'STREDNÉ' : 'VYSOKÉ');
  const riskColor = averageScore <= 1.5 ? 'bg-green-600' : (averageScore <= 3 ? 'bg-orange-500' : 'bg-red-600');
  
  return {
    averageScore,
    riskLevel,
    riskColor
  };
}