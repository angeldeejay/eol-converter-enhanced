#!/usr/bin/env node
'use strict';

const eol = require('eol')
const glob = require('glob')
const fs = require('fs')
const path = require('path')

// Number of bytes sampled from file start for binary-vs-text detection.
const TEXT_SAMPLE_BYTES = 8192
// Max ratio of suspicious control bytes tolerated before treating a file as binary.
const BINARY_CONTROL_RATIO_THRESHOLD = 0.3
const ANSI_RESET = '\x1b[0m'
const ANSI_RED = '\x1b[31m'
const ANSI_YELLOW = '\x1b[33m'
const ANSI_MAGENTA = '\x1b[35m'
const ANSI_CYAN = '\x1b[36m'

/**
 * Print CLI usage, options, and examples.
 *
 * @returns {void}
 */
function printHelp() {
  console.log('Usage: eolc [--lf | --crlf | --check] [-v | --verbose] [--no-color] [--exclude <glob> | --exclude=<glob>]... <target> [<target> ...]')
  console.log('')
  console.log('Modes (switches):')
  console.log('  --lf      Convert matched files to LF (default)')
  console.log('  --crlf    Convert matched files to CRLF')
  console.log('  --check   List matched files only (no writes)')
  console.log('')
  console.log('Target inputs:')
  console.log('  - Glob pattern (for example, "**/*.js")')
  console.log('  - Relative or absolute directory path (processed recursively)')
  console.log('')
  console.log('Options:')
  console.log('  -h, --help         Show this help and exit')
  console.log('  -v, --verbose      Show run context and filter counters')
  console.log('  --no-color         Disable ANSI colors in --check output')
  console.log('  --exclude <glob>   Exclude files matching glob (repeatable)')
  console.log('  --exclude=<glob>   Exclude files matching glob (repeatable)')
  console.log('')
  console.log('Notes:')
  console.log('  - Binary files are automatically skipped using content-based detection')
  console.log('  - In conversion modes, text files without line breaks (EOL=NONE) are skipped')
  console.log('')
  console.log('Examples:')
  console.log('  eolc --check "**/*.js" "**/*.ts"')
  console.log('  eolc --check -v . --exclude "**/.git/**"')
  console.log('  eolc --crlf src --exclude "**/*.min.js"')
  console.log('  eolc --lf "C:/work/project/src" --exclude "**/node_modules/**"')
  console.log('  eolc --help')
}

/**
 * Parse CLI arguments into runtime configuration.
 *
 * Recognized inputs:
 * - Mode switches: `--lf`, `--crlf`, `--check`
 * - Verbosity: `-v`, `--verbose`
 * - Exclusions: `--exclude <glob>`, `--exclude=<glob>`
 * - Positional targets: one or more globs or directory paths
 *
 * @param {string[]} args Raw CLI args (`process.argv.slice(2)`).
 * @returns {{showHelp: true} | {error: string, exitCode?: number} | {showHelp: false, mode: 'lf'|'crlf'|'check', verbose: boolean, noColor: boolean, excludeGlobs: string[], inputTargets: string[]}}
 */
function parseArgs(args) {
  if (args[0] === '--help' || args[0] === '-h') {
    return { showHelp: true }
  }

  if (args.length === 0 || !['--lf', '--crlf', '--check'].includes(args[0])) {
    return {
      error: 'ERROR: first argument must be --lf, --crlf, or --check',
      exitCode: 124,
    }
  }

  const initialMode = args[0].slice(2)
  const excludeGlobs = []
  const inputTargets = []
  const selectedModes = [initialMode]
  let verbose = false
  let noColor = false
  
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]

    if (arg === '-v' || arg === '--verbose') {
      verbose = true
      continue
    }

    if (arg === '--no-color') {
      noColor = true
      continue
    }

    if (arg === '--exclude') {
      const nextArg = args[i + 1]
      if (!nextArg || nextArg.startsWith('-')) {
        return { error: 'ERROR: --exclude requires a glob pattern' }
      }
      excludeGlobs.push(nextArg)
      i++
      continue
    }

    if (arg === '--exclude=') {
      const nextArg = args[i + 1]
      if (!nextArg || nextArg.startsWith('-')) {
        return { error: 'ERROR: --exclude requires a glob pattern' }
      }
      excludeGlobs.push(nextArg)
      i++
      continue
    }

    if (arg.startsWith('--exclude=')) {
      const pattern = arg.slice('--exclude='.length)
      if (!pattern) {
        return { error: 'ERROR: --exclude requires a glob pattern' }
      }
      excludeGlobs.push(pattern)
      continue
    }

    if (arg === '--check') {
      selectedModes.push('check')
      continue
    }

    if (arg === '--crlf') {
      selectedModes.push('crlf')
      continue
    }

    if (arg === '--lf') {
      selectedModes.push('lf')
      continue
    }

    if (arg.startsWith('-')) {
      return { error: 'ERROR: unknown option ' + arg }
    }

    inputTargets.push(arg)
  }

  if (selectedModes.length > 1) {
    return { error: 'ERROR: use only one mode switch: --lf, --crlf, or --check' }
  }

  if (inputTargets.length === 0) {
    return { error: 'ERROR: missing files target (glob or directory path)' }
  }

  return {
    showHelp: false,
    mode: selectedModes[0] || 'lf',
    verbose,
    noColor,
    excludeGlobs,
    inputTargets,
  }
}

/**
 * Build glob options object from exclude patterns.
 *
 * @param {string[]} excludeGlobs Glob patterns to ignore.
 * @returns {{nodir: boolean, ignore?: string[]}}
 */
function createGlobOptions(excludeGlobs) {
  const options = { nodir: true }
  if (excludeGlobs.length > 0) {
    options.ignore = excludeGlobs.flatMap(pattern => (
      pattern.includes('/') || pattern.includes('\\')
        ? [pattern]
        : [pattern, '**/' + pattern]
    ))
  }
  return options
}

/**
 * Check whether a target string contains glob syntax.
 *
 * @param {string} target CLI target string.
 * @returns {boolean}
 */
function hasGlobMagic(target) {
  return /[*?[\]{}]/.test(target)
}

/**
 * Convert Windows separators into glob-friendly slash separators.
 *
 * @param {string} inputPath Path to normalize for glob usage.
 * @returns {string}
 */
function toGlobPath(inputPath) {
  return inputPath.replace(/\\/g, '/')
}

/**
 * Expand each input target to a concrete glob pattern.
 *
 * Directory targets (relative or absolute) are expanded recursively
 * using a recursive wildcard pattern rooted at the directory; non-directory targets are treated as-is.
 *
 * @param {string[]} inputTargets Positional target arguments.
 * @param {string} dir Current working directory.
 * @returns {string[]} Concrete glob patterns.
 */
function expandTargetsToPatterns(inputTargets, dir) {
  return inputTargets.map(target => {
    const resolvedTarget = path.isAbsolute(target)
      ? target
      : path.resolve(dir, target)

    if (fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).isDirectory()) {
      return toGlobPath(path.join(resolvedTarget, '**/*'))
    }

    return target
  })
}

/**
 * Resolve input targets into a deduplicated, alphabetically sorted file list.
 *
 * @param {string[]} inputTargets Target args (globs and/or directories).
 * @param {string} dir Current working directory.
 * @param {{nodir: boolean, ignore?: string[]}} globOptions glob() options.
 * @returns {Promise<string[]>}
 */
async function collectFiles(inputTargets, dir, globOptions) {
  const inputPatterns = expandTargetsToPatterns(inputTargets, dir)
  const filesByPattern = await Promise.all(
    inputPatterns.map(pattern => glob(pattern, globOptions))
  )
  return [...new Set(filesByPattern.flat())].sort((a, b) => a.localeCompare(b))
}

/**
 * Validate literal path targets before glob expansion.
 *
 * @param {string[]} inputTargets Target args (globs and/or directories).
 * @param {string} dir Current working directory.
 * @returns {string | null}
 */
function validateInputTargets(inputTargets, dir) {
  for (const target of inputTargets) {
    if (hasGlobMagic(target)) {
      continue
    }

    const resolvedTarget = path.isAbsolute(target)
      ? target
      : path.resolve(dir, target)

    if (!fs.existsSync(resolvedTarget)) {
      return 'ERROR: target not found: ' + target
    }
  }

  return null
}

/**
 * Print execution context lines shown in verbose mode.
 *
 * @param {string} dir Current working directory.
 * @param {string[]} inputTargets Targets received from CLI.
 * @param {string[]} excludeGlobs Exclusion globs.
 * @param {boolean} isCheck True when running in check mode.
 * @param {boolean} isCrlf True when conversion target is CRLF.
 * @returns {void}
 */
function printRunContext(dir, inputTargets, excludeGlobs, isCheck, isCrlf) {
  console.log('Running in directory ' + dir)
  if (inputTargets.length === 1) {
    console.log('Input target: ' + inputTargets[0])
  } else {
    console.log('Input targets: ' + inputTargets.join(', '))
  }
  if (excludeGlobs.length > 0) {
    console.log('Exclude patterns: ' + excludeGlobs.join(', '))
  }
  console.log(isCheck
    ? 'CHECK: will only list files, no action will be performed'
    : 'Converting to ' + (isCrlf ? 'CRLF' : 'LF'))
}

/**
 * Convert a matched file entry to an absolute path.
 *
 * @param {string} fileName File path returned by glob.
 * @param {string} dir Current working directory.
 * @returns {string}
 */
function toAbsoluteFilePath(fileName, dir) {
  return path.isAbsolute(fileName) ? fileName : path.join(dir, fileName)
}

/**
 * Check whether a control byte is accepted in text files.
 *
 * Allowed controls: tab, line-feed, carriage-return, form-feed.
 *
 * @param {number} byte Single byte value.
 * @returns {boolean}
 */
function isTextSafeControlByte(byte) {
  return byte === 9 || byte === 10 || byte === 13 || byte === 12
}

/**
 * Heuristically classify a file as text or binary from a small byte sample.
 *
 * Rules:
 * - If NUL byte exists => binary.
 * - Otherwise, if suspicious control-byte ratio is too high => binary.
 *
 * @param {string} fileName File path to inspect.
 * @param {string} dir Current working directory.
 * @returns {boolean} True when file is likely text.
 */
function isLikelyTextFile(fileName, dir) {
  const absoluteFilePath = toAbsoluteFilePath(fileName, dir)
  const sampleBuffer = Buffer.alloc(TEXT_SAMPLE_BYTES)
  let fd

  try {
    fd = fs.openSync(absoluteFilePath, 'r')
    const bytesRead = fs.readSync(fd, sampleBuffer, 0, TEXT_SAMPLE_BYTES, 0)

    if (bytesRead === 0) {
      return true
    }

    let suspiciousControlCount = 0

    for (let i = 0; i < bytesRead; i++) {
      const byte = sampleBuffer[i]

      if (byte === 0) {
        return false
      }

      const isControl = byte < 32
      if (isControl && !isTextSafeControlByte(byte)) {
        suspiciousControlCount++
      }
    }

    return (suspiciousControlCount / bytesRead) < BINARY_CONTROL_RATIO_THRESHOLD
  } finally {
    if (typeof fd === 'number') {
      fs.closeSync(fd)
    }
  }
}

/**
 * Detect line-ending style used by a text file.
 *
 * @param {string} fileName File path to inspect.
 * @param {string} dir Current working directory.
 * @returns {'LF'|'CRLF'|'MIXED'|'NONE'}
 */
function detectFileEol(fileName, dir) {
  const absoluteFilePath = toAbsoluteFilePath(fileName, dir)
  const fileContent = fs.readFileSync(absoluteFilePath).toString()
  const hasCrlf = fileContent.includes('\r\n')
  const hasLf = fileContent.includes('\n')

  if (hasCrlf && hasLf) {
    const withoutCrlf = fileContent.replace(/\r\n/g, '')
    return withoutCrlf.includes('\n') ? 'MIXED' : 'CRLF'
  }

  if (hasCrlf) {
    return 'CRLF'
  }

  if (hasLf) {
    return 'LF'
  }

  return 'NONE'
}

/**
 * Return ANSI color code for one EOL label.
 *
 * @param {'LF'|'CRLF'|'MIXED'|'NONE'} eolLabel Detected EOL label.
 * @returns {string}
 */
function getEolColor(eolLabel) {
  if (eolLabel === 'LF') {
    return ANSI_CYAN
  }
  if (eolLabel === 'CRLF') {
    return ANSI_MAGENTA
  }
  if (eolLabel === 'NONE') {
    return ANSI_YELLOW
  }
  return ANSI_RED
}

/**
 * Wrap one console line with the configured EOL color.
 *
 * @param {string} line Printable line content.
 * @param {'LF'|'CRLF'|'MIXED'|'NONE'} eolLabel Detected EOL label.
 * @param {boolean} noColor True when ANSI colors are disabled.
 * @returns {string}
 */
function colorizeLine(line, eolLabel, noColor) {
  if (noColor) {
    return line
  }

  return getEolColor(eolLabel) + line + ANSI_RESET
}

/**
 * Filter candidate files to processable text files.
 *
 * @param {string[]} files Candidate file list.
 * @param {string} dir Current working directory.
 * @param {boolean} includeNoneEol True when NONE files should remain in the result.
 * @returns {{processableFiles: string[], skippedBinaryFiles: string[], skippedNoneEolFiles: string[]}}
 */
function filterProcessableFiles(files, dir, includeNoneEol = false) {
  const processableFiles = []
  const skippedBinaryFiles = []
  const skippedNoneEolFiles = []

  files.forEach(fileName => {
    try {
      if (!isLikelyTextFile(fileName, dir)) {
        skippedBinaryFiles.push(fileName)
        return
      }

      const currentEol = detectFileEol(fileName, dir)
      if (!includeNoneEol && currentEol === 'NONE') {
        skippedNoneEolFiles.push(fileName)
        return
      }

      processableFiles.push(fileName)
    } catch (error) {
      console.warn(error)
      processableFiles.push(fileName)
    }
  })

  return { processableFiles, skippedBinaryFiles, skippedNoneEolFiles }
}

/**
 * Convert one file to the target EOL and write it in place.
 *
 * @param {string} fileName File to convert.
 * @param {string} dir Current working directory.
 * @param {boolean} isCrlf True for CRLF conversion; false for LF.
 * @returns {void}
 */
function convertFile(fileName, dir, isCrlf) {
  const absoluteFilePath = toAbsoluteFilePath(fileName, dir)
  const fileContent = fs.readFileSync(absoluteFilePath).toString()
  const convertFn = (isCrlf ? eol.crlf : eol.lf).bind(eol)
  fs.writeFileSync(absoluteFilePath, convertFn(fileContent))
}

/**
 * Process final file list.
 *
 * In check mode: print `[EOL] path` entries only.
 * In conversion mode: print path and rewrite file with target EOL.
 *
 * @param {string[]} files Final processable file list.
 * @param {string} dir Current working directory.
 * @param {boolean} isCheck True when in check/list-only mode.
 * @param {boolean} isCrlf True for CRLF conversion target.
 * @param {boolean} verbose True to print trailing delimiter.
 * @param {boolean} noColor True when ANSI colors are disabled.
 * @returns {void}
 */
function processFiles(files, dir, isCheck, isCrlf, verbose, noColor) {
  files.forEach(fileName => {
    if (isCheck) {
      try {
        const currentEol = detectFileEol(fileName, dir)
        const eolLabel = '[' + currentEol.padStart(5, ' ') + ']'
        console.log(colorizeLine(eolLabel + ' ' + fileName, currentEol, noColor))
      } catch (error) {
        console.warn(error)
      }
      return
    }

    try {
      const currentEol = detectFileEol(fileName, dir)
      const targetEol = isCrlf ? 'CRLF' : 'LF'
      if (currentEol === targetEol) {
        return
      }

      convertFile(fileName, dir, isCrlf)
      console.log(fileName)
    } catch (error) {
      console.warn(error)
    }
  })
}

/**
 * Main program flow.
 *
 * 1) Parse arguments
 * 2) Resolve candidate files
 * 3) Filter out binary/NONE-EOL files
 * 4) Print/check or convert
 *
 * @returns {Promise<void>}
 */
async function run() {
  const parsed = parseArgs(process.argv.slice(2))

  if (parsed.showHelp) {
    printHelp()
    return
  }

  if (parsed.error) {
    console.error(parsed.error)
    process.exitCode = parsed.exitCode || 1
    return
  }

  const { mode, verbose, noColor, excludeGlobs, inputTargets } = parsed
  const isCheck = mode === 'check'
  const isCrlf = mode === 'crlf'
  const dir = process.cwd()

  const invalidTargetError = validateInputTargets(inputTargets, dir)
  if (invalidTargetError) {
    console.error(invalidTargetError)
    process.exitCode = 1
    return
  }

  if (verbose) {
    printRunContext(dir, inputTargets, excludeGlobs, isCheck, isCrlf)
  }

  const globOptions = createGlobOptions(excludeGlobs)
  const files = await collectFiles(inputTargets, dir, globOptions)

  if (files.length === 0) {
    if (verbose) {
      console.log('No files found')
    }
    return
  }

  const { processableFiles, skippedBinaryFiles, skippedNoneEolFiles } = filterProcessableFiles(
    files,
    dir,
    isCheck
  )

  if (verbose && skippedBinaryFiles.length > 0) {
    console.log('Skipped binary files: ' + skippedBinaryFiles.length)
  }

  if (verbose && skippedNoneEolFiles.length > 0) {
    console.log('Skipped NONE EOL files: ' + skippedNoneEolFiles.length)
  }

  if (verbose) {
    console.log('---')
  }

  if (processableFiles.length === 0) {
    if (verbose) {
      console.log('No processable text files found after filters')
    }
    return
  }

  processFiles(processableFiles, dir, isCheck, isCrlf, verbose, noColor)
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
