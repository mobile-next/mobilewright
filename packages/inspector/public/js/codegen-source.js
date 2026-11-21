// Pure source-editing helpers for codegen. No DOM access, so tests can import this module.

// Inserts a recorded line before the line that closes the generated body.
// That line is the first one consisting only of bodyEnd: recorded steps are indented in a test
// and never equal `await device.close();` in a library script, so a step such as
// `await device.setGeolocation({ ... });`, or code added after the test, cannot be mistaken for it.
// If the user edited that line away, fall back to the last occurrence, then to appending.
export function insertBeforeBodyEnd(source, bodyEnd, line) {
  const end = bodyEndLineStart(source, bodyEnd) ?? lastIndexOrNull(source, bodyEnd)
  if (end === null) {
    return source + line + '\n'
  }
  return source.slice(0, end) + line + '\n' + source.slice(end)
}

function bodyEndLineStart(source, bodyEnd) {
  let lineStart = 0
  for (const sourceLine of source.split('\n')) {
    if (sourceLine.trimEnd() === bodyEnd) {
      return lineStart
    }
    lineStart += sourceLine.length + 1
  }
  return null
}

function lastIndexOrNull(source, bodyEnd) {
  const index = source.lastIndexOf(bodyEnd)
  return index === -1 ? null : index
}
