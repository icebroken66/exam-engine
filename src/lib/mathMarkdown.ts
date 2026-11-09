/** Accept model LaTeX delimiters while leaving Markdown code examples intact. */
function convertText(text: string): string {
  let output = ''
  for (let index = 0; index < text.length;) {
    if (text[index] === '`') {
      const opening = /^`+/.exec(text.slice(index))![0]
      const rest = text.slice(index + opening.length)
      const closing = [...rest.matchAll(/`+/g)].find(match => match[0].length === opening.length)
      if (closing) {
        const end = index + opening.length + closing.index + opening.length
        output += text.slice(index, end); index = end; continue
      }
      output += opening; index += opening.length; continue
    }
    if (text.startsWith('\\\\', index)) {
      output += '\\\\'; index += 2; continue
    }
    const display = text.startsWith('\\[', index)
    if (display || text.startsWith('\\(', index)) {
      const closing = display ? '\\]' : '\\)'
      let end = text.indexOf(closing, index + 2)
      while (end !== -1) {
        let slashes = 0
        for (let before = end - 1; before >= 0 && text[before] === '\\'; before--) slashes++
        if (slashes % 2 === 0) break
        end = text.indexOf(closing, end + 2)
      }
      if (end !== -1) {
        const body = text.slice(index + 2, end).trim()
        if (body && !body.includes('`')) {
          output += display ? `\n\n$$\n${body}\n$$\n\n` : `$${body}$`
          index = end + 2; continue
        }
      }
    }
    output += text[index]; index++
  }
  return output
}

export function normalizeMathMarkdown(markdown: string): string {
  let output = '', prose = '', fence = '', fenceLength = 0
  for (const line of markdown.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*?)(?:\n)?$/.exec(line)
    if (fence) {
      output += line
      if (marker && marker[1][0] === fence && marker[1].length >= fenceLength && !marker[2].trim()) fence = ''
    } else if (marker && !(marker[1][0] === '`' && marker[2].includes('`'))) {
      output += convertText(prose) + line; prose = ''
      fence = marker[1][0]; fenceLength = marker[1].length
    } else if (/^(?: {4}|\t)/.test(line)) {
      output += convertText(prose) + line; prose = ''
    } else {
      prose += line
    }
  }
  return output + convertText(prose)
}
