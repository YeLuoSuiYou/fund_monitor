export function formatDateTime(input: number | Date): string {
  const d = typeof input === "number" ? new Date(input) : input
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mi = String(d.getMinutes()).padStart(2, "0")
  const ss = String(d.getSeconds()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
}

export function formatDate(input: number | Date): string {
  const d = typeof input === "number" ? new Date(input) : input
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

export function formatTime(input: number | Date): string {
  const d = typeof input === "number" ? new Date(input) : input
  const hh = String(d.getHours()).padStart(2, "0")
  const mi = String(d.getMinutes()).padStart(2, "0")
  const ss = String(d.getSeconds()).padStart(2, "0")
  return `${hh}:${mi}:${ss}`
}

export function isTradingTime(dateInput: number | Date = new Date()): boolean {
  const d = typeof dateInput === "number" ? new Date(dateInput) : dateInput
  const day = d.getDay()
  if (day === 0 || day === 6) return false // 周末

  const hh = d.getHours()
  const mm = d.getMinutes()
  const totalMin = hh * 60 + mm

  // 9:15 - 11:30 (包含集合竞价)
  if (totalMin >= 9 * 60 + 15 && totalMin <= 11 * 60 + 30) return true
  // 13:00 - 15:00
  if (totalMin >= 13 * 60 && totalMin <= 15 * 60) return true

  return false
}

export function isMiddayBreak(dateInput: number | Date = new Date()): boolean {
  const d = typeof dateInput === "number" ? new Date(dateInput) : dateInput
  const day = d.getDay()
  if (day === 0 || day === 6) return false

  const hh = d.getHours()
  const mm = d.getMinutes()
  const totalMin = hh * 60 + mm

  return totalMin > 11 * 60 + 30 && totalMin < 13 * 60
}

