import { CanvasTextMetrics, Text, type TextStyleOptions } from 'pixi.js';
import { tokens } from './tokens';

// Pixi 默认用拉丁字符测量字高，中文下沿会被切掉，所以改用中文字符测量。
CanvasTextMetrics.METRICS_STRING = '|ÉqÅ国';
CanvasTextMetrics.BASELINE_SYMBOL = '国';

const TEXT_PADDING = 4;

export function createText(text: string, style: TextStyleOptions): Text {
  const label = new Text({
    text,
    style: { fontFamily: tokens.fontFamily, padding: TEXT_PADDING, ...style },
  });
  label.layout = true;
  return label;
}
