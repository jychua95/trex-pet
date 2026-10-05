// What the T-Rex has seen this session, as pure logic: counters, labels, and the mood line.

export type ToolKind = 'read' | 'edit' | 'bash' | 'other'

export type Stats = {
  filesRead: Set<string>
  filesEdited: Set<string>
  commands: number
  turns: number
  turnToolCalls: number
  editStreak: number
  hasRecentFailure: boolean
}

export type Target = { path: string | null; name: string }

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const HIGH_CONTEXT_PERCENT = 80
const HYPED_STREAK = 3
const CURIOUS_READS = 5
const MAX_NAME_LENGTH = 28

export function createStats(): Stats {
  return {
    filesRead: new Set(),
    filesEdited: new Set(),
    commands: 0,
    turns: 0,
    turnToolCalls: 0,
    editStreak: 0,
    hasRecentFailure: false,
  }
}

export function kindOf(tool: string): ToolKind {
  if (READ_TOOLS.has(tool)) return 'read'
  if (EDIT_TOOLS.has(tool)) return 'edit'
  if (tool === 'Bash') return 'bash'
  return 'other'
}

function clip(text: string): string {
  return text.length > MAX_NAME_LENGTH ? text.slice(0, MAX_NAME_LENGTH - 1) + '…' : text
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

// What a tool call is aimed at: the file's path and a short name to show
export function targetOf(kind: ToolKind, tool: string, input: Readonly<Record<string, unknown>>): Target {
  if (kind === 'bash') {
    const command = textOf(input.command) ?? ''
    return { path: null, name: clip(command.split('\n')[0] ?? '') }
  }
  if (kind === 'other') return { path: null, name: clip(tool) }
  const path = textOf(input.file_path) ?? textOf(input.notebook_path) ?? textOf(input.path)
  if (path !== null) return { path, name: clip(path.split('/').pop() || path) }
  return { path: null, name: clip(textOf(input.pattern) ?? tool) }
}

export function activityOf(kind: ToolKind, target: Target): string {
  if (kind === 'read') return 'sniffing ' + target.name
  if (kind === 'edit') return 'chomping ' + target.name
  if (kind === 'bash') return 'stomping: ' + target.name
  return 'using ' + target.name
}

export function recordCall(stats: Stats): void {
  stats.turnToolCalls += 1
}

export function recordResult(stats: Stats, kind: ToolKind, target: Target, isOk: boolean): void {
  stats.hasRecentFailure = !isOk
  if (!isOk) {
    stats.editStreak = 0
    return
  }
  if (kind === 'read' && target.path !== null) stats.filesRead.add(target.path)
  if (kind === 'bash') stats.commands += 1
  if (kind === 'edit') {
    if (target.path !== null) stats.filesEdited.add(target.path)
    stats.editStreak += 1
  }
}

export function recordTurnStart(stats: Stats): void {
  stats.turns += 1
  stats.turnToolCalls = 0
}

export type MoodInput = {
  stats: Stats
  isWorking: boolean
  isAsleep: boolean
  contextPercent: number | undefined
}

export function moodOf({ stats, isWorking, isAsleep, contextPercent }: MoodInput): string {
  if (contextPercent !== undefined && contextPercent >= HIGH_CONTEXT_PERCENT) {
    return 'sweating (context ' + contextPercent + '%)'
  }
  if (stats.hasRecentFailure) return 'spooked'
  if (isAsleep) return 'asleep'
  if (isWorking) return stats.editStreak >= HYPED_STREAK ? 'hyped' : 'focused'
  if (stats.filesEdited.size > 0) return 'well fed'
  if (stats.filesRead.size >= CURIOUS_READS) return 'curious'
  return 'chill'
}

function plural(count: number, one: string, many: string): string {
  return formatCount(count) + ' ' + (count === 1 ? one : many)
}

export function formatCount(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function summaryOf(stats: Stats): string {
  return [
    'read ' + plural(stats.filesRead.size, 'file', 'files'),
    'edited ' + formatCount(stats.filesEdited.size),
    'ran ' + plural(stats.commands, 'cmd', 'cmds'),
  ].join(' · ')
}

export type LinesInput = MoodInput & { lifetimeEdits: number }

// The lines beside the sprite, under the name line
export function statLines(input: LinesInput): string[] {
  const { stats, lifetimeEdits } = input
  return [
    summaryOf(stats),
    'turn ' + stats.turns + ' · ' + plural(stats.turnToolCalls, 'tool call', 'tool calls') + ' · edit streak ' + stats.editStreak,
    'mood: ' + moodOf(input),
    'lifetime: ' + plural(lifetimeEdits, 'edit', 'edits') + ' fed',
  ]
}
