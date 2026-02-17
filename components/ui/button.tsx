"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200",
  {
    variants: {
      variant: {
        default: "bg-indigo-600 text-white hover:bg-indigo-500",
        secondary: "border border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100",
        outline: "border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50",
        destructive: "bg-rose-600 text-white hover:bg-rose-500",
        ghost: "text-slate-700 hover:bg-slate-100/90",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-11 px-6",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
