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

export async function fetchFundHoldings(baseUrl: string, code: string) {
  const endpoint = baseUrl.replace(/\/+$/, "")
  const url = `${endpoint}/holdings?code=${encodeURIComponent(code)}`
  const res = await fetch(url)
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
  const res = await fetch(url)
  if (!res.ok) {
    throw createValuationError("network", "历史净值请求失败")
  }
  const data = (await res.json()) as FundHistoryResponse
  return data
}

export async function fetchSinaProxy(baseUrl: string, list: string) {
  const endpoint = baseUrl.replace(/\/+$/, "")
  const url = `${endpoint}/proxy/sina?list=${encodeURIComponent(list)}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error("Sina proxy failed")
  }
  const data = await res.json()
  return data.data as string
}

export async function fetchIntradayValuation(baseUrl: string, code: string) {
  const endpoint = baseUrl.replace(/\/+$/, "")
  const url = `${endpoint}/intraday_valuation?code=${encodeURIComponent(code)}`
  const res = await fetch(url)
  if (!res.ok) return []
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
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, time, value, source }),
  }).catch((err) => console.error("Record intraday failed:", err))
}
