import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide transition-colors',
  {
    variants: {
      variant: {
        default: 'border-white/10 bg-white/[0.06] text-zinc-200',
        secondary: 'border-white/8 bg-white/[0.04] text-zinc-400',
        accent: 'border-sky-400/15 bg-sky-400/10 text-sky-100',
        success: 'border-emerald-400/15 bg-emerald-400/10 text-emerald-100'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
