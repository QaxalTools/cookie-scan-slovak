import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, Clock, AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";

interface ProgressStep {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'current' | 'completed' | 'error';
}

interface AnalysisProgressProps {
  steps: ProgressStep[];
  currentStepIndex: number;
  isVisible: boolean;
}

export const AnalysisProgress = ({ steps, currentStepIndex, isVisible }: AnalysisProgressProps) => {
  const [progressValue, setProgressValue] = useState(0);

  useEffect(() => {
    if (isVisible) {
      const progress = Math.round((currentStepIndex / steps.length) * 100);
      setProgressValue(progress);
    }
  }, [currentStepIndex, steps.length, isVisible]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <CardTitle className="text-center">Analýza prebieha</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Postup</span>
              <span>{progressValue}%</span>
            </div>
            <Progress value={progressValue} className="w-full" />
          </div>
          
          <div className="space-y-3">
            {steps.map((step, index) => {
              const isCurrent = index === currentStepIndex;
              const isCompleted = index < currentStepIndex;
              const isPending = index > currentStepIndex;
              
              return (
                <div key={step.id} className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    {isCompleted && (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    )}
                    {isCurrent && (
                      <Clock className="h-5 w-5 text-blue-500 animate-pulse" />
                    )}
                    {isPending && (
                      <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${
                      isCurrent ? 'text-blue-600 dark:text-blue-400' : 
                      isCompleted ? 'text-green-600 dark:text-green-400' :
                      'text-muted-foreground'
                    }`}>
                      {step.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {step.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export const DEFAULT_AUDIT_STEPS: ProgressStep[] = [
  {
    id: 'initialize',
    title: 'Spúšťam analýzu',
    description: 'Inicializujem paralelné analýzy pre oba scenáre',
    status: 'pending'
  },
  {
    id: 'accept_path',
    title: 'Accept analýza',
    description: 'Analyzujem správanie pri prijatí súhlasu',
    status: 'pending'
  },
  {
    id: 'reject_path',
    title: 'Reject analýza', 
    description: 'Analyzujem správanie pri odmietnutí súhlasu',
    status: 'pending'
  },
  {
    id: 'merge_results',
    title: 'Spájam výsledky',
    description: 'Kombinujem dáta z oboch analýz',
    status: 'pending'
  },
  {
    id: 'data_processing',
    title: 'Spracovávam dáta',
    description: 'Analyzujem compliance vzory a porušenia',
    status: 'pending'
  },
  {
    id: 'report_generation',
    title: 'Generujem report',
    description: 'Zostavujem finálny compliance report',
    status: 'pending'
  }
];