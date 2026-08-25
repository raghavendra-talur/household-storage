import { useState, type FormEvent } from "react";
import {
  address,
  lifecycles,
  occupancy,
  placements,
  placementOf,
  pretty,
  type Cue,
  type Data,
  type Item,
  type Lifecycle,
  type Location,
  type Place,
  type Placement,
  type Room,
  type Travel,
} from "../domain";

function formValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? "");
}

// Two-step delete used inside edit dialogs: the first click arms the zone,
// the second confirms. Replaces window.confirm everywhere.
export function DeleteZone({
  label,
  warning,
  onDelete,
}: {
  label: string;
  warning: string;
  onDelete: () => void;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <div className="delete-zone">
        <button type="button" className="danger-link" onClick={() => setArmed(true)}>
          Delete {label}…
        </button>
      </div>
    );
  }
  return (
    <div className="delete-zone armed">
      <p>{warning}</p>
      <div>
        <button type="button" className="danger-solid" onClick={onDelete}>
          Delete {label}
        </button>
        <button type="button" className="secondary" onClick={() => setArmed(false)}>
          Keep it
        </button>
      </div>
    </div>
  );
}

export function RoomForm({
  room,
  onSave,
  onDelete,
}: {
  room?: Room;
  onSave: (draft: Omit<Room, "id">) => void;
  onDelete?: () => void;
}) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSave({
      name: formValue(e.currentTarget, "name"),
      travel: formValue(e.currentTarget, "travel") as Travel,
      notes: formValue(e.currentTarget, "notes"),
    });
  };
  return (
    <form onSubmit={submit} className="form">
      <label>
        Room name
        <input required name="name" placeholder="e.g. Mudroom" defaultValue={room?.name} />
      </label>
      <fieldset>
        <legend>How far does it feel?</legend>
        <label className="choice">
          <input type="radio" name="travel" value="NEAR" defaultChecked={room ? room.travel === "NEAR" : true} />
          <span>
            <b>Near</b>
            <small>Reaching it is not a trip</small>
          </span>
        </label>
        <label className="choice">
          <input type="radio" name="travel" value="FAR" defaultChecked={room?.travel === "FAR"} />
          <span>
            <b>Far</b>
            <small>Reaching it is a trip</small>
          </span>
        </label>
      </fieldset>
      <label>
        Notes
        <textarea name="notes" placeholder="Boundary cases, access details…" defaultValue={room?.notes} />
      </label>
      <button className="primary submit">{room ? "Save room" : "Add room"}</button>
      {room && onDelete && (
        <DeleteZone
          label={`room "${room.name}"`}
          warning="A room can only be deleted once it has no places left."
          onDelete={onDelete}
        />
      )}
    </form>
  );
}

export function PlaceForm({
  data,
  place,
  defaultRoomId,
  onRoom,
  onSave,
  onDelete,
}: {
  data: Data;
  place?: Place;
  defaultRoomId?: string;
  onRoom: () => void;
  onSave: (draft: Omit<Place, "id">) => void;
  onDelete?: () => void;
}) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSave({
      roomId: formValue(e.currentTarget, "room"),
      name: formValue(e.currentTarget, "name"),
      cue: formValue(e.currentTarget, "cue") as Cue,
      capacity: Number(formValue(e.currentTarget, "capacity")),
      notes: formValue(e.currentTarget, "notes"),
    });
  };
  return (
    <form onSubmit={submit} className="form">
      <label>
        Room
        <select name="room" required defaultValue={place?.roomId ?? defaultRoomId}>
          {data.rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · {pretty(r.travel)}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="text-button" onClick={onRoom}>
        Need a new room?
      </button>
      <label>
        Place name
        <input required name="name" placeholder="e.g. Hall closet top shelf" defaultValue={place?.name} />
      </label>
      <label>
        Visibility
        <select name="cue" defaultValue={place?.cue ?? "HIDDEN"}>
          <option value="CUE">Cue — sparse and prominent</option>
          <option value="OPEN">Open — visible and scannable</option>
          <option value="HIDDEN">Hidden — behind a door, lid, or drawer</option>
        </select>
      </label>
      <label>
        Capacity
        <input required name="capacity" type="number" min="1" defaultValue={place?.capacity ?? 5} />
      </label>
      <label>
        Notes
        <textarea name="notes" placeholder="Furniture grouping or access friction…" defaultValue={place?.notes} />
      </label>
      <button className="primary submit">{place ? "Save place" : "Add place"}</button>
      {place && onDelete && (
        <DeleteZone
          label={`place "${place.name}"`}
          warning="Items homed here lose their home; items located here become Unknown."
          onDelete={onDelete}
        />
      )}
    </form>
  );
}

export function ItemForm({
  data,
  item,
  onSave,
  onDelete,
}: {
  data: Data;
  item?: Item;
  onSave: (draft: Omit<Item, "id" | "location"> & { location?: Location }) => void;
  onDelete?: () => void;
}) {
  const [placement, setPlacement] = useState<Placement>(item?.placement ?? "NEAR_HIDDEN");
  // Homes must supply the exact placement. Full places are excluded, except
  // the item's current home — editing must never evict the item.
  const candidates = data.places.filter(
    (p) =>
      placementOf(data, p.id) === placement &&
      (occupancy(data, p.id) < p.capacity || p.id === item?.home),
  );
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const home = formValue(e.currentTarget, "home") || null;
    onSave({
      name: formValue(e.currentTarget, "name"),
      lifecycle: formValue(e.currentTarget, "lifecycle") as Lifecycle,
      placement,
      home,
      notes: formValue(e.currentTarget, "notes"),
      // New items start at their home (or untracked); edits keep the location.
      ...(item ? { location: item.location } : home ? { location: home } : {}),
    });
  };
  return (
    <form onSubmit={submit} className="form">
      <label>
        Item name
        <input required name="name" placeholder="Name this physical object" defaultValue={item?.name} />
      </label>
      <div className="form-grid">
        <label>
          Lifecycle
          <select name="lifecycle" defaultValue={item?.lifecycle}>
            {lifecycles.map((v) => (
              <option key={v} value={v}>
                {pretty(v)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Required placement
          <select value={placement} onChange={(e) => setPlacement(e.target.value as Placement)}>
            {placements.map((v) => (
              <option key={v} value={v}>
                {pretty(v)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Matching home
        <select name="home" defaultValue={item?.home ?? ""}>
          <option value="">No home yet</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {address(data, p.id)} · {occupancy(data, p.id)}/{p.capacity}
            </option>
          ))}
        </select>
        <small>
          {candidates.length
            ? "Only exact placement matches with free capacity are shown."
            : "No matching place has capacity. You can save without a home."}
        </small>
      </label>
      <label>
        Notes
        <textarea name="notes" placeholder="Helpful identifying details…" defaultValue={item?.notes} />
      </label>
      <button className="primary submit">{item ? "Save item" : "Add item"}</button>
      {item && onDelete && (
        <DeleteZone
          label={`"${item.name}"`}
          warning="This removes the item from tracking entirely. It cannot be undone."
          onDelete={onDelete}
        />
      )}
    </form>
  );
}

export function MoveForm({
  data,
  item,
  onMove,
}: {
  data: Data;
  item: Item;
  onMove: (location: Location) => void;
}) {
  return (
    <div className="move-list">
      <p className="modal-copy">
        Moving changes where the item is now. Its home stays <strong>{address(data, item.home)}</strong>.
      </p>
      <button onClick={() => onMove("IN_USE")}>
        <span className="object-icon">◌</span>
        <div>
          <b>In use</b>
          <small>In hand or mid-task</small>
        </div>
      </button>
      <button onClick={() => onMove("UNKNOWN")}>
        <span className="object-icon warn">?</span>
        <div>
          <b>Location unknown</b>
          <small>Mark as lost</small>
        </div>
      </button>
      {data.places.map((p) => (
        <button key={p.id} onClick={() => onMove(p.id)}>
          <span className={`cue-dot ${p.cue.toLowerCase()}`} />
          <div>
            <b>{address(data, p.id)}</b>
            <small>
              {occupancy(data, p.id)} of {p.capacity} occupied
            </small>
          </div>
          {item.home === p.id && <em>HOME</em>}
        </button>
      ))}
      {item.lifecycle === "OUTGOING" && <DepartButton onConfirm={() => onMove("__DEPARTED__")} />}
    </div>
  );
}

// Outgoing items complete by leaving the house; two clicks, like DeleteZone.
function DepartButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <button className="depart" onClick={() => (armed ? onConfirm() : setArmed(true))}>
      <span className="object-icon">→</span>
      <div>
        <b>{armed ? "Confirm — it left the house" : "It left the house"}</b>
        <small>
          {armed
            ? "This removes it from tracking for good."
            : "Donated, returned, or given away — remove from tracking"}
        </small>
      </div>
    </button>
  );
}
