# 基金估值监控系统

本项目是一个本地化使用的基金估值监控系统，支持持仓穿透、估值推算、行业归因以及 5 分钟级别的日内估值曲线回溯。前端提供清晰的基金列表与详情分析视图，后端基于 AkShare 拉取持仓与行情并进行估值计算，同时缓存与持久化历史点位。

## 功能特性

- 持仓穿透估值：自动处理 ETF/联接/QDII 基金的持仓推算
- 日内估值曲线：5 分钟刻度，支持收盘后自动回溯补全
- 行业归因：按行业汇总持仓权重与贡献
- 后端持久化：跨浏览器同步基金列表与估值点位缓存
- 多行情源：支持新浪行情与自定义模板
- 回测异步任务：回测报告改为后台计算，前端轮询进度，避免长请求超时
- 策略对比回测：同窗对比 `baseline` 与 `improved_v1`（MAE/RMSE/命中率/偏置）

## 技术架构

- 前端：React + TypeScript + Vite + Zustand
- 后端：FastAPI + AkShare
- 数据缓存：本地 JSON 文件持久化

## 项目结构

```
.
├─ api/                 # FastAPI 后端与估值逻辑
├─ src/                 # 前端 React 应用
├─ scripts/             # 本地开发脚本
├─ public/              # 静态资源
└─ intraday_history.json/cache.json/user_settings.json # 本地持久化
```

## 开发环境要求

- Node.js >= 18
- Python >= 3.10
- AkShare 可用运行环境（国内网络环境更稳定）

## 快速开始

### 1. 安装前端依赖

```
npm install
```

### 2. 安装后端依赖

```
python -m venv .venv
source .venv/bin/activate
pip install -r api/requirements.txt
```

### 3. 启动前后端（推荐）

```
npm run dev
```

该命令会自动启动 FastAPI 后端，并把可用端口注入到前端环境变量 `VITE_HOLDINGS_API_BASE_URL`。

### 4. 单独启动后端（可选）

```
uvicorn api.akshare_server:app --host 0.0.0.0 --port 8001
```

## 配置说明

常用配置位于前端设置页，主要字段包括：

- `fundCodes`：基金列表
- `refreshIntervalSec`：刷新间隔（秒）
- `quoteSourceId`：行情来源（sina/custom）
- `holdingsApiBaseUrl`：后端服务地址

## 实时估值策略

当前默认策略为 `improved_v1`，核心思路：

- 持仓驱动：基于前十大持仓与实时行情计算贡献
- 类型感知：按基金类型动态调整“持仓贡献 vs 指数代理”权重
- 时效衰减：持仓报告越旧，越降低持仓贡献权重，减少季报滞后误差
- 安全回退：若缺关键行情，自动回退到可用代理路径，不阻断展示

说明：所有策略都保留 `baseline` 对照，避免无对比迭代。

## 回测报告机制

- 接口：`GET /backtest_report`
- 行为：优先返回当前缓存结果；如需重算（`force_refresh=true`），后端启动后台任务并返回进度
- 返回字段（核心）：
  - `results`：当前已完成结果
  - `pending`：是否仍在后台计算
  - `total` / `completed`：进度统计
  - `updatedAt`：最近更新时间

前端回测页会自动轮询进度，直到任务完成。

## 策略优化规范（防未来函数与过拟合）

项目内置了优化规范 skill：`.cursor/skills/backtest-strategy-optimization/SKILL.md`，用于约束迭代过程：

- 严禁未来函数（look-ahead bias）
- 禁止按单基金单独调参后直接全局上线
- 必须保留 baseline 并做同窗 A/B 对比
- 不满足指标门槛时回滚策略

## 缓存与本地数据

以下文件为本地缓存与用户配置，已加入 `.gitignore`，不建议提交：

- `cache.json`：后端请求缓存
- `intraday_history.json`：日内估值历史点位
- `user_settings.json`：基金列表与用户配置
- `backtest_cache.json`：回测结果缓存
- `api/accuracy_history.json`：来源准确度历史

## 常见问题

### Q: 日内曲线没有回溯完整怎么办？
- 系统会在访问详情页时自动回溯当天 5 分钟历史点位，请确保后端可访问 AkShare 数据源。

### Q: 为什么跨浏览器基金列表会丢失？
- 已使用后端持久化 `user_settings.json`，请确认后端服务正常运行。

## 免责声明

本项目仅用于个人学习和研究，不构成任何投资建议。
