export type FundGzEstimate = {
  code: string
  name: string
  gsz: number
  gszzl: number
  gztime: string
  dwjz?: number
  jzrq?: string
}

export type ValuationErrorCode = "offline" | "network" | "timeout" | "invalid_payload" | "invalid_template"
export type ValuationError = Error & { code: ValuationErrorCode }

export function isValuationError(error: unknown): error is ValuationError {
  return typeof error === "object" && error !== null && "code" in error
}

export function createValuationError(code: ValuationErrorCode, message: string): ValuationError {
  const err = new Error(message) as ValuationError
  err.code = code
  return err
}

export type ValuationSourceId = "eastmoney" | "custom"

export type ValuationSourceOption = {
  id: ValuationSourceId | "auto"
  name: string
}

export const valuationSourceOptions: ValuationSourceOption[] = [
  { id: "auto", name: "自动选择（前日最准）" },
  { id: "eastmoney", name: "天天基金估值" },
  { id: "custom", name: "自定义 JSONP 模板" },
]

function buildValuationUrl(sourceId: ValuationSourceId, code: string, customTemplate?: string | null): string {
  if (sourceId === "custom") {
    const template = String(customTemplate ?? "").trim()
    if (!template) {
      throw createValuationError("invalid_template", "自定义估值源模板为空")
    }
    const withCode = template.split("{code}").join(encodeURIComponent(code))
    return withCode.split("{timestamp}").join(String(Date.now()))
  }
  return `https://fundgz.1234567.com.cn/js/${encodeURIComponent(code)}.js?rt=${Date.now()}`
}

export function parseFundGzJsonp(raw: string): FundGzEstimate {
  const prefix = "jsonpgz("
  const start = raw.indexOf(prefix)
  const end = raw.lastIndexOf(")")
  if (start < 0 || end < 0 || end <= start + prefix.length) {
    throw createValuationError("invalid_payload", "无法解析基金估值返回格式")
  }

  const jsonText = raw.slice(start + prefix.length, end)
  const obj = JSON.parse(jsonText) as {
    fundcode?: string
    name?: string
    gsz?: string
    gszzl?: string
    gztime?: string
    dwjz?: string
    jzrq?: string
  }

  const code = obj.fundcode?.trim()
  const name = obj.name?.trim()
  const gsz = Number(obj.gsz)
  const gszzl = Number(obj.gszzl)
  const gztime = obj.gztime?.trim()
  const dwjz = Number(obj.dwjz)
  const jzrq = obj.jzrq?.trim()

  if (!code || !name || !Number.isFinite(gsz) || !Number.isFinite(gszzl) || !gztime) {
    throw createValuationError("invalid_payload", "基金估值字段缺失或格式异常")
  }

  return {
    code,
    name,
    gsz,
    gszzl,
    gztime,
    dwjz: Number.isFinite(dwjz) ? dwjz : undefined,
    jzrq: jzrq || undefined,
  }
}

type JsonpOptions = {
  timeoutMs?: number
  sourceId?: ValuationSourceId
  customTemplate?: string | null
}

export function fetchFundGzEstimate(code: string, options: JsonpOptions = {}): Promise<FundGzEstimate> {
  const normalized = code.trim()
  if (!normalized) return Promise.reject(createValuationError("invalid_payload", "基金标识不能为空"))
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return Promise.reject(createValuationError("offline", "网络断开"))
  }

  const timeoutMs = options.timeoutMs ?? 7000
  const sourceId = options.sourceId ?? "eastmoney"
  const url = buildValuationUrl(sourceId, normalized, options.customTemplate)

  return new Promise((resolve, reject) => {
    const globalAny = window as unknown as {
      jsonpgz?: (payload: unknown) => void
      __fundMonitorJsonpHandlers?: Record<string, Array<(payload: unknown) => void>>
      __fundMonitorJsonpInstalled?: boolean
    }
    if (!globalAny.__fundMonitorJsonpHandlers) {
      globalAny.__fundMonitorJsonpHandlers = {}
    }
    if (!globalAny.__fundMonitorJsonpInstalled) {
      const prev = globalAny.jsonpgz
      globalAny.jsonpgz = (payload: unknown) => {
        if (prev) prev(payload)
        const code = String((payload as { fundcode?: string })?.fundcode ?? "").trim()
        if (!code) return
        const handlers = globalAny.__fundMonitorJsonpHandlers?.[code]
        if (handlers && handlers.length > 0) {
          handlers.forEach((fn) => fn(payload))
        }
      }
      globalAny.__fundMonitorJsonpInstalled = true
    }

    const script = document.createElement("script")
    script.async = true
    script.src = url

    let settled = false

    const cleanup = () => {
      script.onerror = null
      script.remove()
    }

    const finalize = () => {
      const handlers = globalAny.__fundMonitorJsonpHandlers?.[normalized]
      if (!handlers) return
      const next = handlers.filter((fn) => fn !== handler)
      if (next.length === 0) {
        delete globalAny.__fundMonitorJsonpHandlers![normalized]
      } else {
        globalAny.__fundMonitorJsonpHandlers![normalized] = next
      }
    }

    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      finalize()
      cleanup()
      reject(createValuationError("timeout", "请求超时"))
    }, timeoutMs)

    const handler = (payload: unknown) => {
      if (settled) return
      try {
        const obj = payload as {
          fundcode?: string
          name?: string
          gsz?: string
          gszzl?: string
          gztime?: string
          dwjz?: string
          jzrq?: string
        }

        if (obj?.fundcode?.trim() !== normalized) return

        const parsed: FundGzEstimate = {
          code: obj.fundcode.trim(),
          name: String(obj.name ?? "").trim(),
          gsz: Number(obj.gsz),
          gszzl: Number(obj.gszzl),
          gztime: String(obj.gztime ?? "").trim(),
          dwjz: Number(obj.dwjz),
          jzrq: String(obj.jzrq ?? "").trim() || undefined,
        }

        if (!parsed.name || !Number.isFinite(parsed.gsz) || !Number.isFinite(parsed.gszzl) || !parsed.gztime) {
          throw createValuationError("invalid_payload", "基金估值字段缺失或格式异常")
        }
        if (!Number.isFinite(parsed.dwjz)) {
          parsed.dwjz = undefined
        }

        settled = true
        window.clearTimeout(timer)
        finalize()
        cleanup()
        resolve(parsed)
      } catch (e) {
        settled = true
        window.clearTimeout(timer)
        finalize()
        cleanup()
        reject(e instanceof Error ? e : createValuationError("network", "请求失败"))
      }
    }
    const list = globalAny.__fundMonitorJsonpHandlers?.[normalized] ?? []
    list.push(handler)
    globalAny.__fundMonitorJsonpHandlers![normalized] = list

    script.onerror = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      finalize()
      cleanup()
      reject(createValuationError("network", "请求失败"))
    }

    document.body.appendChild(script)
  })
}
