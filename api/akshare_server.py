import logging
import pandas as pd
import numpy as np
import json
import os
import re
import threading
import time
from datetime import datetime, date, timedelta, time as dt_time
from typing import Optional, List, Dict, Literal

import akshare as ak
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def resolve_cors_origins() -> List[str]:
    raw = os.getenv("CORS_ALLOW_ORIGINS", "*").strip()
    if raw == "*":
        return ["*"]
    origins = [v.strip() for v in raw.split(",") if v.strip()]
    return origins or ["*"]

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=resolve_cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

CACHE_TTL_SEC = 7 * 24 * 60 * 60 # 延长至 7 天
CACHE_FILE = "cache.json"
USER_SETTINGS_FILE = "user_settings.json"
INTRADAY_HISTORY_FILE = "intraday_history.json"
BACKTEST_CACHE_FILE = "backtest_cache.json"
FAIL_BASE_SEC = 10
FAIL_MAX_SEC = 300
NAV_REFRESH_AFTER_HOUR = 18
NAV_CHECK_INTERVAL_SEC = 30 * 60
cache_store = {}
backoff_store = {}
fund_info_cache = {} # 缓存基金名称等信息
stock_info_cache = {} # 缓存股票所属行业等信息
user_settings_data = {} # 存储基金列表等用户配置
intraday_history_data = {} # 存储日内估值点 { code: { date: [ { time, value } ] } }
data_lock = threading.Lock()
ak_lock = threading.Lock() # 专门用于保护 akshare 调用，防止 mini_racer 崩溃

class UserSettingsPayload(BaseModel):
    fundCodes: List[str] = Field(default_factory=list)
    refreshIntervalSec: int = Field(default=30, ge=5, le=3600)
    autoRefreshEnabled: bool = True
    quoteSourceId: Literal["sina", "custom"] = "sina"
    customQuoteUrlTemplate: str = ""
    holdingsApiBaseUrl: str = ""
    decimals: int = Field(default=3, ge=0, le=6)
    colorRule: Literal["red_up_green_down", "green_up_red_down"] = "red_up_green_down"
    theme: Literal["dark", "light"] = "dark"
    viewMode: Literal["standard", "compact"] = "standard"
    valuationMode: Literal["official", "holdings", "smart"] = "smart"

def normalize_fund_codes(codes: List[str]) -> List[str]:
    seen = set()
    output = []
    for code in codes:
        c = str(code).strip()
        if not c or c in seen:
            continue
        seen.add(c)
        output.append(c)
    return output

def call_ak(func, *args, **kwargs):
    """
    带锁调用 akshare 接口，确保线程安全并防止 V8 崩溃
    """
    with ak_lock:
        try:
            return func(*args, **kwargs)
        except Exception as e:
            logger.error(f"akshare call error ({func.__name__}): {e}")
            return None

def load_persistent_cache():
    global cache_store, fund_info_cache, stock_info_cache, user_settings_data, intraday_history_data
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # 恢复 cache_store (不再在启动时过滤过期的，保留作为兜底)
                cache_store = data.get("cache_store", {})
                fund_info_cache = data.get("fund_info_cache", {})
                stock_info_cache = data.get("stock_info_cache", {})
                logger.info(f"Loaded {len(cache_store)} cached funds, {len(fund_info_cache)} fund names, and {len(stock_info_cache)} stock info entries")
        except Exception as e:
            logger.error(f"Error loading persistent cache: {e}")
    
    if os.path.exists(USER_SETTINGS_FILE):
        try:
            with open(USER_SETTINGS_FILE, 'r', encoding='utf-8') as f:
                user_settings_data = json.load(f)
                logger.info(f"Loaded user settings from {USER_SETTINGS_FILE}")
        except Exception as e:
            logger.error(f"Error loading user settings: {e}")

    if os.path.exists(INTRADAY_HISTORY_FILE):
        try:
            with open(INTRADAY_HISTORY_FILE, 'r', encoding='utf-8') as f:
                intraday_history_data = json.load(f)
                # 清理 3 天前的数据
                cutoff = (date.today() - timedelta(days=3)).isoformat()
                for code in list(intraday_history_data.keys()):
                    for d in list(intraday_history_data[code].keys()):
                        if d < cutoff:
                            del intraday_history_data[code][d]
                logger.info(f"Loaded intraday history for {len(intraday_history_data)} funds")
        except Exception as e:
            logger.error(f"Error loading intraday history: {e}")

# 准确度记录
accuracy_history_data = {} # { code: { date: { "eastmoney": error, "holdings": error } } }
ACCURACY_HISTORY_FILE = os.path.join(os.path.dirname(__file__), "accuracy_history.json")
backtest_cache_data = {} # { date: { code: { mae, hit_rate_02, hit_rate_05, max_err } } }

def load_accuracy_history():
    global accuracy_history_data
    if os.path.exists(ACCURACY_HISTORY_FILE):
        try:
            with open(ACCURACY_HISTORY_FILE, "r") as f:
                accuracy_history_data = json.load(f)
        except Exception as e:
            logger.error(f"Failed to load accuracy history: {e}")
            accuracy_history_data = {}

def save_accuracy_history():
    try:
        with open(ACCURACY_HISTORY_FILE, "w") as f:
            json.dump(accuracy_history_data, f)
    except Exception as e:
        logger.error(f"Failed to save accuracy history: {e}")

def load_backtest_cache():
    global backtest_cache_data
    if os.path.exists(BACKTEST_CACHE_FILE):
        try:
            with open(BACKTEST_CACHE_FILE, "r") as f:
                backtest_cache_data = json.load(f)
        except Exception as e:
            logger.error(f"Failed to load backtest cache: {e}")
            backtest_cache_data = {}

def save_backtest_cache():
    try:
        with open(BACKTEST_CACHE_FILE, "w") as f:
            json.dump(backtest_cache_data, f)
    except Exception as e:
        logger.error(f"Failed to save backtest cache: {e}")

load_accuracy_history()
load_backtest_cache()

def record_accuracy(code: str, target_date: str, actual_zzl: float):
    """
    计算并记录该基金在该日期的估值准确度
    """
    with data_lock:
        fund_history = intraday_history_data.get(code, {})
        day_points = fund_history.get(target_date, [])
        if not day_points:
            return

        # 寻找接近 15:00 的点
        eastmoney_final = None
        holdings_final = None
        
        # 按时间排序，找最接近收盘的点
        sorted_pts = sorted(day_points, key=lambda x: x["time"])
        for pt in reversed(sorted_pts):
            t = pt["time"]
            if t > "15:05": continue # 忽略盘后点
            
            src = pt.get("source", "holdings")
            val = pt["value"]
            if src == "eastmoney" and eastmoney_final is None:
                eastmoney_final = val
            elif src == "holdings" and holdings_final is None:
                holdings_final = val
            
            if eastmoney_final is not None and holdings_final is not None:
                break
        
        errors = {}
        if eastmoney_final is not None:
            errors["eastmoney"] = abs(eastmoney_final - actual_zzl)
        if holdings_final is not None:
            errors["holdings"] = abs(holdings_final - actual_zzl)
            
        if errors:
            if code not in accuracy_history_data:
                accuracy_history_data[code] = {}
            accuracy_history_data[code][target_date] = errors
            save_accuracy_history()
            logger.info(f"Recorded accuracy for {code} on {target_date}: {errors}")

def get_best_source(code: str) -> str:
    """
    根据历史准确度，返回该基金建议的估值来源
    """
    with data_lock:
        history = accuracy_history_data.get(code, {})
        if not history:
            return "eastmoney" # 默认官方
            
        # 取最近 5 个有记录的交易日
        sorted_dates = sorted(history.keys(), reverse=True)[:5]
        
        east_errors = []
        hold_errors = []
        
        for d in sorted_dates:
            errs = history[d]
            if "eastmoney" in errs: east_errors.append(errs["eastmoney"])
            if "holdings" in errs: hold_errors.append(errs["holdings"])
            
        if not east_errors: return "holdings"
        if not hold_errors: return "eastmoney"
        
        avg_east = sum(east_errors) / len(east_errors)
        avg_hold = sum(hold_errors) / len(hold_errors)
        
        return "holdings" if avg_hold < avg_east else "eastmoney"

def save_persistent_cache():
    try:
        with data_lock:
            payload = json.loads(json.dumps({
                "cache_store": cache_store,
                "fund_info_cache": fund_info_cache,
                "stock_info_cache": stock_info_cache
            }))
        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Error saving persistent cache: {e}")

def save_user_settings():
    try:
        with data_lock:
            payload = json.loads(json.dumps(user_settings_data))
        with open(USER_SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            logger.info(f"Saved user settings to {USER_SETTINGS_FILE}")
    except Exception as e:
        logger.error(f"Error saving user settings: {e}")

def save_intraday_history():
    try:
        with data_lock:
            payload = json.loads(json.dumps(intraday_history_data))
        with open(INTRADAY_HISTORY_FILE, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Error saving intraday history: {e}")

# 启动时加载
load_persistent_cache()

def pick_col(columns, names):
    for name in names:
        if name in columns:
            return name
    # 模糊匹配
    for name in names:
        for col in columns:
            if name in str(col):
                return col
    return None


def get_fund_name(code: str):
    if code in fund_info_cache:
        return fund_info_cache[code]
    try:
        logger.info(f"Fetching fund name for {code}")
        # 尝试多个接口获取名称
        try:
            df = call_ak(ak.fund_individual_basic_info_xq, symbol=code)
            if df is not None and not df.empty:
                name_row = df[df["item"] == "基金名称"]
                if not name_row.empty:
                    name = str(name_row["value"].iloc[0]).strip()
                    fund_info_cache[code] = name
                    save_persistent_cache()
                    return name
        except Exception as e:
            logger.debug(f"Primary fund name source failed for {code}: {e}")

        try:
            # 备选：天天基金列表
            df = call_ak(ak.fund_open_fund_daily_em)
            if df is not None and not df.empty:
                col_code = pick_col(df.columns, ["基金代码", "代码"])
                col_name = pick_col(df.columns, ["基金简称", "名称"])
                match = df[df[col_code] == code]
                if not match.empty:
                    name = str(match.iloc[0][col_name]).strip()
                    fund_info_cache[code] = name
                    save_persistent_cache()
                    return name
        except Exception as e:
            logger.debug(f"Fallback fund name source failed for {code}: {e}")
        
    except Exception as e:
        logger.error(f"Error fetching fund name for {code}: {e}")
    return None


_all_funds_df = None


def find_target_etf_code(feeder_code: str, feeder_name: str):
    global _all_funds_df
    if "联接" not in feeder_name:
        return None

    # 提取目标名称：去掉“联接”及之后的部分
    # 例如：华泰柏瑞沪深300ETF联接A -> 华泰柏瑞沪深300ETF
    target_name = feeder_name.split("联接")[0]
    # 进一步清理名称，去掉末尾的“发起式”、“A/C/I”、“(QDII-ETF)”等
    target_name = re.sub(r'(\(QDII-ETF\))+$', '', target_name)
    target_name = re.sub(r'(发起式|发起|型|开放式|指数|证券投资|基金|份额|[ACI])+$', '', target_name)
    # 如果包含 ETF，通常保留到 ETF 即可
    if "ETF" in target_name:
        target_name = target_name.split("ETF")[0] + "ETF"

    logger.info(f"Searching target ETF for {feeder_code} ({feeder_name}) with keyword: {target_name}")

    try:
        if _all_funds_df is None:
            _all_funds_df = call_ak(ak.fund_name_em)

        if _all_funds_df is None: return None

        # 搜索简称中包含 target_name 且不含“联接”的指数型基金
        mask = (_all_funds_df['基金简称'].str.contains(target_name)) & \
               (~_all_funds_df['基金简称'].str.contains('联接')) & \
               (_all_funds_df['基金类型'].str.contains('指数'))

        candidates = _all_funds_df[mask]
        if not candidates.empty:
            # 优先找名字最匹配的（通常名字较短的是 ETF 本身）
            candidates = candidates.copy()
            candidates['name_len'] = candidates['基金简称'].str.len()
            target_etf = candidates.sort_values('name_len').iloc[0]
            logger.info(f"Found target ETF: {target_etf['基金简称']} ({target_etf['基金代码']})")
            return target_etf['基金代码']
    except Exception as e:
        logger.error(f"Error finding target ETF: {e}")

    return None


def parse_actual_data(code: str):
    try:
        logger.info(f"Fetching actual daily change for {code}")
        
        # 优先尝试从每日净值更新列表获取，这个通常更新最快
        try:
            df_daily = call_ak(ak.fund_open_fund_daily_em)
            if df_daily is not None and not df_daily.empty:
                col_code = pick_col(df_daily.columns, ["基金代码", "代码"])
                match = df_daily[df_daily[col_code] == code]
                if not match.empty:
                    row = match.iloc[0]
                    col_zzl = pick_col(df_daily.columns, ["日增长率", "增长率"])
                    # 尝试找到日期列，通常格式是 "YYYY-MM-DD-单位净值"
                    actual_date = None
                    actual_nav = None
                    # 按日期倒序检查列名，找到最新的有效净值
                    nav_cols = sorted([col for col in df_daily.columns if "-单位净值" in col], reverse=True)
                    for col in nav_cols:
                        val = str(row[col]).strip()
                        if val and val != "nan" and val != "":
                            try:
                                date_str = col.split("-单位净值")[0]
                                actual_date = date_str
                                actual_nav = float(val)
                                break
                            except Exception as e:
                                logger.debug(f"Failed to parse actual nav date/value for {code}: {e}")
                                continue
                    
                    actual_zzl = None
                    if col_zzl:
                        try:
                            val = str(row[col_zzl]).replace("%", "").strip()
                            if val and val != "nan":
                                actual_zzl = float(val)
                        except Exception as e:
                            logger.debug(f"Failed to parse actual daily zzl for {code}: {e}")
                    
                    if actual_date and actual_zzl is not None:
                        logger.info(f"Found actual data for {code} from daily list: {actual_date} {actual_zzl}%")
                        return {
                            "actualZzl": actual_zzl,
                            "actualDate": actual_date,
                            "actualNav": actual_nav
                        }
        except Exception as e:
            logger.warning(f"Error fetching from daily list for {code}: {e}")

        # 备选：从单位净值走势获取
        df = call_ak(ak.fund_open_fund_info_em, symbol=code, indicator="单位净值走势")
        if df is not None and not df.empty:
            last_row = df.iloc[-1]
            # 找到列
            col_zzl = pick_col(df.columns, ["日增长率", "增长率"])
            col_date = pick_col(df.columns, ["净值日期", "日期"])
            col_nav = pick_col(df.columns, ["单位净值", "净值"])
            
            actual_zzl = None
            if col_zzl:
                try:
                    val = str(last_row[col_zzl]).replace("%", "").strip()
                    if val and val != "nan":
                        actual_zzl = float(val)
                except Exception as e:
                    logger.debug(f"Failed to parse latest actual zzl for {code}: {e}")
            
            actual_date = None
            if col_date:
                raw_date = last_row[col_date]
                if isinstance(raw_date, (datetime, date)):
                    actual_date = raw_date.strftime("%Y-%m-%d")
                else:
                    try:
                        actual_date = pd.to_datetime(str(raw_date)).strftime("%Y-%m-%d")
                    except Exception as e:
                        logger.debug(f"Failed to normalize actual date for {code}: {e}")
                        actual_date = str(raw_date).strip()[:10]
            
            actual_nav = None
            if col_nav:
                try:
                    val = str(last_row[col_nav]).strip()
                    if val and val != "nan":
                        actual_nav = float(val)
                except Exception as e:
                    logger.debug(f"Failed to parse actual nav for {code}: {e}")
            
            return {
                "actualZzl": actual_zzl,
                "actualDate": actual_date,
                "actualNav": actual_nav
            }
    except Exception as e:
        logger.error(f"Error fetching actual data for {code}: {e}")
    return None


def get_stock_industry(symbol: str):
    if symbol in stock_info_cache:
        return stock_info_cache[symbol].get("industry")
    try:
        # 仅对 6 位数字代码尝试获取行业（A股）
        if len(symbol) == 6 and symbol.isdigit():
            logger.info(f"Fetching industry for stock {symbol}")
            df = call_ak(ak.stock_individual_info_em, symbol=symbol)
            if df is not None and not df.empty:
                row = df[df["item"] == "行业"]
                if not row.empty:
                    industry = str(row["value"].iloc[0]).strip()
                    stock_info_cache[symbol] = {"industry": industry}
                    # 只有在真正获取到数据时才保存，避免频繁 IO
                    return industry
    except Exception as e:
        logger.warning(f"Failed to fetch industry for {symbol}: {e}")
    return None


def parse_latest_holdings(code: str, is_recursive=False):
    current_year = datetime.now().year
    candidates = []
    for year in [current_year, current_year - 1, current_year - 2]:
        try:
            logger.info(f"Fetching holdings for {code} year {year}")
            df = call_ak(ak.fund_portfolio_hold_em, symbol=code, date=str(year))
            if df is None or df.empty:
                logger.warning(f"No holdings data for {code} in {year}")
                continue
            candidates.append(df)
            break
        except Exception as e:
            logger.error(f"Error fetching holdings for {code} in {year}: {e}")
            continue

    if not candidates:
        # 如果是联接基金且第一次尝试，尝试获取其目标 ETF 的持仓
        if not is_recursive:
            name = get_fund_name(code)
            if name:
                target_code = find_target_etf_code(code, name)
                if target_code and target_code != code:
                    logger.info(f"Redirecting holdings fetch from {code} to target ETF {target_code}")
                    return parse_latest_holdings(target_code, is_recursive=True)
        return None

    df = candidates[0]
    col_symbol = pick_col(df.columns, ["股票代码", "代码", "股票代码(股)", "证券代码"])
    col_name = pick_col(df.columns, ["股票名称", "名称", "证券简称"])
    col_weight = pick_col(df.columns, ["占净值比例", "占基金净值比例", "占净值比", "占比"])
    col_date = pick_col(df.columns, ["季度", "报告期", "截止日期", "报告日期"])
    
    if not col_symbol or not col_weight:
        logger.warning(f"Required columns missing in holdings data for {code}. Columns: {df.columns.tolist()}")
        return None

    latest_date = None
    latest_label = None
    if col_date:
        # 获取唯一的报告期并排序，取最新的一个
        unique_dates = df[col_date].unique().tolist()
        if unique_dates:
            # 简单的字符串排序通常适用于 "2024年4季度..." 这种格式
            unique_dates.sort(reverse=True)
            latest_label = str(unique_dates[0]).strip()
            latest_date = latest_label
            logger.info(f"Detected latest report period for {code}: {latest_label}")
    rows = []
    for _, row in df.iterrows():
        if latest_label and str(row[col_date]).strip() != latest_label:
            continue
        symbol = str(row[col_symbol]).strip()
        if not symbol:
            continue
        weight_raw = row[col_weight]
        try:
            weight = float(str(weight_raw).replace("%", "").strip())
        except Exception:
            continue
        if weight <= 0:
            continue
        name = str(row[col_name]).strip() if col_name else ""
        industry = get_stock_industry(symbol)
        rows.append({"symbol": symbol, "name": name, "weight": weight, "industry": industry})
    rows.sort(key=lambda x: x["weight"], reverse=True)
    return {
        "holdingsDate": latest_date,
        "holdings": rows[:10],
    }


def parse_cash_ratio(code: str):
    url = f"https://fundf10.eastmoney.com/zcpz_{code}.html"
    try:
        logger.info(f"Fetching cash ratio for {code} from {url}")
        text = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10).text
    except Exception as e:
        logger.error(f"Error fetching cash ratio page for {code}: {e}")
        return None, None
    marker = "现金占净比"
    idx = text.find(marker)
    if idx < 0:
        logger.warning(f"Marker '{marker}' not found in page for {code}")
        return None, None
    snippet = text[idx: idx + 2000]
    import re
    # 尝试匹配紧随其后的表格行
    row_match = re.search(r"<tr.*?>(.*?)</tr>", snippet, re.S | re.I)
    if not row_match:
        logger.warning(f"No table row found in snippet for {code}")
        return None, None
    
    cells = re.findall(r"<td.*?>(.*?)</td>", row_match.group(1), re.S)
    if len(cells) < 4:
        # 如果当前行单元格不够，可能是 marker 在 th 中，尝试匹配下一个 tr
        next_row_match = re.search(r"</tr>\s*<tr.*?>(.*?)</tr>", snippet, re.S | re.I)
        if next_row_match:
            cells = re.findall(r"<td.*?>(.*?)</td>", next_row_match.group(1), re.S)
    
    if len(cells) < 4:
        logger.warning(f"Insufficient cells found in table row for {code}: {len(cells)}")
        return None, None
    
    # 清理 HTML 标签
    def clean_html(raw):
        return re.sub(r"<.*?>", "", raw).strip()

    date = clean_html(cells[0])
    cash_raw = clean_html(cells[3]).replace("%", "").strip()
    try:
        cash_ratio = float(cash_raw)
        logger.info(f"Parsed cash ratio for {code}: {cash_ratio} (date: {date})")
    except Exception as e:
        logger.error(f"Error parsing cash ratio value '{cash_raw}' for {code}: {e}")
        cash_ratio = None
    return cash_ratio, date


def parse_base_nav(code: str) -> Optional[tuple[float, str, Optional[dict]]]:
    try:
        logger.info(f"Fetching base nav for {code}")
        df = call_ak(ak.fund_open_fund_info_em, symbol=code, indicator="单位净值走势")
        if df is None or df.empty:
            logger.warning(f"No nav data for {code}")
            return None
        col_nav = pick_col(df.columns, ["单位净值", "净值"])
        col_date = pick_col(df.columns, ["净值日期", "日期"])
        if not col_nav:
            logger.warning(f"NAV column not found in data for {code}. Columns: {df.columns.tolist()}")
            return None
        nav_df = df
        if col_date:
            nav_df = df.copy()
            nav_df[col_date] = pd.to_datetime(nav_df[col_date], errors="coerce")
            nav_df = nav_df.dropna(subset=[col_date]).sort_values(col_date)
        last_row = nav_df.iloc[-1]
        val = float(str(last_row[col_nav]).strip())
        if col_date:
            raw_date = last_row[col_date]
            if isinstance(raw_date, (datetime, pd.Timestamp)):
                nav_date = raw_date.date().isoformat()
            else:
                nav_date = str(raw_date).strip()
                nav_date = nav_date.split(" ")[0] if " " in nav_date else nav_date
        else:
            nav_date = str(date.today().isoformat())
        nav_metrics = compute_nav_metrics(nav_df, col_date, col_nav)
        logger.info(f"Parsed base nav for {code}: {val} ({nav_date})")
        return val, nav_date, nav_metrics
    except Exception as e:
        logger.error(f"Error fetching base nav for {code}: {e}")
        return None


def compute_nav_metrics(nav_df: pd.DataFrame, col_date: Optional[str], col_nav: str) -> Optional[dict]:
    if not col_date:
        return None
    df = nav_df[[col_date, col_nav]].copy()
    df[col_date] = pd.to_datetime(df[col_date], errors="coerce")
    df[col_nav] = pd.to_numeric(df[col_nav], errors="coerce")
    df = df.dropna(subset=[col_date, col_nav]).sort_values(col_date)
    if df.empty:
        return None
    last_date = df[col_date].iloc[-1]
    last_nav = df[col_nav].iloc[-1]
    if not pd.notna(last_date) or not pd.notna(last_nav) or last_nav <= 0:
        return None

    def pick_return(days: int) -> Optional[float]:
        target = last_date - pd.Timedelta(days=days)
        prev = df[df[col_date] <= target]
        if prev.empty:
            return None
        prev_nav = prev[col_nav].iloc[-1]
        if not pd.notna(prev_nav) or prev_nav <= 0:
            return None
        return (last_nav / prev_nav - 1) * 100

    daily_returns = df[col_nav].pct_change().dropna()
    sharpe = None
    if len(daily_returns) > 1:
        std = daily_returns.std()
        if pd.notna(std) and std > 0:
            val = daily_returns.mean() / std * (252 ** 0.5)
            sharpe = float(val) if pd.notna(val) and np.isfinite(val) else None

    running_max = df[col_nav].cummax()
    drawdown = (df[col_nav] / running_max - 1).min()
    max_drawdown = float(drawdown * 100) if pd.notna(drawdown) and np.isfinite(drawdown) else None

    def safe_float(v):
        if v is None: return None
        try:
            fv = float(v)
            return fv if np.isfinite(fv) else None
        except (TypeError, ValueError):
            return None

    return {
        "ret1m": safe_float(pick_return(30)),
        "ret3m": safe_float(pick_return(90)),
        "ret1y": safe_float(pick_return(365)),
        "sharpe": sharpe,
        "maxDrawdown": max_drawdown,
    }


def should_refresh_nav(base_nav_date: Optional[str], nav_checked_at: Optional[float], now: float) -> bool:
    if nav_checked_at and now - nav_checked_at < NAV_CHECK_INTERVAL_SEC:
        return False
    if not base_nav_date:
        return True
    today_str = date.today().isoformat()
    if base_nav_date == today_str:
        return False
    if datetime.now().hour >= NAV_REFRESH_AFTER_HOUR:
        return True
    return False


def refresh_nav_snapshot(code: str, data: dict, now: float) -> dict:
    refreshed = dict(data)
    base_nav = parse_base_nav(code)
    if base_nav:
        refreshed["baseNav"] = base_nav[0]
        refreshed["baseNavDate"] = base_nav[1]
        refreshed["navMetrics"] = base_nav[2]
    actual_info = parse_actual_data(code)
    if actual_info:
        refreshed["actualZzl"] = actual_info.get("actualZzl")
        refreshed["actualDate"] = actual_info.get("actualDate")
        refreshed["actualNav"] = actual_info.get("actualNav")
        # 记录准确度
        if refreshed["actualZzl"] is not None and refreshed["actualDate"]:
            record_accuracy(code, refreshed["actualDate"], refreshed["actualZzl"])
    refreshed["navCheckedAt"] = now
    return refreshed


@app.get("/holdings")
def get_holdings(code: str):
    now = time.time()
    code = str(code).strip()
    if not code:
        raise HTTPException(status_code=400, detail="code required")
    cached = cache_store.get(code)
    if cached and cached["expires_at"] > now:
        data = cached["data"]
        base_nav_date = data.get("baseNavDate")
        nav_checked_at = cached.get("nav_checked_at")
        if should_refresh_nav(base_nav_date, nav_checked_at, now):
            refreshed = refresh_nav_snapshot(code, data, now)
            cached["data"] = refreshed
            cached["fetched_at"] = now
            cached["expires_at"] = now + CACHE_TTL_SEC
            cached["nav_checked_at"] = now
            save_persistent_cache()
            return {**refreshed, "cachedAt": now, "stale": False}
        return {**data, "cachedAt": cached["fetched_at"], "stale": False}
    backoff = backoff_store.get(code)
    if cached and backoff and backoff["next_at"] > now:
        data = cached["data"]
        return {**data, "cachedAt": cached["fetched_at"], "stale": True}
    if backoff and backoff["next_at"] > now:
        raise HTTPException(status_code=429, detail="backoff")
    holdings = parse_latest_holdings(code)
    if not holdings:
        if cached:
            data = cached["data"]
            logger.info(f"Using stale cache for {code} as new fetch failed")
            return {**data, "cachedAt": cached["fetched_at"], "stale": True}
        backoff = backoff_store.get(code, {"count": 0})
        count = backoff["count"] + 1
        delay = min(FAIL_BASE_SEC * (2 ** (count - 1)), FAIL_MAX_SEC)
        backoff_store[code] = {"count": count, "next_at": now + delay}
        
        # 收集错误信息
        error_detail = "no holdings found"
        logger.error(f"Holdings fetch failed for {code}: {error_detail}, backoff for {delay}s")
        raise HTTPException(status_code=404, detail=f"Holdings API failure for {code}: {error_detail}")
    cash_ratio, cash_date = parse_cash_ratio(code)
    base_nav = parse_base_nav(code)
    actual_info = parse_actual_data(code)
    fund_name = get_fund_name(code)
    
    holdings_date = holdings.get("holdingsDate") or cash_date
    data = {
        "code": code,
        "name": fund_name,
        "holdingsDate": holdings_date,
        "cashRatio": cash_ratio,
        "baseNav": base_nav[0] if base_nav else None,
        "baseNavDate": base_nav[1] if base_nav else None,
        "navMetrics": base_nav[2] if base_nav else None,
        "holdings": holdings["holdings"],
        "actualZzl": actual_info["actualZzl"] if actual_info else None,
        "actualDate": actual_info["actualDate"] if actual_info else None,
        "actualNav": actual_info["actualNav"] if actual_info else None,
    }
    cache_store[code] = {
        "data": data,
        "fetched_at": now,
        "expires_at": now + CACHE_TTL_SEC,
        "nav_checked_at": now,
    }
    backoff_store.pop(code, None)
    save_persistent_cache()
    return {**data, "cachedAt": now, "stale": False}


@app.get("/fund_history")
def get_fund_history(code: str):
    try:
        logger.info(f"Fetching history for {code}")
        df = call_ak(ak.fund_open_fund_info_em, symbol=code, indicator="单位净值走势")
        if df is not None and not df.empty:
            col_date = pick_col(df.columns, ["净值日期", "日期"])
            col_nav = pick_col(df.columns, ["单位净值", "净值"])
            
            history = []
            for _, row in df.iterrows():
                history.append({
                    "date": str(row[col_date]).strip(),
                    "nav": float(str(row[col_nav]).strip())
                })
            return {"code": code, "history": history}
    except Exception as e:
        logger.error(f"Error fetching history for {code}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    raise HTTPException(status_code=404, detail="history not found")


@app.get("/health")
def health():
    return {"ok": True, "time": datetime.utcnow().isoformat()}


@app.get("/user_settings")
def get_user_settings():
    with data_lock:
        return json.loads(json.dumps(user_settings_data))


@app.post("/user_settings")
def post_user_settings(settings: dict):
    global user_settings_data
    try:
        payload = UserSettingsPayload.model_validate(settings).model_dump()
    except AttributeError:
        payload = UserSettingsPayload.parse_obj(settings).dict()
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors())
    payload["fundCodes"] = normalize_fund_codes(payload.get("fundCodes", []))
    with data_lock:
        user_settings_data = payload
    save_user_settings()
    return {"ok": True}


def backfill_intraday_history(code: str):
    """
    通过 5 分钟历史 K 线回溯抓取并重建今日的估值序列
    """
    try:
        logger.info(f"Backfilling intraday history for {code} via historical 5-min K-lines")
        holdings_data = parse_latest_holdings(code)
        if not holdings_data: 
            logger.warning(f"No holdings data for {code}, cannot backfill")
            return
        
        cash_ratio, _ = parse_cash_ratio(code)
        cash_ratio = (cash_ratio or 0) / 100
        equity_ratio = max(0, 1 - cash_ratio)
        
        all_hist_data = {} # { symbol: { time: pct } }
        latest_data_date = None
        
        # 1. 抓取所有成分股的 5 分钟线
        for h in holdings_data["holdings"]:
            symbol = h["symbol"]
            symbol_key = symbol
            try:
                df = None
                df_daily = None
                
                # A 股 6 位数字
                if len(symbol) == 6 and symbol.isdigit():
                    df = call_ak(ak.stock_zh_a_hist_min_em, symbol=symbol, period='5', adjust='qfq')
                    df_daily = call_ak(ak.stock_zh_a_hist, symbol=symbol, period="daily", adjust="qfq")
                # 港股 1-5 位数字 (自动补齐 5 位)
                elif 1 <= len(symbol) <= 5 and symbol.isdigit():
                    hk_symbol = symbol.zfill(5)
                    df = call_ak(ak.stock_hk_hist_min_em, symbol=hk_symbol, period='5', adjust='qfq')
                    df_daily = call_ak(ak.stock_hk_hist, symbol=hk_symbol, period="daily", adjust="qfq")
                # 美股 字母
                elif symbol.isalpha() or "." in symbol:
                    us_symbol = symbol if "." in symbol else f"105.{symbol}"
                    df = call_ak(ak.stock_us_hist_min_em, symbol=us_symbol)
                    df_daily = call_ak(ak.stock_us_hist, symbol=us_symbol)
                
                if df is not None and not df.empty and df_daily is not None and not df_daily.empty:
                    df['时间'] = pd.to_datetime(df['时间'])
                    
                    # 确定目标日期：使用该股票最新的日期
                    target_date = df['时间'].dt.date.max()
                    if latest_data_date is None or target_date > latest_data_date:
                        latest_data_date = target_date
                    
                    target_df = df[df['时间'].dt.date == target_date]
                    if target_df.empty: continue

                    # 获取昨收
                    # 如果最后一行日期是 target_date，则昨收是倒数第二行
                    last_daily_row = df_daily.iloc[-1]
                    last_daily_date = pd.to_datetime(last_daily_row['日期']).date()
                    
                    if last_daily_date == target_date:
                        if len(df_daily) >= 2:
                            prev_close = float(df_daily.iloc[-2]['收盘'])
                        else:
                            # 只有一行数据，尝试从 5 分钟线的第一行开盘价近似（不推荐但作为保底）
                            prev_close = float(target_df.iloc[0]['开盘'])
                    else:
                        prev_close = float(last_daily_row['收盘'])
                    
                    if prev_close <= 0: continue
                    
                    hist_pts = {}
                    for _, row in target_df.iterrows():
                        time_key = row['时间'].strftime("%H:%M")
                        close_price = float(row['收盘'])
                        pct = (close_price - prev_close) / prev_close
                        hist_pts[time_key] = pct
                    all_hist_data[symbol_key] = hist_pts
                    
            except Exception as e:
                logger.warning(f"Failed to fetch 5-min history for {symbol}: {e}")
        
        if not all_hist_data: 
            logger.warning(f"No historical 5-min data fetched for any holdings of {code}")
            return
        
        # 2. 合并时间点并计算基金估值
        # 我们使用 latest_data_date 作为这批数据的归属日期
        if latest_data_date is None:
            return
        target_date_str = latest_data_date.isoformat()
        all_times = sorted(list(set([t for pts in all_hist_data.values() for t in pts.keys()])))
        
        reconstructed_points = []
        for t in all_times:
            matched_weight = 0
            matched_contribution = 0
            for h in holdings_data["holdings"]:
                symbol = h["symbol"]
                if symbol in all_hist_data and t in all_hist_data[symbol]:
                    pct = all_hist_data[symbol][t]
                    matched_weight += h["weight"]
                    matched_contribution += h["weight"] * pct
            
            if matched_weight > 0:
                final_return = (matched_contribution / matched_weight) * equity_ratio
                gszzl = round(final_return * 100, 4)
                reconstructed_points.append({"time": t, "value": gszzl, "source": "holdings"})
        
        if reconstructed_points:
            with data_lock:
                if code not in intraday_history_data:
                    intraday_history_data[code] = {}
                intraday_history_data[code][target_date_str] = reconstructed_points
            save_intraday_history()
            logger.info(f"Successfully reconstructed {len(reconstructed_points)} points for {code} on {target_date_str}")
            
    except Exception as e:
        logger.error(f"Error in backfill_intraday_history for {code}: {e}")


@app.get("/intraday_valuation")
def get_intraday_valuation(code: str):
    code = str(code).strip()
    today = date.today().isoformat()
    with data_lock:
        fund_data = json.loads(json.dumps(intraday_history_data.get(code, {})))
    
    # 优先获取今天的数据
    points = fund_data.get(today, [])
    
    # 如果今天点太少，尝试深度回溯
    if len(points) < 10:
        backfill_intraday_history(code)
        # 再次获取
        with data_lock:
            fund_data = json.loads(json.dumps(intraday_history_data.get(code, {})))
        points = fund_data.get(today, [])
    
    # 如果还是没点，可能是今天还没开盘或没数据，尝试获取最近一天的历史数据
    if not points and fund_data:
        dates = sorted(fund_data.keys(), reverse=True)
        if dates:
            latest_date_key = dates[0]
            logger.info(f"Today's intraday is empty for {code}, returning latest available from {latest_date_key}")
            points = fund_data[latest_date_key]
            
    normalized = []
    for p in points:
        if isinstance(p, dict) and "source" not in p:
            normalized.append({**p, "source": "holdings"})
        else:
            normalized.append(p)
    return normalized


@app.post("/intraday_valuation")
def post_intraday_valuation(payload: dict):
    code = str(payload.get("code")).strip()
    time_str = payload.get("time") # HH:mm
    value = payload.get("value")
    source = payload.get("source")
    
    if not code or not time_str or value is None:
        raise HTTPException(status_code=400, detail="missing fields")
    
    today = date.today().isoformat()
    with data_lock:
        if code not in intraday_history_data:
            intraday_history_data[code] = {}
        if today not in intraday_history_data[code]:
            intraday_history_data[code][today] = []
        
        history = intraday_history_data[code][today]
        existing = next((p for p in history if p["time"] == time_str), None)
        if existing:
            existing["value"] = value
            if source:
                existing["source"] = source
        else:
            point = {"time": time_str, "value": value}
            if source:
                point["source"] = source
            history.append(point)
            history.sort(key=lambda x: x["time"])
    
    save_intraday_history()
    return {"ok": True}


@app.get("/best_source")
def get_recommended_source(code: str):
    return {"code": code, "bestSource": get_best_source(code)}


def run_single_backtest(code: str, days=30):
    """
    对单个基金运行过去 30 天的回测
    """
    try:
        # 1. 获取持仓和基本信息
        holdings_data = parse_latest_holdings(code)
        if not holdings_data: return None
        
        cash_ratio, _ = parse_cash_ratio(code)
        cash_ratio = (cash_ratio or 0) / 100
        equity_ratio = 1 - cash_ratio
        
        # 2. 获取基金历史净值
        df_nav = call_ak(ak.fund_open_fund_info_em, symbol=code, indicator="单位净值走势")
        if df_nav is None or df_nav.empty: return None
        
        col_date = pick_col(df_nav.columns, ["净值日期", "日期"])
        col_nav = pick_col(df_nav.columns, ["单位净值", "净值"])
        col_zzl = pick_col(df_nav.columns, ["日增长率", "增长率"])
        
        df_nav[col_date] = pd.to_datetime(df_nav[col_date])
        df_nav = df_nav.sort_values(col_date).tail(days)
        
        if df_nav.empty: return None
        
        # 3. 获取重仓股历史行情
        start_date = df_nav[col_date].min().strftime("%Y%m%d")
        end_date = df_nav[col_date].max().strftime("%Y%m%d")
        
        stock_histories = {}
        for h in holdings_data["holdings"]:
            symbol = h["symbol"]
            df_s = None
            if len(symbol) == 6 and symbol.isdigit():
                df_s = call_ak(ak.stock_zh_a_hist, symbol=symbol, period="daily", start_date=start_date, end_date=end_date, adjust="qfq")
            elif 1 <= len(symbol) <= 5 and symbol.isdigit():
                df_s = call_ak(ak.stock_hk_hist, symbol=symbol.zfill(5), period="daily", start_date=start_date, end_date=end_date, adjust="qfq")
            else:
                df_s = call_ak(ak.stock_us_hist, symbol=symbol, period="daily", start_date=start_date, end_date=end_date, adjust="qfq")
            
            if df_s is not None and not df_s.empty:
                df_s["日期"] = pd.to_datetime(df_s["日期"])
                df_s = df_s.sort_values("日期")
                df_s["ret"] = df_s["收盘"].pct_change()
                stock_histories[symbol] = df_s
        
        # 4. 计算每日误差
        errors = []
        for _, row in df_nav.iterrows():
            d = row[col_date]
            actual = row[col_zzl]
            if isinstance(actual, str):
                try:
                    actual = float(actual.replace("%", ""))
                except Exception as e:
                    logger.debug(f"Failed to parse backtest daily return for {code}: {e}")
                    continue
            
            matched_w = 0
            contrib = 0
            for h in holdings_data["holdings"]:
                s = h["symbol"]
                w = h["weight"]
                if s in stock_histories:
                    s_df = stock_histories[s]
                    s_row = s_df[s_df["日期"] == d]
                    if not s_row.empty:
                        s_ret = s_row["ret"].iloc[0]
                        if pd.notna(s_ret):
                            matched_w += w
                            contrib += w * s_ret
            
            if matched_w > 0:
                est = (contrib / matched_w) * equity_ratio * 100
                errors.append(abs(est - actual))
        
        if not errors: return None
        
        errors_arr = np.array(errors)
        return {
            "code": code,
            "name": get_fund_name(code),
            "mae": float(np.mean(errors_arr)),
            "hit_rate_02": float(np.mean(errors_arr <= 0.2) * 100),
            "hit_rate_05": float(np.mean(errors_arr <= 0.5) * 100),
            "max_err": float(np.max(errors_arr)),
            "samples": len(errors)
        }
    except Exception as e:
        logger.error(f"Backtest failed for {code}: {e}")
        return None


@app.get("/backtest_report")
def get_backtest_report(force_refresh: bool = False):
    today = date.today().isoformat()
    with data_lock:
        codes = list(user_settings_data.get("fundCodes", []))
    
    if not codes:
        return {"date": today, "results": []}
    
    # 检查缓存
    if not force_refresh and today in backtest_cache_data:
        # 过滤掉不在当前列表中的基金
        cached_results = [backtest_cache_data[today][c] for c in codes if c in backtest_cache_data[today]]
        if len(cached_results) == len(codes):
            logger.info("Returning cached backtest report")
            return {"date": today, "results": cached_results}
    
    logger.info(f"Running full backtest for {len(codes)} funds...")
    results = []
    for code in codes:
        res = run_single_backtest(code)
        if res:
            results.append(res)
    
    # 更新缓存
    if today not in backtest_cache_data:
        backtest_cache_data[today] = {}
    
    for res in results:
        backtest_cache_data[today][res["code"]] = res
    
    # 清理旧缓存（保留 7 天）
    cutoff = (date.today() - timedelta(days=7)).isoformat()
    for d in list(backtest_cache_data.keys()):
        if d < cutoff:
            del backtest_cache_data[d]
            
    save_backtest_cache()
    return {"date": today, "results": results}


@app.get("/proxy/sina")
def proxy_sina(list: str):
    """
    代理新浪行情接口，解决前端 Referer 限制和 CORS 问题
    """
    if not list:
        raise HTTPException(status_code=400, detail="list required")
    
    url = f"https://hq.sinajs.cn/list={list}"
    headers = {
        "Referer": "https://finance.sina.com.cn/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    try:
        # 使用 gbk 编码获取，因为新浪接口返回的是 gbk
        resp = requests.get(url, headers=headers, timeout=10)
        resp.encoding = "gbk"
        return {"data": resp.text}
    except Exception as e:
        logger.error(f"Sina proxy error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def fetch_sina_quotes_internal(symbols: List[str]) -> Dict[str, dict]:
    if not symbols: return {}
    url = f"https://hq.sinajs.cn/list={','.join(symbols)}"
    headers = {"Referer": "https://finance.sina.com.cn/"}
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        resp.encoding = "gbk"
        data = {}
        for line in resp.text.splitlines():
            if "=" not in line: continue
            symbol = line.split("=")[0].split("hq_str_")[-1]
            content = line.split('"')[1]
            parts = content.split(",")
            if len(parts) >= 4:
                # A股: name, open, prev_close, price, high, low, ...
                try:
                    price = float(parts[3])
                    prev_close = float(parts[2])
                    if prev_close > 0:
                        data[symbol] = {"price": price, "prev_close": prev_close}
                except Exception as e:
                    logger.debug(f"Failed to parse internal quote for {symbol}: {e}")
                    continue
        return data
    except Exception as e:
        logger.error(f"Error fetching internal quotes: {e}")
        return {}


def background_tracker_loop():
    logger.info("Starting background intraday tracker")
    while True:
        try:
            now = datetime.now()
            # 交易时间: 9:25-11:35, 12:55-15:05 (多留 5 分钟余量)
            is_weekday = now.weekday() < 5
            is_market_time = False
            if is_weekday:
                time_now = now.time()
                # A股交易时间: 9:15-11:30 (含竞价), 13:00-15:00
                if (dt_time(9, 15) <= time_now <= dt_time(11, 30)) or \
                   (dt_time(13, 0) <= time_now <= dt_time(15, 0)):
                    is_market_time = True
            
            if is_market_time:
                with data_lock:
                    fund_codes = list(user_settings_data.get("fundCodes", []))
                if fund_codes:
                    logger.info(f"Background tracking {len(fund_codes)} funds")
                    for code in fund_codes:
                        try:
                            # 1. 获取持仓和现金比
                            holdings_data = parse_latest_holdings(code)
                            if not holdings_data: continue
                            
                            cash_ratio, _ = parse_cash_ratio(code)
                            cash_ratio = (cash_ratio or 0) / 100
                            equity_ratio = max(0, 1 - cash_ratio)
                            
                            # 2. 获取行情
                            symbols = [h["symbol"] for h in holdings_data["holdings"]]
                            quotes = fetch_sina_quotes_internal(symbols)
                            
                            # 3. 计算估值 (全仓缩放模型)
                            matched_weight = 0
                            matched_contribution = 0
                            for h in holdings_data["holdings"]:
                                q = quotes.get(h["symbol"])
                                if q and q["prev_close"] > 0:
                                    pct = (q["price"] - q["prev_close"]) / q["prev_close"]
                                    matched_contribution += h["weight"] * pct
                                    matched_weight += h["weight"]
                            
                            if matched_weight > 0:
                                final_return = (matched_contribution / matched_weight) * equity_ratio
                                gszzl = round(final_return * 100, 4)
                                
                                # 4. 记录
                                minutes = ((now.minute + 4) // 5) * 5
                                if minutes >= 60:
                                    rounded_time = (now + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0).strftime("%H:%M")
                                else:
                                    rounded_time = now.replace(minute=minutes, second=0, microsecond=0).strftime("%H:%M")
                                
                                post_intraday_valuation({
                                    "code": code,
                                    "time": rounded_time,
                                    "value": gszzl
                                })
                        except Exception as e:
                            logger.error(f"Error tracking fund {code}: {e}")
                        
                        # 增加一个小延迟，避免过快连续调用导致 V8/akshare 压力过大
                        time.sleep(1)
            
            # 每 5 分钟运行一次
            time.sleep(300) 
        except Exception as e:
            logger.error(f"Background tracker error: {e}")
            time.sleep(60)

# 启动后台线程
tracker_thread = threading.Thread(target=background_tracker_loop, daemon=True)
tracker_thread.start()
