import logging
import pandas as pd
import numpy as np
import akshare as ak
import sys
import os
from datetime import datetime, timedelta

# 添加当前目录到路径
sys.path.append(os.path.dirname(__file__))

from akshare_server import (
    call_ak, 
    parse_latest_holdings, 
    parse_cash_ratio, 
    pick_col,
    get_fund_name
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def get_historical_data(symbol, start_date, end_date):
    """获取股票/指数历史日线"""
    try:
        # A股
        if len(symbol) == 6 and symbol.isdigit():
            df = ak.stock_zh_a_hist(symbol=symbol, period="daily", start_date=start_date, end_date=end_date, adjust="qfq")
        # 港股
        elif 1 <= len(symbol) <= 5 and symbol.isdigit():
            df = ak.stock_hk_hist(symbol=symbol.zfill(5), period="daily", start_date=start_date, end_date=end_date, adjust="qfq")
        # 美股
        else:
            df = ak.stock_us_hist(symbol=symbol, period="daily", start_date=start_date, end_date=end_date, adjust="qfq")
        
        if df is not None and not df.empty:
            df['日期'] = pd.to_datetime(df['日期'])
            return df
    except Exception as e:
        logger.error(f"Error fetching history for {symbol}: {e}")
    return None

def run_backtest(fund_code, days=20):
    logger.info(f"开始回测基金: {fund_code} (最近 {days} 个交易日)")
    
    # 1. 获取基本信息
    fund_name = get_fund_name(fund_code)
    holdings_data = parse_latest_holdings(fund_code)
    if not holdings_data:
        logger.error("无法获取持仓数据")
        return
    
    cash_ratio, _ = parse_cash_ratio(fund_code)
    cash_ratio = (cash_ratio or 0) / 100
    equity_ratio = 1 - cash_ratio
    
    # 2. 获取基金历史净值
    end_date_dt = datetime.now()
    start_date_dt = end_date_dt - timedelta(days=days * 2) # 多取一点以防周末
    start_str = start_date_dt.strftime("%Y%m%d")
    end_str = end_date_dt.strftime("%Y%m%d")
    
    logger.info("正在获取基金历史净值...")
    fund_nav_df = call_ak(ak.fund_open_fund_info_em, symbol=fund_code, indicator="单位净值走势")
    if fund_nav_df is None or fund_nav_df.empty:
        logger.error("无法获取基金历史净值")
        return
    
    col_date = pick_col(fund_nav_df.columns, ["净值日期", "日期"])
    col_nav = pick_col(fund_nav_df.columns, ["单位净值", "净值"])
    col_zzl = pick_col(fund_nav_df.columns, ["日增长率", "增长率"])
    
    fund_nav_df[col_date] = pd.to_datetime(fund_nav_df[col_date])
    fund_nav_df = fund_nav_df.sort_values(col_date)
    fund_nav_df = fund_nav_df.tail(days)
    
    # 3. 获取所有重仓股的历史表现
    logger.info(f"正在获取 {len(holdings_data['holdings'])} 只重仓股的历史行情...")
    stock_histories = {}
    for h in holdings_data['holdings']:
        symbol = h['symbol']
        df = get_historical_data(symbol, start_str, end_str)
        if df is not None:
            # 计算日增长率
            df = df.sort_values('日期')
            df['涨跌幅'] = df['收盘'].pct_change()
            stock_histories[symbol] = df
            
    # 4. 对齐日期并计算模拟估值
    results = []
    for _, row in fund_nav_df.iterrows():
        target_date = row[col_date]
        actual_zzl = row[col_zzl]
        if isinstance(actual_zzl, str):
            actual_zzl = float(actual_zzl.replace('%', ''))
            
        # 计算该日模拟涨跌幅
        matched_weight = 0
        contribution = 0
        
        for h in holdings_data['holdings']:
            symbol = h['symbol']
            weight = h['weight']
            if symbol in stock_histories:
                stock_df = stock_histories[symbol]
                day_row = stock_df[stock_df['日期'] == target_date]
                if not day_row.empty:
                    stock_ret = day_row['涨跌幅'].iloc[0]
                    if pd.notna(stock_ret):
                        matched_weight += weight
                        contribution += weight * stock_ret
        
        if matched_weight > 0:
            # 全仓缩放模型
            est_zzl = (contribution / matched_weight) * equity_ratio * 100
            error = est_zzl - actual_zzl
            results.append({
                "date": target_date.strftime("%Y-%m-%d"),
                "actual": actual_zzl,
                "estimated": est_zzl,
                "error": error,
                "abs_error": abs(error)
            })
            
    if not results:
        logger.error("回测失败：未能匹配到足够的历史数据点")
        return

    # 5. 生成报告
    df_res = pd.DataFrame(results)
    mae = df_res['abs_error'].mean()
    rmse = np.sqrt((df_res['error']**2).mean())
    max_err = df_res['abs_error'].max()
    hit_rate_05 = (df_res['abs_error'] <= 0.5).mean() * 100 # 误差 0.5% 以内
    hit_rate_02 = (df_res['abs_error'] <= 0.2).mean() * 100 # 误差 0.2% 以内
    
    print("\n" + "="*50)
    print(f"回测报告: {fund_name} ({fund_code})")
    print(f"持仓日期: {holdings_data.get('holdingsDate', '未知')}")
    print(f"现金比例: {cash_ratio*100:.2f}%")
    print(f"测试样本: {len(df_res)} 天")
    print("-" * 50)
    print(f"平均绝对误差 (MAE): {mae:.4f}%")
    print(f"均方根误差 (RMSE): {rmse:.4f}%")
    print(f"最大偏差: {max_err:.4f}%")
    print(f"准确率 (误差<=0.2%): {hit_rate_02:.2f}%")
    print(f"准确率 (误差<=0.5%): {hit_rate_05:.2f}%")
    print("-" * 50)
    
    # 评价
    if mae < 0.15:
        rating = "☆☆☆☆☆ (极准)"
    elif mae < 0.3:
        rating = "☆☆☆☆ (很准)"
    elif mae < 0.5:
        rating = "☆☆☆ (一般)"
    else:
        rating = "☆☆ (较差，可能存在调仓或大量申赎)"
        
    print(f"综合评价: {rating}")
    print("="*50)
    
    # 列出偏差最大的 3 天
    print("\n偏差最大的 3 天:")
    print(df_res.sort_values('abs_error', ascending=False).head(3).to_string(index=False))
    
    return df_res

if __name__ == "__main__":
    code = "014163" # 默认测试一个 QDII 基金
    if len(sys.argv) > 1:
        code = sys.argv[1]
    run_backtest(code)
