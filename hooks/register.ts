import type { EngineInterface, Register, Timer } from 'claude-code'

import { COLUMNS, DEFAULT_PALETTE, JUMP_TICKS, ROWS, cellsOf, parseColor } from './sprites'
import type { Palette, Pose } from './sprites'
import {
  activityOf,
  createStats,
  kindOf,
  recordCall,
  recordResult,
  recordTurnStart,
  statLines,
  summaryOf,
  targetOf,
} from './stats'
import type { LinesInput, ToolKind } from './stats'

const NAME = 'REX'
const RASTER_KEY = 'rex'
const STORE_KEY = 'lifetimeEdits'

// The sprite animates at 8 frames a second, and only checks in once a second while idle
const FAST_MS = 125
const SLOW_MS = 1000

// A quick Read would otherwise flash by unseen
const MIN_POSE_MS = 700
const STOMP_MS = 900
const STARTLED_MS = 900
const CHEER_MS = 1000
const BLINK_MS = 250
const WAG_MS = 1000
const SLEEP_AFTER_MS = 5 * 60_000

// Idle beats are one second apart
const BLINK_EVERY_BEATS = 5
const WAG_EVERY_BEATS = 13

// What /trex can make the dino do, by the word typed after it
const TRICK_MS = 2000
const TRICKS: Readonly<Record<string, { pose: Pose; label: string; ms: number }>> = {
  jump: { pose: 'jump', label: 'jumping!', ms: JUMP_TICKS * FAST_MS },
  run: { pose: 'run', label: 'running', ms: TRICK_MS },
  sniff: { pose: 'sniff', label: 'sniffing', ms: TRICK_MS },
  chomp: { pose: 'chomp', label: 'chomp chomp', ms: TRICK_MS },
  stomp: { pose: 'stomp', label: 'stomping', ms: TRICK_MS },
  wag: { pose: 'wag', label: 'wagging', ms: TRICK_MS },
  cheer: { pose: 'cheer', label: 'cheering', ms: TRICK_MS },
  startled: { pose: 'startled', label: 'spooked', ms: TRICK_MS },
}

const GAP_COLUMNS = 2
const MIN_TEXT_COLUMNS = 24

type Action = {
  pose: Pose
  label: string
  until: number
  // Keep the pose while a call of this kind is still running
  holdFor: ToolKind | null
  // The tick the pose began on, for one that must play from its first frame
  startTick?: number
}

// The tick is the frame to draw: counted from the action's start when it has one
type Scene = { pose: Pose; label: string; isAnimating: boolean; tick: number }

let stats = createStats()
let lifetimeEdits = 0
let contextPercent: number | undefined
let palette: Palette = DEFAULT_PALETTE

let isWorking = false
let action: Action | null = null
let openCalls: Record<ToolKind, number> = { read: 0, edit: 0, bash: 0, other: 0 }
let lastActivityAt = 0

let ticker: Timer | null = null
let tickerMs = 0
let tickCount = 0
let idleBeats = 0
let isTicking = false

// The band's instance and what it last showed, so a tick repaints only what changed
let bandId: string | null = null
let isMounted = false
let lastCells = ''
let lastLabel = ''

function sceneAt(now: number): Scene {
  if (action !== null) {
    const isHeld = action.holdFor !== null && openCalls[action.holdFor] > 0
    if (now < action.until || isHeld) {
      return { pose: action.pose, label: action.label, isAnimating: true, tick: tickCount - (action.startTick ?? 0) }
    }
  }
  if (isWorking) return { pose: 'run', label: 'thinking…', isAnimating: true, tick: tickCount }
  if (now - lastActivityAt >= SLEEP_AFTER_MS) return { pose: 'sleep', label: 'zzz', isAnimating: false, tick: tickCount }
  return { pose: 'idle', label: 'idle', isAnimating: false, tick: tickCount }
}

function actionFor(kind: ToolKind, label: string, now: number): Action {
  if (kind === 'read') return { pose: 'sniff', label, until: now + MIN_POSE_MS, holdFor: 'read' }
  if (kind === 'edit') return { pose: 'chomp', label, until: now + MIN_POSE_MS, holdFor: 'edit' }
  // A long command stomps once, then the dino goes back to running
  if (kind === 'bash') return { pose: 'stomp', label, until: now + STOMP_MS, holdFor: null }
  return { pose: 'run', label, until: now + MIN_POSE_MS, holdFor: 'other' }
}

function linesInput(scene: Scene): LinesInput {
  return { stats, lifetimeEdits, isWorking, isAsleep: scene.pose === 'sleep', contextPercent }
}

function setTicker($: EngineInterface, ms: number): void {
  if (ticker !== null && tickerMs === ms) return
  ticker?.cancel()
  tickerMs = ms
  ticker = $.clock.every(ms, () => {
    tick($).catch(() => {})
  })
}

// Show the scene as it is now: redraw when the text changed, else repaint the sprite alone
async function paint($: EngineInterface, now: number): Promise<void> {
  const scene = sceneAt(now)
  setTicker($, scene.isAnimating ? FAST_MS : SLOW_MS)

  if (scene.label !== lastLabel) {
    lastLabel = scene.label
    $.ui.invalidate('ui.render')
    return
  }
  if (!isMounted || bandId === null) return
  const cells = cellsOf(scene.pose, scene.tick, palette)
  if (cells === lastCells) return
  lastCells = cells
  const painted = await $.ui.blit({ requestId: bandId, key: RASTER_KEY, cells })
  // A collapsed or covered band has no Raster to paint: wait for the next draw
  if (painted.deny !== undefined) isMounted = false
}

async function tick($: EngineInterface): Promise<void> {
  if (isTicking) return
  isTicking = true
  try {
    const now = await $.clock.now()
    tickCount += 1
    if (sceneAt(now).pose === 'idle') {
      idleBeats += 1
      if (idleBeats % WAG_EVERY_BEATS === 0) {
        action = { pose: 'wag', label: 'idle', until: now + WAG_MS, holdFor: null }
      } else if (idleBeats % BLINK_EVERY_BEATS === 0) {
        action = { pose: 'blink', label: 'idle', until: now + BLINK_MS, holdFor: null }
      }
    }
    await paint($, now)
  } finally {
    isTicking = false
  }
}

async function refreshUsage($: EngineInterface): Promise<void> {
  try {
    const usage = await $.session.usage()
    contextPercent = usage.context.percent
  } catch {
    // The mood line just goes without the context reading
  }
}

// Read the stored total again right before writing: another session may have fed it too
async function feed($: EngineInterface): Promise<void> {
  try {
    const saved = Number((await $.store.get(STORE_KEY)) ?? 0)
    lifetimeEdits = (Number.isFinite(saved) ? saved : 0) + 1
    await $.store.set(STORE_KEY, lifetimeEdits)
  } catch {
    lifetimeEdits += 1
  }
}

export const register: Register = (on, options) => {
  // A change in the config menu reloads the module, so reading the colors once is enough
  palette = {
    body: parseColor(options.bodyColor, DEFAULT_PALETTE.body),
    ground: parseColor(options.groundColor, DEFAULT_PALETTE.ground),
  }

  on('session.start', async ($, e, next) => {
    lastActivityAt = await $.clock.now()
    try {
      const saved = Number((await $.store.get(STORE_KEY)) ?? 0)
      lifetimeEdits = Number.isFinite(saved) ? saved : 0
    } catch {
      lifetimeEdits = 0
    }
    await refreshUsage($)
    setTicker($, SLOW_MS)
    $.ui.invalidate('ui.render')
    try {
      await $.command.register({
        name: 'rex',
        description: 'Show what REX the T-Rex has seen this session',
        immediate: true,
      })
    } catch {
      // Another command already has the name: the band still works without it
    }
    try {
      await $.command.register({
        name: 'trex',
        description: 'Make REX do a trick: ' + Object.keys(TRICKS).join(', '),
        argumentHint: '<trick>',
        immediate: true,
      })
    } catch {
      // Same as above: the dino still reacts to what Claude does
    }
    return next(e)
  })

  // /clear starts a new conversation in the same process, so the session counters start over
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      stats = createStats()
      isWorking = false
      action = null
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    isWorking = true
    lastActivityAt = now
    recordTurnStart(stats)
    $.ui.invalidate('ui.render')
    await paint($, now)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's turn ends inside the main one, which is still running
    if (e.agentId !== undefined) return next(e)
    const now = await $.clock.now()
    isWorking = false
    lastActivityAt = now
    if (e.reason === 'answer') action = { pose: 'cheer', label: 'done!', until: now + CHEER_MS, holdFor: null }
    if (e.reason === 'error') action = { pose: 'startled', label: 'spooked', until: now + STARTLED_MS, holdFor: null }
    await refreshUsage($)
    $.ui.invalidate('ui.render')
    await paint($, now)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const kind = kindOf(tool)
    const target = targetOf(kind, tool, e as unknown as Readonly<Record<string, unknown>>)
    const now = await $.clock.now()
    recordCall(stats)
    lastActivityAt = now
    action = actionFor(kind, activityOf(kind, target), now)
    openCalls[kind] += 1
    await paint($, now)

    let result
    try {
      result = await next(e)
    } finally {
      openCalls[kind] -= 1
    }

    // A refused call comes back as { deny }, and a failed one has isError set
    const isOk = result.deny === undefined && result.isError !== true
    recordResult(stats, kind, target, isOk)
    const after = await $.clock.now()
    lastActivityAt = after
    if (!isOk) action = { pose: 'startled', label: 'spooked by ' + tool, until: after + STARTLED_MS, holdFor: null }
    if (isOk && kind === 'edit') await feed($)
    $.ui.invalidate('ui.render')
    return result
  })

  on('command.run', { command: 'rex' }, async ($) => {
    const scene = sceneAt(await $.clock.now())
    return { text: [NAME + ' · ' + scene.label, ...statLines(linesInput(scene))].join('\n') }
  })

  on('command.run', { command: 'trex' }, async ($, e) => {
    const name = e.args.trim().toLowerCase()
    const trick = Object.hasOwn(TRICKS, name) ? TRICKS[name] : undefined
    if (trick === undefined) return { text: 'Usage: /trex <' + Object.keys(TRICKS).join(' | ') + '>' }
    const now = await $.clock.now()
    lastActivityAt = now
    action = { pose: trick.pose, label: trick.label, until: now + trick.ms, holdFor: null, startTick: tickCount }
    await paint($, now)
    return { text: NAME + ' · ' + trick.label }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Whatever the mods after this one draw in the band stays, under the dino
    const below = await next(e)
    if (e.props.hasSurvey) return below

    const scene = sceneAt(await $.clock.now())
    lastLabel = scene.label
    bandId = e.requestId

    // No Raster off the terminal, and no room for one in a short band: one line of text
    if (e.surface !== 'terminal' || e.props.maxRows < ROWS) {
      isMounted = false
      const { Box, Text } = $.ui.resolve(e)
      return Box({
        flexDirection: 'column',
        children: [
          Text({
            dimColor: true,
            wrap: 'truncate-end',
            children: [NAME + ' · ' + scene.label + ' · ' + summaryOf(stats)],
          }),
          below,
        ],
      })
    }

    const { Box, Text, Raster } = $.ui.resolve(e)
    const cells = cellsOf(scene.pose, scene.tick, palette)
    lastCells = cells
    isMounted = true

    const textColumns = e.props.bodyColumns - COLUMNS - GAP_COLUMNS
    const sprite = Raster({ key: RASTER_KEY, columns: COLUMNS, rows: ROWS, cells })
    const text =
      textColumns < MIN_TEXT_COLUMNS
        ? null
        : Box({
            flexDirection: 'column',
            width: textColumns,
            children: [
              Box({
                flexDirection: 'row',
                children: [
                  Text({ bold: true, children: [NAME] }),
                  Text({ wrap: 'truncate-end', children: [' · ' + scene.label] }),
                ],
              }),
              ...statLines(linesInput(scene)).map((line) =>
                Text({ dimColor: true, wrap: 'truncate-end', children: [line] }),
              ),
            ],
          })

    return Box({
      flexDirection: 'column',
      children: [Box({ flexDirection: 'row', columnGap: GAP_COLUMNS, children: [sprite, text] }), below],
    })
  })
}
