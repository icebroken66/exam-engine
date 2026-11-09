import { describe, expect, it } from 'vitest'
import { normalizeMathMarkdown } from './mathMarkdown'

describe('model math Markdown', () => {
  it('renders inline and display delimiters from the actual signals reply', () => {
    const message = String.raw`输入 \(e_2(t)=\delta(t)\)。
\[
r_2(t)=\delta(t)-a e^{-at}u(t).
\]`
    const result = normalizeMathMarkdown(message)
    expect(result).toContain('$e_2(t)=\\delta(t)$')
    expect(result).toContain('$$\nr_2(t)=\\delta(t)-a e^{-at}u(t).\n$$')
  })
  it('preserves code spans, fenced code and unclosed fences', () => {
    for (const code of [String.raw`\(x\)`, String.raw`\[x\]`]) {
      for (const fence of ['```', '~~~~']) {
        expect(normalizeMathMarkdown(`${fence}latex\n${code}\n${fence}\n`)).toBe(`${fence}latex\n${code}\n${fence}\n`)
        expect(normalizeMathMarkdown(`${fence}\n${code}`)).toBe(`${fence}\n${code}`)
      }
      expect(normalizeMathMarkdown(`\`${code}\``)).toBe(`\`${code}\``)
      expect(normalizeMathMarkdown(`    ${code}\n`)).toBe(`    ${code}\n`)
    }
  })
  it('keeps existing dollar math, unmatched delimiters and escaped slashes', () => {
    const message = String.raw`$x$ $$y$$ \(unclosed \\(literal\\)`
    expect(normalizeMathMarkdown(message)).toBe(message)
  })
})
