import { create } from "zustand"
import { fetchFundGzEstimate, isValuationError, type FundGzEstimate } from "@/utils/fundGz"
import { buildFundEstimate, type FundEstimate } from "@/utils/estimate"
import { fetchFundHoldings, recordIntradayValuation } from "@/utils/holdingsApi"
import { fetchStockQuotes, normalizeQuoteSymbol, type QuoteSourceId, type StockQuote } from "@/utils/quote"
import { isTradingTime, isMiddayBreak } from "@/utils/time"

export type LoadStatus = "idle" | "loading" | "success" | "error"

export type FundItemState = {
  status: LoadStatus
  errorMessage: string | null
  lastUpdatedAt: number | null
  lastRefreshStartedAt: number | null
  latest: FundEstimate | null
  previous: FundEstimate | null
}

export type RefreshSummary = {
  total: number
  success: number
  error: number
}

export type FundState = {
  status: LoadStatus
  errorMessage: string | null
  lastUpdatedAt: number | null
  lastRefreshStartedAt: number | null
  summary: RefreshSummary
  funds: Record<string, FundItemState>
}

export type FundActions = {
  refreshAll: (
    codes: string[],
    options?: { 
      quoteSourceId?: QuoteSourceId; 
      customQuoteTemplate?: string | null; 
      holdingsApiBaseUrl?: string;
      valuationMode?: import("./settingsStore").ValuationMode;
    },
  ) => Promise<void>
  clearData: () => void
}

export type FundStore = FundState & FundActions

function normalizeCodes(codes: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of codes) {
    const v = String(c ?? "").trim()
    if (!v) continue
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

let networkBackoffUntil = 0
const networkBackoffMs = 15000
const intradaySentCache: Record<string, string> = {}

const emptySummary: RefreshSummary = { total: 0, success: 0, error: 0 }

function getTodayString(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

async function checkBackendHealth(baseUrl: string, timeoutMs = 1500): Promise<boolean> {
  if (!baseUrl) return false
  let id: number | undefined
  try {
    const endpoint = baseUrl.replace(/\/+$/, "")
    const controller = new AbortController()
    id = window.setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(`${endpoint}/health`, { signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    if (id !== undefined) window.clearTimeout(id)
  }
}

export const useFundStore = create<FundStore>((set, get) => ({
  status: "idle",
  errorMessage: null,
  lastUpdatedAt: null,
  lastRefreshStartedAt: null,
  summary: emptySummary,
  funds: {},

  refreshAll: async (codes: string[], options = {}) => {
    const current = get()
    if (current.status === "loading") return
    const now = Date.now()
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      if (current.errorMessage !== "网络断开，已暂停刷新") {
        set(() => ({ status: "error", errorMessage: "网络断开，已暂停刷新", lastRefreshStartedAt: null }))
      }
      return
    }
    if (networkBackoffUntil > now) {
      if (current.errorMessage !== "网络异常，已暂停刷新") {
        set(() => ({ status: "error", errorMessage: "网络异常，已暂停刷新", lastRefreshStartedAt: null }))
      }
      return
    }

    const quoteSourceId = options.quoteSourceId ?? "sina"
    const customQuoteTemplate = options.customQuoteTemplate ?? null
    const holdingsApiBaseUrl = options.holdingsApiBaseUrl ?? "http://localhost:8001"
    const valuationMode = options.valuationMode ?? "smart"

    console.log(`[FundStore] Refreshing with holdings API: ${holdingsApiBaseUrl}, mode: ${valuationMode}`)
    const list = normalizeCodes(codes)
    if (list.length === 0) {
      set(() => ({ status: "idle", errorMessage: null, summary: emptySummary, lastRefreshStartedAt: null }))
      return
    }

    const backendReady = await checkBackendHealth(holdingsApiBaseUrl)
    if (!backendReady) {
      const msg = "后端服务不可用"
      set((s) => {
        const nextFunds: Record<string, FundItemState> = { ...s.funds }
        for (const code of list) {
          nextFunds[code] = {
            status: "error",
            errorMessage: msg,
            lastUpdatedAt: Date.now(),
            lastRefreshStartedAt: Date.now(),
            latest: s.funds[code]?.latest ?? null,
            previous: s.funds[code]?.previous ?? null,
          }
        }
        return {
          status: "error",
          errorMessage: msg,
          summary: { total: list.length, success: 0, error: list.length },
          funds: nextFunds,
        }
      })
      return
    }

    const startedAt = Date.now()
    set((s) => {
      const nextFunds: Record<string, FundItemState> = { ...s.funds }
      for (const code of list) {
        const prev = nextFunds[code]
        nextFunds[code] = {
          status: "loading",
          errorMessage: null,
          lastUpdatedAt: prev?.lastUpdatedAt ?? null,
          lastRefreshStartedAt: startedAt,
          latest: prev?.latest ?? null,
          previous: prev?.previous ?? null,
        }
      }
      return {
        status: "loading",
        errorMessage: null,
        lastRefreshStartedAt: startedAt,
        summary: { total: list.length, success: 0, error: 0 },
        funds: nextFunds,
      }
    })

    const parsedHoldings: Record<
      string,
      {
        holdings: { symbol: string; weight: number; name?: string }[]
        cashRatio: number
        baseNav: number | null
        holdingsDate?: string
        stale?: boolean
        cachedAt?: number
        fundName?: string
        actualZzl?: number | null
        actualDate?: string | null
        navMetrics?: import("@/utils/estimate").NavMetrics | null
      }
    > = {}
    const fundErrors: Record<string, string> = {}
    if (!holdingsApiBaseUrl.trim()) {
      set(() => ({ status: "error", errorMessage: "持仓接口未配置", lastRefreshStartedAt: null }))
      return
    }

    const holdingsResults = await Promise.allSettled(list.map((code) => fetchFundHoldings(holdingsApiBaseUrl, code)))
    holdingsResults.forEach((result, idx) => {
      const code = list[idx]
      if (result.status !== "fulfilled") {
        const reason = result.reason
        let msg = "持仓接口失败"
        if (reason instanceof Error) {
          if (/HTTP\s+404/.test(reason.message)) msg = "持仓未找到"
          else if (/HTTP\s+429/.test(reason.message)) msg = "请求过快(退避中)"
          else if (reason.message.includes("fetch")) msg = "无法连接服务"
        }
        fundErrors[code] = msg
        return
      }
      const payload = result.value
      const items =
        payload.holdings
          ?.map((item) => {
            const normalized = normalizeQuoteSymbol(item.symbol)
            if (!normalized) return null
            const rawWeight = Number(item.weight)
            if (!Number.isFinite(rawWeight) || rawWeight <= 0) return null
            const weight = rawWeight > 1 ? rawWeight / 100 : rawWeight
            return { symbol: normalized, weight, name: item.name }
          })
          .filter((item): item is { symbol: string; weight: number; name: string | undefined } => Boolean(item)) ?? []
      if (items.length === 0) {
        fundErrors[code] = "持仓为空"
        return
      }
      const rawCash = Number(payload.cashRatio ?? 0)
      const cashRatio = Number.isFinite(rawCash) ? (rawCash > 1 ? rawCash / 100 : rawCash) : 0
      const baseNav = payload.baseNav ?? null
      const cachedAt = Number(payload.cachedAt)
      parsedHoldings[code] = {
        holdings: items,
        cashRatio,
        baseNav: baseNav !== null && Number.isFinite(Number(baseNav)) ? Number(baseNav) : null,
        holdingsDate: payload.holdingsDate,
        stale: payload.stale ?? false,
        cachedAt: Number.isFinite(cachedAt) ? cachedAt : undefined,
        fundName: payload.name,
        actualZzl: payload.actualZzl,
        actualDate: payload.actualDate,
        navMetrics: payload.navMetrics ?? null,
      }
    })

    const todayStr = getTodayString()
    const officialResults = await Promise.allSettled(list.map((code) => fetchFundGzEstimate(code)))
    const officialMap: Record<string, FundGzEstimate> = {}
    officialResults.forEach((result, idx) => {
      const code = list[idx]
      if (result.status === "fulfilled") {
        officialMap[code] = result.value
      }
    })

    // 如果是智能模式，获取推荐的估值源
    const bestSources: Record<string, string> = {}
    if (valuationMode === "smart") {
      const bestSourceResults = await Promise.allSettled(
        list.map((code) =>
          fetch(`${holdingsApiBaseUrl.replace(/\/+$/, "")}/best_source?code=${code}`).then((r) => r.json()),
        ),
      )
      bestSourceResults.forEach((result, idx) => {
        const code = list[idx]
        if (result.status === "fulfilled") {
          bestSources[code] = result.value.bestSource
        }
      })
    }

    const fallbackCodes = list.filter((code) => {
      const official = officialMap[code]
      return !official || !official.gztime || !official.gztime.startsWith(todayStr)
    })

    const symbols = new Set<string>()
    for (const code of fallbackCodes) {
      const config = parsedHoldings[code]
      if (!config) continue
      for (const item of config.holdings) {
        symbols.add(item.symbol)
      }
    }

    let quotes: Record<string, StockQuote> = {}
    try {
      if (symbols.size > 0) {
        quotes = await fetchStockQuotes(Array.from(symbols), {
          sourceId: quoteSourceId,
          customTemplate: customQuoteTemplate,
          proxyBaseUrl: holdingsApiBaseUrl,
        })
      }
    } catch (e) {
      let msg = e instanceof Error ? e.message : "请求失败"
      if (isValuationError(e)) {
        if (e.code === "offline") msg = "网络断开"
        if (e.code === "network" || e.code === "timeout") msg = "网络异常"
        if (e.code === "network" || e.code === "timeout" || e.code === "offline") {
          networkBackoffUntil = Math.max(networkBackoffUntil, Date.now() + networkBackoffMs)
        }
      }
      set((s) => {
        const nextFunds: Record<string, FundItemState> = { ...s.funds }
        for (const code of list) {
          nextFunds[code] = {
            status: "error",
            errorMessage: msg,
            lastUpdatedAt: Date.now(),
            lastRefreshStartedAt: startedAt,
            latest: s.funds[code]?.latest ?? null,
            previous: s.funds[code]?.previous ?? null,
          }
        }
        return {
          status: "error",
          errorMessage: msg,
          summary: { total: list.length, success: 0, error: list.length },
          funds: nextFunds,
        }
      })
      return
    }

    const baseFunds = get().funds
    const nextFunds: Record<string, FundItemState> = { ...baseFunds }
    let success = 0
    let error = 0
    let anyErrorMessage: string | null = null
    for (const code of list) {
      const config = parsedHoldings[code]
      const err = fundErrors[code]
      const official = officialMap[code]
      const isOfficialAvailable = official && official.gztime && official.gztime.startsWith(todayStr)
      
      let useOfficial = false
      if (valuationMode === "official") {
        useOfficial = isOfficialAvailable
      } else if (valuationMode === "holdings") {
        useOfficial = false
      } else {
        // smart 模式
        const best = bestSources[code] || "eastmoney"
        if (best === "eastmoney") {
          useOfficial = isOfficialAvailable
        } else {
          useOfficial = false
        }
      }

      const previous = baseFunds[code]?.latest ?? baseFunds[code]?.previous ?? null
      if (useOfficial && official) {
        const estimate: FundEstimate = {
          code,
          name: official.name ?? config?.fundName ?? code,
          gsz: official.gsz,
          gszzl: official.gszzl,
          gztime: official.gztime,
          coverage: 1,
          cashRatio: config?.cashRatio ?? 0,
          holdingsDate: config?.holdingsDate,
          baseNav: official.dwjz ?? config?.baseNav ?? null,
          navMetrics: config?.navMetrics ?? null,
          stale: config?.stale,
          cachedAt: config?.cachedAt,
          actualZzl: config?.actualZzl ?? null,
          actualDate: config?.actualDate ?? null,
          holdings: config?.holdings ?? [],
          valuationSource: "eastmoney",
          quoteTime: official.gztime,
        }
        success += 1
        nextFunds[code] = {
          status: "success",
          errorMessage: null,
          lastUpdatedAt: Date.now(),
          lastRefreshStartedAt: startedAt,
          latest: estimate,
          previous,
        }
        // 仅在交易时间内上报日内点位，避免午间休息时的异常点
        if (estimate.gszzl !== null && isTradingTime()) {
          const now = new Date()
          const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
          const key = `${code}:${estimate.valuationSource}`
          if (intradaySentCache[key] !== timeStr) {
            intradaySentCache[key] = timeStr
            recordIntradayValuation(holdingsApiBaseUrl, code, timeStr, estimate.gszzl, estimate.valuationSource)
          }
        }
        continue
      }
      if (!config || err) {
        const msg = err ?? "持仓异常"
        if (!anyErrorMessage) anyErrorMessage = msg
        error += 1
        nextFunds[code] = {
          status: "error",
          errorMessage: msg,
          lastUpdatedAt: Date.now(),
          lastRefreshStartedAt: startedAt,
          latest: baseFunds[code]?.latest ?? null,
          previous: baseFunds[code]?.previous ?? null,
        }
        continue
      }

      const estimate = buildFundEstimate({
        code,
        name: config.fundName,
        holdings: config.holdings,
        quotes,
        cashRatio: config.cashRatio,
        baseNav: config.baseNav,
        navMetrics: config.navMetrics ?? null,
        holdingsDate: config.holdingsDate,
        stale: config.stale,
        cachedAt: config.cachedAt,
        actualZzl: config.actualZzl,
        actualDate: config.actualDate,
      })
      if (estimate.coverage <= 0) {
        const msg = "行情缺失"
        if (!anyErrorMessage) anyErrorMessage = msg
        error += 1
        nextFunds[code] = {
          status: "error",
          errorMessage: msg,
          lastUpdatedAt: Date.now(),
          lastRefreshStartedAt: startedAt,
          latest: baseFunds[code]?.latest ?? null,
          previous: baseFunds[code]?.previous ?? null,
        }
        continue
      }

      success += 1
      nextFunds[code] = {
        status: "success",
        errorMessage: null,
        lastUpdatedAt: Date.now(),
        lastRefreshStartedAt: startedAt,
        latest: estimate,
        previous,
      }

      if (estimate.gszzl !== null) {
        const now = new Date()
        const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
        const key = `${code}:${estimate.valuationSource}`
        if (intradaySentCache[key] !== timeStr) {
          intradaySentCache[key] = timeStr
          recordIntradayValuation(holdingsApiBaseUrl, code, timeStr, estimate.gszzl, estimate.valuationSource)
        }
      }
    }

    const at = Date.now()
    const finalStatus: LoadStatus = success > 0 ? "success" : "error"
    const finalError = success > 0 ? null : anyErrorMessage ?? "请求失败"
    set(() => ({
      status: finalStatus,
      errorMessage: finalError,
      lastUpdatedAt: at,
      summary: { total: list.length, success, error },
      funds: nextFunds,
    }))
  },

  clearData: () =>
    set(() => ({
      status: "idle",
      errorMessage: null,
      lastUpdatedAt: null,
      lastRefreshStartedAt: null,
      summary: emptySummary,
      funds: {},
    })),
}))
