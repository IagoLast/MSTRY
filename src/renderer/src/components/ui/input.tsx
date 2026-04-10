import * as React from 'react'

import { cn } from '../../lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-10 w-full min-w-0 rounded-xl border bg-overlay px-3 py-2 text-sm text-foreground shadow-[inset_0_1px_0_var(--inset-glow)] outline-none transition-colors placeholder:text-muted focus-visible:border-foreground/20 focus-visible:bg-overlay-hover disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className
      )}
      {...props}
    />
  )
}

export { Input }
