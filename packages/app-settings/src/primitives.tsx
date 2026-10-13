import * as React from 'react';

export function Button({ className = '', variant = 'default', size = 'sm', type = 'button', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'outline' | 'ghost'; size?: 'sm' | 'icon' }) {
  return <button type={type} className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${size === 'icon' ? 'h-8 w-8' : 'h-8 px-3'} ${variant === 'default' ? 'border border-primary bg-primary text-primary-foreground' : variant === 'outline' ? 'border border-border bg-background text-foreground' : 'border border-transparent bg-transparent text-muted-foreground'} ${className}`} {...props} />;
}
export function Input({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground disabled:opacity-50 ${className}`} {...props} />;
}
