/**
 * IPC Watcher Tests
 *
 * Coverage:
 * - schedule_task message dispatch (including name/description)
 * - pause_task / resume_task / cancel_task dispatch
 * - Throws error when required fields are missing
 * - Throws error on unknown message type
 * - JSON file processing (write -> read -> delete)
 * - Error files moved to errors directory
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import './setup.ts'
import { getPaths } from '../src/config/index.ts'
import { IpcWatcher } from '../src/ipc/watcher.ts'

const ipcDir = resolve(getPaths().data, 'ipc')

function setupAgentTasksDir(agentId: string): string {
  const tasksDir = join(ipcDir, agentId, 'tasks')
  mkdirSync(tasksDir, { recursive: true })
  return tasksDir
}

function cleanIpcDir() {
  try { rmSync(ipcDir, { recursive: true, force: true }) } catch {}
}

// ===== dispatch logic =====

describe('IpcWatcher — dispatch', () => {
  test('schedule_task passes name and description', () => {
    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore — testing private method
    watcher.dispatch({
      type: 'schedule_task',
      prompt: 'test prompt',
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      chatId: 'chat-1',
      name: 'Task Name',
      description: 'Task Description',
    }, 'agent-x')

    expect(onScheduleTask).toHaveBeenCalledTimes(1)
    const arg = onScheduleTask.mock.calls[0][0]
    expect(arg.prompt).toBe('test prompt')
    expect(arg.scheduleType).toBe('cron')
    expect(arg.scheduleValue).toBe('0 9 * * *')
    expect(arg.agentId).toBe('agent-x')
    expect(arg.chatId).toBe('chat-1')
    expect(arg.name).toBe('Task Name')
    expect(arg.description).toBe('Task Description')
  })

  test('schedule_task without name/description defaults to undefined', () => {
    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore
    watcher.dispatch({
      type: 'schedule_task',
      prompt: 'test',
      schedule_type: 'interval',
      schedule_value: '60000',
      chatId: 'chat-1',
    }, 'agent-y')

    const arg = onScheduleTask.mock.calls[0][0]
    expect(arg.name).toBeUndefined()
    expect(arg.description).toBeUndefined()
  })

  test('schedule_task throws error when required fields are missing', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    expect(() => {
      // @ts-ignore
      watcher.dispatch({ type: 'schedule_task', prompt: '', schedule_type: 'cron', schedule_value: '0 9 * * *', chatId: 'c' }, 'a')
    }).toThrow('missing required field')

    expect(() => {
      // @ts-ignore
      watcher.dispatch({ type: 'schedule_task', prompt: 'p', schedule_type: '', schedule_value: '0 9 * * *', chatId: 'c' }, 'a')
    }).toThrow('missing required field')
  })

  test('pause_task dispatch', () => {
    const onPauseTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask,
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore
    watcher.dispatch({ type: 'pause_task', taskId: 'task-123' }, 'agent-1')
    expect(onPauseTask).toHaveBeenCalledWith('task-123')
  })

  test('pause_task throws error when taskId is missing', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    expect(() => {
      // @ts-ignore
      watcher.dispatch({ type: 'pause_task', taskId: '' }, 'a')
    }).toThrow('missing required field')
  })

  test('resume_task dispatch', () => {
    const onResumeTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask,
      onCancelTask: () => {},
    })

    // @ts-ignore
    watcher.dispatch({ type: 'resume_task', taskId: 'task-456' }, 'agent-1')
    expect(onResumeTask).toHaveBeenCalledWith('task-456')
  })

  test('resume_task throws error when taskId is missing', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    expect(() => {
      // @ts-ignore
      watcher.dispatch({ type: 'resume_task', taskId: '' }, 'a')
    }).toThrow('missing required field')
  })

  test('cancel_task dispatch', () => {
    const onCancelTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask,
    })

    // @ts-ignore
    watcher.dispatch({ type: 'cancel_task', taskId: 'task-789' }, 'agent-1')
    expect(onCancelTask).toHaveBeenCalledWith('task-789')
  })

  test('cancel_task throws error when taskId is missing', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    expect(() => {
      // @ts-ignore
      watcher.dispatch({ type: 'cancel_task', taskId: '' }, 'a')
    }).toThrow('missing required field')
  })

  test('unknown message type throws error', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    expect(() => {
      // @ts-ignore
      watcher.dispatch({ type: 'unknown_type' }, 'a')
    }).toThrow('Unknown IPC message type')
  })
})

// ===== processFile file handling =====

describe('IpcWatcher — file handling', () => {
  afterEach(() => cleanIpcDir())

  test('deletes JSON file after successful processing', async () => {
    const tasksDir = setupAgentTasksDir('test-agent')
    const filePath = join(tasksDir, '1000-abc.json')
    writeFileSync(filePath, JSON.stringify({
      type: 'schedule_task',
      prompt: 'test',
      schedule_type: 'interval',
      schedule_value: '60000',
      chatId: 'chat-1',
      name: 'File Test',
    }))

    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore
    await watcher.processFile(filePath, 'test-agent')

    expect(onScheduleTask).toHaveBeenCalledTimes(1)
    expect(existsSync(filePath)).toBe(false) // file has been deleted
  })

  test('moves invalid JSON to errors directory', async () => {
    const tasksDir = setupAgentTasksDir('test-agent')
    const filePath = join(tasksDir, '2000-bad.json')
    writeFileSync(filePath, 'not valid json {{{')

    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore
    await watcher.processFile(filePath, 'test-agent')

    expect(existsSync(filePath)).toBe(false) // original file has been deleted
    const errorsDir = join(ipcDir, 'errors')
    expect(existsSync(errorsDir)).toBe(true)
    const errorFiles = readdirSync(errorsDir)
    expect(errorFiles.length).toBeGreaterThan(0)
  })

  test('moves file to errors directory when dispatch fails', async () => {
    const tasksDir = setupAgentTasksDir('test-agent')
    const filePath = join(tasksDir, '3000-fail.json')
    // Missing required fields will cause dispatch to throw
    writeFileSync(filePath, JSON.stringify({
      type: 'schedule_task',
      prompt: '',
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      chatId: 'c',
    }))

    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore
    await watcher.processFile(filePath, 'test-agent')

    expect(existsSync(filePath)).toBe(false)
    const errorsDir = join(ipcDir, 'errors')
    expect(existsSync(errorsDir)).toBe(true)
  })
})

// ===== start / stop =====

describe('IpcWatcher start/stop', () => {
  test('stop does not throw', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })
    expect(() => watcher.stop()).not.toThrow()
  })

  test('start + stop works correctly', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })
    watcher.start()
    watcher.stop()
  })

  test('repeated start does not create multiple intervals', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })
    watcher.start()
    watcher.start() // second call should return immediately
    watcher.stop()
  })
})

// ===== additional test scenarios =====

describe('IpcWatcher — dispatch schedule_task schedule_type validation', () => {
  test('schedule_type=interval + schedule_value=60000', () => {
    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore — testing private method
    watcher.dispatch({
      type: 'schedule_task',
      prompt: 'interval task',
      schedule_type: 'interval',
      schedule_value: '60000',
      chatId: 'chat-interval',
    }, 'agent-interval')

    expect(onScheduleTask).toHaveBeenCalledTimes(1)
    const arg = onScheduleTask.mock.calls[0][0]
    expect(arg.prompt).toBe('interval task')
    expect(arg.scheduleType).toBe('interval')
    expect(arg.scheduleValue).toBe('60000')
    expect(arg.agentId).toBe('agent-interval')
    expect(arg.chatId).toBe('chat-interval')
  })

  test('schedule_type=once + schedule_value=ISO date', () => {
    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    const isoDate = '2026-04-01T12:00:00.000Z'

    // @ts-ignore — testing private method
    watcher.dispatch({
      type: 'schedule_task',
      prompt: 'once task',
      schedule_type: 'once',
      schedule_value: isoDate,
      chatId: 'chat-once',
    }, 'agent-once')

    expect(onScheduleTask).toHaveBeenCalledTimes(1)
    const arg = onScheduleTask.mock.calls[0][0]
    expect(arg.prompt).toBe('once task')
    expect(arg.scheduleType).toBe('once')
    expect(arg.scheduleValue).toBe(isoDate)
    expect(arg.agentId).toBe('agent-once')
    expect(arg.chatId).toBe('chat-once')
  })
})

describe('IpcWatcher — dispatch schedule_task optional field combinations', () => {
  test('passes only name without description', () => {
    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore
    watcher.dispatch({
      type: 'schedule_task',
      prompt: 'name only',
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      chatId: 'chat-n',
      name: 'Name Only',
    }, 'agent-n')

    expect(onScheduleTask).toHaveBeenCalledTimes(1)
    const arg = onScheduleTask.mock.calls[0][0]
    expect(arg.name).toBe('Name Only')
    expect(arg.description).toBeUndefined()
  })

  test('passes only description without name', () => {
    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore
    watcher.dispatch({
      type: 'schedule_task',
      prompt: 'desc only',
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      chatId: 'chat-d',
      description: 'Description Only',
    }, 'agent-d')

    expect(onScheduleTask).toHaveBeenCalledTimes(1)
    const arg = onScheduleTask.mock.calls[0][0]
    expect(arg.name).toBeUndefined()
    expect(arg.description).toBe('Description Only')
  })
})

describe('IpcWatcher — dispatch schedule_task missing fields', () => {
  test('throws error when chatId is missing', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    expect(() => {
      // @ts-ignore
      watcher.dispatch({
        type: 'schedule_task',
        prompt: 'valid prompt',
        schedule_type: 'cron',
        schedule_value: '0 9 * * *',
      }, 'agent-no-chat')
    }).toThrow('missing required field')
  })

  test('throws error when schedule_value is missing', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    expect(() => {
      // @ts-ignore
      watcher.dispatch({
        type: 'schedule_task',
        prompt: 'valid prompt',
        schedule_type: 'cron',
        chatId: 'chat-1',
      }, 'agent-no-sv')
    }).toThrow('missing required field')
  })
})

describe('IpcWatcher — file handling (extended scenarios)', () => {
  afterEach(() => cleanIpcDir())

  test('non-JSON extension files are ignored', async () => {
    const tasksDir = setupAgentTasksDir('txt-agent')
    const txtPath = join(tasksDir, '1000-note.txt')
    writeFileSync(txtPath, 'this is plain text')

    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // tick internally filters files via filter(f => f.endsWith('.json')),
    // so .txt files will not be passed to processFile
    // @ts-ignore — testing private method
    await watcher.tick()

    expect(onScheduleTask).toHaveBeenCalledTimes(0)
    // .txt file should still exist (not processed, not deleted)
    expect(existsSync(txtPath)).toBe(true)
  })

  test('empty JSON object {} is moved to errors directory', async () => {
    const tasksDir = setupAgentTasksDir('empty-json-agent')
    const filePath = join(tasksDir, '1000-empty.json')
    writeFileSync(filePath, '{}')

    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore
    await watcher.processFile(filePath, 'empty-json-agent')

    // {} has no type field, dispatch will throw "Unknown IPC message type"
    expect(onScheduleTask).toHaveBeenCalledTimes(0)
    expect(existsSync(filePath)).toBe(false) // original file has been deleted
    const errorsDir = join(ipcDir, 'errors')
    expect(existsSync(errorsDir)).toBe(true)
    const errorFiles = readdirSync(errorsDir)
    expect(errorFiles.length).toBeGreaterThan(0)
  })

  test('multiple files processed in order', async () => {
    const tasksDir = setupAgentTasksDir('multi-agent')
    const calls: string[] = []

    // Create multiple files with different timestamp prefixes
    writeFileSync(join(tasksDir, '2000-b.json'), JSON.stringify({
      type: 'schedule_task',
      prompt: 'second',
      schedule_type: 'interval',
      schedule_value: '30000',
      chatId: 'chat-2',
    }))
    writeFileSync(join(tasksDir, '1000-a.json'), JSON.stringify({
      type: 'schedule_task',
      prompt: 'first',
      schedule_type: 'interval',
      schedule_value: '60000',
      chatId: 'chat-1',
    }))
    writeFileSync(join(tasksDir, '3000-c.json'), JSON.stringify({
      type: 'schedule_task',
      prompt: 'third',
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      chatId: 'chat-3',
    }))

    const onScheduleTask = mock((data: { prompt: string }) => {
      calls.push(data.prompt)
    })
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore — tick processes files sorted by filename
    await watcher.tick()

    expect(onScheduleTask).toHaveBeenCalledTimes(3)
    // tick sorts by filename: 1000-a < 2000-b < 3000-c
    expect(calls).toEqual(['first', 'second', 'third'])
  })
})
