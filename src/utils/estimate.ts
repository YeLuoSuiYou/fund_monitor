import { formatDateTime } from "@/utils/time"
import type { HoldingItem } from "@/utils/holdings"
import type { StockQuote } from "@/utils/quote"

export type FundEstimate = {
  code: string
  name: string
  gsz: number | null
  gszzl: number | null
  gztime: string
  coverage: number
  cashRatio: number
  holdingsDate?: string
  baseNav?: number | null
  navMetrics?: NavMetrics | null
  stale?: boolean
  cachedAt?: number
  actualZzl?: number | null
  actualDate?: string | null
  holdings?: HoldingItem[]
  valuationSource?: "eastmoney" | "holdings"
  quoteTime?: string | null
  fundType?: string | null
  benchmarkSymbol?: string | null
  strategyVersion?: string
}

export type NavMetrics = {
  ret1m?: number | null
  ret3m?: number | null
  ret1y?: number | null
  sharpe?: number | null
  maxDrawdown?: number | null
}

function inferBenchmarkSymbol(name?: string, fundType?: string | null): string {
  const text = `${name ?? ""} ${fundType ?? ""}`
  if (/中证1000|1000/.test(text)) return "sh000852"
  if (/中证500|500/.test(text)) return "sh000905"
  if (/上证50|50/.test(text)) return "sh000016"
  if (/创业板/.test(text)) return "sz399006"
  if (/深证|深成/.test(text)) return "sz399001"
  return "sh000300"
}

function inferHoldingsWeight(fundType?: string | null): number {
  const text = String(fundType ?? "")
  if (/指数|ETF/.test(text)) return 0.25
  if (/混合/.test(text)) return 0.65
  return 0.8
}

function parseHoldingsDateToTs(label?: string): number | null {
  if (!label) return null
  const q = label.match(/(\d{4})年\s*([1-4])季度/)
  if (q) {
    const year = Number(q[1])
    const quarter = Number(q[2])
    const month = quarter * 3
    return new Date(year, month, 0, 23, 59, 59).getTime()
  }
  const direct = Date.parse(label.replace(/[./]/g, "-"))
  return Number.isFinite(direct) ? direct : null
}

function computeFreshnessFactor(holdingsDate?: string): number {
  const ts = parseHoldingsDateToTs(holdingsDate)
  if (!ts) return 1
  const ageDays = Math.max(0, (Date.now() - ts) / (24 * 3600 * 1000))
  if (ageDays <= 45) return 1
  return Math.max(0.65, 1 - ((ageDays - 45) / 365) * 0.35)
}

export function buildFundEstimate(params: {
  code: string
  name?: string
  holdings: HoldingItem[]
  quotes: Record<string, StockQuote>
  cashRatio: number // 0-1 之间的数值
  baseNav: number | null
  navMetrics?: NavMetrics | null
  holdingsDate?: string
  stale?: boolean
  cachedAt?: number
  actualZzl?: number | null
  actualDate?: string | null
  fundType?: string | null
  benchmarkSymbol?: string | null
  benchmarkReturn?: number | null
  strategyVersion?: string
}): FundEstimate {
  // 1. 计算已匹配到的前十大权重之和
  let matchedWeight = 0
  let matchedReturnContribution = 0
  let latestQuoteTime = ""

  for (const h of params.holdings) {
    const quote = params.quotes[h.symbol]
    if (!quote) continue
    if (!Number.isFinite(quote.prevClose) || quote.prevClose <= 0) continue
    if (quote.time && quote.time > latestQuoteTime) latestQuoteTime = quote.time
    
    const pct = (quote.price - quote.prevClose) / quote.prevClose
    matchedReturnContribution += h.weight * pct
    matchedWeight += h.weight
  }

  // cashRatio 已经在 store 中归一为 0-1
  const cashRatioDecimal = Number.isFinite(params.cashRatio) ? Math.min(1, Math.max(0, params.cashRatio)) : 0
  const equityRatio = Math.max(0, 1 - cashRatioDecimal)

  const holdingsDrivenReturn = matchedWeight > 0 ? (matchedReturnContribution / matchedWeight) * equityRatio : null
  const benchmarkSymbol = params.benchmarkSymbol ?? inferBenchmarkSymbol(params.name, params.fundType)
  const proxyStockReturn = Number.isFinite(params.benchmarkReturn as number)
    ? (params.benchmarkReturn as number)
    : (matchedWeight > 0 ? matchedReturnContribution / matchedWeight : 0)
  const proxyDrivenReturn = proxyStockReturn * equityRatio

  const freshness = computeFreshnessFactor(params.holdingsDate)
  const holdingsWeightBase = inferHoldingsWeight(params.fundType)
  const holdingsWeight = holdingsDrivenReturn === null ? 0 : holdingsWeightBase * freshness
  const proxyWeight = 1 - holdingsWeight

  let finalReturn = holdingsDrivenReturn === null
    ? proxyDrivenReturn
    : holdingsDrivenReturn * holdingsWeight + proxyDrivenReturn * proxyWeight

  const gszzl = Number.isFinite(finalReturn) ? finalReturn * 100 : null
  const gsz =
    params.baseNav && Number.isFinite(params.baseNav) ? params.baseNav * (1 + finalReturn) : null
  
  // 覆盖率：已匹配到的权重占前十大总权重的比例
  const totalTop10Weight = params.holdings.reduce((sum, h) => sum + h.weight, 0)
  const coverage = totalTop10Weight > 0 ? matchedWeight / totalTop10Weight : 0

  return {
    code: params.code,
    name: params.name ?? params.code,
    gsz,
    gszzl,
    gztime: formatDateTime(Date.now()),
    coverage,
    cashRatio: params.cashRatio,
    holdingsDate: params.holdingsDate,
    baseNav: params.baseNav,
    navMetrics: params.navMetrics ?? null,
    stale: params.stale,
    cachedAt: params.cachedAt,
    actualZzl: params.actualZzl,
    actualDate: params.actualDate,
    holdings: params.holdings,
    valuationSource: "holdings",
    quoteTime: latestQuoteTime || null,
    fundType: params.fundType ?? null,
    benchmarkSymbol,
    strategyVersion: params.strategyVersion ?? "improved_v1",
  }
}
