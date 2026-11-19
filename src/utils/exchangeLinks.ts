export function buildTradingViewMexcUrl(rawSymbol: string, interval: "15" | "60" = "15"): string {
  const symbol = rawSymbol.toUpperCase().trim();
  return `https://www.tradingview.com/chart/?symbol=MEXC:${encodeURIComponent(symbol)}&interval=${interval}`;
}

export function buildTelegramSignalReplyMarkup(rawSymbol: string, entryPrice: number) {
  const symbol = rawSymbol.toUpperCase().trim();
  const safeEntry = Number.isFinite(entryPrice) ? String(entryPrice) : "0";
  return {
    inline_keyboard: [
      [
        { text: "📈 TradingView (MEXC 15M)", url: buildTradingViewMexcUrl(symbol, "15") },
        { text: "🔄 Jonli narx", callback_data: `sig_refresh:${symbol}:${safeEntry}` }
      ],
      [
        { text: "📊 1H Grafik", callback_data: `sig_1h:${symbol}` },
        { text: "🧪 Backtest", callback_data: `sig_bt:${symbol}` }
      ]
    ]
  };
}
