// The T-Rex's frames, as pure data: a pose and a tick in, a Raster's packed cells out.
// One terminal cell holds two pixels (a half block), so the 12-pixel sprite takes 6 rows.

export const COLUMNS = 18
export const ROWS = 6

export type Pose =
  | 'idle'
  | 'blink'
  | 'wag'
  | 'sleep'
  | 'run'
  | 'sniff'
  | 'chomp'
  | 'stomp'
  | 'startled'
  | 'cheer'
  | 'jump'

export const POSES: readonly Pose[] = [
  'idle',
  'blink',
  'wag',
  'sleep',
  'run',
  'sniff',
  'chomp',
  'stomp',
  'startled',
  'cheer',
  'jump',
]

const ORANGE = 0xd25516
const BROWN = 0x653f24
const GRAY = 0x8a8a8a
const RED = 0xc62828
// One above the 24-bit range: the terminal's own default color
const DEFAULT_COLOR = 0x01000000

export type Palette = { body: number; ground: number }

export const DEFAULT_PALETTE: Palette = { body: ORANGE, ground: BROWN }

// A color as the plugin's options spell it, '#d25516' or 'd25516'; anything else is the fallback
export function parseColor(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback
  const hex = /^#?([0-9a-f]{6})$/i.exec(value.trim())?.[1]
  return hex === undefined ? fallback : Number.parseInt(hex, 16)
}

const SPACE = 0x20
const FULL_BLOCK = 0x2588
const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584

// '#' is the dino, 'o' its eye (left empty), '=' the ground, '.' nothing
const BODY: readonly string[] = [
  '..........####....',
  '.........#o####...',
  '.........######...',
  '.........###......',
  '.........#####....',
  '..#.....####......',
  '..##..#######.....',
  '..##########......',
  '...########.......',
  '....######........',
  '.....#..#.........',
  '.....##.##........',
]

const JAW_ROW = 3
const JAW_CLOSED: readonly string[] = ['.........######...', '.........####.....']

const TAIL_ROW = 5
const TAIL_FLAT: readonly string[] = ['........####......', '.###..#######.....']

const LEG_ROW = 10
const LEGS_RIGHT_UP: readonly string[] = ['.....#..##........', '.....##...........']
const LEGS_LEFT_UP: readonly string[] = ['.....##.#.........', '........##........']

const GROUND_ROW = 9
const GROUND: readonly string[] = ['==...........====.', '..............==..', '=.=.........=.....']

const EMPTY_ROW = '.'.repeat(COLUMNS)

// One jump, a tick per step. The sprite fills the raster's height, so the body rises
// into a tucked head: the lift never exceeds the head's drop, and nothing is cut off
const JUMP_ARC: readonly { headDrop: number; lift: number }[] = [
  { headDrop: 1, lift: 0 },
  { headDrop: 1, lift: 1 },
  { headDrop: 2, lift: 2 },
  { headDrop: 2, lift: 2 },
  { headDrop: 2, lift: 2 },
  { headDrop: 1, lift: 1 },
  { headDrop: 1, lift: 0 },
  { headDrop: 0, lift: 0 },
]

export const JUMP_TICKS = JUMP_ARC.length

type Overlay = { column: number; row: number; char: string; color: number }

type Look = {
  isJawClosed: boolean
  isEyeClosed: boolean
  isTailFlat: boolean
  // Pixels the head drops onto the neck, and pixels the whole dino rises off the ground
  headDrop: number
  lift: number
  legs: 'stand' | 'rightUp' | 'leftUp'
  shift: -1 | 0 | 1
  groundOffset: number
  overlays: Overlay[]
}

export type Frame = { pixels: string[]; overlays: Overlay[] }

function lookOf(pose: Pose, tick: number): Look {
  const look: Look = {
    isJawClosed: false,
    isEyeClosed: false,
    isTailFlat: false,
    headDrop: 0,
    lift: 0,
    legs: 'stand',
    shift: 0,
    groundOffset: 0,
    overlays: [],
  }
  const isOdd = tick % 2 === 1
  const isSecondHalf = tick % 4 >= 2

  switch (pose) {
    case 'idle':
      break
    case 'blink':
      look.isEyeClosed = true
      break
    case 'wag':
      look.isTailFlat = isSecondHalf
      break
    case 'sleep': {
      look.isEyeClosed = true
      look.isJawClosed = true
      const snore = ['z', 'zZ', 'zZz'][tick % 3] ?? 'z'
      look.overlays = [...snore].map((char, i) => ({ column: 15 + i, row: 0, char, color: GRAY }))
      break
    }
    case 'run':
      look.legs = isOdd ? 'leftUp' : 'rightUp'
      look.groundOffset = tick
      break
    case 'sniff':
      look.headDrop = isSecondHalf ? 1 : 0
      break
    case 'chomp':
      look.isJawClosed = isOdd
      break
    case 'stomp':
      look.legs = isOdd ? 'leftUp' : 'rightUp'
      look.shift = isSecondHalf ? 1 : 0
      break
    case 'startled':
      look.shift = -1
      if (!isOdd) look.overlays = [{ column: 16, row: 0, char: '!', color: RED }]
      break
    case 'cheer':
      look.isJawClosed = isOdd
      look.isTailFlat = isSecondHalf
      if (!isOdd) look.overlays = [{ column: 16, row: 0, char: '*', color: ORANGE }]
      break
    case 'jump': {
      const step = JUMP_ARC[tick % JUMP_ARC.length]
      look.headDrop = step?.headDrop ?? 0
      look.lift = step?.lift ?? 0
      break
    }
  }
  return look
}

// Keep the top row's pixel where it has one, else take the row beneath's
function merge(top: string, beneath: string): string {
  let out = ''
  for (let x = 0; x < COLUMNS; x++) out += top[x] !== '.' ? top[x] : (beneath[x] ?? '.')
  return out
}

function shiftRow(row: string, shift: -1 | 0 | 1): string {
  if (shift === 1) return '.' + row.slice(0, -1)
  if (shift === -1) return row.slice(1) + '.'
  return row
}

export function frameOf(pose: Pose, tick: number): Frame {
  const look = lookOf(pose, tick)
  let rows = [...BODY]

  if (look.isTailFlat) rows.splice(TAIL_ROW, TAIL_FLAT.length, ...TAIL_FLAT)
  if (look.isJawClosed) rows.splice(JAW_ROW, JAW_CLOSED.length, ...JAW_CLOSED)
  if (look.isEyeClosed) rows = rows.map((row) => row.replace('o', '#'))
  if (look.headDrop > 0) {
    // The head's five rows drop onto the neck, and the body keeps its pixels where they meet
    const head = rows.slice(0, TAIL_ROW)
    rows = rows.map((row, y) => {
      const dropped = head[y - look.headDrop] ?? EMPTY_ROW
      return y < TAIL_ROW ? dropped : merge(row, dropped)
    })
  }
  if (look.legs !== 'stand') {
    const legs = look.legs === 'rightUp' ? LEGS_RIGHT_UP : LEGS_LEFT_UP
    rows.splice(LEG_ROW, legs.length, ...legs)
  }
  if (look.lift > 0) rows = [...rows.slice(look.lift), ...Array<string>(look.lift).fill(EMPTY_ROW)]
  rows = rows.map((row) => shiftRow(row, look.shift))

  // The ground scrolls behind the dino, wrapping at the sprite's width
  GROUND.forEach((ground, i) => {
    let scrolled = ''
    for (let x = 0; x < COLUMNS; x++) scrolled += ground[(x + look.groundOffset) % COLUMNS] ?? '.'
    const y = GROUND_ROW + i
    rows[y] = merge(rows[y] ?? EMPTY_ROW, scrolled)
  })

  return { pixels: rows, overlays: look.overlays }
}

function colorOf(pixel: string | undefined, palette: Palette): number | null {
  if (pixel === '#') return palette.body
  if (pixel === '=') return palette.ground
  return null
}

// One cell is three numbers: the character's code point, its color, and its background
function cellOf(top: number | null, bottom: number | null): [number, number, number] {
  if (top !== null && bottom !== null) {
    return top === bottom ? [FULL_BLOCK, top, DEFAULT_COLOR] : [UPPER_HALF, top, bottom]
  }
  if (top !== null) return [UPPER_HALF, top, DEFAULT_COLOR]
  if (bottom !== null) return [LOWER_HALF, bottom, DEFAULT_COLOR]
  return [SPACE, DEFAULT_COLOR, DEFAULT_COLOR]
}

export function packCells(frame: Frame, palette: Palette = DEFAULT_PALETTE): string {
  const numbers: number[] = []
  for (let row = 0; row < ROWS; row++) {
    const top = frame.pixels[row * 2] ?? EMPTY_ROW
    const bottom = frame.pixels[row * 2 + 1] ?? EMPTY_ROW
    for (let column = 0; column < COLUMNS; column++) {
      let cell = cellOf(colorOf(top[column], palette), colorOf(bottom[column], palette))
      const overlay = frame.overlays.find((o) => o.row === row && o.column === column)
      // A glyph only goes where the sprite left the cell empty
      if (overlay && cell[0] === SPACE) cell = [overlay.char.codePointAt(0) ?? SPACE, overlay.color, DEFAULT_COLOR]
      numbers.push(...cell)
    }
  }
  // The mod runtime has Uint8Array.toBase64, which the es2023 lib does not declare
  const bytes = new Uint8Array(Uint32Array.from(numbers).buffer) as Uint8Array & { toBase64(): string }
  return bytes.toBase64()
}

export function cellsOf(pose: Pose, tick: number, palette: Palette = DEFAULT_PALETTE): string {
  return packCells(frameOf(pose, tick), palette)
}
