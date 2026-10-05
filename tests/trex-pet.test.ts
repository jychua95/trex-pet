import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { COLUMNS, DEFAULT_PALETTE, JUMP_TICKS, POSES, ROWS, cellsOf, frameOf, parseColor } from '../hooks/sprites'
import { createStats, kindOf, moodOf, recordResult, statLines, targetOf } from '../hooks/stats'

// What Claude Code passes to a ui.render hook for the band, apart from the app
const BAND = {
  plugin: 'trex-pet',
  component: 'AbovePrompt',
  viewport: { columns: 105, rows: 40 },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

type ToolAnswer = { result: string } | { deny: string } | { result: string; isError: true }

type Stubs = {
  clock: ReturnType<typeof mock.clock>
  saved: Map<string, unknown>
  blits: string[]
  // What the next tool calls resolve to, by tool name
  answers: Map<string, ToolAnswer>
}

// Answer everything the mod asks of Claude Code, so no session, tool, or store runs
function stub(on: On, entries: Record<string, unknown> = {}): Stubs {
  const stubs: Stubs = {
    clock: mock.clock(on, { now: 1_000_000 }),
    saved: new Map(Object.entries(entries)),
    blits: [],
    answers: new Map(),
  }
  on('store.get', ($, e) => ({ value: stubs.saved.get(e.key) }))
  on('store.set', ($, e) => {
    stubs.saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 20_000, percent: 10 }, rateLimits: [] },
  }))
  on('ui.blit', ($, e) => {
    if ('cells' in e) stubs.blits.push(e.cells)
    return { value: {} }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', ($, e) => stubs.answers.get(String(e.tool)) ?? { result: 'ok' })
  // Stands for what the mods after this one draw in the band
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn below'] }))
  return stubs
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

test('every pose packs a full grid of cells, and the moving ones change between ticks', async () => {
  // Twelve bytes a cell, as base64
  const length = Math.ceil((COLUMNS * ROWS * 12) / 3) * 4
  for (const pose of POSES) {
    for (let tick = 0; tick < 8; tick++) expect(cellsOf(pose, tick)).toHaveLength(length)
  }
  expect(cellsOf('run', 0)).not.toBe(cellsOf('run', 1))
  expect(cellsOf('chomp', 0)).not.toBe(cellsOf('chomp', 1))
  expect(cellsOf('sniff', 0)).not.toBe(cellsOf('sniff', 2))
  expect(cellsOf('sleep', 0)).not.toBe(cellsOf('sleep', 1))
  expect(cellsOf('blink', 0)).not.toBe(cellsOf('idle', 0))
  expect(cellsOf('idle', 0)).toBe(cellsOf('idle', 5))
})

test('tools sort into kinds and name what they are aimed at', async () => {
  expect(kindOf('Read')).toBe('read')
  expect(kindOf('Write')).toBe('edit')
  expect(kindOf('Bash')).toBe('bash')
  expect(kindOf('mcp__github__list')).toBe('other')
  expect(targetOf('edit', 'Edit', { file_path: '/work/src/api/user.ts' })).toEqual({
    path: '/work/src/api/user.ts',
    name: 'user.ts',
  })
  expect(targetOf('bash', 'Bash', { command: 'npm test\necho done' }).name).toBe('npm test')
})

test('the mood follows what happened', async () => {
  const stats = createStats()
  const base = { stats, isWorking: false, isAsleep: false, contextPercent: 10 }
  expect(moodOf(base)).toBe('chill')
  expect(moodOf({ ...base, isWorking: true })).toBe('focused')
  for (const name of ['a.ts', 'b.ts', 'c.ts']) recordResult(stats, 'edit', { path: name, name }, true)
  expect(moodOf({ ...base, isWorking: true })).toBe('hyped')
  expect(moodOf(base)).toBe('well fed')
  expect(moodOf({ ...base, contextPercent: 85 })).toBe('sweating (context 85%)')
  recordResult(stats, 'bash', { path: null, name: 'npm test' }, false)
  expect(moodOf(base)).toBe('spooked')
  expect(stats.editStreak).toBe(0)
  expect(statLines({ ...base, lifetimeEdits: 1204 })[3]).toBe('lifetime: 1,204 edits fed')
})

test('the band draws the sprite beside the counts of what Claude did', async ($, on) => {
  stub(on)
  await $.session.start(START)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'Read', file_path: '/work/README.md' })
  await $.tool.call({ tool: 'Read', file_path: '/work/README.md' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/src/app.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster', key: 'rex' })).toMatchObject({ props: { columns: COLUMNS, rows: ROWS } })
  expect(await ui.find({ type: 'Text', text: 'read 1 file · edited 1 · ran 1 cmd' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'turn 1 · 4 tool calls · edit streak 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'lifetime: 1 edit fed' })).toBeDefined()
  // What the other mods drew is kept
  expect(await ui.find({ type: 'Text', text: 'drawn below' })).toBeDefined()
})

test('a refused or failed call spooks the dino and is not counted', async ($, on) => {
  const stubs = stub(on)
  stubs.answers.set('Bash', { deny: 'not allowed' })
  stubs.answers.set('Edit', { result: 'no match', isError: true })
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /spooked by Edit/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'read 0 files · edited 0 · ran 0 cmds' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'mood: spooked' })).toBeDefined()
  expect(stubs.saved.has('lifetimeEdits')).toBe(false)
})

test('the lifetime count adds to what earlier sessions saved', async ($, on) => {
  const stubs = stub(on, { lifetimeEdits: 41 })
  await $.session.start(START)
  await $.tool.call({ tool: 'Write', file_path: '/work/new.ts', content: 'x' })
  expect(stubs.saved.get('lifetimeEdits')).toBe(42)
})

test('the sprite animates while Claude works and rests when the turn is over', async ($, on) => {
  const stubs = stub(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.turn.start({ turnId: 't1', text: 'go' })
  await stubs.clock.advance(500)
  // Four ticks of running, each a different frame
  expect(stubs.blits.length).toBeGreaterThanOrEqual(3)
  expect(await ui.find({ type: 'Text', text: /thinking/ })).toBeDefined()

  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 500, isAborted: false, reason: 'answer' })
  await stubs.clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: /idle/ })).toBeDefined()

  // Five quiet minutes later the dino is asleep
  await stubs.clock.advance(5 * 60_000)
  expect(await ui.find({ type: 'Text', text: /zzz/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'mood: asleep' })).toBeDefined()
})

test('a narrow band keeps the sprite and drops the text', async ($, on) => {
  stub(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 30 } })
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^mood:/ })).toBeUndefined()
})

test('a short band and the Desktop app get one line of text', async ($, on) => {
  stub(on)
  await $.session.start(START)
  const short = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, maxRows: 3 } })
  expect(await short.find({ type: 'Raster' })).toBeUndefined()
  expect(await short.find({ type: 'Text', text: /^REX · idle · read 0 files/ })).toBeDefined()
  await short.unmount()

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await desktop.find({ type: 'Text', text: /^REX · idle · read 0 files/ })).toBeDefined()
})

test('the band yields to a survey', async ($, on) => {
  stub(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.drawn()).toMatchObject({ type: 'Text', children: ['drawn below'] })
})

test('/clear starts the session counts over and keeps the lifetime count', async ($, on) => {
  stub(on)
  await $.session.start(START)
  await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b' })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'read 0 files · edited 0 · ran 0 cmds' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'lifetime: 1 edit fed' })).toBeDefined()
})

test('/rex prints the same summary', async ($, on) => {
  stub(on)
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const answer = await $.command.run({
    command: 'rex',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 105 },
  })
  expect(answer.text).toMatch(/read 0 files · edited 0 · ran 1 cmd/)
})

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 105 } } as const

test('a jump lifts the feet off the ground without cutting the head off', async () => {
  const standing = frameOf('idle', 0).pixels
  for (let tick = 0; tick < JUMP_TICKS; tick++) {
    // Every frame keeps all of the dino's pixels above the feet's two rows
    const pixels = frameOf('jump', tick).pixels
    expect(pixels).toHaveLength(standing.length)
  }
  const peak = frameOf('jump', 3).pixels
  expect(peak[0]).toBe(standing[0])
  expect(peak[10]).not.toMatch(/#/)
  expect(peak[11]).not.toMatch(/#/)
  expect(peak[9]).toMatch(/#/)
  // The last step lands back in the standing frame
  expect(cellsOf('jump', JUMP_TICKS - 1)).toBe(cellsOf('idle', 0))
})

test('/trex jump plays the jump from its first frame, then the dino rests', async ($, on) => {
  const stubs = stub(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // Idle beats first, so the jump does not start on tick zero by luck
  await stubs.clock.advance(3000)

  const answer = await $.command.run({ command: 'trex', args: ' Jump ', ...RUN })
  expect(answer.text).toBe('REX · jumping!')
  expect(await ui.find({ type: 'Text', text: /jumping!/ })).toBeDefined()
  expect(await ui.find({ type: 'Raster', key: 'rex' })).toMatchObject({ props: { cells: cellsOf('jump', 0) } })

  stubs.blits.length = 0
  await stubs.clock.advance(500)
  expect(stubs.blits).toContain(cellsOf('jump', 3))

  await stubs.clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /idle/ })).toBeDefined()
})

test('/trex with no trick, or one it does not know, lists the tricks', async ($, on) => {
  stub(on)
  await $.session.start(START)
  for (const args of ['', 'fly', 'constructor']) {
    const answer = await $.command.run({ command: 'trex', args, ...RUN })
    expect(answer.text).toMatch(/^Usage: \/trex <jump \| run \| /)
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /idle/ })).toBeDefined()
})

test('a color option is read as hex, and anything else keeps the default', async () => {
  expect(parseColor('#22AA55', 0)).toBe(0x22aa55)
  expect(parseColor(' 22aa55 ', 0)).toBe(0x22aa55)
  for (const bad of ['green', '#2a5', '', 42, undefined]) expect(parseColor(bad, 0xd25516)).toBe(0xd25516)
})

test('the dino is drawn in the configured color', { options: { bodyColor: '#22aa55' } }, async ($, on) => {
  stub(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const green = cellsOf('idle', 0, { ...DEFAULT_PALETTE, body: 0x22aa55 })
  expect(green).not.toBe(cellsOf('idle', 0))
  expect(await ui.find({ type: 'Raster', key: 'rex' })).toMatchObject({ props: { cells: green } })
})
