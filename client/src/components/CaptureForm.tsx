import { useRef, useState, type FormEvent } from "react";
import * as api from "../api";
import { parseCaptureLines } from "../capture";
import type { Item } from "../domain";

// Rapid entry for clearing out a dump room: type a name, Enter, repeat.
// Every capture is created homeless with location Unknown and lifecycle
// INCOMING, so the reports drive the later find-it-a-home triage. Pasting a
// multi-line list captures one item per line.
export function CaptureForm({ onChanged }: { onChanged: () => void }) {
  const [captured, setCaptured] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const capture = async (text: string) => {
    const names = parseCaptureLines(text);
    if (names.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      for (const name of names) {
        const item = await api.createItem({
          name,
          lifecycle: "INCOMING",
          placement: "NEAR_OPEN",
          home: null,
          location: "UNKNOWN",
        });
        setCaptured((prev) => [item, ...prev]);
      }
      if (inputRef.current) inputRef.current.value = "";
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void capture(inputRef.current?.value ?? "");
  };

  const undo = async (item: Item) => {
    try {
      await api.deleteItem(item.id);
      setCaptured((prev) => prev.filter((i) => i.id !== item.id));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inputRef.current?.focus();
    }
  };

  return (
    <div className="capture">
      <p className="modal-copy">
        Name what you see and press Enter — details come later. Paste a list to capture one item per
        line.
      </p>
      <form onSubmit={submit} className="capture-input">
        <input
          ref={inputRef}
          placeholder="e.g. old router"
          autoFocus
          disabled={busy}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (text.includes("\n")) {
              e.preventDefault();
              void capture(text);
            }
          }}
        />
        <button className="primary" disabled={busy}>
          Capture
        </button>
      </form>
      {error && <p className="capture-error">{error}</p>}
      <div className="capture-list">
        {captured.length > 0 && (
          <p className="capture-count">
            {captured.length} captured this session — all Incoming · location Unknown
          </p>
        )}
        {captured.map((item) => (
          <div className="capture-entry" key={item.id}>
            <span>✓ {item.name}</span>
            <button aria-label={`Remove ${item.name}`} onClick={() => void undo(item)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
