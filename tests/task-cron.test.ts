import { describe, expect, test } from 'bun:test'
import { buildCronExpression, createDefaultCronDraft, parseCronExpression } from '../web/src/lib/task-cron.ts'

describe('task cron helpers', () => {
  test('builds daily cron expressions', () => {
    expect(buildCronExpression('daily', {
      ...createDefaultCronDraft(),
      hour: '09',
      minute: '00',
    })).toBe('0 9 * * *')
  })

  test('builds weekly cron expressions', () => {
    expect(buildCronExpression('weekly', {
      ...createDefaultCronDraft(),
      hour: '09',
      minute: '00',
      weekday: '1',
    })).toBe('0 9 * * 1')
  })

  test('builds monthly cron expressions', () => {
    expect(buildCronExpression('monthly', {
      ...createDefaultCronDraft(),
      hour: '09',
      minute: '00',
      dayOfMonth: '15',
    })).toBe('0 9 15 * *')
  })

  test('parses simple daily cron expressions', () => {
    expect(parseCronExpression('0 9 * * *')).toEqual({
      mode: 'daily',
      draft: {
        minute: '00',
        hour: '09',
        weekday: '1',
        dayOfMonth: '1',
      },
    })
  })

  test('parses simple weekly cron expressions', () => {
    expect(parseCronExpression('0 9 * * 1')).toEqual({
      mode: 'weekly',
      draft: {
        minute: '00',
        hour: '09',
        weekday: '1',
        dayOfMonth: '1',
      },
    })
  })

  test('parses simple monthly cron expressions', () => {
    expect(parseCronExpression('0 9 15 * *')).toEqual({
      mode: 'monthly',
      draft: {
        minute: '00',
        hour: '09',
        weekday: '1',
        dayOfMonth: '15',
      },
    })
  })

  test('falls back to custom for complex cron expressions', () => {
    expect(parseCronExpression('*/5 * * * *')).toBeNull()
    expect(parseCronExpression('0 9 * * 1-5')).toBeNull()
  })
})
