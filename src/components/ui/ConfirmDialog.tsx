import { Button } from "@/components/ui/Button"
import { Card } from "@/components/ui/Card"

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <Card className="w-full max-w-md p-4">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</div>
        {description ? <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmText}
          </Button>
        </div>
      </Card>
    </div>
  )
}

