import { useState } from 'react';
import { AuditForm } from '@/components/AuditForm';
import { AuditResults } from '@/components/AuditResults';
import { EmailDraft } from '@/components/EmailDraft';
import { AnalysisProgress, DEFAULT_AUDIT_STEPS } from '@/components/AnalysisProgress';
import { simulateAudit, generateEmailDraft } from '@/utils/auditSimulator';
import { AuditData } from '@/types/audit';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { autoCaptureConsent } from '@/utils/consentService';
import { analyzeConsentScreenshot } from '@/utils/consentOcr';

const Index = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [auditData, setAuditData] = useState<AuditData | null>(null);
  const [showEmailDraft, setShowEmailDraft] = useState(false);
  const [clientEmail, setClientEmail] = useState('');
  const [showProgress, setShowProgress] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const { toast } = useToast();

  const handleAuditSubmit = async (input: string, email: string, isHtml: boolean) => {
    setIsLoading(true);
    setShowProgress(true);
    setCurrentStep(0);
    setClientEmail(email);
    
    try {
      let auditInput = input;
      let isLiveMode = false;
      let finalUrl = input;

      // For URL inputs, try to fetch real HTML using Edge Function
      if (!isHtml) {
        try {
          const { data, error } = await supabase.functions.invoke('fetch-html', {
            body: { url: input },
          });

          if (error) {
            throw error;
          }

          if (data?.success && data?.html) {
            // Inject base tag to ensure correct domain identification
            const baseTag = `<base href="${data.finalUrl || input}">`;
            auditInput = data.html.replace('<head>', `<head>${baseTag}`);
            isHtml = true;
            isLiveMode = true;
            finalUrl = data.finalUrl || input;
            
            toast({
              title: "Live analýza spustená",
              description: "Načítavame reálne dáta z webstránky...",
            });
          } else {
            throw new Error(data?.error || 'Failed to fetch HTML');
          }
        } catch (fetchError) {
          console.log('Live fetch failed, falling back to simulation:', fetchError);
          toast({
            title: "Prechod na simuláciu",
            description: "Nebolo možné načítať reálne dáta. Používame simuláciu.",
            variant: "default",
          });
        }
      }

      const minDuration = isHtml ? 2000 : 4000;
      
      // Run main audit simulation
      const data = await simulateAudit(
        auditInput, 
        isHtml, 
        (stepIndex) => setCurrentStep(stepIndex),
        minDuration
      );
      
      // Update audit data with live mode information
      if (isLiveMode) {
        data.url = input; // Original URL
        data.finalUrl = finalUrl;
        data.hasRedirect = finalUrl !== input;
        data.managementSummary.data_source = "Live analýza (server fetch)";
      }
      
      // Automatic banner capture for live mode
      if (isLiveMode) {
        // Move to banner capture step
        const bannerCaptureStepIndex = DEFAULT_AUDIT_STEPS.findIndex(step => step.id === 'banner_capture');
        setCurrentStep(bannerCaptureStepIndex);
        
        try {
          const captureResult = await autoCaptureConsent(input);
          
          if (captureResult.success && captureResult.screenshot) {
            // Perform OCR analysis
            const ocrResult = await analyzeConsentScreenshot(captureResult.screenshot);
            
            // Add consent UX data to audit results
            data.consentUx = {
              screenshot: captureResult.screenshot,
              used: 'edge',
              confidence: ocrResult.confidence,
              text: ocrResult.text,
              analysis: {
                bannerPresent: ocrResult.analysis?.hasConsentBanner || false,
                acceptButtonFound: (ocrResult.analysis?.buttons.accept?.length || 0) > 0,
                rejectButtonFound: (ocrResult.analysis?.buttons.reject?.length || 0) > 0,
                settingsButtonFound: (ocrResult.analysis?.buttons.settings?.length || 0) > 0,
                uxAssessment: {
                  balance: ocrResult.analysis?.evaluation.hasBalancedButtons ? 'Vyvážené' : 'Nevyvážené',
                  clarity: ocrResult.analysis?.evaluation.hasDetailedSettings ? 'Jasné' : 'Nejasné',
                  overallScore: ocrResult.analysis?.evaluation.uxAssessment === 'transparent' ? 'Transparentné' : 
                               ocrResult.analysis?.evaluation.uxAssessment === 'unbalanced' ? 'Nevyvážené' : 'Chýba'
                }
              }
            };
            
            toast({
              title: "Banner zachytený automaticky",
              description: "Cookie banner bol automaticky zachytený a analyzovaný.",
            });
          } else {
            console.log('Automatic banner capture failed:', captureResult.error);
            toast({
              title: "Banner sa nepodarilo zachytiť",
              description: "Automatické zachytenie banneru zlyhalo. Môžete to skúsiť manuálne.",
              variant: "default",
            });
          }
        } catch (error) {
          console.error('Banner capture error:', error);
          // Don't show error toast for automatic capture failure
        }
      }
      
      // Skip to verdict step
      const verdictStepIndex = DEFAULT_AUDIT_STEPS.findIndex(step => step.id === 'verdict');
      setCurrentStep(verdictStepIndex);
      
      setTimeout(() => {
        setAuditData(data);
        setShowProgress(false);
        toast({
          title: "Audit dokončený",
          description: isLiveMode ? "Live analýza dokončená." : "Simulácia dokončená.",
        });
        setIsLoading(false);
      }, 1000);
      
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

      </div>
    </div>
  );
};

export default Index;
