/**
 * Wrap content in a markdown code fence.
 *
 * Strategy:
 * - Choose the safer fence family between backticks and tildes.
 * - Use fence width = maxRunInContent + 1 (at least 3), so inner fences cannot close it.
 * - Sanitize language info string to avoid accidental line breaks/closure issues.
 */
export function fenced(content: string, lang = ''): string {
  const normalized = String(content ?? '').replace(/\r\n?/g, '\n');

  const longestRun = (text: string, ch: '`' | '~'): number => {
    let max = 0;
    let cur = 0;
    for (const c of text) {
      if (c === ch) {
        cur += 1;
        if (cur > max) max = cur;
      } else {
        cur = 0;
      }
    }
    return max;
  };

  const tildeNeed = Math.max(3, longestRun(normalized, '~') + 1);
  const fenceChar = '~';
  const fenceLen = tildeNeed;
  const fence = fenceChar.repeat(fenceLen);

  const safeLang = /^[A-Za-z0-9_+.-]+$/.test(lang) ? lang : '';
  return `${fence}${safeLang}\n${normalized}\n${fence}`;
}
