import { create } from "zustand"
import { persist } from "zustand/middleware"

export type ThemeMode = "dark" | "light"
export type ColorRule = "red_up_green_down" | "green_up_red_down"
export type ViewMode = "standard" | "compact"

export function normalizeFundCodes(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : []
  const normalized = raw
    .map((v) => String(v ?? "").trim())
    .filter((v) => v.length > 0)

  const seen = new Set<string>()
  const out: string[] = []
  for (const v of normalized) {
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

function sanitizeSettings(input: Partial<SettingsState>): Partial<SettingsState> {
  const out: Partial<SettingsState> = {}
  if ("fundCodes" in input) out.fundCodes = normalizeFundCodes(input.fundCodes)
  if ("refreshIntervalSec" in input) {
    const v = Number(input.refreshIntervalSec)
    if (Number.isFinite(v)) out.refreshIntervalSec = Math.min(3600, Math.max(5, Math.round(v)))
  }
  if ("autoRefreshEnabled" in input) out.autoRefreshEnabled = Boolean(input.autoRefreshEnabled)
  if ("quoteSourceId" in input && (input.quoteSourceId === "sina" || input.quoteSourceId === "custom")) {
    out.quoteSourceId = input.quoteSourceId
  }
  if ("customQuoteUrlTemplate" in input) out.customQuoteUrlTemplate = String(input.customQuoteUrlTemplate ?? "")
  if ("holdingsApiBaseUrl" in input) out.holdingsApiBaseUrl = String(input.holdingsApiBaseUrl ?? "")
  if ("decimals" in input) {
    const v = Number(input.decimals)
    if (Number.isFinite(v)) out.decimals = Math.min(6, Math.max(0, Math.round(v)))
  }
  if ("colorRule" in input && (input.colorRule === "red_up_green_down" || input.colorRule === "green_up_red_down")) {
    out.colorRule = input.colorRule
  }
  if ("theme" in input && (input.theme === "dark" || input.theme === "light")) {
    out.theme = input.theme
  }
  if ("viewMode" in input && (input.viewMode === "standard" || input.viewMode === "compact")) {
    out.viewMode = input.viewMode
  }
  return out
}

export type SettingsState = {
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

export type SettingsActions = {
  setSettings: (patch: Partial<SettingsState>, syncToBackend?: boolean) => void
  resetSettings: () => void
  loadFromBackend: () => Promise<void>
}

export type SettingsStore = SettingsState & SettingsActions

const defaultHoldingsApiBaseUrl = import.meta.env.VITE_HOLDINGS_API_BASE_URL ?? "http://localhost:8001"

export const defaultSettings: SettingsState = {
  fundCodes: [],
  refreshIntervalSec: 30,
  autoRefreshEnabled: true,
  quoteSourceId: "sina",
  customQuoteUrlTemplate: "",
  holdingsApiBaseUrl: defaultHoldingsApiBaseUrl,
  decimals: 3,
  colorRule: "red_up_green_down",
  theme: "dark",
  viewMode: "standard",
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      ...defaultSettings,
      setSettings: (patch, syncToBackend = true) => {
        const sanitized = sanitizeSettings(patch)
        set(sanitized)
        if (syncToBackend) {
          const next = get()
          const baseUrl = next.holdingsApiBaseUrl || defaultHoldingsApiBaseUrl
          fetch(`${baseUrl.replace(/\/+$/, "")}/user_settings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(next),
          }).catch((err) => console.error("[SettingsStore] Sync to backend failed:", err))
        }
      },
      resetSettings: () => {
        const newState = { ...defaultSettings }
        set(newState)
        fetch(`${newState.holdingsApiBaseUrl.replace(/\/+$/, "")}/user_settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newState),
        }).catch((err) => console.error("[SettingsStore] Reset sync failed:", err))
      },
      loadFromBackend: async () => {
        try {
          const baseUrl = get().holdingsApiBaseUrl || defaultHoldingsApiBaseUrl
          const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/user_settings`)
          if (res.ok) {
            const data = await res.json()
            if (data && Object.keys(data).length > 0) {
              console.log("[SettingsStore] Loaded settings from backend")
              // 加载时不触发同步，防止循环
              const sanitized = sanitizeSettings(data)
              if (Object.keys(sanitized).length > 0) {
                get().setSettings(sanitized, false)
              }
            }
          }
        } catch (err) {
          console.error("[SettingsStore] Load from backend failed:", err)
        }
      },
    }),
    {
      name: "fund_monitor_settings_v1",
      version: 10,
      migrate: (persisted, version) => {
        const p = persisted as any
        if (!p) return defaultSettings

        // 无论版本是多少，都先与默认值合并以保证字段完整性
        const migrated = {
          ...defaultSettings,
          ...p,
        }

        // 处理 v7 以前的旧字段 fundCode (单数)
        if (version < 7) {
          const list = Array.isArray(p.fundCodes) ? p.fundCodes : (p.fundCode ? [p.fundCode] : [])
          migrated.fundCodes = normalizeFundCodes(list)
        }

        // 处理 v8 以前缺失的 viewMode
        if (version < 8) {
          migrated.viewMode = p.viewMode ?? "standard"
        }

        // 处理 v10 以前可能的 fundCodes 格式不一致
        if (version < 10) {
          migrated.fundCodes = normalizeFundCodes(migrated.fundCodes)
        }

        return migrated as SettingsState
      },
      partialize: (s) => ({
        fundCodes: normalizeFundCodes(s.fundCodes),
        refreshIntervalSec: s.refreshIntervalSec,
        autoRefreshEnabled: s.autoRefreshEnabled,
        quoteSourceId: s.quoteSourceId,
        customQuoteUrlTemplate: s.customQuoteUrlTemplate,
        holdingsApiBaseUrl: s.holdingsApiBaseUrl,
        decimals: s.decimals,
        colorRule: s.colorRule,
        theme: s.theme,
        viewMode: s.viewMode,
      }),
    },
  ),
)
