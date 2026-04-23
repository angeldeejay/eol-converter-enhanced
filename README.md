# Newlines (EOL) Converter CLI

Simple CLI to inspect and normalize line endings across files.

- Convert to `LF` (default) or `CRLF`
- Check current EOL per file without writing changes
- Accept glob patterns, relative directories, and absolute directories
- Support multiple `--exclude` patterns
- Skip binary files and text files with no line breaks (`NONE`)

## Installation

```bash
npm i -g eol-converter-cli
```

## Command

```bash
eolConverter [--lf | --crlf | --check] [-v | --verbose] [--exclude <glob> | --exclude=<glob>]... <target> [<target> ...]
```

## Modes

- `--lf`: convert matched files to LF (default)
- `--crlf`: convert matched files to CRLF
- `--check`: list files and detected EOL only (no writes)

## Options

- `-h`, `--help`: show usage and exit
- `-v`, `--verbose`: print run context and filter counters
- `--exclude <glob>`: exclude files matching a glob (repeatable)
- `--exclude=<glob>`: same as above

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
```

Files with `NONE` EOL are filtered out and not listed.

## Examples

Check only:

```bash
eolConverter --check "**/*.js" "**/*.ts"
eolConverter --check -v . --exclude "**/.git/**" --exclude "**/node_modules/**"
```

Convert to LF:

```bash
eolConverter --lf "**/*.{js,jsx,ts,tsx}"
eolConverter --lf src tests --exclude "**/*.min.js"
```

Convert to CRLF:

```bash
eolConverter --crlf "**/*.js"
eolConverter --crlf "C:/work/project/src" --exclude "**/node_modules/**"
```

## Notes

- Conversion writes files in place.
- Candidate files are filtered before processing:
  - likely binary files are skipped
  - text files with no line breaks (`NONE`) are skipped

## License

Apache 2.0 © [Juraj Husár](https://jurosh.com)
