export type HoldingItem = {
  symbol: string
  weight: number
  name?: string
  industry?: string
}

function toWeight(raw: string): number | null {
  const cleaned = raw.replace("%", "").trim()
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value <= 0) return null
  if (value > 1) return value / 100
  return value
}

export function parseHoldingsText(text: string): HoldingItem[] {
  const lines = String(text ?? "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const items: HoldingItem[] = []
  for (const line of lines) {
    const normalized = line.replace(/[，,;；]+/g, " ").trim()
    let code = ""
    let weightRaw = ""
    if (normalized.includes(":")) {
      const parts = normalized.split(":")
      code = parts[0]?.trim() ?? ""
      weightRaw = parts[1]?.trim() ?? ""
    } else {
      const parts = normalized.split(/\s+/)
      code = parts[0]?.trim() ?? ""
      weightRaw = parts[1]?.trim() ?? ""
    }
    if (!code || !weightRaw) continue
    const weight = toWeight(weightRaw)
    if (weight === null) continue
    items.push({ symbol: code, weight })
  }
  return items
}
