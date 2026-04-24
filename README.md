# eol-converter-enhanced

Simple CLI to inspect and normalize line endings across files.

- Convert to `LF` (default) or `CRLF`
- Check current EOL per file without writing changes
- Accept glob patterns, relative directories, and absolute directories
- Support multiple `--exclude` patterns
- Skip binary files automatically
- Skip `NONE` files only in conversion modes
- Colorize `--check` output without extra dependencies

This tool was inspired by [nodejs-eol-converter-cli](https://github.com/jurosh/nodejs-eol-converter-cli)

## Installation

```bash
npm i -g github:angeldeejay/eol-converter-enhanced
```

## Command

```bash
eolc [--lf | --crlf | --check] [-v | --verbose] [--no-color] [--exclude <glob> | --exclude=<glob>]... <target> [<target> ...]
```

The first argument must be one of:

- `--lf`
- `--crlf`
- `--check`

The only exception is help:

- `eolc -h`
- `eolc --help`

## Modes

- `--lf`: convert matched files to LF (default)
- `--crlf`: convert matched files to CRLF
- `--check`: list files and detected EOL only (no writes)

## Options

- `-h`, `--help`: show usage and exit
- `-v`, `--verbose`: print run context and filter counters
- `--no-color`: disable ANSI colors in `--check` output
- `--exclude <glob>`: exclude files matching a glob (repeatable)
- `--exclude=<glob>`: same as above
- `--exclude= <glob>`: same as above

## Targets

Each positional `<target>` can be:

- A glob pattern (for example, `"**/*.js"`)
- A relative directory path (processed recursively)
- An absolute directory path (processed recursively)

Multiple targets are supported in one command.

## Output

In `--check` mode, output is sorted alphabetically and shown as:

```text
[   LF] path/to/file
[ CRLF] path/to/file
[MIXED] path/to/file
[ NONE] path/to/file
```

When ANSI colors are enabled, the full line is colored by detected EOL:

- `LF` → cyan
- `CRLF` → magenta
- `MIXED` → red
- `NONE` → yellow

Use `--no-color` to disable that coloring.

## Examples

Check only:

```bash
eolc --check "**/*.js" "**/*.ts"
eolc --check -v . --exclude "**/.git/**" --exclude "**/node_modules/**"
eolc --check --no-color . --exclude= ".venv"
```

Convert to LF:

```bash
eolc --lf "**/*.{js,jsx,ts,tsx}"
eolc --lf src tests --exclude "**/*.min.js"
eolc --lf . --exclude= ".venv"
```

Convert to CRLF:

```bash
eolc --crlf "**/*.js"
eolc --crlf "C:/work/project/src" --exclude "**/node_modules/**"
```

## Notes

- Conversion writes files in place.
- `--lf` and `--crlf` print only files that were actually changed.
- If a file already matches the target EOL, it is not shown during conversion.
- In `--check`, files with `NONE` are listed like any other text file.
- Candidate files are filtered before processing:
  - likely binary files are skipped
  - in conversion modes, text files with no line breaks (`NONE`) are skipped
- A missing literal target path exits with code `1`.
- If the first token is not `--lf`, `--crlf`, or `--check`, the command exits with code `124`.
- If no files match or no processable files remain after filtering, the command exits with code `0`.

## License

Apache 2.0
