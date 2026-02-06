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
}

export type NavMetrics = {
  ret1m?: number | null
  ret3m?: number | null
  ret1y?: number | null
  sharpe?: number | null
  maxDrawdown?: number | null
}

export function buildFundEstimate(params: {
  code: string
  name?: string
  holdings: HoldingItem[]
  quotes: Record<string, StockQuote>
  cashRatio: number // 0-100 之间的数值
  baseNav: number | null
  navMetrics?: NavMetrics | null
  holdingsDate?: string
  stale?: boolean
  cachedAt?: number
  actualZzl?: number | null
  actualDate?: string | null
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

  /**
   * 2. 核心算法改进：全仓缩放模型
   * 
   * 现状：前十大往往只占 40%-60%，直接求和会大幅低估波动。
   * 假设：非重仓股的平均表现与重仓股一致。
   * 公式：TotalReturn = (MatchedReturnContribution / MatchedWeight) * EquityRatio
   * 其中 EquityRatio = 1 - CashRatio
   */
  const cashRatioDecimal = (params.cashRatio || 0) / 100
  const equityRatio = Math.max(0, 1 - cashRatioDecimal)
  
  let finalReturn = 0
  if (matchedWeight > 0) {
    // 先计算重仓股部分的平均涨幅，再乘以总股票仓位
    finalReturn = (matchedReturnContribution / matchedWeight) * equityRatio
  }

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
  }
}
