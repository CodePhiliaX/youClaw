import { describe, expect, test } from 'bun:test'
import { formatUserMessageForDisplay } from '../web/src/lib/user-message-format'

describe('formatUserMessageForDisplay', () => {
  test('converts long divider lines into markdown rules', () => {
    const input = [
      '────────────────────────────────────────────────────',
      '',
      'body',
      '',
      '------------------------------',
    ].join('\n')

    expect(formatUserMessageForDisplay(input)).toBe(['---', '', 'body', '', '---'].join('\n'))
  })

  test('normalizes bullet and tree lines into markdown lists', () => {
    const input = ['• Top level', '  └ Nested item'].join('\n')

    expect(formatUserMessageForDisplay(input)).toBe(['- Top level', '    - Nested item'].join('\n'))
  })

  test('keeps regular content unchanged apart from line ending normalization', () => {
    const input = 'plain text\r\nwith next line'

    expect(formatUserMessageForDisplay(input)).toBe('plain text\nwith next line')
  })
})
