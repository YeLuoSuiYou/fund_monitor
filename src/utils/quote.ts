import { createValuationError } from "@/utils/fundGz"

export type QuoteSourceId = "sina" | "custom"

export type QuoteSourceOption = {
  id: QuoteSourceId
  name: string
}

export const quoteSourceOptions: QuoteSourceOption[] = [
  { id: "sina", name: "新浪行情" },
  { id: "custom", name: "自定义模板" },
]

export type StockQuote = {
  symbol: string
  name: string
  price: number
  prevClose: number
  time: string
}

export function normalizeQuoteSymbol(input: string): string | null {
  const raw = String(input ?? "").trim().toLowerCase()
  if (!raw) return null
  if (/^(sh|sz|bj)\d{6}$/.test(raw)) return raw
  if (/^\d{6}$/.test(raw)) {
    if (raw.startsWith("6")) return `sh${raw}`
    if (raw.startsWith("0") || raw.startsWith("3")) return `sz${raw}`
    if (raw.startsWith("8") || raw.startsWith("4")) return `bj${raw}`
  }
  return null
}

function getTodayString(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function parseSinaQuote(symbol: string, raw: string): StockQuote | null {
  const text = String(raw ?? "")
  if (!text) return null
  const parts = text.split(",")
  if (parts.length < 5) return null
  const name = parts[0]?.trim() ?? symbol
  const prevClose = Number(parts[2])
  const price = Number(parts[3])
  const date = parts[30]?.trim()
  const time = parts[31]?.trim()
  if (!Number.isFinite(prevClose) || !Number.isFinite(price)) return null
  if (!date || date !== getTodayString()) return null
  const ts = time ? `${date} ${time}` : date
  return { symbol, name, price, prevClose, time: ts }
}

type QuoteOptions = {
  timeoutMs?: number
  sourceId?: QuoteSourceId
  customTemplate?: string | null
  proxyBaseUrl?: string // 新增：后端代理地址
}

export async function fetchStockQuotes(symbols: string[], options: QuoteOptions = {}): Promise<Record<string, StockQuote>> {
  const sourceId = options.sourceId ?? "sina"
  const timeoutMs = options.timeoutMs ?? 7000
  const proxyBaseUrl = options.proxyBaseUrl?.replace(/\/$/, "") ?? ""
  
  const list = Array.from(
    new Set(
      symbols
        .map((s) => normalizeQuoteSymbol(s))
        .filter((s): s is string => Boolean(s)),
    ),
  )
  if (list.length === 0) return {}
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw createValuationError("offline", "网络断开")
  }

  // 如果是新浪源且有代理地址，走后端代理（解决 Referer/CORS 限制）
  if (sourceId === "sina" && proxyBaseUrl) {
    let id: number | undefined
    try {
      const url = `${proxyBaseUrl}/proxy/sina?list=${encodeURIComponent(list.join(","))}`
      const controller = new AbortController()
      id = window.setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { data } = await res.json()
      
      const result: Record<string, StockQuote> = {}
      const lines = String(data ?? "").split(";")
      for (const line of lines) {
        const match = line.match(/var hq_str_(sh|sz|bj)(\d{6})="(.*)"/)
        if (match) {
          const symbol = match[1] + match[2]
          const raw = match[3]
          const parsed = parseSinaQuote(symbol, raw)
          if (parsed) result[symbol] = parsed
        }
      }
      return result
    } catch (e) {
      console.error("[Quote] Proxy fetch failed, falling back to JSONP:", e)
      // 失败后回退到原有的 JSONP 逻辑
    } finally {
      if (id !== undefined) window.clearTimeout(id)
    }
  }

  let url = ""
  if (sourceId === "custom") {
    const template = String(options.customTemplate ?? "").trim()
    if (!template) throw createValuationError("invalid_template", "行情源模板为空")
    url = template
      .split("{symbols}")
      .join(list.join(","))
      .split("{timestamp}")
      .join(String(Date.now()))
  } else {
    url = `https://hq.sinajs.cn/list=${list.join(",")}`
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.async = true
    script.src = url
    script.charset = "gb2312"

    let settled = false
    const cleanup = () => {
      script.onerror = null
      script.onload = null
      script.remove()
    }

    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(createValuationError("timeout", "请求超时"))
    }, timeoutMs)

    script.onload = () => {
      if (settled) return
      const result: Record<string, StockQuote> = {}
      for (const symbol of list) {
        const key = `hq_str_${symbol}`
        const raw = (window as unknown as Record<string, unknown>)[key]
        if (typeof raw === "string") {
          const parsed = parseSinaQuote(symbol, raw)
          if (parsed) result[symbol] = parsed
        }
      }
      settled = true
      window.clearTimeout(timer)
      cleanup()
      resolve(result)
    }

    script.onerror = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      cleanup()
      reject(createValuationError("network", "请求失败"))
    }

    document.body.appendChild(script)
  })
}
