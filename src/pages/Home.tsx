import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { LayoutGrid, List, RefreshCw, Settings as SettingsIcon, BarChart2 } from "lucide-react"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card"
import { Skeleton } from "@/components/ui/Skeleton"
import { Switch } from "@/components/ui/Switch"
import { useFundStore } from "@/stores/fundStore"
import { useSettingsStore } from "@/stores/settingsStore"
import { quoteSourceOptions } from "@/utils/quote"
import { formatDate, formatDateTime, isMiddayBreak } from "@/utils/time"
import { fetchSinaProxy } from "@/utils/holdingsApi"
import { cn } from "@/lib/utils"


function getDeltaTone(delta: number) {
  if (delta > 0) return "up"
  if (delta < 0) return "down"
  return "flat"
}

function getDeltaClass(tone: "up" | "down" | "flat", colorRule: string) {
  if (tone === "flat") return "text-zinc-500 dark:text-zinc-400"

  const redUp = colorRule === "red_up_green_down"
  const upCls = redUp ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"
  const downCls = redUp ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
  return tone === "up" ? upCls : downCls
}

function formatMetric(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--"
  try {
    return value.toFixed(digits)
  } catch {
    return "--"
  }
}

function formatPercent(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--"
  try {
    return `${value.toFixed(digits)}%`
  } catch {
    return "--"
  }
}

type IndexData = {
  name: string
  price: number
  change: number
  pct: number
}

export default function Home() {
  const navigate = useNavigate()
  const fundCodes = useSettingsStore((s) => s.fundCodes) || []
  const refreshIntervalSec = useSettingsStore((s) => s.refreshIntervalSec)
  const autoRefreshEnabled = useSettingsStore((s) => s.autoRefreshEnabled)
  const quoteSourceId = useSettingsStore((s) => s.quoteSourceId)
  const customQuoteUrlTemplate = useSettingsStore((s) => s.customQuoteUrlTemplate)
  const holdingsApiBaseUrl = useSettingsStore((s) => s.holdingsApiBaseUrl)
  const valuationMode = useSettingsStore((s) => s.valuationMode)
  const decimals = useSettingsStore((s) => s.decimals)
  const colorRule = useSettingsStore((s) => s.colorRule)
  const viewMode = useSettingsStore((s) => s.viewMode) || "standard"
  const setSettings = useSettingsStore((s) => s.setSettings)
  const loadFromBackend = useSettingsStore((s) => s.loadFromBackend)

  useEffect(() => {
    loadFromBackend()
  }, [loadFromBackend])

  const status = useFundStore((s) => s.status)
  const errorMessage = useFundStore((s) => s.errorMessage)
  const lastUpdatedAt = useFundStore((s) => s.lastUpdatedAt)
  const lastRefreshStartedAt = useFundStore((s) => s.lastRefreshStartedAt)
  const summary = useFundStore((s) => s.summary)
  const funds = useFundStore((s) => s.funds)
  const refreshAll = useFundStore((s) => s.refreshAll)

  const [now, setNow] = useState(() => Date.now())
  const [indices, setIndices] = useState<IndexData[]>([])
  
  // 交易时间检测逻辑
  const marketStatus = useMemo(() => {
    const d = new Date(now)
    const day = d.getDay()
    const isWeekend = day === 0 || day === 6
    if (isWeekend) return { isOpen: false, reason: "周末休市" }

    const hour = d.getHours()
    const min = d.getMinutes()
    const totalMin = hour * 60 + min

    // 9:15 - 11:30
    const morningStart = 9 * 60 + 15
    const morningEnd = 11 * 60 + 30
    // 13:00 - 15:00
    const afternoonStart = 13 * 60
    const afternoonEnd = 15 * 60

    if (totalMin < morningStart) return { isOpen: false, reason: "尚未开盘" }
    if (totalMin > morningEnd && totalMin < afternoonStart) return { isOpen: false, reason: "午间休市" }
    if (totalMin >= afternoonEnd) return { isOpen: false, reason: "已收盘" }
    
    return { isOpen: true, reason: "交易中" }
  }, [now])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const normalizedCodes = useMemo(() => fundCodes.map((c) => c.trim()).filter((c) => c.length > 0), [fundCodes])
  const canFetch = normalizedCodes.length > 0

  useEffect(() => {
    document.title = "实时监控基金估值"
  }, [])

  const customTemplate = (customQuoteUrlTemplate || "").trim()
  const effectiveSourceId = quoteSourceId === "custom" && !customTemplate ? "sina" : quoteSourceId

  useEffect(() => {
    if (!canFetch) return
    if (status === "idle")
      refreshAll(normalizedCodes, {
        quoteSourceId: effectiveSourceId,
        customQuoteTemplate: customTemplate,
        holdingsApiBaseUrl,
        valuationMode,
      })
  }, [canFetch, normalizedCodes, refreshAll, status, effectiveSourceId, customTemplate, holdingsApiBaseUrl, valuationMode])

  useEffect(() => {
    if (!canFetch) return
    if (!autoRefreshEnabled) return
    if (!marketStatus.isOpen) return // 非交易时间不自动刷新

    const ms = Math.max(5, refreshIntervalSec || 30) * 1000
    const id = window.setInterval(() => {
      refreshAll(normalizedCodes, {
        quoteSourceId: effectiveSourceId,
        customQuoteTemplate: customTemplate,
        holdingsApiBaseUrl,
        valuationMode,
      })
    }, ms)
    return () => window.clearInterval(id)
  }, [
    autoRefreshEnabled,
    canFetch,
    normalizedCodes,
    refreshAll,
    refreshIntervalSec,
    effectiveSourceId,
    customTemplate,
    holdingsApiBaseUrl,
    marketStatus.isOpen,
    valuationMode,
  ])

  // 大盘指数刷新逻辑
  useEffect(() => {
    async function loadIndices() {
      if (!holdingsApiBaseUrl) return
      try {
        const raw = await fetchSinaProxy(holdingsApiBaseUrl, "s_sh000300,s_sh000001,s_sz399001")
        if (!raw) return
        const lines = raw.split(";")
        const next: IndexData[] = []
        for (const line of lines) {
          const match = line.match(/hq_str_s_(sh\d+|sz\d+)="(.*?)"/)
          if (match) {
            const parts = match[2].split(",")
            if (parts.length >= 4) {
              next.push({
                name: parts[0],
                price: parseFloat(parts[1]),
                change: parseFloat(parts[2]),
                pct: parseFloat(parts[3]),
              })
            }
          }
        }
        setIndices(next)
      } catch (e) {
        console.error("Failed to load indices:", e)
      }
    }

    loadIndices()
    if (marketStatus.isOpen) {
      const id = window.setInterval(loadIndices, 30000)
      return () => window.clearInterval(id)
    }
  }, [holdingsApiBaseUrl, marketStatus.isOpen])

  const nextRefreshInSec = useMemo(() => {
    if (!autoRefreshEnabled || !marketStatus.isOpen) return null
    const base = lastRefreshStartedAt ?? now
    const ms = Math.max(5, refreshIntervalSec || 30) * 1000
    const diff = ms - (now - base)
    return Math.max(0, Math.ceil(diff / 1000))
  }, [autoRefreshEnabled, lastRefreshStartedAt, now, refreshIntervalSec, marketStatus.isOpen])

  const statusTone =
    status === "error"
      ? "danger"
      : status === "loading"
        ? "info"
        : status === "success" && summary.error > 0
          ? "info"
          : status === "success"
            ? "success"
            : "neutral"
  const statusText =
    status === "error"
      ? "Error"
      : status === "loading"
        ? "Loading"
        : status === "success" && summary.error > 0
          ? "Partial"
          : status === "success"
            ? "Success"
            : "Idle"

  const lastLine = lastUpdatedAt ? `最近刷新：${formatDateTime(lastUpdatedAt)}` : "尚未刷新"
  const intervalLine = `自动刷新：${Math.max(5, refreshIntervalSec || 30)}s`
  const marketTag = marketStatus.isOpen ? (
    <Badge tone="success" className="animate-pulse">● {marketStatus.reason}</Badge>
  ) : (
    <Badge tone="neutral">○ {marketStatus.reason}</Badge>
  )

  const indexBar = indices.length > 0 ? (
    <div className="flex flex-wrap items-center gap-4 text-xs">
      {indices.map((idx) => {
        const cls = getDeltaClass(idx.pct >= 0 ? "up" : "down", colorRule)
        return (
          <div key={idx.name} className="flex items-center gap-1.5 border-r border-zinc-200 dark:border-zinc-800 pr-4 last:border-0">
            <span className="text-zinc-500">{idx.name}</span>
            <span className="font-medium tabular-nums">{idx.price.toFixed(2)}</span>
            <span className={cn("font-medium tabular-nums", cls)}>
              {idx.pct >= 0 ? "+" : ""}{idx.pct.toFixed(2)}%
            </span>
          </div>
        )
      })}
    </div>
  ) : null

  const sourceLabel = useMemo(() => {
    const activeLabel = quoteSourceOptions.find((item) => item.id === effectiveSourceId)?.name ?? "未知来源"
    return `行情源：${activeLabel}`
  }, [effectiveSourceId])

  const modelLabel = useMemo(() => {
    const modeLabel = valuationMode === "official" ? "官方" : valuationMode === "holdings" ? "持仓" : "智能"
    return `估值口径：${modeLabel}`
  }, [valuationMode])
  const errorHint = useMemo(() => {
    if (status !== "error") return null
    if (errorMessage?.includes("网络")) return "网络异常，已暂停刷新，恢复后自动重试"
    return errorMessage ?? "请求失败"
  }, [status, errorMessage])
  const isCompact = viewMode === "compact"

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <header className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold">基金估值监控</div>
              {marketTag}
            </div>
            <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">{canFetch ? `监控 ${normalizedCodes.length} 只基金` : "未配置"}</div>
          </div>
          <div className="hidden lg:block">
            {indexBar}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSettings({ viewMode: isCompact ? "standard" : "compact" })}
            >
              {isCompact ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
              {isCompact ? "标准模式" : "紧凑模式"}
            </Button>
            <Link to="/backtest">
              <Button variant="secondary" size="sm">
                <BarChart2 className="h-4 w-4" />
                回测报告
              </Button>
            </Link>
            <Link to="/settings">
              <Button variant="secondary" size="sm">
                <SettingsIcon className="h-4 w-4" />
                设置
              </Button>
            </Link>
          </div>
        </header>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
          <div className="flex flex-wrap items-center gap-2">
            {status === "success" ? (
              <span className="flex items-center gap-1.5 px-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                已就绪
              </span>
            ) : (
              <Badge tone={statusTone}>{statusText}</Badge>
            )}
            <span>{lastLine}</span>
            {canFetch ? (
              <span className="text-zinc-500 dark:text-zinc-400">成功 {summary.success}/{summary.total}</span>
            ) : null}
            <span className="text-zinc-500 dark:text-zinc-400">{sourceLabel}</span>
            <span className="text-zinc-500 dark:text-zinc-400">{modelLabel}</span>
            {errorHint ? <span className="text-rose-600 dark:text-rose-400">{errorHint}</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                refreshAll(normalizedCodes, {
                  quoteSourceId: effectiveSourceId,
                  customQuoteTemplate: customTemplate,
                  holdingsApiBaseUrl,
                  valuationMode,
                })
              }
              disabled={!canFetch || status === "loading"}
            >
              <RefreshCw className={"h-4 w-4 " + (status === "loading" ? "animate-spin" : "")} />
              手动刷新全部
            </Button>
            <div className="flex items-center gap-2">
              <span>{intervalLine}</span>
              {autoRefreshEnabled && nextRefreshInSec !== null ? (
                <span className="text-zinc-500 dark:text-zinc-400">下次刷新：{nextRefreshInSec}s</span>
              ) : null}
              <Switch checked={autoRefreshEnabled} onCheckedChange={(next) => setSettings({ autoRefreshEnabled: next })} disabled={!canFetch} />
            </div>
          </div>
        </div>

        {status === "error" ? (
          <div className="mt-4">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>请求失败</CardTitle>
                  <CardDescription>{errorHint ?? "请求失败"}</CardDescription>
                </div>
              </CardHeader>
              <div className="mt-4">
                <Button
                  variant="secondary"
                  onClick={() =>
                    refreshAll(normalizedCodes, {
                      quoteSourceId: effectiveSourceId,
                      customQuoteTemplate: customTemplate,
                      holdingsApiBaseUrl,
                      valuationMode,
                    })
                  }
                  disabled={!canFetch}
                >
                  重试（刷新全部）
                </Button>
              </div>
            </Card>
          </div>
        ) : null}

        <main className="mt-6">
          {!canFetch ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>你还没有添加任何基金</CardTitle>
                  <CardDescription>去设置页添加基金后，首页会同时监控所有基金</CardDescription>
                </div>
              </CardHeader>
              <div className="mt-4">
                <Link to="/settings">
                  <Button variant="primary">去设置添加基金</Button>
                </Link>
              </div>
            </Card>
          ) : (
            <div
              className={cn(
                "transition-all duration-200",
                isCompact
                  ? "flex flex-col gap-2"
                  : "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
              )}
            >
              {normalizedCodes.map((code) => {
                const item = funds[code]
                const latest = item?.latest ?? null
                const previous = item?.previous ?? null
                const delta =
                  latest && previous && latest.gsz !== null && previous.gsz !== null ? latest.gsz - previous.gsz : null
                const deltaTone = delta === null ? "flat" : getDeltaTone(delta)
                const deltaCls = delta === null ? "text-zinc-500 dark:text-zinc-400" : getDeltaClass(deltaTone, colorRule)

                const isBreak = isMiddayBreak()
                const zfText = (latest && latest.gszzl != null) ? `${latest.gszzl > 0 ? "+" : ""}${latest.gszzl.toFixed(2)}%` : (isBreak ? "午间休市" : "--")
                const zfTone = (latest && latest.gszzl != null) ? getDeltaTone(latest.gszzl) : "flat"
                const zfCls = latest?.gszzl != null ? getDeltaClass(zfTone, colorRule) : "text-zinc-500 dark:text-zinc-400"

                const actualZzl = latest?.actualZzl ?? null
                const actualDate = latest?.actualDate ?? null
                const isActualToday = actualDate === formatDate(Date.now())
                
                // 判断是否在收盘后（15:00之后）且数据尚未更新
                const currentHour = new Date().getHours()
                const isAfterMarketClose = currentHour >= 15
                const showPendingActual = isAfterMarketClose && !isActualToday

                const actualText = actualZzl !== null ? `${actualZzl.toFixed(2)}%` : "--"
                const actualTone = actualZzl !== null ? getDeltaTone(actualZzl) : "flat"
                const actualCls = actualZzl !== null ? getDeltaClass(actualTone, colorRule) : "text-zinc-500 dark:text-zinc-400"
                
                const variance = (latest && latest.gszzl != null && actualZzl !== null) ? latest.gszzl - actualZzl : null
                const varianceText = variance !== null ? `${variance >= 0 ? "+" : ""}${variance.toFixed(2)}%` : null

                const gztimeText = latest ? latest.gztime : "--"
                const quoteTimeText = latest?.quoteTime ?? "--"
                const quoteTimeDisplay = isBreak && latest?.quoteTime ? `${quoteTimeText} (午休沿用)` : quoteTimeText
                const valuationSourceText = latest?.valuationSource === "eastmoney" ? "官方估值" : "持仓推算"
                const gszText = latest && latest.gsz !== null ? latest.gsz.toFixed(decimals) : "--"
                const deltaText =
                  delta === null ? "--" : `${delta >= 0 ? "+" : ""}${delta.toFixed(decimals)}`
                const coverageText = latest ? `${Math.round(latest.coverage * 100)}%` : "--"
                const cashRatioText = latest ? `${Math.round(latest.cashRatio * 100)}%` : "--"
                const cachedAtText = latest?.cachedAt ? formatDateTime(latest.cachedAt) : "--"
                const baseNavText = (latest && latest.baseNav != null) ? latest.baseNav.toFixed(decimals) : "--"
                const compactZzlText = isActualToday ? actualText : zfText
                const compactZzlTone =
                  isActualToday && actualZzl !== null
                    ? getDeltaTone(actualZzl)
                    : (latest && latest.gszzl != null)
                      ? getDeltaTone(latest.gszzl)
                      : "flat"
                const compactZzlCls = getDeltaClass(compactZzlTone, colorRule)
                const navMetrics = latest?.navMetrics ?? null
                const ret1m = navMetrics?.ret1m ?? null
                const ret3m = navMetrics?.ret3m ?? null
                const ret1y = navMetrics?.ret1y ?? null
                const sharpe = navMetrics?.sharpe ?? null
                const maxDrawdown = navMetrics?.maxDrawdown ?? null
                const ret1mCls = ret1m === null ? "text-zinc-500 dark:text-zinc-400" : getDeltaClass(getDeltaTone(ret1m), colorRule)
                const ret3mCls = ret3m === null ? "text-zinc-500 dark:text-zinc-400" : getDeltaClass(getDeltaTone(ret3m), colorRule)
                const ret1yCls = ret1y === null ? "text-zinc-500 dark:text-zinc-400" : getDeltaClass(getDeltaTone(ret1y), colorRule)
                const drawdownCls =
                  maxDrawdown === null ? "text-zinc-500 dark:text-zinc-400" : getDeltaClass(getDeltaTone(maxDrawdown), colorRule)

                const itemStatus = item?.status ?? "idle"
                const itemTone = itemStatus === "success" ? "success" : itemStatus === "error" ? "danger" : itemStatus === "loading" ? "info" : "neutral"
                const itemText = itemStatus === "success" ? "Success" : itemStatus === "error" ? "Error" : itemStatus === "loading" ? "Loading" : "Idle"
                const isBackendDown = itemStatus === "error" && item?.errorMessage === "后端服务不可用"

                if (isCompact) {
                  return (
                    <div
                      key={code}
                      className="grid cursor-pointer grid-cols-1 gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1fr)]"
                      onClick={() => navigate(`/fund/${code}`)}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{latest?.name || `基金（${code}）`}</div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">代码：{code}</div>
                          </div>
                          {itemStatus !== "success" && (
                            <Badge tone={itemTone}>{itemText}</Badge>
                          )}
                        </div>
                        {itemStatus === "error" ? (
                          <div className="mt-1 truncate text-[11px] text-rose-600 dark:text-rose-400">
                            {item?.errorMessage ?? "请求失败"}
                          </div>
                        ) : null}
                      </div>

                      <div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">最新净值/涨跌幅</div>
                        <div className="mt-0.5 flex items-baseline gap-2">
                          <div className="font-semibold tabular-nums">{baseNavText}</div>
                          <div className={cn("font-semibold tabular-nums", compactZzlCls)}>{compactZzlText}</div>
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">近1月/3月/年</div>
                        <div className="mt-0.5 flex flex-wrap items-baseline gap-2 tabular-nums">
                          <span className={ret1mCls}>{formatPercent(ret1m)}</span>
                          <span className={ret3mCls}>{formatPercent(ret3m)}</span>
                          <span className={ret1yCls}>{formatPercent(ret1y)}</span>
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">夏普/最大回撤</div>
                        <div className="mt-0.5 flex flex-wrap items-baseline gap-2 tabular-nums">
                          <span className="text-zinc-700 dark:text-zinc-200">{formatMetric(sharpe)}</span>
                          <span className={drawdownCls}>{formatPercent(maxDrawdown)}</span>
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
                          <span>估值/时间</span>
                          {itemStatus === "success" && (
                            <span className="h-1 w-1 rounded-full bg-emerald-500 shrink-0" />
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-baseline gap-2 tabular-nums">
                          <span className="font-semibold">{gszText}</span>
                          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{gztimeText}</span>
                        </div>
                      </div>
                    </div>
                  )
                }

                return (
                  <Card key={code} className="cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors" onClick={() => navigate(`/fund/${code}`)}>
                    <CardHeader>
                      <div className="min-w-0">
                        <CardTitle>{latest?.name || `基金（${code}）`}</CardTitle>
                        <CardDescription>代码：{code}</CardDescription>
                      </div>
                      <div className="shrink-0 text-right">
                        {itemStatus !== "success" && (
                          <Badge tone={itemTone}>{itemText}</Badge>
                        )}
                      </div>
                    </CardHeader>

                    <div className="mt-4">
                      {itemStatus === "loading" && !latest ? (
                        <div className="space-y-3">
                          <Skeleton className="h-12 w-40" />
                          <Skeleton className="h-5 w-32" />
                          <Skeleton className="h-4 w-52" />
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-end justify-between gap-4">
                          <div className="w-full">
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 flex justify-between">
                              <span>{isActualToday ? "今日实盘涨跌幅" : "当日涨跌幅 (估)"}</span>
                              {showPendingActual && (
                                <span className="text-[10px] text-amber-500 animate-pulse">等待净值更新...</span>
                              )}
                              {!isActualToday && actualDate && (
                                <span className="text-[10px] text-zinc-400">实盘最近: {actualDate}</span>
                              )}
                            </div>
                            <div className="mt-1 flex items-baseline gap-2">
                              <div className={`text-3xl font-semibold tracking-tight tabular-nums ${isActualToday ? actualCls : zfCls}`}>
                                {isActualToday ? actualText : zfText}
                              </div>
                              {isActualToday && (
                                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                  估值: <span className={zfCls}>{zfText}</span>
                                  {varianceText && <span className="ml-1">(误差: {varianceText})</span>}
                                </div>
                              )}
                            </div>
                            <div className="mt-3 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                              <span>估值</span>
                              {itemStatus === "success" && (
                                <span className="h-1 w-1 rounded-full bg-emerald-500 shrink-0" title="同步成功" />
                              )}
                            </div>
                            <div className="mt-1 text-lg font-semibold tracking-tight tabular-nums">{gszText}</div>
                            <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                              <span>估值时间：{gztimeText}</span>
                            </div>
                            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">估值来源：{valuationSourceText}</div>
                            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">行情时间：{quoteTimeDisplay}</div>
                            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                              较上一笔：<span className={deltaCls}>{deltaText}</span>
                            </div>
                            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                              持仓日期：{latest?.holdingsDate || "--"}
                            </div>
                            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                              现金比例：{cashRatioText}，行情覆盖：{coverageText}
                            </div>
                            {latest?.stale ? (
                              <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">持仓缓存：{cachedAtText}</div>
                            ) : null}
                          </div>
                        </div>
                      )}

                      {itemStatus === "error" ? (
                        <div className="mt-3 text-xs text-rose-600 dark:text-rose-400">
                          {item?.errorMessage ?? "请求失败"}
                          {isBackendDown ? (
                            <span className="ml-1 text-zinc-500 dark:text-zinc-400">
                              （请检查后端服务是否启动，或确认设置里的持仓 API 地址）
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </Card>
                )
              })}
            </div>
          )}

          <div className="mt-6 px-1 text-xs text-zinc-500 dark:text-zinc-400">数据仅供参考</div>
        </main>
      </div>
    </div>
  )
}
