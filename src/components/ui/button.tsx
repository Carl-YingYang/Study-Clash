import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "nb-press inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border-2 border-ink text-sm font-bold tracking-wide transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-nb hover:bg-primary/90",
        destructive:
          "bg-destructive text-ink shadow-nb hover:bg-destructive/90 focus-visible:ring-destructive/40",
        outline:
          "bg-card text-foreground shadow-nb-sm hover:bg-accent",
        secondary:
          "bg-lav text-ink shadow-nb-sm hover:bg-lav/80",
        mint:
          "bg-mint text-ink shadow-nb-sm hover:bg-mint/80",
        ink:
          "bg-ink text-paper shadow-nb hover:bg-ink/90",
        ghost:
          "border-transparent shadow-none hover:bg-accent hover:text-accent-foreground",
        link: "border-transparent shadow-none text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3",
        sm: "h-9 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-12 rounded-xl px-6 text-base has-[>svg]:px-4",
        xl: "h-14 rounded-xl px-8 text-lg has-[>svg]:px-5",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
