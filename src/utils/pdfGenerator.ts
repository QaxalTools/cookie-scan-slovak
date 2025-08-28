import { jsPDF } from 'jspdf';
import { AuditData } from '@/types/audit';

// Add Unicode font support for Slovak diacritics
import 'jspdf/dist/polyfills.es.js';

export const generatePDFReport = (data: AuditData): jsPDF => {
  const pdf = new jsPDF('p', 'mm', 'a4');
  let currentY = 30;
  const leftMargin = 20;
  const rightMargin = 190;
  const pageWidth = 210;
  const pageHeight = 297;
  const lineHeight = 6;
  
  // Add header and footer on each page
  const addHeader = () => {
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor('#666666');
    pdf.text('GDPR Cookie Audit Report', leftMargin, 15);
    pdf.text(new Date().toLocaleDateString('sk-SK'), pageWidth - leftMargin, 15, { align: 'right' });
    
    // Add line under header
    pdf.setDrawColor('#E5E5E5');
    pdf.line(leftMargin, 18, pageWidth - leftMargin, 18);
  };
  
  const addFooter = () => {
    const pageCount = pdf.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor('#666666');
      
      // Add line above footer
      pdf.setDrawColor('#E5E5E5');
      pdf.line(leftMargin, pageHeight - 20, pageWidth - leftMargin, pageHeight - 20);
      
      pdf.text(`Strana ${i} z ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
    }
  };
  
  // Add initial header
  addHeader();
  
  // Helper functions
  const addPageIfNeeded = (neededSpace: number) => {
    if (currentY + neededSpace > 260) {
      pdf.addPage();
      addHeader();
      currentY = 30;
      return true;
    }
    return false;
  };

  const addText = (text: string, fontSize: number = 11, style: 'normal' | 'bold' = 'normal', color: string = '#000000') => {
    pdf.setFontSize(fontSize);
    pdf.setFont('helvetica', style);
    pdf.setTextColor(color);
    
    // Better text wrapping with proper Slovak character handling
    const maxWidth = rightMargin - leftMargin;
    const lines = pdf.splitTextToSize(text, maxWidth);
    const neededSpace = lines.length * lineHeight + 2;
    
    addPageIfNeeded(neededSpace);
    
    lines.forEach((line: string) => {
      pdf.text(line, leftMargin, currentY);
      currentY += lineHeight;
    });
    
    currentY += 2; // Consistent spacing
  };

  const addTitle = (text: string, level: number = 1) => {
    const fontSize = level === 1 ? 16 : level === 2 ? 14 : 12;
    const spacing = level === 1 ? 8 : level === 2 ? 6 : 4;
    const color = level === 1 ? '#1e40af' : level === 2 ? '#2563eb' : '#000000';
    
    currentY += spacing;
    addPageIfNeeded(fontSize + spacing);
    
    pdf.setFontSize(fontSize);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(color);
    
    pdf.text(text, leftMargin, currentY);
    currentY += fontSize * 0.4 + spacing;
    
    // Add underline for level 1 and 2 titles
    if (level <= 2) {
      pdf.setDrawColor(color);
      pdf.setLineWidth(level === 1 ? 0.8 : 0.5);
      const textWidth = pdf.getTextWidth(text);
      pdf.line(leftMargin, currentY - spacing + 2, leftMargin + textWidth, currentY - spacing + 2);
      currentY += 2;
    }
  };

  const addTable = (headers: string[], rows: string[][], title?: string) => {
    if (title) {
      addText(title, 10, 'bold', '#374151');
      currentY += 2;
    }
    
    const colWidth = (rightMargin - leftMargin) / headers.length;
    const rowHeight = 7;
    const tableHeight = (rows.length + 1) * rowHeight + 6;
    
    addPageIfNeeded(tableHeight);
    
    // Draw table border
    pdf.setDrawColor('#D1D5DB');
    pdf.setLineWidth(0.3);
    
    // Draw headers with better styling
    pdf.setFillColor(248, 250, 252);
    pdf.rect(leftMargin, currentY - 3, rightMargin - leftMargin, rowHeight, 'FD');
    
    headers.forEach((header, i) => {
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor('#374151');
      const headerText = header.length > 25 ? header.substring(0, 22) + '...' : header;
      pdf.text(headerText, leftMargin + (i * colWidth) + 2, currentY);
      
      // Draw column separators
      if (i > 0) {
        pdf.line(leftMargin + (i * colWidth), currentY - 3, leftMargin + (i * colWidth), currentY + rowHeight - 3);
      }
    });
    currentY += rowHeight;
    
    // Draw rows with alternating colors
    rows.forEach((row, rowIndex) => {
      // Check if we need a new page for this row
      addPageIfNeeded(rowHeight + 2);
      
      const fillColor = rowIndex % 2 === 0 ? [255, 255, 255] : [249, 250, 251];
      pdf.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
      pdf.rect(leftMargin, currentY - 3, rightMargin - leftMargin, rowHeight, 'FD');
      
      row.forEach((cell, i) => {
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor('#1F2937');
        
        // Better cell text handling with proper truncation
        const maxCellWidth = colWidth - 4;
        const cellText = pdf.splitTextToSize(cell || '', maxCellWidth);
        const displayText = cellText[0] || '';
        
        pdf.text(displayText, leftMargin + (i * colWidth) + 2, currentY);
        
        // Draw column separators
        if (i > 0) {
          pdf.setDrawColor('#E5E7EB');
          pdf.line(leftMargin + (i * colWidth), currentY - 3, leftMargin + (i * colWidth), currentY + rowHeight - 3);
        }
      });
      currentY += rowHeight;
    });
    
    // Draw final border
    pdf.setDrawColor('#D1D5DB');
    pdf.rect(leftMargin, currentY - tableHeight, rightMargin - leftMargin, tableHeight, 'S');
    
    currentY += 6;
  };

  // Generate PDF content
  try {
    // Header
    addTitle('GDPR Cookie Audit Report', 1);
    addText(`Dátum: ${new Date().toLocaleDateString('sk-SK')}`);
    addText(`Analyzovaná URL: ${data.url}`);
    
    // A) Management Summary
    addTitle('A) Manažérsky sumár', 2);
    addText(`Verdikt: ${data.managementSummary.verdict}`, 12, 'bold');
    addText(`Celkové hodnotenie: ${data.managementSummary.overall}`);
    addText(`Riziká: ${data.managementSummary.risks}`);
    
    if (data.managementSummary.data_source) {
      addText(`Zdroj dát: ${data.managementSummary.data_source}`);
    }

    // B) Detailed Analysis
    addTitle('B) Detailná analýza', 2);
    
    // 1. HTTPS
    addTitle('1. HTTPS zabezpečenie', 3);
    addText(`Status: ${data.detailedAnalysis.https.status}`);
    addText(`Komentár: ${data.detailedAnalysis.https.comment}`);
    
    // 2. Third Parties
    addTitle('2. Tretie strany', 3);
    addText(`Celkový počet: ${data.detailedAnalysis.thirdParties.total}`);
    
    if (data.detailedAnalysis.thirdParties.list.length > 0) {
      const thirdPartyHeaders = ['Doména', 'Počet požiadaviek'];
      const thirdPartyRows = data.detailedAnalysis.thirdParties.list.map(party => [
        party.domain,
        party.requests.toString()
      ]);
      addTable(thirdPartyHeaders, thirdPartyRows);
    }
    
    // 3. Trackers
    addTitle('3. Trackery a web-beacony', 3);
    if (data.detailedAnalysis.trackers.length > 0) {
      const trackerHeaders = ['Služba', 'Host', 'Pred súhlasom', 'Status'];
      const trackerRows = data.detailedAnalysis.trackers.map(tracker => [
        tracker.service,
        tracker.host,
        tracker.spamsBeforeConsent ? 'ÁNO' : 'NIE',
        tracker.status
      ]);
      addTable(trackerHeaders, trackerRows);
    } else {
      addText('Žiadne trackery neboli detegované.');
    }
    
    // 4. Cookies
    addTitle('4. Cookies', 3);
    addText(`Celkový počet: ${data.detailedAnalysis.cookies.total}`);
    addText(`First-party: ${data.detailedAnalysis.cookies.firstParty}`);
    addText(`Third-party: ${data.detailedAnalysis.cookies.thirdParty}`);
    
    if (data.detailedAnalysis.cookies.details && data.detailedAnalysis.cookies.details.length > 0) {
      const cookieHeaders = ['Názov', 'Typ', 'Kategória', 'Expirácia'];
      const cookieRows = data.detailedAnalysis.cookies.details.slice(0, 20).map(cookie => [
        cookie.name,
        cookie.type,
        cookie.category,
        cookie.expiration || 'N/A'
      ]);
      addTable(cookieHeaders, cookieRows);
      
      if (data.detailedAnalysis.cookies.details.length > 20) {
        addText(`... a ďalších ${data.detailedAnalysis.cookies.details.length - 20} cookies`);
      }
    }
    
    // 5. Storage
    if (data.detailedAnalysis.storage && data.detailedAnalysis.storage.length > 0) {
      addTitle('5. Local/Session Storage', 3);
      const storageHeaders = ['Kľúč', 'Typ', 'Pred súhlasom'];
      const storageRows = data.detailedAnalysis.storage.slice(0, 15).map(item => [
        item.key,
        item.type,
        item.createdPreConsent ? 'ÁNO' : 'NIE'
      ]);
      addTable(storageHeaders, storageRows);
    }
    
    // 6. Consent Management
    addTitle('6. Consent Management', 3);
    addText(`Consent tool: ${data.detailedAnalysis.consentManagement.hasConsentTool ? 'ÁNO' : 'NIE'}`);
    addText(`Trackery pred súhlasom: ${data.detailedAnalysis.consentManagement.trackersBeforeConsent}`);
    addText(`Cookie meno: ${data.detailedAnalysis.consentManagement.consentCookieName}`);
    
    // C) Risk Table
    if (data.riskTable && data.riskTable.length > 0) {
      addTitle('C) Tabuľka rizík', 2);
      const riskHeaders = ['Oblasť', 'Status', 'Komentár'];
      const riskRows = data.riskTable.map(risk => [
        risk.area,
        risk.status,
        risk.comment
      ]);
      addTable(riskHeaders, riskRows);
    }
    
    // D) Recommendations
    if (data.recommendations && data.recommendations.length > 0) {
      addTitle('D) Odporúčania', 2);
      data.recommendations.forEach((rec, index) => {
        addText(`${index + 1}. ${rec.title}: ${rec.description}`, 11);
      });
    }
    
    // Add footer to all pages
    addFooter();
    
    return pdf;
    
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  }
};