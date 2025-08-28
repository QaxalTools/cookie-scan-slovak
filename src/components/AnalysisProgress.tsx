import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Circle, Loader2 } from 'lucide-react';

export interface ProgressStep {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'current' | 'completed';
}

interface AnalysisProgressProps {
  steps: ProgressStep[];
  currentStepIndex: number;
  isVisible: boolean;
}

export const AnalysisProgress = ({ steps, currentStepIndex, isVisible }: AnalysisProgressProps) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (isVisible && currentStepIndex >= 0) {
      const progressValue = ((currentStepIndex + 1) / steps.length) * 100;
      setProgress(progressValue);
    }
  }, [currentStepIndex, steps.length, isVisible]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="p-6">
          <div className="text-center mb-6">
            <h2 className="text-xl font-semibold mb-2">Analyzujem webovú stránku</h2>
            <p className="text-muted-foreground text-sm">
              Vykonávam kompletnú analýzu GDPR súladu...
            </p>
          </div>

          <Progress value={progress} className="mb-6" />

          <div className="space-y-3">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-start gap-3">
                <div className="mt-0.5">
                  {index < currentStepIndex ? (
                    <CheckCircle className="h-5 w-5 text-success" />
                  ) : index === currentStepIndex ? (
                    <Loader2 className="h-5 w-5 text-primary animate-spin" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1">
                  <p className={`text-sm font-medium ${
                    index <= currentStepIndex ? 'text-foreground' : 'text-muted-foreground'
                  }`}>
                    {step.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export const DEFAULT_AUDIT_STEPS: ProgressStep[] = [
  {
    id: 'fetch',
    title: 'Načítavam stránku',
    description: 'Sťahujem HTML obsah a analyzujem štruktúru',
    status: 'pending'
  },
  {
    id: 'https',
    title: 'Kontrola HTTPS',
    description: 'Overujem zabezpečenie SSL certifikátu',
    status: 'pending'
  },
  {
    id: 'third-parties',
    title: 'Detekcia tretích strán',
    description: 'Identifikujem externé domény a služby',
    status: 'pending'
  },
  {
    id: 'trackers',
    title: 'Analýza trackerov',
    description: 'Hľadám tracking pixely a beacony',
    status: 'pending'
  },
  {
    id: 'cookies',
    title: 'Sken cookies',
    description: 'Kategorizujem a analyzujem cookies',
    status: 'pending'
  },
  {
    id: 'storage',
    title: 'Kontrola úložiska',
    description: 'Skúmam localStorage a sessionStorage',
    status: 'pending'
  },
  {
    id: 'consent',
    title: 'Consent management',
    description: 'Overujem súhlas používateľa a CMP',
    status: 'pending'
  },
  {
    id: 'capture',
    title: 'Zachytávam cookie lištu',
    description: 'Robím screenshot pre UX analýzu',
    status: 'pending'
  },
  {
    id: 'ocr',
    title: 'OCR analýza cookie lišty',
    description: 'Analyzujem tlačidlá a UX dizajn',
    status: 'pending'
  },
  {
    id: 'verdict',
    title: 'Generujem výsledok',
    description: 'Vyhodnocujem súlad a vytváram report',
    status: 'pending'
  }
];