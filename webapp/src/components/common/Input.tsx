import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  suffix?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, suffix, hint, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-white mb-2">
            {label}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            className={`
              w-full bg-qrl-darker border rounded-xl px-4 py-3 text-white
              focus:outline-none focus:border-qrl-cyan transition-colors
              placeholder:text-qrl-muted
              ${error ? 'border-red-500' : 'border-qrl-border'}
              ${suffix ? 'pr-16' : ''}
              ${className}
            `}
            {...props}
          />
          {suffix && (
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-qrl-muted font-medium">
              {suffix}
            </span>
          )}
        </div>
        {hint && !error && <p className="text-qrl-muted text-sm mt-2">{hint}</p>}
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
