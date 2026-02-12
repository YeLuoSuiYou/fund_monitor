import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, RefreshCw, AlertCircle, CheckCircle2, XCircle, Info } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { useSettingsStore } from "@/stores/settingsStore"
import { cn } from "@/lib/utils"

type BacktestResult = {
  code: string
  name: string
  fundType?: string | null
  benchmarkSymbol?: string | null
  strategyVersion?: string
  mae: number
  rmse?: number
  hit_rate_02: number
  hit_rate_05: number
  max_err: number
  bias?: number
  samples: number
  baseline?: {
    mae: number
    rmse: number
    hit_rate_02: number
    hit_rate_05: number
    max_err: number
    bias: number
  } | null
}

type ReportResponse = {
  date: string
  results: BacktestResult[]
  pending?: boolean
  total?: number
  completed?: number
  updatedAt?: string
}

const REQUEST_TIMEOUT_MS = 10000

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("请求超时")
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export default function BacktestReport() {
  const holdingsApiBaseUrl = useSettingsStore((s) => s.holdingsApiBaseUrl)
  const [data, setData] = useState<ReportResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchReport = useCallback(async (force = false) => {
    try {
      setRefreshing(force)
      if (!force) setLoading(true)
      const res = await fetchWithTimeout(
        `${holdingsApiBaseUrl.replace(/\/+$/, "")}/backtest_report${force ? "?force_refresh=true" : ""}`,
      )
      if (!res.ok) throw new Error("获取报告失败")
      const json = await res.json()
      setData(json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [holdingsApiBaseUrl])

  useEffect(() => {
    fetchReport()
  }, [fetchReport])

  useEffect(() => {
    if (!data?.pending) return
    const id = window.setTimeout(() => {
      fetchReport(false)
    }, 2000)
    return () => window.clearTimeout(id)
  }, [data?.pending, fetchReport, data?.completed])

  const getRating = (mae: number) => {
    if (mae < 0.15) return { label: "极准", tone: "success", icon: CheckCircle2 }
    if (mae < 0.3) return { label: "很准", tone: "success", icon: CheckCircle2 }
    if (mae < 0.5) return { label: "一般", tone: "warning", icon: Info }
    return { label: "偏差较大", tone: "danger", icon: XCircle }
  }

  const getDeltaClass = (mae: number) => {
    if (mae < 0.3) return "text-emerald-500"
    if (mae < 0.5) return "text-amber-500"
    return "text-rose-500"
  }

  const formatDelta = (value: number | undefined) => {
    if (!Number.isFinite(value)) return "--"
    return `${(value as number) > 0 ? "+" : ""}${(value as number).toFixed(3)}`
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Link to="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4" />
                返回首页
              </Button>
            </Link>
            <div>
              <div className="text-sm font-semibold">估值策略回测报告</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                回测过去 30 个交易日“持仓推算”策略与实际收盘净值的偏差
              </div>
            </div>
          </div>
          <Button 
            variant="secondary" 
            size="sm" 
            onClick={() => fetchReport(true)} 
            disabled={loading || refreshing}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />
            重新计算
          </Button>
        </header>

        <main className="mt-6">
          {loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-4">
              <RefreshCw className="h-8 w-8 animate-spin text-zinc-400" />
              <p className="text-sm text-zinc-500">正在回测所有基金的历史表现，可能需要几秒钟...</p>
            </div>
          ) : error ? (
            <Card className="border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/20">
              <CardContent className="flex items-center gap-3 pt-6">
                <AlertCircle className="h-5 w-5 text-rose-500" />
                <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
              </CardContent>
            </Card>
          ) : data?.results.length === 0 && !data?.pending ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800">
              <p className="text-sm text-zinc-500">尚未添加任何基金</p>
              <Link to="/settings">
                <Button variant="secondary" size="sm">前往设置</Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {data?.pending ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                  回测任务后台运行中：{data.completed ?? 0}/{data.total ?? data.results.length}。页面将自动刷新结果。
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {data?.results.map((res) => {
                  const rating = getRating(res.mae)
                  const RatingIcon = rating.icon
                  return (
                    <Card key={res.code} className="overflow-hidden">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <CardTitle className="truncate text-sm">{res.name}</CardTitle>
                            <CardDescription className="text-xs">{res.code}</CardDescription>
                          </div>
                          <Badge tone={rating.tone as any} className="gap-1">
                            <RatingIcon className="h-3 w-3" />
                            {rating.label}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 gap-y-3 pt-2">
                          <div>
                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">平均误差 (MAE)</p>
                            <p className={cn("text-lg font-bold tabular-nums", getDeltaClass(res.mae))}>
                              {res.mae.toFixed(3)}%
                            </p>
                            {res.baseline ? (
                              <p className="text-[10px] text-zinc-500">
                                较基线: {formatDelta(res.mae - res.baseline.mae)}%
                              </p>
                            ) : null}
                          </div>
                          <div>
                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">RMSE/最大偏差</p>
                            <p className="text-lg font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">
                              {(res.rmse ?? res.max_err).toFixed(2)}% / {res.max_err.toFixed(2)}%
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">准确率 (≤0.2%)</p>
                            <p className="text-sm font-medium tabular-nums">
                              {res.hit_rate_02.toFixed(1)}%
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">样本/偏置</p>
                            <p className="text-sm font-medium tabular-nums">
                              {res.samples} 天 / {formatDelta(res.bias)}%
                            </p>
                          </div>
                        </div>
                        
                        <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-zinc-500">准确率 (误差 ≤ 0.5%)</span>
                            <span className="font-bold text-emerald-500">{res.hit_rate_05.toFixed(1)}%</span>
                          </div>
                          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <div 
                              className="h-full bg-emerald-500 transition-all" 
                              style={{ width: `${res.hit_rate_05}%` }}
                            />
                          </div>
                          <div className="mt-2 text-[10px] text-zinc-500">
                            策略: {res.strategyVersion ?? "baseline"} | 基准: {res.benchmarkSymbol ?? "--"} | 类型: {res.fundType ?? "--"}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
              
              <div className="rounded-xl bg-zinc-100 p-4 dark:bg-zinc-900/50">
                <div className="flex items-start gap-3">
                  <Info className="mt-0.5 h-4 w-4 text-zinc-400" />
                  <div className="text-xs text-zinc-500 space-y-1">
                    <p>• 报告反映了“持仓推算”模型在历史上的准确程度。MAE 越小，说明该基金的估值越值得信赖。</p>
                    <p>• 偏差较大（MAE &gt; 0.5%）通常意味着基金在近期发生了调仓、存在大量隐形仓位、或者现金申赎剧烈。</p>
                    <p>• 缓存有效期为 1 天，若需最新数据请点击“重新计算”。</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
