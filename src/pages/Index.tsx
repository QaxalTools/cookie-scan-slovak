import { useState } from 'react';
import { AuditForm } from '@/components/AuditForm';
import { AuditResults } from '@/components/AuditResults';
import { EmailDraft } from '@/components/EmailDraft';
import { AnalysisProgress, DEFAULT_AUDIT_STEPS } from '@/components/AnalysisProgress';
import { simulateAudit, generateEmailDraft } from '@/utils/auditSimulator';
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
      const minDuration = isHtml ? 2000 : 4000;
      
      // Run main audit simulation
      const data = await simulateAudit(
        input, 
        isHtml, 
        (stepIndex) => setCurrentStep(stepIndex),
        minDuration
      );
      
      // Skip to verdict step
      const verdictStepIndex = DEFAULT_AUDIT_STEPS.findIndex(step => step.id === 'verdict');
      setCurrentStep(verdictStepIndex);
      
      setTimeout(() => {
        setAuditData(data);
        setShowProgress(false);
        toast({
          title: "Audit dokončený",
          description: isHtml ? "Analýza HTML kódu bola úspešne dokončená" : "Technická analýza bola úspešne dokončená",
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
