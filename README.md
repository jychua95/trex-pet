# trex-pet

A pixel T-Rex that lives above your prompt in [Claude Code](https://claude.com/claude-code). REX watches what Claude is doing and reacts: it sniffs when Claude reads a file, chomps when Claude edits one, stomps when a command runs, and falls asleep when you walk away. The lines beside it keep count of the session.

```
         ▄▀███▄     REX · chomping user.ts
         ███▀▀▀     read 4 files · edited 2 · ran 1 cmd
  ▄     ▄███▀▀      turn 3 · 7 tool calls · edit streak 2
  ██▄▄██████▀       mood: focused
▄▄ ▀██████▀  ▄▄▄▄   lifetime: 1,204 edits fed
▄ ▄  █▄ █▄  ▄ ▀▀
```

It is a Claude Code plugin written against the mods (function hooks) API. No build step, no dependencies, no network access.

## Requirements

- Claude Code 2.1.289 or newer. The mods API is early access and can change between releases, so a much newer version may need an update of this plugin.
- A terminal with 24-bit color. The sprite is drawn with half-block characters, so it needs no image support and works in Apple Terminal, iTerm2, Ghostty, the VS Code terminal and the like.
- In the Desktop app, or when the band above the prompt is shorter than 6 rows, REX shows as a single line of text instead of a sprite.

## Install

### As a plugin (recommended)

Inside Claude Code:

```
/plugin marketplace add jychua95/trex-pet
/plugin install trex-pet@trex-pet
```

Or from a shell:

```sh
claude plugin marketplace add jychua95/trex-pet
claude plugin install trex-pet@trex-pet
```

Start a new session, or run `/reload-plugins`, and REX appears above the prompt.

To update later:

```sh
claude plugin marketplace update trex-pet
claude plugin update trex-pet@trex-pet
```

To remove it:

```sh
claude plugin uninstall trex-pet@trex-pet
```

### From a local clone (for hacking on it)

```sh
git clone https://github.com/jychua95/trex-pet.git ~/mods/trex-pet
claude --plugin-dir ~/mods/trex-pet
```

To load it in every session without the flag, name the folder in the `env` block of `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/mods/trex-pet"
  }
}
```

A folder loaded this way is watched: save a file and the mod reloads in the running session. Use one install method, not both, or you get two dinos.

## Commands

| Command | What it does |
| :- | :- |
| `/trex <trick>` | Makes REX do a trick right now, even while Claude is working |
| `/trex` | Lists the tricks |
| `/rex` | Prints REX's current state and the session summary as text |

### Tricks

| Trick | What you see | How long |
| :- | :- | :- |
| `/trex jump` | Crouches, hops off the ground, lands | 1 second |
| `/trex run` | Legs cycle and the ground scrolls | 2 seconds |
| `/trex sniff` | Head bobs down toward the ground | 2 seconds |
| `/trex chomp` | Jaw snaps open and shut | 2 seconds |
| `/trex stomp` | Stamps its feet and rocks forward | 2 seconds |
| `/trex wag` | Tail swings | 2 seconds |
| `/trex cheer` | Jaw and tail go together, with a `*` sparkle | 2 seconds |
| `/trex startled` | Recoils, with a red `!` | 2 seconds |

## What REX does on its own

Every pose means something about the session:

| Pose | When it happens | What it tells you |
| :- | :- | :- |
| idle | Nothing is running | Claude is waiting for you |
| blink | Every 5 seconds while idle | REX is alive and well |
| wag | Every 13 seconds while idle | Same, with more enthusiasm |
| run | A turn is in progress | Claude is thinking, or using a tool that is not a read, an edit or a command |
| sniff | `Read`, `Grep`, `Glob`, `LS`, `NotebookRead` | Claude is reading. The label names the file |
| chomp | `Edit`, `Write`, `MultiEdit`, `NotebookEdit` | Claude is editing. Each successful edit feeds REX |
| stomp | `Bash` | Claude is running a command. The label shows its first line |
| startled | A tool call failed or was denied, or the turn ended in an error | Something went wrong. The label names the tool |
| cheer | The turn finished with an answer | Done |
| sleep | 5 minutes with no activity | Nobody is home |
| jump | Only on `/trex jump` | You asked nicely |

### The lines beside the sprite

1. `REX · <what it is doing>`
2. Unique files read, unique files edited, and commands run this session
3. The turn number, tool calls in this turn, and the current streak of successful edits
4. Mood (below)
5. Lifetime edits fed, counted across every session on the machine

`/clear` resets the session counts. The lifetime count stays.

### Moods

The first one that applies wins:

| Mood | Meaning |
| :- | :- |
| sweating | The context window is 80% full or more. Time to think about `/compact` |
| spooked | The last tool call failed or was denied |
| asleep | REX is sleeping |
| hyped | Claude is working and has landed 3 or more edits in a row |
| focused | Claude is working |
| well fed | Idle, and at least one file was edited this session |
| curious | Idle, and at least 5 files were read this session |
| chill | None of the above |

## Customize the colors

Two options, each a 6-digit hex color:

| Option | What it colors | Default |
| :- | :- | :- |
| `bodyColor` | The T-Rex | `#d25516` |
| `groundColor` | The ground under it | `#653f24` |

A value that is not a 6-digit hex color is ignored, and the default is used.

Set them in any of these ways:

- In Claude Code, open `/plugin`, pick trex-pet, and choose to configure it. `/config` lists the same options. A change takes effect right away.
- When installing:

  ```sh
  claude plugin install trex-pet@trex-pet --config 'bodyColor=#22aa55' --config 'groundColor=#3a3a3a'
  ```

- After installing, from a shell:

  ```sh
  echo '{"bodyColor":"#22aa55"}' | claude plugin configure trex-pet@trex-pet --values-stdin
  ```

- With a local clone, in `~/.claude/settings.json`:

  ```json
  {
    "pluginConfigs": {
      "trex-pet": {
        "options": { "bodyColor": "#22aa55", "groundColor": "#3a3a3a" }
      }
    }
  }
  ```

Some colors to try: `#22aa55` (classic green), `#7e57c2` (purple), `#29b6f6` (ice blue), `#e0e0e0` (fossil).

### Going further

The sprite itself is plain text in [`hooks/sprites.ts`](hooks/sprites.ts): `#` is a dino pixel, `o` the eye, `=` the ground. Clone the repository, load it with `--plugin-dir`, and redraw it. [`ARCHITECTURE.md`](ARCHITECTURE.md) explains how to add a pose, a trick, a stat line or an option.

## Privacy and permissions

REX reads the clock, the session's context usage and the names of the tools Claude calls. It writes one number, the lifetime edit count, to its own plugin store. It makes no network calls, reads no files, and never changes or blocks a tool call.

## Development

```sh
claude plugin validate .   # check the manifest and the hooks module
claude plugin test .       # run the tests
```

The files under `.claude-plugin/types/` are written by Claude Code when the mod loads from a folder. They are ignored by git.

## Troubleshooting

- **No dino after installing.** Run `/reload-plugins` or start a new session, then check `claude plugin list`. Run `claude --debug` to see why a plugin did not load.
- **Only one line of text.** The band above the prompt has fewer than 6 rows, or you are in the Desktop app. Make the terminal taller.
- **The sprite shows without the text.** The terminal is too narrow for both. Make it wider.
- **Two dinos.** The plugin is both installed and loaded from a folder. Remove one.
- **It stopped working after a Claude Code update.** The mods API changed. Open an issue with your `claude --version`.

## License

[MIT](LICENSE)
