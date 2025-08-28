import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';

interface SimulationBadgeProps {
  className?: string;
}

export const SimulationBadge = ({ className }: SimulationBadgeProps) => {
  return (
    <Badge variant="outline" className={`text-warning border-warning/50 bg-warning/10 ${className}`}>
      <AlertTriangle className="h-3 w-3 mr-1" />
      Simulačný režim
    </Badge>
  );
};