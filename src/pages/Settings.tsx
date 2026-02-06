import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ArrowLeft, Trash2 } from "lucide-react"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { Button } from "@/components/ui/Button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card"
import { Input } from "@/components/ui/Input"
import { Select } from "@/components/ui/Select"
import { Switch } from "@/components/ui/Switch"
import { useFundStore } from "@/stores/fundStore"
import { defaultSettings, type ColorRule, type ThemeMode, type ViewMode, useSettingsStore } from "@/stores/settingsStore"
import { quoteSourceOptions } from "@/utils/quote"

type DraftSettings = {
  fundCodes: string[]
  refreshIntervalSec: number
  autoRefreshEnabled: boolean
  quoteSourceId: "sina" | "custom"
  customQuoteUrlTemplate: string
  holdingsApiBaseUrl: string
  decimals: number
  colorRule: ColorRule
  theme: ThemeMode
  viewMode: ViewMode
}

export default function Settings() {
  const navigate = useNavigate()
  const fundCodes = useSettingsStore((s) => s.fundCodes) || []
  const refreshIntervalSec = useSettingsStore((s) => s.refreshIntervalSec)
  const autoRefreshEnabled = useSettingsStore((s) => s.autoRefreshEnabled)
  const quoteSourceId = useSettingsStore((s) => s.quoteSourceId)
  const customQuoteUrlTemplate = useSettingsStore((s) => s.customQuoteUrlTemplate)
  const holdingsApiBaseUrl = useSettingsStore((s) => s.holdingsApiBaseUrl)
  const decimals = useSettingsStore((s) => s.decimals)
  const colorRule = useSettingsStore((s) => s.colorRule)
  const theme = useSettingsStore((s) => s.theme)
  const viewMode = useSettingsStore((s) => s.viewMode) || "standard"
  const setSettings = useSettingsStore((s) => s.setSettings)
  const resetSettings = useSettingsStore((s) => s.resetSettings)
  const clearData = useFundStore((s) => s.clearData)

  const currentDraft = useMemo(
    () => ({
      fundCodes,
      refreshIntervalSec,
      autoRefreshEnabled,
      quoteSourceId,
      customQuoteUrlTemplate,
      holdingsApiBaseUrl,
      decimals,
      colorRule,
      theme,
      viewMode,
    }),
    [fundCodes, refreshIntervalSec, autoRefreshEnabled, quoteSourceId, customQuoteUrlTemplate, holdingsApiBaseUrl, decimals, colorRule, theme, viewMode]
  )
  const [draft, setDraft] = useState<DraftSettings>(() => ({ ...currentDraft }))
  const [newCodesText, setNewCodesText] = useState("")
  const [fundCodesError, setFundCodesError] = useState<string | null>(null)
  const [showClear, setShowClear] = useState(false)
  const [savedToast, setSavedToast] = useState(false)

  useEffect(() => {
    document.title = "设置 - 实时监控基金估值"
  }, [])

  useEffect(() => {
    setDraft({ ...currentDraft })
  }, [currentDraft])

  const onAddCodes = () => {
    const tokens = newCodesText
      .split(/[\s,，;；]+/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
    if (tokens.length === 0) {
      setFundCodesError("请输入基金标识")
      return
    }

    const next = [...draft.fundCodes]
    const seen = new Set(next)
    let added = 0
    for (const t of tokens) {
      if (seen.has(t)) continue
      seen.add(t)
      next.push(t)
      added += 1
    }

    if (added === 0) {
      setFundCodesError("基金已存在")
      return
    }

    setFundCodesError(null)
    setDraft((d) => ({ ...d, fundCodes: next }))
    setNewCodesText("")
  }

  const sourceError = draft.quoteSourceId === "custom" && !draft.customQuoteUrlTemplate.trim() ? "请填写行情模板 URL" : null
  const apiError = draft.holdingsApiBaseUrl.trim().length === 0 ? "请填写持仓 API 地址" : null
  const canSave = !sourceError && !apiError

  const onSave = () => {
    if (!canSave) return
    setSettings({
      fundCodes: draft.fundCodes,
      refreshIntervalSec: draft.refreshIntervalSec,
      autoRefreshEnabled: draft.autoRefreshEnabled,
      quoteSourceId: draft.quoteSourceId,
      customQuoteUrlTemplate: draft.customQuoteUrlTemplate,
      holdingsApiBaseUrl: draft.holdingsApiBaseUrl,
      decimals: draft.decimals,
      colorRule: draft.colorRule,
      theme: draft.theme,
      viewMode: draft.viewMode,
    })
    setSavedToast(true)
    window.setTimeout(() => setSavedToast(false), 1500)
    navigate("/")
  }

  const onCancel = () => {
    setDraft({ ...currentDraft })
    navigate("/")
  }

  const onClearAll = () => {
    setShowClear(false)
    try {
      localStorage.removeItem("fund_monitor_settings_v1")
    } catch {
      return
    }
    resetSettings()
    clearData()
    setDraft({ ...defaultSettings })
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Link to="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4" />
                返回首页
              </Button>
            </Link>
            <div>
              <div className="text-sm font-semibold">设置</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">配置基金标识、自动刷新频率与显示偏好</div>
            </div>
          </div>
        </header>

        <main className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>基金列表</CardTitle>
                <CardDescription>添加后首页将同时监控列表内所有基金</CardDescription>
              </div>
            </CardHeader>

            <div className="mt-4">
              <label className="text-xs text-zinc-500 dark:text-zinc-400">添加基金标识</label>
              <div className="mt-2 flex flex-wrap gap-2">
                <div className="min-w-[220px] flex-1">
                  <Input
                    value={newCodesText}
                    onChange={(e) => setNewCodesText(e.target.value)}
                    placeholder="例如：161725 或 161725,000001"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        onAddCodes()
                      }
                    }}
                  />
                </div>
                <Button variant="primary" onClick={onAddCodes}>
                  添加
                </Button>
              </div>
              {fundCodesError ? <div className="mt-2 text-xs text-rose-600 dark:text-rose-400">{fundCodesError}</div> : null}

              <div className="mt-4">
                {draft.fundCodes.length === 0 ? (
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200">
                    暂无基金，保存后首页会显示空态提示。
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-900/60 dark:border-zinc-800">
                    {draft.fundCodes.map((code) => (
                      <div key={code} className="flex items-center justify-between gap-3 bg-white px-3 py-2 text-sm dark:bg-zinc-950">
                        <div className="font-medium tabular-nums">{code}</div>
                        <Button variant="ghost" size="sm" onClick={() => setDraft((d) => ({ ...d, fundCodes: d.fundCodes.filter((c) => c !== code) }))}>
                          <Trash2 className="h-4 w-4" />
                          删除
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>持仓数据源</CardTitle>
                <CardDescription>从接口获取前十大重仓股与现金比例</CardDescription>
              </div>
            </CardHeader>

            <div className="mt-4">
              <label className="text-xs text-zinc-500 dark:text-zinc-400">持仓 API 地址</label>
              <div className="mt-2">
                <Input
                  value={draft.holdingsApiBaseUrl}
                  onChange={(e) => setDraft((d) => ({ ...d, holdingsApiBaseUrl: e.target.value }))}
                  placeholder="例如：http://localhost:8001"
                />
              </div>
              {apiError ? <div className="mt-2 text-xs text-rose-600 dark:text-rose-400">{apiError}</div> : null}
              <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">需要可访问的本地或内网服务</div>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>刷新配置</CardTitle>
                <CardDescription>设置自动刷新间隔，过低频率可能导致请求过于频繁</CardDescription>
              </div>
            </CardHeader>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs text-zinc-500 dark:text-zinc-400">刷新间隔</label>
                <div className="mt-2">
                  <Select
                    value={String(draft.refreshIntervalSec)}
                    onChange={(e) => setDraft((d) => ({ ...d, refreshIntervalSec: Number(e.target.value) }))}
                  >
                    <option value="5">5s</option>
                    <option value="10">10s</option>
                    <option value="30">30s</option>
                    <option value="60">60s</option>
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">自动刷新开关</div>
                  <div className="mt-1 text-sm font-medium">{draft.autoRefreshEnabled ? "已开启" : "已关闭"}</div>
                </div>
                <Switch checked={draft.autoRefreshEnabled} onCheckedChange={(v) => setDraft((d) => ({ ...d, autoRefreshEnabled: v }))} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>行情源</CardTitle>
                <CardDescription>估值模型依赖实时行情数据源</CardDescription>
              </div>
            </CardHeader>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-zinc-500 dark:text-zinc-400">行情源选择</label>
                <div className="mt-2">
                  <Select
                    value={draft.quoteSourceId}
                    onChange={(e) => setDraft((d) => ({ ...d, quoteSourceId: e.target.value as DraftSettings["quoteSourceId"] }))}
                  >
                    {quoteSourceOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              {draft.quoteSourceId === "custom" ? (
                <div>
                  <label className="text-xs text-zinc-500 dark:text-zinc-400">行情模板 URL</label>
                  <div className="mt-2">
                    <Input
                      value={draft.customQuoteUrlTemplate}
                      onChange={(e) => setDraft((d) => ({ ...d, customQuoteUrlTemplate: e.target.value }))}
                      placeholder="例如：https://example.com/list={symbols}&ts={timestamp}"
                    />
                  </div>
                  {sourceError ? <div className="mt-2 text-xs text-rose-600 dark:text-rose-400">{sourceError}</div> : null}
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">支持占位符：{`{symbols}`}、{`{timestamp}`}</div>
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>显示偏好</CardTitle>
                <CardDescription>调整数值格式、涨跌配色与主题</CardDescription>
              </div>
            </CardHeader>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="text-xs text-zinc-500 dark:text-zinc-400">小数位</label>
                <div className="mt-2">
                  <Select value={String(draft.decimals)} onChange={(e) => setDraft((d) => ({ ...d, decimals: Number(e.target.value) }))}>
                    <option value="0">0</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                  </Select>
                </div>
              </div>

              <div>
                <label className="text-xs text-zinc-500 dark:text-zinc-400">涨跌颜色规则</label>
                <div className="mt-2">
                  <Select
                    value={draft.colorRule}
                    onChange={(e) => setDraft((d) => ({ ...d, colorRule: e.target.value as ColorRule }))}
                  >
                    <option value="red_up_green_down">红涨绿跌</option>
                    <option value="green_up_red_down">绿涨红跌</option>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">主题</div>
                  <div className="mt-1 text-sm font-medium">{draft.theme === "dark" ? "暗色" : "亮色"}</div>
                </div>
                <Switch checked={draft.theme === "dark"} onCheckedChange={(v) => setDraft((d) => ({ ...d, theme: v ? "dark" : "light" }))} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>数据管理</CardTitle>
                <CardDescription>清除本地配置与缓存（不可逆）</CardDescription>
              </div>
            </CardHeader>

            <div className="mt-4">
              <Button variant="danger" onClick={() => setShowClear(true)}>
                <Trash2 className="h-4 w-4" />
                清除本地配置与缓存
              </Button>
            </div>
          </Card>
        </main>

        <div className="sticky bottom-4 mt-6 flex items-center justify-end gap-2 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <Button variant="secondary" onClick={onCancel}>
            取消
          </Button>
          <Button variant="primary" onClick={onSave} disabled={!canSave}>
            保存
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={showClear}
        title="确认清除本地配置与缓存？"
        description="此操作会清除基金标识、刷新频率、显示偏好，以及趋势列表记录，且不可恢复。"
        confirmText="清除"
        danger
        onCancel={() => setShowClear(false)}
        onConfirm={onClearAll}
      />

      {savedToast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">
          已保存
        </div>
      ) : null}
    </div>
  )
}
