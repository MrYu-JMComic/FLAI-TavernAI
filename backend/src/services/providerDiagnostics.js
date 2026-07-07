export function createJsonResponseDiagnostics(response, result = {}) {
  return {
    transport: 'json',
    contentType: responseContentType(response),
    contentLength: String(result?.content || '').length,
    reasoningLength: String(result?.reasoning || '').length,
    usageKeys: listObjectKeys(result?.usage)
  };
}

export function createJsonStreamResponseDiagnostics(response, result = {}, json = []) {
  return {
    transport: 'json-stream',
    contentType: responseContentType(response),
    itemCount: Array.isArray(json) ? json.length : 0,
    contentLength: String(result?.content || '').length,
    reasoningLength: String(result?.reasoning || '').length,
    usageKeys: listObjectKeys(result?.usage)
  };
}

export function createStreamResponseDiagnostics(response) {
  return {
    transport: 'sse',
    contentType: responseContentType(response),
    eventCount: 0,
    jsonEventCount: 0,
    nonJsonEventCount: 0,
    doneEvent: false,
    samples: []
  };
}

export function recordStreamEventDiagnostics(diagnostics, event = {}, json) {
  if (!diagnostics) {
    return;
  }
  diagnostics.eventCount += 1;
  if (!json || typeof json !== 'object') {
    diagnostics.nonJsonEventCount += 1;
    addStreamDiagnosticSample(diagnostics, {
      event: event.event || 'message',
      json: false
    });
    return;
  }

  diagnostics.jsonEventCount += 1;
  addStreamDiagnosticSample(diagnostics, describeStreamJsonEvent(event, json));
}

export function finalizeStreamDiagnostics(diagnostics) {
  if (!diagnostics) {
    return null;
  }
  return {
    transport: diagnostics.transport,
    contentType: diagnostics.contentType,
    eventCount: diagnostics.eventCount,
    jsonEventCount: diagnostics.jsonEventCount,
    nonJsonEventCount: diagnostics.nonJsonEventCount,
    doneEvent: diagnostics.doneEvent,
    samples: diagnostics.samples
  };
}

function describeStreamJsonEvent(event = {}, json = {}) {
  const choice = Array.isArray(json.choices) ? json.choices[0] : null;
  const candidate = Array.isArray(json.candidates) ? json.candidates[0] : null;
  const delta = choice?.delta || json.delta;
  const message = choice?.message || json.message;
  const sample = {
    event: event.event || 'message',
    json: true,
    type: String(json.type || ''),
    topKeys: listObjectKeys(json),
    choiceKeys: listObjectKeys(choice),
    deltaKind: typeof delta,
    deltaKeys: listObjectKeys(delta),
    messageKeys: listObjectKeys(message),
    candidateKeys: listObjectKeys(candidate),
    finishReason: String(choice?.finish_reason || choice?.finishReason || candidate?.finishReason || candidate?.finish_reason || '')
  };

  if (candidate?.content) {
    sample.candidateContentKeys = listObjectKeys(candidate.content);
    const parts = Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
    sample.candidatePartKeys = listObjectKeys(parts[0]);
  }
  return sample;
}

function addStreamDiagnosticSample(diagnostics, sample) {
  if (!diagnostics || diagnostics.samples.length >= 6) {
    return;
  }
  diagnostics.samples.push(sample);
}

function responseContentType(response) {
  return String(response?.headers?.get?.('content-type') || '').toLowerCase();
}

function listObjectKeys(value, limit = 12) {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const keys = [];
  for (const key of Object.keys(value)) {
    keys.push(key);
    if (keys.length >= limit) {
      break;
    }
  }
  return keys;
}
