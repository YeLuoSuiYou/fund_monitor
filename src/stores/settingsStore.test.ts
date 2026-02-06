import { describe, expect, it } from "vitest"
import { normalizeFundCodes } from "@/stores/settingsStore"

describe("normalizeFundCodes", () => {
  it("returns empty list for non-array input", () => {
    expect(normalizeFundCodes("161725")).toEqual([])
    expect(normalizeFundCodes(null)).toEqual([])
    expect(normalizeFundCodes(undefined)).toEqual([])
  })

  it("trims and removes empty items", () => {
    expect(normalizeFundCodes([" 161725 ", "", "  "])).toEqual(["161725"])
  })

  it("dedupes while keeping order", () => {
    expect(normalizeFundCodes(["161725", "000001", "161725", "000001", "161725"])).toEqual(["161725", "000001"])
  })

  it("stringifies non-string items", () => {
    expect(normalizeFundCodes([161725, 0, true, false] as unknown as string[])).toEqual(["161725", "0", "true", "false"])
  })
})

