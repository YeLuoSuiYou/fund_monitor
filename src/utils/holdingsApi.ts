import { createValuationError } from "@/utils/fundGz"
import type { NavMetrics } from "@/utils/estimate"

export type HoldingsApiHolding = {
  symbol: string
  name?: string
  weight: number
  industry?: string
}

export type HoldingsApiResponse = {
  code: string
  name?: string
  fundType?: string | null
  benchmarkSymbol?: string | null
  holdingsDate?: string
  cashRatio?: number
  baseNav?: number | null
  baseNavDate?: string | null
  navMetrics?: NavMetrics | null
  holdings: HoldingsApiHolding[]
  stale?: boolean
  cachedAt?: number
  actualZzl?: number | null
  actualDate?: string | null
  actualNav?: number | null
}

export type FundHistoryResponse = {
  code: string
  history: { date: string; nav: number }[]
}

export type IntradayPoint = {
  time: string
  value: number
  source?: string
}

const DEFAULT_TIMEOUT_MS = 7000

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const id = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw createValuationError("timeout", "请求超时")
    }
    throw createValuationError("network", error instanceof Error ? error.message : "网络请求失败")
  } finally {
    window.clearTimeout(id)
  }
}

export async function fetchFundHoldings(baseUrl: string, code: string) {
  const endpoint = baseUrl.replace(/\/+$/, "")
  const url = `${endpoint}/holdings?code=${encodeURIComponent(code)}`
  const res = await fetchWithTimeout(url)
  if (!res.ok) {
    throw createValuationError("network", `持仓请求失败 HTTP ${res.status}`)
  }
  const data = (await res.json()) as HoldingsApiResponse
  if (!data || !Array.isArray(data.holdings)) {
    throw createValuationError("invalid_payload", "持仓返回格式异常")
  }
  return data
}

export async function fetchFundHistory(baseUrl: string, code: string) {
  const endpoint = baseUrl.replace(/\/+$/, "")
  const url = `${endpoint}/fund_history?code=${encodeURIComponent(code)}`
  const res = await fetchWithTimeout(url)
  if (!res.ok) {
    throw createValuationError("network", "历史净值请求失败")
  }
  const data = (await res.json()) as FundHistoryResponse
  return data
}

export async function fetchSinaProxy(baseUrl: string, list: string) {
  const endpoint = baseUrl.replace(/\/+$/, "")
  const url = `${endpoint}/proxy/sina?list=${encodeURIComponent(list)}`
  const res = await fetchWithTimeout(url)
  if (!res.ok) {
    throw createValuationError("network", `Sina proxy failed HTTP ${res.status}`)
  }
  const data = await res.json()
  return data.data as string
}

export async function fetchIntradayValuation(baseUrl: string, code: string) {
  const endpoint = baseUrl.replace(/\/+$/, "")
  const url = `${endpoint}/intraday_valuation?code=${encodeURIComponent(code)}`
  const res = await fetchWithTimeout(url)
  if (!res.ok) {
    throw createValuationError("network", `日内估值请求失败 HTTP ${res.status}`)
  }
  return (await res.json()) as IntradayPoint[]
}

export async function recordIntradayValuation(
  baseUrl: string,
  code: string,
  time: string,
  value: number,
  source?: string,
) {
  const endpoint = baseUrl.replace(/\/+$/, "")
  const url = `${endpoint}/intraday_valuation`
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, time, value, source }),
      },
      5000,
    )
    if (!res.ok) {
      console.warn("Record intraday failed with status:", res.status)
    }
  } catch (err) {
    console.error("Record intraday failed:", err)
  }
}
