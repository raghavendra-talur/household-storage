import { useMemo, useState } from "react";
import * as api from "../api";
import {
  address,
  allowed,
  lifecycles,
  occupancy,
  placementOf,
  pretty,
  type Data,
  type Item,
  type Lifecycle,
} from "../domain";

// The second half of Quick Capture: deal out each homeless item, one card at
// a time — pick a lifecycle, tap a legal home, next. Like the CaptureForm it
// talks to the API directly so the dialog stays open across the whole pile.
export function TriageForm({ data, onChanged }: { data: Data; onChanged: () => void }) {
  // The queue is snapshotted once so cards don't reshuffle mid-session;
  // each card re-resolves its item from live data.
  const [queue] = useState<string[]>(() => data.items.filter((i) => !i.home).map((i) => i.id));
  const [index, setIndex] = useState(0);
  const [putAway, setPutAway] = useState(true);
  const [departArmed, setDepartArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Skip cards whose item vanished or got a home elsewhere (SSE races).
  const remaining = useMemo(
    () => queue.slice(index).filter((id) => data.items.some((i) => i.id === id && !i.home)),
    [queue, index, data],
  );
  const item: Item | undefined = data.items.find((i) => i.id === remaining[0]);

  const advance = () => {
    setDepartArmed(false);
    setError(null);
    setIndex(queue.indexOf(remaining[0]) + 1);
  };

  if (!item) {
    return (
      <div className="triage">
        <div className="triage-done">
          <span>✓</span>
          <p>
            <strong>Triage complete.</strong> Every item has a home to aim for.
          </p>
        </div>
      </div>
    );
  }

  const lifecycle = item.lifecycle;
  const candidates = data.places.filter(
    (p) =>
      allowed[lifecycle].includes(placementOf(data, p.id)) &&
      occupancy(data, p.id) < p.capacity,
  );
  const done = queue.length - remaining.length;

  const setLifecycle = async (next: Lifecycle) => {
    try {
      setError(null);
      await api.updateItem(item.id, { lifecycle: next });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const assign = async (placeId: string) => {
    try {
      setError(null);
      await api.updateItem(item.id, {
        home: placeId,
        placement: placementOf(data, placeId),
        ...(putAway ? { location: placeId } : {}),
      });
      onChanged();
      advance();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const depart = async () => {
    if (!departArmed) {
      setDepartArmed(true);
      return;
    }
    try {
      await api.deleteItem(item.id);
      onChanged();
      advance();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="triage">
      <p className="modal-copy">
        {done + 1} of {queue.length} · give each homeless thing a home to aim for.
      </p>
      <div className="triage-card">
        <h3>{item.name}</h3>
        {item.notes && <p className="quiet">{item.notes}</p>}
        <div className="triage-chips">
          {lifecycles.map((l) => (
            <button
              key={l}
              className={l === lifecycle ? "chip active" : "chip"}
              onClick={() => void setLifecycle(l)}
            >
              {pretty(l)}
            </button>
          ))}
        </div>
        <div className="triage-places">
          {candidates.length === 0 && (
            <p className="quiet">
              No {pretty(lifecycle)}-legal place has free capacity. Pick another lifecycle, or skip
              and make room first.
            </p>
          )}
          {candidates.map((p) => (
            <button key={p.id} onClick={() => void assign(p.id)}>
              <span className={`cue-dot ${p.cue.toLowerCase()}`} />
              <div>
                <b>{address(data, p.id)}</b>
                <small>
                  {pretty(placementOf(data, p.id))} · {occupancy(data, p.id)} of {p.capacity} occupied
                </small>
              </div>
            </button>
          ))}
        </div>
        <label className="triage-putaway">
          <input type="checkbox" checked={putAway} onChange={(e) => setPutAway(e.target.checked)} />
          I’m putting it there right now
        </label>
        {error && <p className="capture-error">{error}</p>}
        <div className="triage-actions">
          <button className="secondary" onClick={advance}>
            Skip
          </button>
          <button className={departArmed ? "danger-solid" : "danger-link"} onClick={() => void depart()}>
            {departArmed ? "Confirm — it left the house" : "It left the house…"}
          </button>
        </div>
      </div>
    </div>
  );
}
