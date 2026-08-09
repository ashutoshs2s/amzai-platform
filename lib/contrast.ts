/**
 * WCAG 2.1 contrast ratio.
 *
 * DESIGN.md section 7 sets a floor of 4.5:1 on all text and singles out the
 * amber as the one at risk. This exists so that claim can be checked rather
 * than assumed, and so the styleguide can show the real numbers instead of
 * asserting that everything is fine.
 */

function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const parse = (index: number) =>
    parseInt(value.slice(index, index + 2), 16) / 255;
  return [parse(0), parse(2), parse(4)];
}

function linearise(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linearise);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two hex colours, from 1 to 21. */
export function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Whether a pairing clears the 4.5:1 floor in DESIGN.md section 7. */
export function meetsFloor(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= 4.5;
}
