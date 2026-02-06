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

