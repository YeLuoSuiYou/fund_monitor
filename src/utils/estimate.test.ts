import { describe, expect, it } from "vitest"
import { buildFundEstimate } from "@/utils/estimate"

describe("buildFundEstimate", () => {
  it("uses benchmark proxy when holdings quotes are missing", () => {
    const estimate = buildFundEstimate({
      code: "000001",
      name: "测试指数基金",
      fundType: "指数型",
      holdings: [{ symbol: "sh600000", weight: 0.6 }],
      quotes: {},
      cashRatio: 0.05,
      baseNav: 1.2,
      benchmarkSymbol: "sh000300",
      benchmarkReturn: 0.01,
      holdingsDate: "2025年4季度股票投资明细",
    })

    expect(estimate.gszzl).not.toBeNull()
    expect(estimate.benchmarkSymbol).toBe("sh000300")
    expect(estimate.strategyVersion).toBe("adaptive_v2")
    // 1% * 95% = 0.95%
    expect(estimate.gszzl as number).toBeCloseTo(0.95, 2)
  })

  it("applies cash ratio as decimal (0-1) instead of percentage", () => {
    const estimate = buildFundEstimate({
      code: "000002",
      name: "测试股票基金",
      fundType: "股票型",
      holdings: [{ symbol: "sh600000", weight: 0.6 }],
      quotes: {
        sh600000: {
          symbol: "sh600000",
          name: "浦发银行",
          price: 10.2,
          prevClose: 10,
          time: "2026-02-12 11:30:00",
        },
      },
      cashRatio: 0.1,
      baseNav: 1,
      holdingsDate: "2026-02-01",
    })

    expect(estimate.gszzl).not.toBeNull()
    // 涨幅约 2%，股票仓位 90%，结果应接近 1.8%
    expect(estimate.gszzl as number).toBeGreaterThan(1)
    expect(estimate.gszzl as number).toBeLessThan(2.2)
  })
})

