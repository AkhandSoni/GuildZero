import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const buttonVariants = cva(
  "gz-button inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "gz-button-primary",
        outline:
          "gz-button-outline",
        destructive: "gz-button-danger",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
function Button({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, className }))}
      {...props}
    />
  );
}
export { Button, buttonVariants };
