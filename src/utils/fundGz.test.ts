import { describe, expect, it } from "vitest"
import { parseFundGzJsonp } from "@/utils/fundGz"

describe("parseFundGzJsonp", () => {
  it("parses jsonpgz payload", () => {
    const raw =
      'jsonpgz({"fundcode":"161725","name":"招商中证白酒指数(LOF)","jzrq":"2026-01-31","dwjz":"1.2345","gsz":"1.2501","gszzl":"1.26","gztime":"2026-02-01 10:21"});'
    const r = parseFundGzJsonp(raw)
    expect(r.code).toBe("161725")
    expect(r.name.length).toBeGreaterThan(0)
    expect(r.gsz).toBeCloseTo(1.2501)
    expect(r.gszzl).toBeCloseTo(1.26)
    expect(r.gztime).toBe("2026-02-01 10:21")
  })

  it("throws on invalid format", () => {
    expect(() => parseFundGzJsonp("hello")).toThrow()
  })
})
