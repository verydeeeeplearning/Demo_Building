// Extracts the student-facing prose from a model draft message that may have leaked structured
// content instead of plain text. When the agent dumps its whole draft as a message, only the
// `assistantMessage` prose should reach the chat — never components/connections/agentEvents/the
// circuit-draft JSON. Observed leak shapes:
//   A) a JSON object:            {"assistantMessage": "...", "components": [...]}
//   B) markdown sections:        ... ### assistantMessage <prose> ### clarification ...
//   C) labeled plain text:       assistantMessage: <prose> clarification: 없음 회로 초안: {...}
// Pure + dependency-free so it can be unit-tested in isolation (chat-quality fix, plan-independent).

// Field labels that delimit the end of the assistantMessage prose in the labeled/markdown forms.
// Each requires a trailing colon so prose like "검증된 회로 초안입니다" (no colon) is NOT a terminator.
const FIELD_TERMINATOR =
  /(?:#{1,6}\s|(?:\bclarification\b|회로\s*초안|회로\s*스펙|\bcircuit\s*spec\b|\bcircuitspec\b|\bagent\s*events\b|\bassumptions\b)\s*[:：]|\n?\s*\{|```)/i;

// "assistantMessage" as a label: optionally markdown (### / **), optionally followed by a colon.
// The leading boundary keeps it from matching a quoted JSON key ("assistantMessage": handled below).
const ASSISTANT_LABEL = /(?:^|[\n\r#*>\s-])\**\s*assistant\s*message\**\s*[:：]?\s*/i;

export function extractAssistantProse(raw: string): string {
  const text = (raw ?? '').trim();
  if (!text) {
    return text;
  }

  // 1) Labeled form (markdown "### assistantMessage", "**assistantMessage**", or plain
  //    "assistantMessage:"). Capture the prose up to the next field label, JSON object, or fence.
  const label = ASSISTANT_LABEL.exec(text);
  if (label) {
    const after = text.slice(label.index + label[0].length);
    const term = FIELD_TERMINATOR.exec(after);
    const value = (term ? after.slice(0, term.index) : after).trim();
    if (value) {
      return value;
    }
  }

  // 2) JSON object form: pull the "assistantMessage" string field directly. A regex (not JSON.parse)
  //    is used so truncated/streamed JSON still yields the message, which appears first in the schema.
  if (/"assistantMessage"\s*:/.test(text)) {
    const field = text.match(/"assistantMessage"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (field) {
      let value = field[1];
      try {
        value = JSON.parse(`"${field[1]}"`) as string;
      } catch {
        // keep the raw captured value if it is not a parseable JSON string fragment
      }
      if (value.trim()) {
        return value.trim();
      }
    }
  }

  // 3) Plain prose, optionally wrapped in a lone code fence — strip the fence, keep the text.
  const unfenced = text
    .replace(/^```[a-z]*\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
  return unfenced || text;
}
