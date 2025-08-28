import { useState } from 'react';
import { AuditForm } from '@/components/AuditForm';
import { AuditResults } from '@/components/AuditResults';
import { EmailDraft } from '@/components/EmailDraft';
import { AnalysisProgress, DEFAULT_AUDIT_STEPS } from '@/components/AnalysisProgress';
import { performLiveAudit, generateEmailDraft } from '@/utils/auditSimulator';
import { AuditData } from '@/types/audit';
import { useToast } from '@/hooks/use-toast';

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
      const minDuration = isHtml ? 3000 : 8000; // HTML is faster, live URL analysis takes longer
      
      const data = await performLiveAudit(
        input, 
        isHtml, 
        (stepIndex) => setCurrentStep(stepIndex),
        minDuration
      );
      
      setAuditData(data);
      setShowProgress(false);
      
      toast({
        title: "Audit dokončený",
        description: "Analýza webovej stránky bola úspešne dokončená",
      });
    } catch (error) {
      setShowProgress(false);
      toast({
        title: "Chyba",
        description: "Nepodarilo sa vykonať audit webovej stránky",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
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
            Profesionálny live nástroj na audit súladu s GDPR a ePrivacy direktívou. 
            Analyzuje cookies, trackery a consent management priamo na vašej webovej stránke.
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
