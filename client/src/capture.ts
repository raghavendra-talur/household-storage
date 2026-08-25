// Quick Capture: turn free text (typed or pasted) into item names.
// One name per line; whitespace trimmed, blanks dropped, and duplicates
// within the same paste collapsed case-insensitively to the first spelling.
export function parseCaptureLines(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of text.split("\n")) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}
