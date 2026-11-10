import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-500",
  {
    variants: {
      variant: {
        default: "bg-emerald-300 text-neutral-950 hover:bg-emerald-200",
        outline:
          "border border-neutral-700 bg-transparent text-neutral-100 hover:bg-neutral-800",
        destructive: "bg-red-950 text-red-200 hover:bg-red-900",
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
