import zlib from "zlib";
import { MexcKline } from "./mexcClient.service";

export interface ChartLevels {
  symbol: string;
  entryPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  verdict?: "APPROVE" | "REJECT" | string;
  timeframeLabel?: string;
}

type RGB = [number, number, number];

// Minimal 5x7 uppercase/numeric bitmap font for crisp native PNG rendering (zero native deps)
const FONT_5X7: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11100", "10010", "10001", "10001", "10001", "10010", "11100"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10011", "10101", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["01110", "10000", "11110", "10001", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "/": ["00001", "00010", "00100", "00100", "01000", "10000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "%": ["11001", "11010", "00100", "00100", "01011", "10011", "00000"],
  $: ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "|": ["00100", "00100", "00100", "00100", "00100", "00100", "00100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"]
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRgbPng(width: number, height: number, pixels: Buffer): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 2; // RGB color type
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter None
    pixels.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    signature,
    makePngChunk("IHDR", ihdr),
    makePngChunk("IDAT", compressed),
    makePngChunk("IEND", Buffer.alloc(0))
  ]);
}

class PixelCanvas {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;

  constructor(width: number, height: number, bg: RGB) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 3);
    this.fillRect(0, 0, width, height, bg);
  }

  setPixel(x: number, y: number, color: RGB, alpha = 1): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return;
    const idx = (yi * this.width + xi) * 3;
    if (alpha >= 1) {
      this.data[idx] = color[0];
      this.data[idx + 1] = color[1];
      this.data[idx + 2] = color[2];
    } else {
      const inv = 1 - alpha;
      this.data[idx] = Math.round(color[0] * alpha + this.data[idx] * inv);
      this.data[idx + 1] = Math.round(color[1] * alpha + this.data[idx + 1] * inv);
      this.data[idx + 2] = Math.round(color[2] * alpha + this.data[idx + 2] * inv);
    }
  }

  fillRect(x: number, y: number, w: number, h: number, color: RGB, alpha = 1): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        this.setPixel(px, py, color, alpha);
      }
    }
  }

  strokeRect(x: number, y: number, w: number, h: number, color: RGB): void {
    this.fillRect(x, y, w, 1, color);
    this.fillRect(x, y + h - 1, w, 1, color);
    this.fillRect(x, y, 1, h, color);
    this.fillRect(x + w - 1, y, 1, h, color);
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, color: RGB, thickness = 1, alpha = 1): void {
    let ix0 = Math.round(x0);
    let iy0 = Math.round(y0);
    const ix1 = Math.round(x1);
    const iy1 = Math.round(y1);
    const dx = Math.abs(ix1 - ix0);
    const dy = Math.abs(iy1 - iy0);
    const sx = ix0 < ix1 ? 1 : -1;
    const sy = iy0 < iy1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      if (thickness <= 1) {
        this.setPixel(ix0, iy0, color, alpha);
      } else {
        this.fillRect(ix0 - Math.floor(thickness / 2), iy0 - Math.floor(thickness / 2), thickness, thickness, color, alpha);
      }
      if (ix0 === ix1 && iy0 === iy1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        ix0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        iy0 += sy;
      }
    }
  }

  drawDashedHLine(x0: number, x1: number, y: number, color: RGB, dash = 8, gap = 5, alpha = 0.9): void {
    let x = Math.floor(x0);
    const end = Math.ceil(x1);
    while (x < end) {
      const segEnd = Math.min(x + dash, end);
      this.fillRect(x, y, segEnd - x, 1, color, alpha);
      x += dash + gap;
    }
  }

  drawText(text: string, x: number, y: number, color: RGB, scale = 1): void {
    const upper = text.toUpperCase();
    let cursorX = Math.round(x);
    const baseY = Math.round(y);
    for (const ch of upper) {
      const glyph = FONT_5X7[ch] ?? FONT_5X7[" "];
      for (let row = 0; row < glyph.length; row++) {
        const bits = glyph[row];
        for (let col = 0; col < bits.length; col++) {
          if (bits[col] === "1") {
            this.fillRect(cursorX + col * scale, baseY + row * scale, scale, scale, color);
          }
        }
      }
      cursorX += 6 * scale;
    }
  }

  measureTextWidth(text: string, scale = 1): number {
    return Math.max(0, text.length * 6 * scale - scale);
  }
}

function calcEmaSeries(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let ema = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    ema = i === 0 ? values[i] : values[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

function formatAxisPrice(price: number): string {
  if (!Number.isFinite(price)) return "0";
  if (price >= 1000) return price.toFixed(1);
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(6);
}

function formatDisplayPair(symbol: string): string {
  const clean = symbol.toUpperCase().trim();
  if (clean.endsWith("USDT") && clean.length > 4) {
    return `${clean.slice(0, -4)}/USDT`;
  }
  return clean;
}

export function generate15mChartPng(klines: MexcKline[], levels: ChartLevels): Buffer {
  const W = 960;
  const H = 540;

  const BG: RGB = [11, 18, 32];
  const PANEL_BG: RGB = [15, 23, 42];
  const GRID: RGB = [30, 41, 59];
  const BORDER: RGB = [51, 65, 85];
  const TEXT_PRIMARY: RGB = [241, 245, 249];
  const TEXT_MUTED: RGB = [148, 163, 184];
  const BULL: RGB = [16, 185, 129];
  const BEAR: RGB = [239, 68, 68];
  const EMA9_COLOR: RGB = [56, 189, 248];
  const EMA21_COLOR: RGB = [245, 158, 11];
  const TP_COLOR: RGB = [34, 197, 94];
  const ENTRY_COLOR: RGB = [56, 189, 248];
  const SL_COLOR: RGB = [244, 63, 94];

  const canvas = new PixelCanvas(W, H, BG);
  const candles = klines.slice(-60);
  const tf = (levels.timeframeLabel || "15M").toUpperCase();
  const displayPair = formatDisplayPair(levels.symbol);

  // Header bar
  canvas.fillRect(0, 0, W, 56, [15, 23, 42]);
  canvas.fillRect(0, 55, W, 1, BORDER);

  canvas.drawText(`${displayPair} ${tf}`, 20, 16, TEXT_PRIMARY, 3);
  const titleW = canvas.measureTextWidth(`${displayPair} ${tf}`, 3);
  canvas.drawText("MEXC SPOT", 34 + titleW, 24, TEXT_MUTED, 2);

  // Verdict badge on right side of header
  const verdict = (levels.verdict || "INFO").toUpperCase();
  const badgeColor: RGB =
    verdict === "APPROVE" ? [21, 128, 61] : verdict === "REJECT" ? [185, 28, 28] : [30, 64, 175];
  const badgeText = verdict === "APPROVE" ? "APPROVE" : verdict === "REJECT" ? "REJECT" : verdict;
  const badgeW = canvas.measureTextWidth(badgeText, 2) + 24;
  canvas.fillRect(W - badgeW - 20, 13, badgeW, 30, badgeColor);
  canvas.drawText(badgeText, W - badgeW - 8, 21, TEXT_PRIMARY, 2);

  // Layout bounds
  const plotLeft = 20;
  const plotRight = W - 125;
  const plotW = plotRight - plotLeft;
  const priceTop = 72;
  const priceBottom = 382;
  const priceH = priceBottom - priceTop;
  const volTop = 398;
  const volBottom = 492;
  const volH = volBottom - volTop;

  // Plot backgrounds
  canvas.fillRect(plotLeft, priceTop, plotW, priceH, PANEL_BG);
  canvas.strokeRect(plotLeft, priceTop, plotW, priceH, BORDER);
  canvas.fillRect(plotLeft, volTop, plotW, volH, PANEL_BG);
  canvas.strokeRect(plotLeft, volTop, plotW, volH, BORDER);

  if (candles.length > 0) {
    // Compute price range including candles + Entry/TP/SL levels
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    for (const c of candles) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
    }
    const levelValues = [levels.entryPrice, levels.takeProfitPrice, levels.stopLossPrice].filter(
      (v) => Number.isFinite(v) && v > 0
    );
    for (const lv of levelValues) {
      if (lv < minPrice) minPrice = lv;
      if (lv > maxPrice) maxPrice = lv;
    }
    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || maxPrice <= minPrice) {
      const ref = levels.entryPrice || candles[candles.length - 1].close || 1;
      minPrice = ref * 0.98;
      maxPrice = ref * 1.02;
    }
    const pad = (maxPrice - minPrice) * 0.08;
    minPrice -= pad;
    maxPrice += pad;

    const priceToY = (p: number): number => {
      const norm = (p - minPrice) / Math.max(maxPrice - minPrice, 1e-12);
      return priceBottom - 6 - norm * (priceH - 12);
    };

    // Horizontal gridlines & Y-axis labels
    const gridSteps = 5;
    for (let g = 0; g <= gridSteps; g++) {
      const frac = g / gridSteps;
      const pVal = maxPrice - frac * (maxPrice - minPrice);
      const y = Math.round(priceTop + 6 + frac * (priceH - 12));
      canvas.fillRect(plotLeft + 1, y, plotW - 2, 1, GRID);
      canvas.drawText(formatAxisPrice(pVal), plotRight + 8, y - 4, TEXT_MUTED, 1);
    }

    // Vertical gridlines
    const vSteps = 6;
    for (let v = 1; v < vSteps; v++) {
      const x = Math.round(plotLeft + (plotW * v) / vSteps);
      canvas.fillRect(x, priceTop + 1, 1, priceH - 2, GRID);
      canvas.fillRect(x, volTop + 1, 1, volH - 2, GRID);
    }

    // Volume scaling
    const maxVol = Math.max(
      ...candles.map((c) => (c.quoteAssetVolume > 0 ? c.quoteAssetVolume : c.volume)),
      1
    );

    const stepX = (plotW - 16) / Math.max(candles.length, 1);
    const bodyW = Math.max(3, Math.min(11, Math.floor(stepX * 0.65)));

    // Draw candles & volume bars
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const cx = Math.round(plotLeft + 8 + (i + 0.5) * stepX);
      const isBull = c.close >= c.open;
      const color = isBull ? BULL : BEAR;

      // Wick
      const yHigh = priceToY(c.high);
      const yLow = priceToY(c.low);
      canvas.fillRect(cx, yHigh, 1, Math.max(1, yLow - yHigh), color);

      // Body
      const yOpen = priceToY(c.open);
      const yClose = priceToY(c.close);
      const bodyTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(2, Math.abs(yClose - yOpen));
      canvas.fillRect(cx - Math.floor(bodyW / 2), bodyTop, bodyW, bodyH, color);

      // Volume bar
      const volVal = c.quoteAssetVolume > 0 ? c.quoteAssetVolume : c.volume;
      const barH = Math.max(2, Math.round((volVal / maxVol) * (volH - 10)));
      canvas.fillRect(cx - Math.floor(bodyW / 2), volBottom - 2 - barH, bodyW, barH, color, 0.55);
    }

    // Overlay EMA9 & EMA21 curves
    const closes = candles.map((c) => c.close);
    const ema9 = calcEmaSeries(closes, 9);
    const ema21 = calcEmaSeries(closes, 21);

    for (let i = 1; i < candles.length; i++) {
      const xPrev = plotLeft + 8 + (i - 0.5) * stepX;
      const xCurr = plotLeft + 8 + (i + 0.5) * stepX;
      canvas.drawLine(xPrev, priceToY(ema21[i - 1]), xCurr, priceToY(ema21[i]), EMA21_COLOR, 2, 0.9);
      canvas.drawLine(xPrev, priceToY(ema9[i - 1]), xCurr, priceToY(ema9[i]), EMA9_COLOR, 2, 0.95);
    }

    // Draw Entry / TP / SL horizontal dashed lines + right-axis price tags
    const drawLevel = (label: string, price: number, color: RGB) => {
      if (!Number.isFinite(price) || price <= 0) return;
      const y = Math.round(priceToY(price));
      if (y < priceTop + 2 || y > priceBottom - 2) return;
      canvas.drawDashedHLine(plotLeft + 2, plotRight - 2, y, color, 7, 4, 0.95);
      // Price pill on right axis
      canvas.fillRect(plotRight + 3, y - 8, 118, 17, color);
      canvas.drawText(`${label} ${formatAxisPrice(price)}`, plotRight + 7, y - 3, [11, 18, 32], 1);
    };

    drawLevel("TP", levels.takeProfitPrice, TP_COLOR);
    drawLevel("EN", levels.entryPrice, ENTRY_COLOR);
    drawLevel("SL", levels.stopLossPrice, SL_COLOR);
  }

  // Volume label
  canvas.drawText("VOLUME", plotLeft + 8, volTop + 6, TEXT_MUTED, 1);

  // Footer legend
  const footerY = 508;
  canvas.fillRect(20, footerY + 2, 10, 10, EMA9_COLOR);
  canvas.drawText("EMA9", 36, footerY + 3, TEXT_MUTED, 1);

  canvas.fillRect(92, footerY + 2, 10, 10, EMA21_COLOR);
  canvas.drawText("EMA21", 108, footerY + 3, TEXT_MUTED, 1);

  canvas.fillRect(172, footerY + 2, 10, 10, TP_COLOR);
  canvas.drawText(`TP ${formatAxisPrice(levels.takeProfitPrice)}`, 188, footerY + 3, TP_COLOR, 1);

  canvas.fillRect(310, footerY + 2, 10, 10, ENTRY_COLOR);
  canvas.drawText(`ENTRY ${formatAxisPrice(levels.entryPrice)}`, 326, footerY + 3, ENTRY_COLOR, 1);

  canvas.fillRect(468, footerY + 2, 10, 10, SL_COLOR);
  canvas.drawText(`SL ${formatAxisPrice(levels.stopLossPrice)}`, 484, footerY + 3, SL_COLOR, 1);

  const brand = "CRYPTOQUANT-COPILOT";
  canvas.drawText(brand, W - canvas.measureTextWidth(brand, 1) - 20, footerY + 3, TEXT_MUTED, 1);

  return encodeRgbPng(W, H, canvas.data);
}
