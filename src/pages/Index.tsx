import { useState } from 'react';
import { AuditForm } from '@/components/AuditForm';
import { AuditResults } from '@/components/AuditResults';
import { EmailDraft } from '@/components/EmailDraft';
import { ConsentUploadDialog } from '@/components/ConsentUploadDialog';
import { AnalysisProgress, DEFAULT_AUDIT_STEPS } from '@/components/AnalysisProgress';
import { simulateAudit, generateEmailDraft } from '@/utils/auditSimulator';
import { autoCaptureConsent } from '@/utils/consentService';
import { analyzeConsentScreenshot } from '@/utils/consentOcr';
import { AuditData } from '@/types/audit';
import { useToast } from '@/hooks/use-toast';

const Index = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [auditData, setAuditData] = useState<AuditData | null>(null);
  const [showEmailDraft, setShowEmailDraft] = useState(false);
  const [clientEmail, setClientEmail] = useState('');
  const [showProgress, setShowProgress] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [pendingAuditData, setPendingAuditData] = useState<AuditData | null>(null);
  const { toast } = useToast();

  const handleAuditSubmit = async (input: string, email: string, isHtml: boolean) => {
    setIsLoading(true);
    setShowProgress(true);
    setCurrentStep(0);
    setClientEmail(email);
    
    try {
      const minDuration = isHtml ? 2000 : 4000;
      
      // Run main audit simulation
      const data = await simulateAudit(
        input, 
        isHtml, 
        (stepIndex) => setCurrentStep(stepIndex),
        minDuration
      );
      
      // If HTML input, skip capture/OCR steps
      if (isHtml) {
        // Skip to verdict
        const verdictStepIndex = DEFAULT_AUDIT_STEPS.findIndex(step => step.id === 'verdict');
        setCurrentStep(verdictStepIndex);
        
        setTimeout(() => {
          setAuditData(data);
          setShowProgress(false);
          toast({
            title: "Audit dokončený",
            description: "Analýza HTML kódu bola úspešne dokončená",
          });
          setIsLoading(false);
        }, 1000);
        return;
      }
      
      // For URL input, proceed with capture and OCR
      await handleCaptureAndOCR(data);
      
    } catch (error) {
      setShowProgress(false);
      setIsLoading(false);
      toast({
        title: "Chyba",
        description: "Nepodarilo sa vykonať audit webovej stránky",
        variant: "destructive",
      });
    }
  };

  const handleCaptureAndOCR = async (data: AuditData) => {
    try {
      // Step to capture
      const captureStepIndex = DEFAULT_AUDIT_STEPS.findIndex(step => step.id === 'capture');
      setCurrentStep(captureStepIndex);
      
      // Attempt auto-capture
      const captureResult = await autoCaptureConsent(data.finalUrl || data.url, {
        delay: 4000,
        viewport: { width: 1920, height: 1080 },
        locale: 'sk-SK',
      });
      
      if (captureResult.success && captureResult.screenshot) {
        // Step to OCR
        const ocrStepIndex = DEFAULT_AUDIT_STEPS.findIndex(step => step.id === 'ocr');
        setCurrentStep(ocrStepIndex);
        
        // Perform OCR analysis
        const ocrResult = await analyzeConsentScreenshot(captureResult.screenshot);
        
        // Add consent UX data to audit results
        data.consentUx = {
          screenshot: captureResult.screenshot,
          used: captureResult.used,
          ocr: ocrResult.success ? ocrResult.analysis : undefined
        };
        
        // Complete audit
        const verdictStepIndex = DEFAULT_AUDIT_STEPS.findIndex(step => step.id === 'verdict');
        setCurrentStep(verdictStepIndex);
        
        setTimeout(() => {
          setAuditData(data);
          setShowProgress(false);
          setIsLoading(false);
          toast({
            title: "Audit dokončený",
            description: `Analýza dokončená so screenshotom (${captureResult.used === 'edge' ? 'bezpečný režim' : 'klientsky režim'})`,
          });
        }, 1000);
        
      } else {
        // Capture failed - show upload dialog
        setPendingAuditData(data);
        setShowUploadDialog(true);
      }
      
    } catch (error) {
      console.error('Capture/OCR error:', error);
      // Fallback to upload dialog
      setPendingAuditData(data);
      setShowUploadDialog(true);
    }
  };

  const handleUpload = (screenshot: string, ocrAnalysis: any) => {
    if (pendingAuditData) {
      pendingAuditData.consentUx = {
        screenshot,
        used: 'client',
        ocr: ocrAnalysis
      };
      
      // Complete audit
      const verdictStepIndex = DEFAULT_AUDIT_STEPS.findIndex(step => step.id === 'verdict');
      setCurrentStep(verdictStepIndex);
      
      setTimeout(() => {
        setAuditData(pendingAuditData);
        setShowProgress(false);
        setIsLoading(false);
        setPendingAuditData(null);
        toast({
          title: "Audit dokončený",
          description: "Analýza dokončená s nahraným screenshotom",
        });
      }, 1000);
    }
  };

  const handleSkip = () => {
    if (pendingAuditData) {
      // Complete audit without consent UX
      const verdictStepIndex = DEFAULT_AUDIT_STEPS.findIndex(step => step.id === 'verdict');
      setCurrentStep(verdictStepIndex);
      
      setTimeout(() => {
        setAuditData(pendingAuditData);
        setShowProgress(false);
        setIsLoading(false);
        setPendingAuditData(null);
        toast({
          title: "Audit dokončený",
          description: "UX analýza cookie lišty bola vynechaná",
        });
      }, 1000);
    }
  };

  const handleGenerateEmail = () => {
    if (auditData) {
      setShowEmailDraft(true);
    }
  };

  const emailContent = auditData ? generateEmailDraft(auditData, clientEmail) : '';

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-12 px-4">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-6 text-primary">
            GDPR Cookie Audit Tool
          </h1>
          <p className="text-xl text-foreground/80 max-w-3xl mx-auto leading-relaxed">
            Profesionálny nástroj na audit súladu s GDPR a ePrivacy direktívou. 
            Analyzuje cookies, trackery a consent management na vašej webovej stránke.
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          {!auditData && !showEmailDraft && (
            <div className="max-w-lg mx-auto">
              <AuditForm onSubmit={handleAuditSubmit} isLoading={isLoading} />
            </div>
          )}

          {auditData && !showEmailDraft && (
            <AuditResults data={auditData} onGenerateEmail={handleGenerateEmail} />
          )}

          {showEmailDraft && (
            <EmailDraft 
              emailContent={emailContent} 
              onClose={() => setShowEmailDraft(false)} 
            />
          )}
        </div>

        <AnalysisProgress 
          steps={DEFAULT_AUDIT_STEPS}
          currentStepIndex={currentStep}
          isVisible={showProgress}
        />

        <ConsentUploadDialog
          isOpen={showUploadDialog}
          onClose={() => setShowUploadDialog(false)}
          onUpload={handleUpload}
          onSkip={handleSkip}
        />
      </div>
    </div>
  );
};

export default Index;
