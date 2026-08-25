const LF = 10;
const CR = 13;

/**
 * Incremental WHATWG-compliant text/event-stream parser.
 * https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream
 *
 * Feed decoded text with push(); each call returns the events completed by that
 * chunk. Handles CRLF / LF / lone-CR line endings (including a CR/LF pair split
 * across chunks), a single leading BOM, comment lines (":"), fields without a
 * colon, and strips exactly one leading space after the colon.
 *
 * end() leniently dispatches a pending event that was not followed by a blank
 * line. The spec discards it, but several gateways end streams without the
 * final separator and their last payload must not be lost.
 */
export function createSseParser() {
  let carry = '';
  let pendingCr = false;
  let atStreamStart = true;
  let eventType = '';
  let dataBuffer = '';
  let hasData = false;
  let lastEventId = '';

  function takeEvent(events) {
    if (!hasData) {
      eventType = '';
      return;
    }
    const data = dataBuffer.endsWith('\n') ? dataBuffer.slice(0, -1) : dataBuffer;
    events.push({
      event: eventType || 'message',
      data,
      id: lastEventId
    });
    eventType = '';
    dataBuffer = '';
    hasData = false;
  }

  function processLine(line, events) {
    if (line === '') {
      takeEvent(events);
      return;
    }
    if (line.charCodeAt(0) === 58) {
      // Comment line (":keep-alive") — ignore.
      return;
    }

    const colonIndex = line.indexOf(':');
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
    if (value.charCodeAt(0) === 32) {
      // The spec strips exactly one leading U+0020 — never more, never tabs.
      value = value.slice(1);
    }

    if (field === 'data') {
      dataBuffer += `${value}\n`;
      hasData = true;
    } else if (field === 'event') {
      eventType = value;
    } else if (field === 'id') {
      if (!value.includes('\0')) {
        lastEventId = value;
      }
    }
    // "retry" and unknown fields are ignored: fetch-based consumers do not
    // auto-reconnect, so the reconnection delay has no effect here.
  }

  function push(text) {
    let source = String(text ?? '');
    if (!source) {
      return [];
    }
    if (atStreamStart) {
      if (source.charCodeAt(0) === 0xfeff) {
        source = source.slice(1);
      }
      atStreamStart = false;
      if (!source) {
        return [];
      }
    }

    const events = [];
    let lineStart = 0;
    let index = 0;

    if (pendingCr) {
      // Previous chunk ended in CR: swallow a leading LF from this chunk.
      pendingCr = false;
      if (source.charCodeAt(0) === LF) {
        index = 1;
        lineStart = 1;
      }
    }

    for (; index < source.length; index += 1) {
      const code = source.charCodeAt(index);
      if (code !== LF && code !== CR) {
        continue;
      }
      processLine(carry + source.slice(lineStart, index), events);
      carry = '';
      if (code === CR) {
        if (index + 1 === source.length) {
          pendingCr = true;
        } else if (source.charCodeAt(index + 1) === LF) {
          index += 1;
        }
      }
      lineStart = index + 1;
    }

    carry += source.slice(lineStart);
    return events;
  }

  function end() {
    const events = [];
    if (carry) {
      processLine(carry, events);
      carry = '';
    }
    pendingCr = false;
    takeEvent(events);
    return events;
  }

  return { push, end };
}
