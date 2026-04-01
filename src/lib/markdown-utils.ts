/**
 * Wrap content in a markdown code fence, auto-escalating backtick count
 * when the content itself contains triple-backtick fences.
 */
export function fenced(content: string, lang = ''): string {
  let n = 3;
  while (content.includes('`'.repeat(n))) n++;
  const f = '`'.repeat(n);
  return `${f}${lang}\n${content}\n${f}`;
}
