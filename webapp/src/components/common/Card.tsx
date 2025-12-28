import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  title?: string;
  className?: string;
}

export function Card({ children, title, className = '' }: CardProps) {
  return (
    <div className={`bg-qrl-dark border border-gray-700 rounded-lg p-4 ${className}`}>
      {title && (
        <h3 className="text-lg font-semibold text-gray-200 mb-3">{title}</h3>
      )}
      {children}
    </div>
  );
}
