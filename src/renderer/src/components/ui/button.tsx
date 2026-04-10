import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all outline-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-4 shrink-0 [&_svg]:shrink-0 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0',
  {
    variants: {
      variant: {
        default:
          'border bg-foreground/90 text-background hover:bg-foreground',
        secondary:
          'border bg-overlay text-secondary hover:bg-overlay-hover',
        ghost: 'text-secondary hover:bg-overlay-hover hover:text-foreground',
        outline:
          'border bg-overlay text-secondary shadow-[inset_0_1px_0_var(--inset-glow)] hover:bg-overlay-hover',
        destructive:
          'border border-red-500/20 bg-red-500/10 text-error hover:bg-red-500/16 hover:text-foreground'
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-lg px-3 text-xs',
        lg: 'h-11 rounded-xl px-5',
        icon: 'size-9 rounded-xl'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
