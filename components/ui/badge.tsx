import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition",
  {
    variants: {
      variant: {
        default: "border-transparent bg-indigo-600 text-white",
        secondary: "border-teal-200 bg-teal-50 text-teal-800",
        outline: "border-indigo-200 bg-indigo-50 text-indigo-700",
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  }
);

type BadgeProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
