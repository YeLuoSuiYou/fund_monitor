import { cn } from "@/lib/utils"

export type BadgeTone = "neutral" | "success" | "danger" | "info"

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: React.ReactNode; className?: string }) {
  const cls =
    tone === "success"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
      : tone === "danger"
        ? "bg-rose-500/15 text-rose-600 dark:text-rose-300"
        : tone === "info"
          ? "bg-blue-500/15 text-blue-600 dark:text-blue-300"
          : "bg-zinc-500/15 text-zinc-700 dark:text-zinc-200"

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        cls,
        className
      )}
    >
      {children}
    </span>
  )
}

