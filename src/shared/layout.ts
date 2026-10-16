export const PANEL_GAP_PX = 12;
export const CENTER_MIN_WIDTH_PX = 160;
export const CENTER_MIN_HEIGHT_PX = 96;

export const defaultPanelSizes = {
  headerSizePx: 140,
  footerSizePx: 140,
  leftSizePx: 260,
  rightSizePx: 280,
};

export const layoutSizeLimits = {
  header: { min: 32, max: 10_000 },
  footer: { min: 32, max: 10_000 },
  left: { min: 64, max: 10_000 },
  right: { min: 64, max: 10_000 },
  center: { min: 0.01, max: 1_000 },
};

// Keep saved preferences, but fit both outer panels when the window gets smaller.
export function fitPanelPair(
  first: number,
  second: number,
  available: number,
  firstMin: number,
  secondMin: number,
  centerMin: number,
  firstVisible = true,
  secondVisible = true,
): [number, number] {
  const minimumFirst = firstVisible ? firstMin : 0;
  const minimumSecond = secondVisible ? secondMin : 0;
  const gaps = Number(firstVisible) + Number(secondVisible);
  const budget = Math.max(minimumFirst + minimumSecond, available - centerMin - PANEL_GAP_PX * gaps);
  const firstExtra = firstVisible ? Math.max(0, first - minimumFirst) : 0;
  const secondExtra = secondVisible ? Math.max(0, second - minimumSecond) : 0;
  const extra = firstExtra + secondExtra;
  const scale = extra > 0 ? Math.min(1, (budget - minimumFirst - minimumSecond) / extra) : 1;
  return [minimumFirst + firstExtra * scale, minimumSecond + secondExtra * scale];
}
