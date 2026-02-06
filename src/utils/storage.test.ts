import { describe, expect, it } from "vitest"
import { safeJsonParse } from "@/utils/storage"

describe("safeJsonParse", () => {
  it("returns null for invalid json", () => {
    expect(safeJsonParse("{" )).toBeNull()
  })

  it("parses valid json", () => {
    expect(safeJsonParse<{ a: number }>("{\"a\":1}")?.a).toBe(1)
  })
})

