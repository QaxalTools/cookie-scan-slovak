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
              <table>
                <tr><th>Názov</th><th>Typ</th><th>Kategória</th><th>Expirácia</th><th>Stav</th></tr>
                ${data.detailedAnalysis.cookies.details.map(cookie =>
                  `<tr><td>${cookie.name}</td><td>${cookie.type === 'first-party' ? '1P' : '3P'}</td><td>${cookie.category}</td><td>${cookie.expiration}</td><td class="status-${cookie.status}">${cookie.status.toUpperCase()}</td></tr>`
                ).join('')}
              </table>
              
              <h3>5. LocalStorage/SessionStorage</h3>
              ${data._internal?.storage && data._internal.storage.length > 0 ? `
              <table>
                <tr><th>Kľúč</th><th>Scope</th><th>Vzorová hodnota</th><th>Osobné údaje</th></tr>
                ${data._internal.storage.map(item => `
                  <tr><td style="font-family: monospace;">${item.key}</td><td>${item.scope}</td><td style="font-family: monospace; font-size: 12px;">${item.sample_value.length > 50 ? item.sample_value.substring(0, 50) + '...' : item.sample_value}</td><td class="status-${item.contains_personal_data ? 'error' : 'ok'}">${item.contains_personal_data ? 'Áno' : 'Nie'}</td></tr>
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
              
              <h3>7. Právne zhrnutie</h3>
              <p>${data.detailedAnalysis.legalSummary}</p>
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
            <h3 className="font-semibold mb-2">4. Cookies ({data.detailedAnalysis.cookies.total})</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Názov</th>
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
                      <th className="text-left p-2">Poznámka</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.detailedAnalysis.storage.map((storage, index) => (
                      <tr key={index} className="border-b">
                        <td className="p-2 font-mono text-xs">{storage.key}</td>
                        <td className="p-2 font-mono text-xs bg-muted/50 rounded px-1">{storage.valuePattern}</td>
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

      {/* Akcie */}
      <div className="flex gap-4">
        <Button onClick={onGenerateEmail} variant="gradient" className="flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Vygenerovať email pre klienta
        </Button>
        <Button onClick={handleDownloadPDF} variant="outline" className="flex items-center gap-2">
          <Download className="h-4 w-4" />
          Stiahnuť PDF správu
        </Button>
      </div>
    </div>
  );
};