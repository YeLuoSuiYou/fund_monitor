import { cn } from "@/lib/utils"

export function Switch({
  checked,
  onCheckedChange,
  disabled,
}: {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      aria-pressed={checked}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full border transition disabled:opacity-50 disabled:cursor-not-allowed",
        checked
          ? "border-blue-500 bg-blue-600"
          : "border-zinc-300 bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  )
}

