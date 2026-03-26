const dividerLinePattern = /^[\s\u00a0]*([_=~\u2500-\u2501\u2014\u2015-])\1{15,}[\s\u00a0]*$/u
const bulletLinePattern = /^(\s*)•\s+(.*)$/u
const treeLinePattern = /^(\s*)[└├╰╭│]\s+(.*)$/u

export function formatUserMessageForDisplay(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return ''
      if (dividerLinePattern.test(trimmed)) return '---'

      const bulletMatch = line.match(bulletLinePattern)
      if (bulletMatch) {
        const [, indent, body] = bulletMatch
        return `${indent}- ${body}`
      }

      const treeMatch = line.match(treeLinePattern)
      if (treeMatch) {
        const [, indent, body] = treeMatch
        return `${indent}  - ${body}`
      }

      return line
    })
    .join('\n')
}
