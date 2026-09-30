import * as React from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { Button as MossButton } from '@/components/ui/button'
import { Badge as MossBadge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { CopyButton as MossCopyButton } from '@/components/shared/copy-button'
import { cn } from '@/lib/utils'

// Keep cc-haha's Trace composition while rendering with the moss component system.
export function Button({ size = 'sm', icon, ...props }: Omit<ComponentProps<typeof MossButton>, 'size'> & {
  size?: 'xs' | 'sm' | 'base' | 'md'; icon?: ReactNode
}) {
  return <MossButton type="button" size={size === 'base' || size === 'md' ? 'default' : 'sm'} {...props}>{icon}{props.children}</MossButton>
}

export function IconButton({ icon, label, size, tone, hoverTone, bordered, className, ...props }: Omit<ComponentProps<typeof MossButton>, 'size'> & {
  icon: ReactNode; label: string; size?: string; tone?: string; hoverTone?: string; bordered?: boolean
}) {
  return <MossButton type="button" size="icon-sm" variant={bordered ? 'outline' : 'ghost'} aria-label={label} title={label}
    className={cn(size === '2xs' && 'size-5', tone === 'muted' && 'text-muted-foreground', hoverTone === 'danger' && 'hover:text-destructive', className)} {...props}>{icon}</MossButton>
}

export function Badge({ tone = 'neutral', size, pill, mono, bordered, variant, className, ...props }: Omit<ComponentProps<typeof MossBadge>, 'variant'> & {
  tone?: string; size?: string; pill?: boolean; mono?: boolean; bordered?: boolean; variant?: string
}) {
  return <MossBadge variant={variant === 'outline' || bordered ? 'outline' : 'secondary'} className={cn(
    size === 'xs' ? 'text-[10px]' : 'text-[11px]', mono && 'font-mono', pill && 'rounded-full',
    tone === 'danger' && 'text-destructive dark:text-destructive-foreground bg-destructive/10', tone === 'success' && 'text-primary',
    tone === 'warning' && 'text-foreground bg-secondary', className,
  )} {...props} />
}

export function StatusDot({ tone = 'success', pulse }: { tone?: string; size?: string; pulse?: boolean }) {
  return <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', tone === 'danger' ? 'bg-destructive' : tone === 'warning' ? 'bg-[var(--color-warning)]' : 'bg-primary', pulse && 'animate-pulse')} />
}

export function CopyButton({ copiedLabel: _copiedLabel, displayLabel, displayCopiedLabel: _displayCopiedLabel, ...props }: ComponentProps<typeof MossCopyButton> & {
  copiedLabel?: string; displayLabel?: ReactNode; displayCopiedLabel?: ReactNode
}) {
  return <MossCopyButton {...props} showLabel={displayLabel ? false : props.showLabel} />
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" aria-hidden="true" />
}

export function EmptyState({ title, description, icon, className, variant, headingLevel = 3 }: {
  title?: string; description?: string; icon?: ReactNode; className?: string; variant?: string; size?: string; headingLevel?: number
}) {
  return <div className={cn('rounded-xl p-5 text-center text-muted-foreground', variant === 'dashed' && 'border border-dashed', className)}>
    {icon && <div className="mb-2 flex justify-center">{icon}</div>}
    {title && <div role="heading" aria-level={headingLevel} className="font-medium text-foreground">{title}</div>}
    {description && <p className="mt-1 text-sm">{description}</p>}
  </div>
}

export function ErrorState({ title, detail, onRetry, retryLabel, className }: {
  title: string; detail: string; onRetry: () => void; retryLabel: string; className?: string; tone?: string
}) {
  return <div role="alert" className={cn('rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm', className)}>
    <p className="font-medium text-destructive">{title}</p><p className="mt-1 break-words">{detail}</p>
    <Button variant="outline" className="mt-3" onClick={onRetry}>{retryLabel}</Button>
  </div>
}

export function SearchField({ value, onChange, label, clearLabel, placeholder, containerClassName }: {
  value: string; onChange: (value: string) => void; label: string; clearLabel?: string; placeholder?: string; size?: string; containerClassName?: string
}) {
  return <div className={cn('relative', containerClassName)}>
    <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
    <Input value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} placeholder={placeholder} className="pl-8 pr-9" />
    {value && <IconButton className="absolute right-0.5 top-0.5" label={clearLabel || label} icon={<X className="size-3.5" />} onClick={() => onChange('')} />}
  </div>
}

export function SegmentedControl<T extends string>({ value, onChange, items, label, className }: {
  value: T; onChange: (value: T) => void; items: Array<{ value: T; label: string }>; label: string; size?: string; className?: string
}) {
  return <div role="group" aria-label={label} className={cn('flex flex-wrap gap-1 rounded-lg bg-muted p-1', className)}>
    {items.map((item) => <MossButton type="button" key={item.value} size="sm" variant={item.value === value ? 'secondary' : 'ghost'}
      aria-pressed={item.value === value} className={cn('h-7 flex-1 px-2 text-xs', item.value === value && 'bg-background shadow-sm')}
      onClick={() => onChange(item.value)}>{item.label}</MossButton>)}
  </div>
}
