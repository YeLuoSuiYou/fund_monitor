export type StoredValue<T> = {
  value: T
  updatedAt: number
}

export function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export const storage = {
  getJson<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return null
      return safeJsonParse<T>(raw)
    } catch {
      return null
    }
  },
  setJson<T>(key: string, value: T) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      return
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key)
    } catch {
      return
    }
  },
  clear() {
    try {
      localStorage.clear()
    } catch {
      return
    }
  },
}

