import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SimulationBadge } from '@/components/SimulationBadge';
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Shield, 
  Cookie, 
  Eye, 
  Mail,
  Download
} from 'lucide-react';
import { AuditData } from '@/types/audit';

interface AuditResultsProps {
  data: AuditData;
  onGenerateEmail: () => void;
}

export const AuditResults = ({ data, onGenerateEmail }: AuditResultsProps) => {
  // Consistency checks
  const performConsistencyChecks = () => {
    const checks = [];
    
    // Check cookie count consistency
    const expectedCookieCount = data.detailedAnalysis.cookies.firstParty + data.detailedAnalysis.cookies.thirdParty;
    if (expectedCookieCount !== data.detailedAnalysis.cookies.total) {
      checks.push(`Cookie count mismatch: ${data.detailedAnalysis.cookies.total} total vs ${expectedCookieCount} calculated`);
    }
    
    // Check pre-consent trackers count
    const preConsentCount = data.detailedAnalysis.trackers.filter(t => t.spamsBeforeConsent).length;
    if (preConsentCount !== data.detailedAnalysis.consentManagement.trackersBeforeConsent) {
      checks.push(`Pre-consent tracker count mismatch: ${data.detailedAnalysis.consentManagement.trackersBeforeConsent} stated vs ${preConsentCount} in table`);
    }
    
    // Check third party count
    const thirdPartyDomains = new Set(data.detailedAnalysis.thirdParties.list.map(p => p.domain));
    if (thirdPartyDomains.size !== data.detailedAnalysis.thirdParties.total) {
      checks.push(`Third party count mismatch: ${data.detailedAnalysis.thirdParties.total} stated vs ${thirdPartyDomains.size} unique domains`);
    }
    
    return checks;
  };

  const consistencyIssues = performConsistencyChecks();

  const handleDownloadJSON = () => {
    const jsonData = JSON.stringify(data._internal, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  const handleDownloadPDF = () => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>GDPR Audit Report</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }
              h1, h2, h3 { color: #333; }
              .header { text-align: center; margin-bottom: 30px; }
              .section { margin-bottom: 25px; }
              table { width: 100%; border-collapse: collapse; margin: 10px 0; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
              th { background-color: #f5f5f5; }
              .status-ok { color: green; font-weight: bold; }
              .status-warning { color: orange; font-weight: bold; }
              .status-error { color: red; font-weight: bold; }
              @media print { body { margin: 0; } }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>GDPR Cookie Audit Report</h1>
              <p>Dátum: ${new Date().toLocaleDateString('sk-SK')}</p>
            </div>
            
            <div class="section">
              <h2>A) Manažérsky sumár</h2>
              <p><strong>Verdikt:</strong> ${data.managementSummary.verdict.toUpperCase()}</p>
              <p><strong>Celkové hodnotenie:</strong> ${data.managementSummary.overall}</p>
              <p><strong>Riziká:</strong> ${data.managementSummary.risks}</p>
              ${data.managementSummary.data_source ? `<p><strong>Zdroj dát:</strong> ${data.managementSummary.data_source}</p>` : ''}
            </div>

            <div class="section">
              <h2>B) Detailná analýza</h2>
              
              <h3>1. HTTPS zabezpečenie</h3>
              <p class="status-${data.detailedAnalysis.https.status}">${data.detailedAnalysis.https.comment}</p>
              
              <h3>2. Tretie strany (${data.detailedAnalysis.thirdParties.total})</h3>
              <table>
                <tr><th>Doména</th><th>Počet požiadaviek</th></tr>
                ${data.detailedAnalysis.thirdParties.list.map(party => 
                  `<tr><td>${party.domain}</td><td>${party.requests}</td></tr>`
                ).join('')}
              </table>
              
              <h3>3. Trackery a web-beacony</h3>
              <table>
                <tr><th>Služba</th><th>Host</th><th>Dôkaz</th><th>Pred súhlasom</th><th>Stav</th></tr>
                ${data.detailedAnalysis.trackers.map(tracker =>
                  `<tr><td>${tracker.service}</td><td>${tracker.host}</td><td>${tracker.evidence}</td><td>${tracker.spamsBeforeConsent ? 'ÁNO' : 'NIE'}</td><td class="status-${tracker.status}">${tracker.status.toUpperCase()}</td></tr>`
                ).join('')}
              </table>
              
              ${data._internal?.beacons?.filter(b => b.pre_consent).length > 0 ? `
              <h4>Pred-súhlasové trackery (${data._internal.beacons.filter(b => b.pre_consent).length})</h4>
              <ul>
                ${data._internal.beacons.filter(b => b.pre_consent).map(beacon =>
                  `<li><strong>${beacon.service}:</strong> ${beacon.sample_url}</li>`
                ).join('')}
              </ul>` : ''}
              
              <h3>4. Cookies (${data.detailedAnalysis.cookies.total})</h3>
              <p><strong>First-party:</strong> ${data.detailedAnalysis.cookies.firstParty} | <strong>Third-party:</strong> ${data.detailedAnalysis.cookies.thirdParty}</p>
              <table>
                <tr><th>Názov</th><th>Typ</th><th>Kategória</th><th>Expirácia (dni)</th><th>Stav</th></tr>
                ${data.detailedAnalysis.cookies.details.map(cookie => {
                  const internalCookie = data._internal?.cookies?.find(ic => ic.name === cookie.name && ic.domain === cookie.domain);
                  let retentionDays = 'Neznáme';
                  if (internalCookie?.expiry_days !== null && internalCookie?.expiry_days !== undefined) {
                    retentionDays = internalCookie.expiry_days.toString();
                  } else if (cookie.expiration.includes('Session')) {
                    retentionDays = 'Session';
                  }
                  return `<tr><td>${cookie.name}</td><td>${cookie.type === 'first-party' ? '1P' : '3P'}</td><td>${cookie.category}</td><td>${retentionDays}</td><td class="status-${cookie.status}">${cookie.status.toUpperCase()}</td></tr>`;
                }).join('')}
              </table>
              ${(() => {
                const longRetentionCookies = data.detailedAnalysis.cookies.details.filter(cookie => {
                  const internalCookie = data._internal?.cookies?.find(ic => ic.name === cookie.name && ic.domain === cookie.domain);
                  if (internalCookie?.expiry_days && internalCookie.expiry_days > 365) {
                    return cookie.category.toLowerCase().includes('marketing') || cookie.category.toLowerCase().includes('analytics');
                  }
                  return false;
                });
                return longRetentionCookies.length > 0 ? `<p class="status-warning"><strong>⚠️ Poznámka:</strong> ${longRetentionCookies.length} marketingových/analytických cookies má retenciu nad 1 rok, čo môže byť nad rámec primeranosti podľa GDPR.</p>` : '';
              })()}
              
              <h3>5. LocalStorage/SessionStorage</h3>
              ${data._internal?.storage && data._internal.storage.length > 0 ? `
              <table>
                <tr><th>Kľúč</th><th>Scope</th><th>Vzorová hodnota</th><th>Osobné údaje</th><th>Zdroj a timing</th></tr>
                ${data._internal.storage.map(item => `
                  <tr><td style="font-family: monospace;">${item.key}</td><td>${item.scope}</td><td style="font-family: monospace; font-size: 12px;">${item.sample_value.length > 50 ? item.sample_value.substring(0, 50) + '...' : item.sample_value}</td><td class="status-${item.contains_personal_data ? 'error' : 'ok'}">${item.contains_personal_data ? 'Áno' : 'Nie'}</td><td style="font-size: 11px;">${item.source_party ? 'Via ' + item.source_party + ' | ' : ''}${item.created_pre_consent ? 'Pred súhlasom' : 'Po súhlase'}</td></tr>
                `).join('')}
              </table>
              ${data._internal.storage.some(item => item.contains_personal_data) ? `
              <p class="status-error"><strong>⚠️ Poznámka:</strong> Nájdené osobné údaje v storage bez užívateľského súhlasu.</p>
              ` : ''}
              ` : '<p>Žiadne údaje v LocalStorage/SessionStorage neboli nájdené.</p>'}
              
              <h3>6. Consent Management</h3>
              <p><strong>Consent nástroj:</strong> ${data.detailedAnalysis.consentManagement.hasConsentTool ? 'Implementovaný' : 'Chýba'}</p>
              <p><strong>Trackery pred súhlasom:</strong> ${data.detailedAnalysis.consentManagement.trackersBeforeConsent}</p>
              <p><strong>Dôkazy:</strong> ${data.detailedAnalysis.consentManagement.evidence}</p>
              ${data._internal?.cmp?.present && data._internal?.cmp?.cookie_name ? `
              <p><strong>Detekovaná consent cookie:</strong> ${data._internal.cmp.cookie_name} (${data._internal.cmp.raw_value.substring(0, 30)}...)</p>
              ` : ''}
              
              <h3>7. Právne zhrnutie</h3>
              <p>${data.detailedAnalysis.legalSummary}</p>
            </div>

            <!-- NEW SECTIONS -->
            <div class="section">
              <h2>B+. Dáta odosielané tretím stranám</h2>
              ${(() => {
                const extractedParams = [];
                const piiKeywords = ['fbp', 'fbc', 'tid', 'cid', 'sid', 'uid', 'user_id', 'ip', 'geo'];
                if (data._internal?.beacons) {
                  data._internal.beacons.forEach(beacon => {
                    try {
                      const url = new URL(beacon.sample_url);
                      url.searchParams.forEach((value, key) => {
                        if (piiKeywords.some(k => key.toLowerCase().includes(k))) {
                          extractedParams.push({
                            service: beacon.service,
                            parameter: key,
                            sampleValue: value.length > 20 ? value.substring(0, 20) + '...' : value,
                            isPII: ['ip', 'geo', 'uid', 'user_id', 'fbp', 'fbc', 'cid', 'sid'].some(k => key.toLowerCase().includes(k)),
                            preConsent: beacon.pre_consent
                          });
                        }
                      });
                    } catch (e) {}
                  });
                }
                return extractedParams.length > 0 ? `
                <table>
                  <tr><th>Služba</th><th>Parameter</th><th>Vzor hodnoty</th><th>Osobné údaje?</th><th>Pred súhlasom?</th></tr>
                  ${extractedParams.map(param => 
                    `<tr><td>${param.service}</td><td style="font-family: monospace;">${param.parameter}</td><td style="font-family: monospace;">${param.sampleValue}</td><td class="status-${param.isPII ? 'error' : 'ok'}">${param.isPII ? 'Áno' : 'Nie'}</td><td class="status-${param.preConsent ? 'error' : 'ok'}">${param.preConsent ? 'Áno' : 'Nie'}</td></tr>`
                  ).join('')}
                </table>
                <p style="font-size: 12px; color: #666;">Zobrazené sú zachytené vzorové hodnoty z požiadaviek/beaconov odoslaných tretím stranám.</p>
                ` : '<p>Neboli nájdené relevantné parametre odosielané tretím stranám.</p>';
              })()}
            </div>

            <div class="section">
              <h2>B++. UX analýza cookie lišty</h2>
              ${(() => {
                const hasCMP = data.detailedAnalysis.consentManagement.hasConsentTool;
                const preConsentTrackers = data.detailedAnalysis.consentManagement.trackersBeforeConsent > 0;
                const isPresent = hasCMP;
                const defaultBehavior = preConsentTrackers ? 'Opt-in (nevyžaduje súhlas)' : 'Opt-out (blokuje trackery)';
                const balancedButtons = preConsentTrackers ? 'Nie (nevyvážená)' : 'Áno (pravdepodobné)';
                const detailedSettings = data._internal?.cmp?.present ? 'Áno (detekovaný CMP nástroj)' : 'Neznáme';
                let assessment = 'Chýba';
                if (hasCMP) {
                  assessment = preConsentTrackers ? 'Nevyvážená' : 'Transparentná';
                }
                return `
                <table>
                  <tr><th>Charakteristika</th><th>Hodnota</th></tr>
                  <tr><td>Prítomnosť cookie lišty</td><td class="status-${isPresent ? 'ok' : 'error'}">${isPresent ? 'Áno' : 'Nie'}</td></tr>
                  <tr><td>Predvolené správanie</td><td>${defaultBehavior}</td></tr>
                  <tr><td>Rovnocenné tlačidlá</td><td>${balancedButtons}</td></tr>
                  <tr><td>Detailné nastavenia</td><td>${detailedSettings}</td></tr>
                </table>
                <p><strong>Celkové hodnotenie UX:</strong> <span class="status-${assessment === 'Transparentná' ? 'ok' : assessment === 'Nevyvážená' ? 'warning' : 'error'}">${assessment.toUpperCase()}</span></p>
                `;
              })()}
            </div>

            <div class="section">
              <h2>B+++. Legislatívne odkazy</h2>
              <ul>
                <li><strong>Článok 5(3) ePrivacy Directive:</strong> Ukladanie nenutných cookies bez súhlasu používateľa</li>
                <li><strong>Článok 6 GDPR:</strong> Spracúvanie IP adries, user_id a online identifikátorov</li>
                <li><strong>Články 12-14 GDPR:</strong> Povinnosť informovať používateľov a zabezpečiť transparentnosť</li>
                <li><strong>Článok 5(1)(e) GDPR:</strong> Princíp minimalizácie údajov a primerané doby uchovávania</li>
              </ul>
            </div>

            <div class="section">
              <h2>B++++. Rizikový scoring</h2>
              ${(() => {
                const httpsScore = data.detailedAnalysis.https.status === 'ok' ? 0 : 
                                  data.detailedAnalysis.https.status === 'warning' ? 3 : 5;
                const cmpScore = !data.detailedAnalysis.consentManagement.hasConsentTool ? 5 :
                                data.detailedAnalysis.consentManagement.trackersBeforeConsent > 0 ? 4 : 1;
                const cookiesScore = data.detailedAnalysis.cookies.details.some(c => 
                  c.category.toLowerCase().includes('marketing') || c.category.toLowerCase().includes('analytics')
                ) && data.detailedAnalysis.consentManagement.trackersBeforeConsent > 0 ? 4 : 2;
                const storageScore = data._internal?.storage?.some(s => s.contains_personal_data && s.created_pre_consent) ? 5 : 1;
                const preConsentBeacons = data._internal?.beacons?.filter(b => b.pre_consent)?.length || 0;
                const trackersScore = preConsentBeacons === 0 ? 0 : preConsentBeacons <= 3 ? 3 : preConsentBeacons <= 7 ? 4 : 5;
                const uxScore = !data.detailedAnalysis.consentManagement.hasConsentTool ? 5 :
                               data.detailedAnalysis.consentManagement.trackersBeforeConsent > 0 ? 4 : 1;
                const totalScore = (httpsScore + cmpScore + cookiesScore + storageScore + trackersScore + uxScore) / 6;
                const overallRisk = totalScore <= 1.5 ? 'Low' : totalScore <= 3 ? 'Medium' : 'High';
                
                const riskAreas = [
                  { area: 'HTTPS', score: httpsScore, note: httpsScore <= 1 ? 'Správne implementované' : 'Problémy so zabezpečením' },
                  { area: 'CMP', score: cmpScore, note: cmpScore === 5 ? 'Chýba nástroj' : cmpScore === 4 ? 'Neblokuje trackery' : 'Správne funguje' },
                  { area: 'Cookies', score: cookiesScore, note: cookiesScore >= 4 ? 'Marketing cookies pred súhlasom' : 'Akceptovateľné' },
                  { area: 'Storage', score: storageScore, note: storageScore === 5 ? 'Osobné údaje pred súhlasom' : 'V poriadku' },
                  { area: 'Trackery', score: trackersScore, note: preConsentBeacons + ' pred-súhlasových trackerov' },
                  { area: 'UX lišta', score: uxScore, note: uxScore === 5 ? 'Chýba' : uxScore === 4 ? 'Nevyvážená' : 'Transparentná' }
                ];
                
                return `
                <table>
                  <tr><th>Oblasť</th><th>Skóre (0-5)</th><th>Poznámka</th></tr>
                  ${riskAreas.map(area => 
                    `<tr><td><strong>${area.area}</strong></td><td class="status-${area.score <= 1 ? 'ok' : area.score <= 3 ? 'warning' : 'error'}">${area.score}/5</td><td style="font-size: 12px;">${area.note}</td></tr>`
                  ).join('')}
                </table>
                <p><strong>Celkové riziko:</strong> <span class="status-${overallRisk === 'Low' ? 'ok' : overallRisk === 'Medium' ? 'warning' : 'error'}">${overallRisk.toUpperCase()}</span> (Priemerné skóre: ${totalScore.toFixed(1)}/5)</p>
                `;
              })()}
            </div>

            <div class="section">
              <h2>C) OK vs. Rizikové</h2>
              <table>
                <tr><th>Oblasť</th><th>Stav</th><th>Komentár</th></tr>
                ${data.riskTable.map(risk =>
                  `<tr><td>${risk.area}</td><td class="status-${risk.status}">${risk.status.toUpperCase()}</td><td>${risk.comment}</td></tr>`
                ).join('')}
              </table>
            </div>

            <div class="section">
              <h2>D) Odporúčania</h2>
              ${data.recommendations.map(rec =>
                `<div style="margin-bottom: 15px;"><h4>${rec.title}</h4><p>${rec.description}</p></div>`
              ).join('')}
            </div>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };

  const getStatusIcon = (status: 'ok' | 'warning' | 'error') => {
    switch (status) {
      case 'ok':
        return <CheckCircle className="h-4 w-4 text-success" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-destructive" />;
    }
  };

  const getStatusBadge = (status: 'ok' | 'warning' | 'error') => {
    switch (status) {
      case 'ok':
        return <Badge variant="secondary" className="bg-success/10 text-success">OK</Badge>;
      case 'warning':
        return <Badge variant="secondary" className="bg-warning/10 text-warning">Upozornenie</Badge>;
      case 'error':
        return <Badge variant="secondary" className="bg-destructive/10 text-destructive">Riziko</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-3 mb-2">
          <h2 className="text-2xl font-bold">Výsledky auditu</h2>
          <SimulationBadge />
        </div>
        <p className="text-muted-foreground">
          Komplexná analýza GDPR a ePrivacy súladu
        </p>
      </div>

      {/* A) Manažérsky sumár */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            A) Manažérsky sumár
            <Badge variant={data.managementSummary.verdict === 'súlad' ? 'secondary' : 
                          data.managementSummary.verdict === 'čiastočný súlad' ? 'outline' : 'destructive'}>
              {data.managementSummary.verdict.toUpperCase()}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="p-4 rounded-lg bg-gradient-accent">
              <h3 className="font-semibold mb-2">Celkové hodnotenie</h3>
              <p className="text-muted-foreground">
                {data.managementSummary.overall}
              </p>
            </div>
            <div className="p-4 rounded-lg border border-border">
              <h3 className="font-semibold mb-2">{data.managementSummary.verdict === 'súlad' ? 'Pozitívne zistenia' : 'Identifikované riziká'}</h3>
              <p className="text-muted-foreground">
                {data.managementSummary.risks}
              </p>
            </div>
            {data.managementSummary.data_source && (
              <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
                <p className="text-sm text-warning-foreground">
                  <strong>Zdroj dát:</strong> {data.managementSummary.data_source}
                  {data.managementSummary.data_source.includes('Simulácia') && (
                    <span className="block mt-1 text-xs">
                      Pre presné výsledky odporúčame použitie profesionálneho auditovacieho nástroja.
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* B) Detailná analýza */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle>B) Detailná analýza</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 1. HTTPS */}
          <div>
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              {getStatusIcon(data.detailedAnalysis.https.status)}
              1. HTTPS zabezpečenie
            </h3>
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <span>{data.detailedAnalysis.https.comment}</span>
              {getStatusBadge(data.detailedAnalysis.https.status)}
            </div>
          </div>

          {/* 2. Tretie strany */}
          <div>
            <h3 className="font-semibold mb-2">2. Tretie strany ({data.detailedAnalysis.thirdParties.total})</h3>
            <div className="space-y-2">
              {data.detailedAnalysis.thirdParties.list.map((party, index) => (
                <div key={index} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                  <span className="text-sm">{party.domain}</span>
                  <Badge variant="outline">{party.requests} požiadaviek</Badge>
                </div>
              ))}
            </div>
          </div>

          {/* 3. Trackery/Beacony */}
          <div>
            <h3 className="font-semibold mb-2">3. Trackery a web-beacony</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                   <tr className="border-b">
                     <th className="text-left p-2">Služba</th>
                     <th className="text-left p-2">Host</th>
                     <th className="text-left p-2">Dôkaz (URL/parametre)</th>
                     <th className="text-left p-2">Pred súhlasom</th>
                     <th className="text-left p-2">Stav</th>
                   </tr>
                </thead>
                <tbody>
                   {data.detailedAnalysis.trackers.map((tracker, index) => (
                     <tr key={index} className="border-b">
                       <td className="p-2">{tracker.service}</td>
                       <td className="p-2 text-xs text-muted-foreground">{tracker.host}</td>
                       <td className="p-2 text-xs font-mono bg-muted/50 rounded px-1">{tracker.evidence}</td>
                       <td className="p-2">
                         <Badge variant={tracker.spamsBeforeConsent ? 'destructive' : 'secondary'} className="text-xs">
                           {tracker.spamsBeforeConsent ? 'ÁNO' : 'NIE'}
                         </Badge>
                       </td>
                       <td className="p-2">{getStatusBadge(tracker.status)}</td>
                     </tr>
                   ))}
                </tbody>
               </table>
             </div>
             
             {/* Show pre-consent trackers explicitly if they exist */}
             {data._internal?.beacons?.filter(b => b.pre_consent).length > 0 && (
               <div className="mt-4 p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
                 <h4 className="font-semibold text-destructive mb-2">
                   ⚠️ Pred-súhlasové trackery ({data._internal.beacons.filter(b => b.pre_consent).length})
                 </h4>
                 <div className="space-y-2">
                   {data._internal.beacons.filter(b => b.pre_consent).map((beacon, index) => (
                     <div key={index} className="text-xs font-mono bg-muted/50 p-2 rounded">
                       <strong>{beacon.service}:</strong> {beacon.sample_url}
                     </div>
                   ))}
                 </div>
                 <p className="text-xs text-destructive mt-2">
                   Tieto trackery sa spúšťajú automaticky pri načítaní stránky bez súhlasu používateľa.
                 </p>
               </div>
             )}
           </div>

          {/* 4. Cookies */}
          <div>
            <h3 className="font-semibold mb-2">
              4. Cookies ({data.detailedAnalysis.cookies.total})
              <span className="text-sm font-normal text-muted-foreground ml-2">
                First-party: {data.detailedAnalysis.cookies.firstParty} | Third-party: {data.detailedAnalysis.cookies.thirdParty}
              </span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Názov</th>
                    <th className="text-left p-2">Doména</th>
                    <th className="text-left p-2">1P/3P</th>
                    <th className="text-left p-2">Typ</th>
                    <th className="text-left p-2">Expirácia</th>
                    <th className="text-left p-2">Stav</th>
                  </tr>
                </thead>
                <tbody>
                  {data.detailedAnalysis.cookies.details.map((cookie, index) => (
                    <tr key={index} className="border-b">
                      <td className="p-2 font-mono text-xs">{cookie.name}</td>
                      <td className="p-2 text-xs text-muted-foreground">{cookie.domain}</td>
                      <td className="p-2">{cookie.type === 'first-party' ? '1P' : '3P'}</td>
                      <td className="p-2">{cookie.category}</td>
                      <td className="p-2">{cookie.expiration}</td>
                      <td className="p-2">{getStatusBadge(cookie.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 5. LocalStorage/SessionStorage */}
          {data.detailedAnalysis.storage.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">5. LocalStorage/SessionStorage</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Kľúč</th>
                      <th className="text-left p-2">Vzor hodnôt</th>
                      <th className="text-left p-2">Zdroj</th>
                      <th className="text-left p-2">Vznik pred súhlasom</th>
                      <th className="text-left p-2">Poznámka</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.detailedAnalysis.storage.map((storage, index) => (
                      <tr key={index} className="border-b">
                        <td className="p-2 font-mono text-xs">{storage.key}</td>
                        <td className="p-2 font-mono text-xs bg-muted/50 rounded px-1">{storage.valuePattern}</td>
                        <td className="p-2">{storage.source}</td>
                        <td className="p-2">
                          <Badge variant={storage.createdPreConsent ? 'destructive' : 'secondary'} className="text-xs">
                            {storage.createdPreConsent ? 'ÁNO' : 'NIE'}
                          </Badge>
                        </td>
                        <td className="p-2">{storage.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 6. CMP a časovanie */}
          <div>
            <h3 className="font-semibold mb-2">6. Consent Management a časovanie</h3>
            <div className="p-4 bg-muted/50 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span>Consent nástroj:</span>
                <Badge variant={data.detailedAnalysis.consentManagement.hasConsentTool ? 'secondary' : 'destructive'}>
                  {data.detailedAnalysis.consentManagement.hasConsentTool ? 'Implementovaný' : 'Chýba'}
                </Badge>
              </div>
              {data.detailedAnalysis.consentManagement.consentCookieName && (
                <div className="flex items-center justify-between">
                  <span>Detegovaný consent cookie:</span>
                  <span className="font-mono text-xs bg-muted rounded px-2 py-1">
                    {data.detailedAnalysis.consentManagement.consentCookieName}
                  </span>
                </div>
              )}
              {data.detailedAnalysis.consentManagement.consentCookieValue && (
                <div className="text-xs text-muted-foreground">
                  <strong>Raw value:</strong> {data.detailedAnalysis.consentManagement.consentCookieValue}
                </div>
              )}
              <div className="flex items-center justify-between">
                <span>Trackery pred súhlasom:</span>
                <Badge variant={data.detailedAnalysis.consentManagement.trackersBeforeConsent > 0 ? 'destructive' : 'secondary'}>
                  {data.detailedAnalysis.consentManagement.trackersBeforeConsent}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                <strong>Dôkazy:</strong> {data.detailedAnalysis.consentManagement.evidence}
              </div>
            </div>
          </div>

          {/* 7. Právne zhrnutie */}
          <div>
            <h3 className="font-semibold mb-2">7. Právne zhrnutie</h3>
            <div className="p-4 bg-gradient-accent rounded-lg">
              <p className="text-sm">{data.detailedAnalysis.legalSummary}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* NEW SECTIONS - Between B and C */}
      
      {/* B+. Dáta odosielané tretím stranám */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle>B+. Dáta odosielané tretím stranám</CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            // Extract parameters from beacons
            const extractedParams = [];
            const piiKeywords = ['fbp', 'fbc', 'tid', 'cid', 'sid', 'uid', 'user_id', 'ip', 'geo'];
            
            if (data._internal?.beacons) {
              data._internal.beacons.forEach(beacon => {
                try {
                  const url = new URL(beacon.sample_url);
                  url.searchParams.forEach((value, key) => {
                    if (piiKeywords.some(k => key.toLowerCase().includes(k))) {
                      extractedParams.push({
                        service: beacon.service,
                        parameter: key,
                        sampleValue: value.length > 20 ? value.substring(0, 20) + '...' : value,
                        isPII: ['ip', 'geo', 'uid', 'user_id', 'fbp', 'fbc', 'cid', 'sid'].some(k => key.toLowerCase().includes(k)),
                        preConsent: beacon.pre_consent
                      });
                    }
                  });
                } catch (e) {
                  // Skip invalid URLs
                }
              });
            }
            
            return extractedParams.length > 0 ? (
              <div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Služba</th>
                        <th className="text-left p-2">Parameter</th>
                        <th className="text-left p-2">Vzor hodnoty</th>
                        <th className="text-left p-2">Osobné údaje?</th>
                        <th className="text-left p-2">Pred súhlasom?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extractedParams.map((param, index) => (
                        <tr key={index} className="border-b">
                          <td className="p-2">{param.service}</td>
                          <td className="p-2 font-mono text-xs">{param.parameter}</td>
                          <td className="p-2 font-mono text-xs bg-muted/50 rounded px-1">{param.sampleValue}</td>
                          <td className="p-2">
                            <Badge variant={param.isPII ? 'destructive' : 'secondary'} className="text-xs">
                              {param.isPII ? 'Áno' : 'Nie'}
                            </Badge>
                          </td>
                          <td className="p-2">
                            <Badge variant={param.preConsent ? 'destructive' : 'secondary'} className="text-xs">
                              {param.preConsent ? 'Áno' : 'Nie'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Zobrazené sú zachytené vzorové hodnoty z požiadaviek/beaconov odoslaných tretím stranám.
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">Neboli nájdené relevantné parametre odosielané tretím stranám.</p>
            );
          })()}
        </CardContent>
      </Card>

      {/* B++. UX analýza cookie lišty */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle>B++. UX analýza cookie lišty</CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            const hasCMP = data.detailedAnalysis.consentManagement.hasConsentTool;
            const preConsentTrackers = data.detailedAnalysis.consentManagement.trackersBeforeConsent > 0;
            
            // Determine UX characteristics
            const isPresent = hasCMP;
            const defaultBehavior = preConsentTrackers ? 'Opt-in (nevyžaduje súhlas)' : 'Opt-out (blokuje trackery)';
            const balancedButtons = preConsentTrackers ? 'Nie (nevyvážená)' : 'Áno (pravdepodobné)';
            const detailedSettings = data._internal?.cmp?.present ? 'Áno (detekovaný CMP nástroj)' : 'Neznáme';
            
            // Overall assessment
            let assessment = 'Chýba';
            if (hasCMP) {
              assessment = preConsentTrackers ? 'Nevyvážená' : 'Transparentná';
            }
            
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <h4 className="font-semibold text-sm mb-1">Prítomnosť cookie lišty</h4>
                    <Badge variant={isPresent ? 'secondary' : 'destructive'}>
                      {isPresent ? 'Áno' : 'Nie'}
                    </Badge>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <h4 className="font-semibold text-sm mb-1">Predvolené správanie</h4>
                    <span className="text-sm">{defaultBehavior}</span>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <h4 className="font-semibold text-sm mb-1">Rovnocenné tlačidlá</h4>
                    <span className="text-sm">{balancedButtons}</span>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <h4 className="font-semibold text-sm mb-1">Detailné nastavenia</h4>
                    <span className="text-sm">{detailedSettings}</span>
                  </div>
                </div>
                <div className="p-4 bg-gradient-accent rounded-lg">
                  <h4 className="font-semibold mb-2">Celkové hodnotenie UX</h4>
                  <Badge variant={assessment === 'Transparentná' ? 'secondary' : 
                                 assessment === 'Nevyvážená' ? 'outline' : 'destructive'} 
                         className="mb-2">
                    {assessment}
                  </Badge>
                  <p className="text-sm text-muted-foreground">
                    {assessment === 'Chýba' && 'Cookie lišta nie je implementovaná.'}
                    {assessment === 'Nevyvážená' && 'CMP nástroj je prítomný, ale neblokuje trackery pred súhlasom.'}
                    {assessment === 'Transparentná' && 'CMP nástroj správne blokuje trackery až po súhlase používateľa.'}
                  </p>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* B+++. Retenčné doby cookies */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle>B+++. Retenčné doby cookies</CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            // Calculate retention periods and check for long-retention cookies
            const cookiesWithRetention = data.detailedAnalysis.cookies.details.map(cookie => {
              // Find matching internal cookie for expiration
              const internalCookie = data._internal?.cookies?.find(ic => 
                ic.name === cookie.name && ic.domain === cookie.domain
              );
              
              let retentionDays = 'Neznáme';
              let numericDays = 0;
              if (internalCookie?.expiry_days !== null && internalCookie?.expiry_days !== undefined) {
                retentionDays = `${internalCookie.expiry_days} dní`;
                numericDays = internalCookie.expiry_days;
              } else if (cookie.expiration.includes('Session')) {
                retentionDays = 'Session';
              }
              
              return { ...cookie, retentionDays, numericDays };
            });
            
            const longRetentionCookies = cookiesWithRetention.filter(cookie => 
              cookie.numericDays > 365 && 
              (cookie.category.toLowerCase().includes('marketing') || cookie.category.toLowerCase().includes('analytics'))
            );
            
            return (
              <div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Názov</th>
                        <th className="text-left p-2">Kategória</th>
                        <th className="text-left p-2">Expirácia (dni)</th>
                        <th className="text-left p-2">Stav</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cookiesWithRetention.map((cookie, index) => (
                        <tr key={index} className="border-b">
                          <td className="p-2 font-mono text-xs">{cookie.name}</td>
                          <td className="p-2">{cookie.category}</td>
                          <td className="p-2">
                            <span className={cookie.numericDays > 365 ? 'text-warning font-semibold' : ''}>
                              {cookie.retentionDays}
                            </span>
                          </td>
                          <td className="p-2">{getStatusBadge(cookie.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {longRetentionCookies.length > 0 && (
                  <div className="mt-4 p-4 bg-warning/10 border border-warning/30 rounded-lg">
                    <h4 className="font-semibold text-warning mb-2">⚠️ Upozornenie na dlhú retenciu</h4>
                    <p className="text-sm text-warning-foreground">
                      Nájdené {longRetentionCookies.length} marketingové/analytické cookies s retenciou nad 1 rok. 
                      Takáto dlhá doba uchovávania môže byť nad rámec primeranosti podľa GDPR článku 5(1)(e).
                    </p>
                    <div className="mt-2 space-y-1">
                      {longRetentionCookies.map((cookie, index) => (
                        <div key={index} className="text-xs font-mono bg-muted/50 p-1 rounded">
                          {cookie.name}: {cookie.retentionDays}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* B++++. Legislatívne odkazy */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle>B++++. Legislatívne odkazy</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="p-3 bg-muted/30 rounded-lg">
              <h4 className="font-semibold text-sm mb-1">📋 Relevantná legislatíva</h4>
              <ul className="text-sm space-y-2 mt-2">
                <li>
                  <strong>Článok 5(3) ePrivacy Directive:</strong> Ukladanie nenutných cookies bez súhlasu používateľa
                </li>
                <li>
                  <strong>Článok 6 GDPR:</strong> Spracúvanie IP adries, user_id a online identifikátorov
                </li>
                <li>
                  <strong>Články 12-14 GDPR:</strong> Povinnosť informovať používateľov a zabezpečiť transparentnosť
                </li>
                <li>
                  <strong>Článok 5(1)(e) GDPR:</strong> Princíp minimalizácie údajov a primerané doby uchovávania
                </li>
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">
              Tieto články sú najčastejšie relevantné pri hodnotení súladu s GDPR a ePrivacy smernicou v kontexte webových stránok.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* B+++++. Rizikový scoring */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle>B+++++. Rizikový scoring</CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            // Calculate risk scores (0-5)
            const httpsScore = data.detailedAnalysis.https.status === 'ok' ? 0 : 
                              data.detailedAnalysis.https.status === 'warning' ? 3 : 5;
            
            const cmpScore = !data.detailedAnalysis.consentManagement.hasConsentTool ? 5 :
                            data.detailedAnalysis.consentManagement.trackersBeforeConsent > 0 ? 4 : 1;
            
            const cookiesScore = data.detailedAnalysis.cookies.details.some(c => 
              c.category.toLowerCase().includes('marketing') || c.category.toLowerCase().includes('analytics')
            ) && data.detailedAnalysis.consentManagement.trackersBeforeConsent > 0 ? 4 : 2;
            
            const storageScore = data._internal?.storage?.some(s => s.contains_personal_data && s.created_pre_consent) ? 5 : 1;
            
            const preConsentBeacons = data._internal?.beacons?.filter(b => b.pre_consent)?.length || 0;
            const trackersScore = preConsentBeacons === 0 ? 0 :
                                 preConsentBeacons <= 3 ? 3 :
                                 preConsentBeacons <= 7 ? 4 : 5;
            
            const uxScore = !data.detailedAnalysis.consentManagement.hasConsentTool ? 5 :
                           data.detailedAnalysis.consentManagement.trackersBeforeConsent > 0 ? 4 : 1;
            
            const totalScore = (httpsScore + cmpScore + cookiesScore + storageScore + trackersScore + uxScore) / 6;
            const overallRisk = totalScore <= 1.5 ? 'Low' : totalScore <= 3 ? 'Medium' : 'High';
            
            const riskAreas = [
              { area: 'HTTPS', score: httpsScore, note: data.detailedAnalysis.https.status === 'ok' ? 'Správne implementované' : 'Problémy so zabezpečením' },
              { area: 'CMP', score: cmpScore, note: cmpScore === 5 ? 'Chýba nástroj' : cmpScore === 4 ? 'Neblokuje trackery' : 'Správne funguje' },
              { area: 'Cookies', score: cookiesScore, note: cookiesScore >= 4 ? 'Marketing cookies pred súhlasom' : 'Akceptovateľné' },
              { area: 'Storage', score: storageScore, note: storageScore === 5 ? 'Osobné údaje pred súhlasom' : 'V poriadku' },
              { area: 'Trackery', score: trackersScore, note: `${preConsentBeacons} pred-súhlasových trackerov` },
              { area: 'UX lišta', score: uxScore, note: uxScore === 5 ? 'Chýba' : uxScore === 4 ? 'Nevyvážená' : 'Transparentná' }
            ];
            
            return (
              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Oblasť</th>
                        <th className="text-left p-2">Skóre (0-5)</th>
                        <th className="text-left p-2">Poznámka</th>
                      </tr>
                    </thead>
                    <tbody>
                      {riskAreas.map((area, index) => (
                        <tr key={index} className="border-b">
                          <td className="p-2 font-semibold">{area.area}</td>
                          <td className="p-2">
                            <Badge variant={area.score <= 1 ? 'secondary' : 
                                          area.score <= 3 ? 'outline' : 'destructive'}>
                              {area.score}/5
                            </Badge>
                          </td>
                          <td className="p-2 text-xs text-muted-foreground">{area.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                <div className="p-4 bg-gradient-accent rounded-lg">
                  <h4 className="font-semibold mb-2">Celkové riziko</h4>
                  <div className="flex items-center gap-3">
                    <Badge variant={overallRisk === 'Low' ? 'secondary' : 
                                   overallRisk === 'Medium' ? 'outline' : 'destructive'} 
                           className="text-lg px-3 py-1">
                      {overallRisk.toUpperCase()}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      Priemerné skóre: {totalScore.toFixed(1)}/5
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {overallRisk === 'Low' && 'Nízke riziko - väčšina oblastí je v súlade s požiadavkami.'}
                    {overallRisk === 'Medium' && 'Stredné riziko - potrebné vykonať niekoľko zlepšení.'}
                    {overallRisk === 'High' && 'Vysoké riziko - nutné okamžité riešenie identifikovaných problémov.'}
                  </p>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* C) OK vs. Rizikové */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle>C) OK vs. Rizikové</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Oblasť</th>
                  <th className="text-left p-2">Stav</th>
                  <th className="text-left p-2">Komentár</th>
                </tr>
              </thead>
              <tbody>
                {data.riskTable.map((risk, index) => (
                  <tr key={index} className="border-b">
                    <td className="p-2">{risk.area}</td>
                    <td className="p-2">{getStatusBadge(risk.status)}</td>
                    <td className="p-2 text-sm text-muted-foreground">{risk.comment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* D) Checklist odporúčaní */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle>D) Checklist odporúčaní</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {data.recommendations.map((rec, index) => (
              <div key={index} className="p-3 rounded-lg border border-border">
                <h4 className="font-semibold mb-1">{rec.title}</h4>
                <p className="text-sm text-muted-foreground">{rec.description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Consistency Check */}
      {consistencyIssues.length > 0 ? (
        <Card className="shadow-medium border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">⚠️ INCOMPLETE - Zber alebo parsing neúplný</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Detegované boli nasledujúce konzistenčné problémy:
              </p>
              <ul className="list-disc list-inside space-y-1">
                {consistencyIssues.map((issue, index) => (
                  <li key={index} className="text-sm text-destructive">{issue}</li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground mt-2">
                Verdikt zostáva <strong>NESÚLAD</strong>, ale dáta môžu byť neúplné.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-medium border-green-500/50 bg-green-50/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-green-700">
              <Shield className="h-4 w-4" />
              <span className="text-sm font-medium">
                ✓ Kontrola konzistencie: Všetky počty v tabuľkách sa zhodujú s číslami v súhrne.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Akcie */}
      <div className="flex gap-4 flex-wrap">
        <Button onClick={onGenerateEmail} variant="gradient" className="flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Vygenerovať email pre klienta
        </Button>
        <Button onClick={handleDownloadPDF} variant="outline" className="flex items-center gap-2">
          <Download className="h-4 w-4" />
          Stiahnuť PDF správu
        </Button>
        <Button onClick={handleDownloadJSON} variant="outline" className="flex items-center gap-2">
          <Download className="h-4 w-4" />
          Stiahnuť JSON export
        </Button>
      </div>
    </div>
  );
};