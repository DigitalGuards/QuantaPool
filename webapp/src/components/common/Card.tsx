import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  className?: string;
  accent?: 'orange' | 'cyan' | 'none';
}

export function Card({ children, title, subtitle, className = '', accent = 'none' }: CardProps) {
  const accentStyles = {
    orange: 'border-l-4 border-l-qrl-orange',
    cyan: 'border-l-4 border-l-qrl-cyan',
    none: '',
  };

  return (
    <div className={`bg-qrl-card backdrop-blur-sm border border-qrl-border rounded-xl p-5 ${accentStyles[accent]} ${className}`}>
      {title && (
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-sm text-qrl-muted mt-1">{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  );
}
