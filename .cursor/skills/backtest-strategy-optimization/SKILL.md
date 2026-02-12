---
name: backtest-strategy-optimization
description: Optimizes fund valuation strategy using rolling backtests without look-ahead bias. Use when improving estimate accuracy, tuning strategy parameters, comparing baseline vs improved models, or when the user asks to iterate strategy based on backtest results.
---
# Backtest Strategy Optimization

## Purpose
Improve fund intraday estimation accuracy with strict anti-leakage and anti-overfitting rules.

## Hard Rules
1. Never use future data:
   - Any feature at time `t` must be built only from data available at or before `t`.
   - No use of `t+1` NAV/returns in signal construction.
2. No single-fund overfit:
   - Hyperparameters must be global or fund-type-level, never custom-per-fund.
   - Do not optimize one fund in isolation and deploy globally.
3. Keep baseline path:
   - Always preserve a baseline strategy for A/B comparison.

## Workflow
Copy this checklist and track progress:

```text
Backtest Optimization Progress
- [ ] Step 1: Define evaluation window and fund universe
- [ ] Step 2: Run baseline backtest and store metrics
- [ ] Step 3: Propose limited parameter updates (global or type-level)
- [ ] Step 4: Re-run backtest and compare delta metrics
- [ ] Step 5: Validate no-leakage assumptions
- [ ] Step 6: Keep or rollback changes by acceptance criteria
```

## Step 1: Evaluation Design
- Use a fixed rolling window (for example last 30 trading days).
- Include all tracked A-share funds, not cherry-picked subsets.
- Keep same universe between baseline and candidate runs.

## Step 2: Baseline Metrics
Record at least:
- `mae`
- `rmse`
- `hit_rate_02`
- `hit_rate_05`
- `bias`
- `samples`

## Step 3: Candidate Changes (Allowed)
- Adjust global weights (for example holdings vs proxy blend).
- Adjust fund-type-level weights (index/mixed/equity buckets).
- Adjust freshness decay curve globally.

Not allowed:
- One-off parameter for a single fund code.
- Using report fields that are only known after the target date.

## Step 4: Acceptance Criteria
Accept candidate only if all conditions hold:
1. Aggregate MAE improves versus baseline.
2. No large degradation in tail funds (check max error and worst decile).
3. Bias does not drift materially in one direction.

If not met, rollback to baseline.

## Output Template
Use this concise report format:

```markdown
## Backtest Iteration N
- Window: <date range>
- Universe: <count> funds
- Change: <what was changed>

## Result
- MAE: <baseline> -> <candidate> (delta)
- RMSE: <baseline> -> <candidate> (delta)
- HitRate<=0.2: <baseline> -> <candidate> (delta)
- HitRate<=0.5: <baseline> -> <candidate> (delta)
- Bias: <baseline> -> <candidate>

## Safety Check
- Look-ahead leakage check: pass/fail
- Per-fund hyperparameter check: pass/fail

## Decision
- Keep / Rollback
```

