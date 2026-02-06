import { cn } from "@/lib/utils"

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger"
export type ButtonSize = "sm" | "md"

export function Button({
  variant = "secondary",
  size = "md",
  disabled,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"

  const sizeCls = size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm"

  const variantCls =
    variant === "primary"
      ? "bg-blue-600 text-white hover:bg-blue-700"
      : variant === "danger"
        ? "bg-rose-600 text-white hover:bg-rose-700"
        : variant === "ghost"
          ? "bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800"
          : "border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"

  return (
    <button
      disabled={disabled}
      className={cn(base, sizeCls, variantCls, className)}
      {...props}
    />
  )
}

