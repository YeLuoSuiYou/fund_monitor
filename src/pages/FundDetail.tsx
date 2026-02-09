import { useEffect, useMemo, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { ArrowLeft, Loader2 } from "lucide-react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
} from "recharts"
import { Button } from "@/components/ui/Button"
import { Badge } from "@/components/ui/Badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
import { useFundStore } from "@/stores/fundStore"
import { useSettingsStore } from "@/stores/settingsStore"
import {
  fetchFundHistory,
  fetchFundHoldings,
  fetchIntradayValuation,
  type FundHistoryResponse,
  type IntradayPoint,
} from "@/utils/holdingsApi"
import { fetchStockQuotes, type QuoteSourceId, type StockQuote } from "@/utils/quote"
import { formatDate, isMiddayBreak } from "@/utils/time"
import { cn } from "@/lib/utils"

type Period = "INTRADAY" | "1M" | "3M" | "1Y" | "ALL"

export default function FundDetail() {
  const { code } = useParams<{ code: string }>()
  const holdingsApiBaseUrl = useSettingsStore((s) => s.holdingsApiBaseUrl)
  const quoteSourceId = useSettingsStore((s) => s.quoteSourceId)
  const customQuoteUrlTemplate = useSettingsStore((s) => s.customQuoteUrlTemplate)
  const fund = useFundStore((s) => s.funds[code ?? ""])
  const [history, setHistory] = useState<FundHistoryResponse["history"]>([])
  const [intraday, setIntraday] = useState<IntradayPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>("INTRADAY")
  const [holdingsQuotes, setHoldingsQuotes] = useState<Record<string, StockQuote>>({})
  const [holdingsQuoteTime, setHoldingsQuoteTime] = useState<string | null>(null)
  const [holdingsLoading, setHoldingsLoading] = useState(false)

  useEffect(() => {
    if (!code) return
    async function loadHistory() {
      try {
        setLoading(true)
        const [historyRes, intradayRes] = await Promise.all([
          fetchFundHistory(holdingsApiBaseUrl, code!),
          fetchIntradayValuation(holdingsApiBaseUrl, code!),
        ])
        setHistory(historyRes.history)
        setIntraday(intradayRes)
      } catch (e) {
        console.error("Failed to load history/intraday:", e)
      } finally {
        setLoading(false)
      }
    }
    loadHistory()
  }, [code, holdingsApiBaseUrl])

  useEffect(() => {
    const holdings = fund?.latest?.holdings ?? []
    if (!holdings.length) {
      setHoldingsQuotes({})
      setHoldingsQuoteTime(null)
      return
    }
    let active = true
    async function loadHoldingsQuotes() {
      try {
        setHoldingsLoading(true)
        const symbols = holdings.map((h) => h.symbol)
        const quotes = await fetchStockQuotes(symbols, {
          sourceId: quoteSourceId as QuoteSourceId,
          customTemplate: customQuoteUrlTemplate,
          proxyBaseUrl: holdingsApiBaseUrl,
        })
        if (!active) return
        setHoldingsQuotes(quotes)
        const times = Object.values(quotes)
          .map((q) => q.time)
          .filter((t): t is string => Boolean(t))
        setHoldingsQuoteTime(times.sort().slice(-1)[0] ?? null)
      } catch (e) {
        if (!active) return
        console.error("Failed to load holdings quotes:", e)
        setHoldingsQuotes({})
        setHoldingsQuoteTime(null)
      } finally {
        if (active) setHoldingsLoading(false)
      }
    }
    loadHoldingsQuotes()
    return () => {
      active = false
    }
  }, [fund?.latest?.holdings, holdingsApiBaseUrl, quoteSourceId, customQuoteUrlTemplate])

  const latest = fund?.latest

  const chartData = useMemo(() => {
    const baseNav = latest?.baseNav || 1
    const todayStr = new Date().toISOString().split("T")[0]
    
    // 如果没有 5min 序列数据，但有今日实时涨跌幅，构造一个点以防止图表空白
    if (period === "INTRADAY") {
      const allPoints = [...intraday]
      let points = allPoints.filter((p) => {
        // 过滤掉非交易时段的点位（如午间休市时的异常跳动）
        const [hh, mm] = p.time.split(":").map(Number)
        const totalMin = hh * 60 + mm
        const isMarketTime = (totalMin >= 9 * 60 + 15 && totalMin <= 11 * 60 + 30) || 
                            (totalMin >= 13 * 60 && totalMin <= 15 * 5)
        if (!isMarketTime) return false

        if (!latest?.valuationSource) return true
        return !p.source || p.source === latest.valuationSource
      })
      
      // 如果当前口径的点位太少（比如官方估值只有 1 个点），则尝试使用持仓口径的点位作为趋势参考
      if (points.length < 5 && latest?.valuationSource === "eastmoney") {
        const holdingsPoints = allPoints.filter(p => p.source === "holdings")
        if (holdingsPoints.length >= 5) {
          // 使用持仓点位作为底色，但我们需要平移它们，使得最后一个点对齐当前的官方估值
          const lastHoldingsVal = holdingsPoints[holdingsPoints.length - 1].value
          const offset = (latest.gszzl ?? lastHoldingsVal) - lastHoldingsVal
          points = holdingsPoints.map(p => ({
            ...p,
            value: p.value + offset,
            source: "eastmoney_fallback"
          }))
        }
      }

      if (latest?.gszzl != null && latest?.gztime?.includes(todayStr)) {
        // 提取 gztime 中的 HH:mm
        const timeMatch = latest.gztime.match(/\d{2}:\d{2}/)
        const timeStr = timeMatch ? timeMatch[0] : "15:00"
        const existed = points.some((p) => p.time === timeStr)
        if (!existed) points.push({ time: timeStr, value: latest.gszzl, source: latest.valuationSource })
        else {
          points = points.map((p) =>
            p.time === timeStr ? { ...p, value: latest.gszzl!, source: latest.valuationSource } : p,
          )
        }
      }

      if (latest?.actualZzl != null && latest?.actualDate === todayStr) {
        const hasActual = points.some(p => p.time.includes("(实)"))
        if (!hasActual) {
          points.push({ time: "15:00(实)", value: latest.actualZzl, source: "actual" })
        }
      }
      
      if (points.length === 0) return []
      
      return points.map((p) => ({
        date: p.time,
        nav: baseNav * (1 + p.value / 100),
        percentage: p.value,
      }))
    }

    if (!history.length) return []
    const now = new Date()
    let startDate = new Date(0)

    if (period === "1M") {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
    } else if (period === "3M") {
      startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())
    } else if (period === "1Y") {
      startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
    }

    const startStr = formatDate(startDate)
    const filtered = history.filter((h) => h.date >= startStr)
    if (filtered.length === 0) return []

    const firstNav = filtered[0].nav
    return filtered.map((h) => ({
      ...h,
      percentage: firstNav > 0 ? ((h.nav - firstNav) / firstNav) * 100 : 0,
    }))
  }, [history, intraday, period, latest])
  const valuationSourceText = latest?.valuationSource === "eastmoney" ? "官方估值" : "持仓推算"
  const quoteTimeText = latest?.quoteTime ?? "--"

  const industryData = useMemo(() => {
    const holdings = latest?.holdings ?? []
    const stats: Record<string, { weight: number; contribution: number; count: number }> = {}
    
    holdings.forEach(h => {
      const industry = h.industry || "其他"
      const quote = holdingsQuotes[h.symbol]
      const pct = (quote && Number.isFinite(quote.prevClose) && quote.prevClose > 0)
        ? (quote.price - quote.prevClose) / quote.prevClose
        : 0
      
      if (!stats[industry]) {
        stats[industry] = { weight: 0, contribution: 0, count: 0 }
      }
      stats[industry].weight += h.weight
      stats[industry].contribution += h.weight * pct
      stats[industry].count += 1
    })

    return Object.entries(stats)
      .map(([name, data]) => ({
        name,
        value: data.weight * 100,
        contribution: data.contribution * 100,
        avgReturn: data.weight > 0 ? (data.contribution / data.weight) * 100 : 0
      }))
      .sort((a, b) => b.value - a.value)
  }, [latest?.holdings, holdingsQuotes])

  const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"]

  const colorRule = useSettingsStore((s) => s.colorRule)
  const gszzlTone =
    latest?.gszzl == null ? "flat" : latest.gszzl > 0 ? "up" : latest.gszzl < 0 ? "down" : "flat"
  const getDeltaClass = (tone: "up" | "down" | "flat", rule: string) => {
    if (tone === "flat") return "text-zinc-500"
    if (rule === "red_up_green_down") {
      return tone === "up" ? "text-rose-500" : "text-emerald-500"
    } else {
      return tone === "up" ? "text-emerald-500" : "text-rose-500"
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <header className="flex items-center gap-4">
          <Link to="/">
            <Button variant="secondary" size="sm">
              <ArrowLeft className="h-4 w-4" />
              返回首页
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">{latest?.name || `基金（${code}）`}</h1>
            <p className="text-sm text-zinc-500">代码：{code}</p>
          </div>
        </header>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base font-medium">净值走势</CardTitle>
              <div className="flex gap-2">
                {(["INTRADAY", "1M", "3M", "1Y", "ALL"] as Period[]).map((p) => (
                  <Button
                    key={p}
                    variant={period === p ? "primary" : "secondary"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setPeriod(p)}
                  >
                    {p === "INTRADAY" ? "日内" : p === "ALL" ? "成立来" : p}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[400px] w-full mt-4">
                {loading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
                  </div>
                ) : chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="colorNav" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#88888822" />
                      <XAxis
                        dataKey="date"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: "#888888" }}
                        minTickGap={30}
                      />
                      <YAxis
                        yAxisId="left"
                        orientation="left"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: "#888888" }}
                        domain={["auto", "auto"]}
                        tickFormatter={(v) => v.toFixed(2)}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: "#888888" }}
                        domain={["auto", "auto"]}
                        tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`}
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length && payload[0].payload) {
                            const data = payload[0].payload
                            const pct = data.percentage ?? 0
                            const tone = pct > 0 ? "up" : pct < 0 ? "down" : "flat"
                            const cls = getDeltaClass(tone, colorRule)
                            const isIntraday = period === "INTRADAY"
                            return (
                              <div className="bg-zinc-900 border-none rounded-lg p-3 text-xs shadow-xl ring-1 ring-white/10">
                                <div className="text-zinc-500 mb-1">
                                  {isIntraday ? `时间：${label}` : `日期：${label}`}
                                </div>
                                <div className="flex justify-between gap-4 mb-1">
                                  <span className="text-zinc-400">
                                    {isIntraday ? "估值净值" : "单位净值"}
                                  </span>
                                  <span className="font-bold text-blue-400">{(data.nav || 0).toFixed(4)}</span>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <span className="text-zinc-400">
                                    {isIntraday ? "估值涨跌" : "累计涨跌"}
                                  </span>
                                  <span className={cn("font-bold", cls)}>
                                    {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
                                  </span>
                                </div>
                              </div>
                            )
                          }
                          return null
                        }}
                      />
                      <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="nav"
                        name="单位净值"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorNav)"
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Area
                        yAxisId="right"
                        type="monotone"
                        dataKey="percentage"
                        name="涨跌幅"
                        stroke="transparent"
                        fill="transparent"
                        dot={false}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-zinc-500">
                    暂无历史数据
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">当前状态</CardTitle>
                {isMiddayBreak() && (
                   <Badge tone="info" className="px-1.5 py-0 text-[10px]">午间休市</Badge>
                 )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-xs text-zinc-500">最新净值</div>
                  <div className="text-2xl font-bold">{latest?.baseNav?.toFixed(4) || "--"}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">盘中估值</div>
                  <div className="text-2xl font-bold">
                    {isMiddayBreak() ? "--" : (latest?.gsz?.toFixed(4) || "--")}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">估值涨跌幅</div>
                  <div className={`text-xl font-bold ${isMiddayBreak() ? "text-zinc-500" : getDeltaClass(gszzlTone, colorRule)}`}>
                    {isMiddayBreak() ? "休市中" : (latest?.gszzl != null ? `${latest.gszzl > 0 ? "+" : ""}${latest.gszzl.toFixed(2)}%` : "--")}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-zinc-500">
                  <div>估值来源：{isMiddayBreak() ? "--" : valuationSourceText}</div>
                  <div>行情时间：{isMiddayBreak() ? "--" : quoteTimeText}</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">行业分布与归因</CardTitle>
              </CardHeader>
              <CardContent>
                {industryData.length > 0 ? (
                  <div className="space-y-4">
                    <div className="h-[160px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={industryData}
                            innerRadius={40}
                            outerRadius={60}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {industryData.map((_, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip 
                            content={({ active, payload }) => {
                              if (active && payload && payload.length) {
                                const data = payload[0].payload
                                return (
                                  <div className="bg-zinc-900 border-none rounded-lg p-2 text-[10px] shadow-xl ring-1 ring-white/10">
                                    <div className="text-zinc-400">{data.name}</div>
                                    <div className="text-white font-bold">占比: {data.value.toFixed(2)}%</div>
                                    <div className={cn("font-medium", getDeltaClass(data.avgReturn > 0 ? "up" : "down", colorRule))}>
                                      平均涨跌: {data.avgReturn > 0 ? "+" : ""}{data.avgReturn.toFixed(2)}%
                                    </div>
                                  </div>
                                )
                              }
                              return null
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 text-[10px] text-zinc-400">
                        <span>行业</span>
                        <span className="text-right">权重</span>
                        <span className="text-right">贡献</span>
                      </div>
                      {industryData.map((item, index) => (
                        <div key={item.name} className="grid grid-cols-3 items-center text-xs">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                            <span className="truncate">{item.name}</span>
                          </div>
                          <div className="text-right tabular-nums">{item.value.toFixed(1)}%</div>
                          <div className={cn("text-right tabular-nums font-medium", getDeltaClass(item.contribution > 0 ? "up" : "down", colorRule))}>
                            {item.contribution > 0 ? "+" : ""}{item.contribution.toFixed(2)}%
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-zinc-400 italic py-4">暂无行业分析数据</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">资产配置</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-zinc-500">现金比例</span>
                  <span className="font-medium">{latest ? `${Math.round(latest.cashRatio * 100)}%` : "--"}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-zinc-500">行情覆盖率</span>
                  <span className="font-medium">{latest ? `${Math.round(latest.coverage * 100)}%` : "--"}</span>
                </div>
                <div className="pt-2">
                  <div className="text-xs text-zinc-500 mb-2">前十大重仓股</div>
                  <div className="space-y-2">
                    {latest?.holdingsDate && (
                      <div className="text-[10px] text-zinc-400 mb-1">报告期：{latest.holdingsDate}</div>
                    )}
                    {holdingsQuoteTime ? (
                      <div className="text-[10px] text-zinc-400 mb-1">行情时间：{holdingsQuoteTime}</div>
                    ) : null}
                    {holdingsLoading ? (
                      <div className="text-xs text-zinc-400 italic">正在获取行情...</div>
                    ) : latest?.holdings && latest.holdings.length > 0 ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-4 gap-2 text-[10px] text-zinc-400">
                          <span>股票</span>
                          <span className="text-right">权重</span>
                          <span className="text-right">涨跌幅</span>
                          <span className="text-right">最新价</span>
                        </div>
                        {latest.holdings.map((h) => {
                          const quote = holdingsQuotes[h.symbol]
                          const pct =
                            quote && Number.isFinite(quote.prevClose) && quote.prevClose > 0
                              ? ((quote.price - quote.prevClose) / quote.prevClose) * 100
                              : null
                          const tone = pct === null ? "flat" : pct > 0 ? "up" : pct < 0 ? "down" : "flat"
                          const cls = getDeltaClass(tone, colorRule)
                          return (
                            <div key={h.symbol} className="grid grid-cols-4 gap-2 text-xs">
                              <div className="min-w-0">
                                <div className="truncate">{h.name || h.symbol}</div>
                                <div className="text-[10px] text-zinc-400">{h.symbol}</div>
                              </div>
                              <div className="text-right tabular-nums">{(h.weight * 100).toFixed(2)}%</div>
                              <div className={cn("text-right tabular-nums", cls)}>
                                {pct === null ? "--" : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`}
                              </div>
                              <div className="text-right tabular-nums">
                                {quote && Number.isFinite(quote.price) ? quote.price.toFixed(2) : "--"}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="text-xs text-zinc-400 italic">暂无持仓明细</div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
