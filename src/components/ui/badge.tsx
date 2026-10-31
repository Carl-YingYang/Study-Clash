import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border-2 border-ink px-2 py-0.5 text-xs font-bold uppercase tracking-wide w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-lav text-ink [a&]:hover:bg-lav/90",
        destructive:
          "bg-coral text-ink [a&]:hover:bg-coral/90",
        mint:
          "bg-mint text-ink [a&]:hover:bg-mint/90",
        ink:
          "bg-ink text-paper [a&]:hover:bg-ink/90",
        outline:
          "bg-card text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
