import type { ButtonHTMLAttributes } from 'react'
export function Button({ variant = 'default', size: _size, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'outline' | 'ghost'; size?: 'sm' }) {
  return <button type="button" className={`moss-button is-${variant} ${className}`} {...props} />
}
