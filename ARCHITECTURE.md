# trex-pet

## Purpose

A Claude Code mod that draws a pixel T-Rex in the band above the prompt. The dino animates with what Claude is doing, and the lines beside it summarize the session. Personal use, terminal first.

## Stack

- Claude Code mods API (early access; built and tested on v2.1.289)
- TypeScript, loaded directly by Claude Code. No build step, no dependencies.

## Features

- 18 x 6 cell sprite (12 pixels tall, two per cell) with eleven poses: idle, blink, wag, sleep, run, sniff, chomp, stomp, startled, cheer, jump
- Session counters: unique files read, unique files edited, commands run, tool calls this turn, edit streak
- Mood line derived from the counters, the turn state, and context window use
- Lifetime edit count kept across sessions
- `/rex` prints the same summary as text
- `/trex <trick>` plays a pose on demand: jump, run, sniff, chomp, stomp, wag, cheer, startled
- Dino and ground colors set through the plugin's options (`bodyColor`, `groundColor`)
- Fallbacks: sprite only in a narrow band, one line of text in a short band or the Desktop app

## Module map

| File | Responsibility |
| :- | :- |
| `.claude-plugin/plugin.json` | Manifest, and the `userConfig` fields a user can set |
| `.claude-plugin/marketplace.json` | Makes the repository its own one-plugin marketplace, for `plugin install` |
| `hooks/register.ts` | Event wiring and every mods API call: hooks, the ticker, drawing the band |
| `hooks/sprites.ts` | Pure. A pose and a tick in, a Raster's packed cells out |
| `hooks/stats.ts` | Pure. Counters, tool classification, labels, mood |
| `tests/trex-pet.test.ts` | Unit tests for the pure modules, and hook tests through the test kit |

`sprites.ts` and `stats.ts` take no `$`. That is a constraint, not a preference: the mods static analysis refuses a module that passes `$` to an imported function.

## Data flow

1. `tool.call` classifies the call, sets the current action (pose, label, minimum duration), and counts the result once `next(e)` resolves.
2. `turn.start` and `turn.complete` set whether Claude is working.
3. A ticker (`$.clock.every`) runs at 125 ms while something is animating and 1000 ms while idle. Each tick works out the scene from the state and the time.
4. When the label changed, the tick invalidates `ui.render`, which redraws sprite and text. When only the frame changed, it repaints the Raster with `$.ui.blit`, with no render pass.

State lives in module variables. It resets when the module reloads, which only happens when a file here is saved. `/clear` resets the session counters through `session.end`.

Only `lifetimeEdits` is persisted, in `$.store`. The value is read again right before each write, because every session on the machine shares the store.

## Extension points

- New pose: add it to `Pose` and `POSES`, and a case in `lookOf` in `sprites.ts`. Poses are built from the base sprite by swapping rows, so most need no new art.
- New trigger: add an action in `actionFor` in `register.ts`.
- New `/trex` trick: add a row to `TRICKS` in `register.ts`. A pose that must play from its first frame (like `jump`) reads the tick counted from the action's `startTick`.
- New option: add a field to `userConfig` in `plugin.json` and read it from `options` at the top of `register`. A change in the config menu reloads the module.
- New stat line: add it to `statLines` in `stats.ts`. The band has room for five lines of text.
- Tool classification: the `READ_TOOLS` and `EDIT_TOOLS` sets in `stats.ts`.

## Deployment notes

- Published as a plugin: users add the GitHub repository as a marketplace and install `trex-pet@trex-pet`. An installed copy only changes with a new commit and `claude plugin update`, so bump `version` in `plugin.json` on each release.
- For development it is loaded through `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. The folder is watched, so a saved edit hot-reloads. Do not install the published copy on the same machine, or the dino is drawn twice.
- Check a change with `claude plugin validate .` and `claude plugin test` from this folder.
- `.claude-plugin/types/` and `tsconfig.json` are written by Claude Code on load. Do not edit them. They describe the API of the installed version.
- The mods API may change between Claude Code releases. After an update, run the tests before trusting the band.
- A mod runs with the user's permissions. This one reads the clock, session usage, and its own store, and writes only its own store. It makes no network or file system calls.
