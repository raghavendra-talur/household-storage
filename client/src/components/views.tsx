import { useState } from "react";
import {
  address,
  designIssues,
  greeting,
  misplacedItems,
  occupancy,
  overloadedPlaces,
  placements,
  pretty,
  unknownItems,
  type Cue,
  type Data,
  type Item,
  type Place,
  type Placement,
  type Room,
} from "../domain";
import { placeTableRows, type PlaceSortKey } from "../placeTable";
import { Empty, PanelHead, Stat } from "./bits";

export type Tab = "items" | "places" | "reports";

export interface ItemActions {
  onMove: (item: Item) => void;
  onEdit: (item: Item) => void;
}

export function Reports({ data, actions }: { data: Data; actions: ItemActions }) {
  const misplaced = misplacedItems(data);
  const unknown = unknownItems(data);
  const overloaded = overloadedPlaces(data);
  const issues = designIssues(data);
  const errors = issues.filter((i) => i.severity === "error").length;
  const resetCount = misplaced.length + unknown.length;
  const healthy = data.places.length - overloaded.length;
  const byFullness = [...data.places].sort(
    (a, b) => occupancy(data, b.id) / b.capacity - occupancy(data, a.id) / a.capacity,
  );

  return (
    <div className="content">
      <section className="hero-card">
        <div>
          <p className="eyebrow">TODAY’S RESET</p>
          <h2>
            {resetCount ? `${resetCount} things need a little attention.` : "Everything is in its place."}
          </h2>
          <p>A clear home keeps the house easy to read. Start with what’s out of place.</p>
        </div>
        <div className="hero-orbit">
          <strong>{resetCount}</strong>
          <span>to reset</span>
        </div>
      </section>

      <div className="stat-grid">
        <Stat value={data.items.length} label="Things tracked" note={`${data.rooms.length} rooms`} />
        <Stat
          value={data.items.filter((i) => i.location === i.home).length}
          label="At home"
          note="right where they belong"
          good
        />
        <Stat
          value={healthy}
          label="Places within capacity"
          note={`of ${data.places.length} total`}
          good={overloaded.length === 0}
        />
        <Stat value={errors} label="Design checks" note="home & lifecycle rules" good={errors === 0} />
      </div>

      <div className="two-col">
        <section className="panel">
          <PanelHead title="Reset list" subtitle="Return, locate, or re-home" />
          {resetCount === 0 ? (
            <Empty text="The reset list is clear." />
          ) : (
            <div className="rows">
              {[...unknown, ...misplaced].map((i) => (
                <div className="item-row" key={i.id}>
                  <span className={`object-icon ${i.location === "UNKNOWN" ? "warn" : ""}`}>◇</span>
                  <div>
                    <strong>{i.name}</strong>
                    <small>
                      {i.location === "UNKNOWN" ? "Location unknown" : `Now in ${address(data, i.location)}`}
                    </small>
                  </div>
                  <span className="home-label">Home: {address(data, i.home)}</span>
                  <button onClick={() => actions.onMove(i)}>Move</button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <PanelHead title="Capacity pulse" subtitle="Fullest places first" />
          <div className="capacity-list">
            {byFullness.map((p) => {
              const count = occupancy(data, p.id);
              const pct = Math.min(100, (count / p.capacity) * 100);
              return (
                <div key={p.id}>
                  <div className="capacity-label">
                    <span>
                      <strong>{p.name}</strong>
                      <small>{address(data, p.id).split(" · ")[0]}</small>
                    </span>
                    <b className={count > p.capacity ? "bad" : ""}>
                      {count} / {p.capacity}
                    </b>
                  </div>
                  <div className="bar">
                    <i style={{ width: `${pct}%` }} className={count > p.capacity ? "bad" : ""} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="panel">
        <PanelHead title="Design checks" subtitle="Exact home match and lifecycle legality" />
        {issues.length ? (
          issues.map((x, n) => (
            <div className="issue" key={n}>
              <div>
                <b>{x.item.name}</b>
                <small>{x.text}</small>
              </div>
              <span className={x.severity}>
                <button className="issue-fix" onClick={() => actions.onEdit(x.item)}>
                  {x.severity}
                </button>
              </span>
            </div>
          ))
        ) : (
          <Empty text="All homes pass their design checks." />
        )}
      </section>

      <section className="principle">
        <span>✦</span>
        <p>
          <strong>A home is an exact match.</strong> More visible isn’t always better—scarce cue space
          stays calm when only the right things use it.
        </p>
      </section>
    </div>
  );
}

const PLACE_COLUMNS: { key: PlaceSortKey; label: string }[] = [
  { key: "place", label: "Place" },
  { key: "room", label: "Room" },
  { key: "cue", label: "Visibility" },
  { key: "placement", label: "Placement" },
  { key: "occupancy", label: "Occupancy" },
];

export function Places({
  data,
  query,
  onEditRoom,
  onEditPlace,
  onAddPlace,
}: {
  data: Data;
  query: string;
  onEditRoom: (room: Room) => void;
  onEditPlace: (place: Place) => void;
  onAddPlace: (roomId?: string) => void;
}) {
  const [sort, setSort] = useState<PlaceSortKey>("place");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [room, setRoom] = useState("");
  const [cue, setCue] = useState<Cue | "">("");
  const [placement, setPlacement] = useState<Placement | "">("");

  const rows = placeTableRows(data, { sort, dir, room, cue, placement, query });
  const sortBy = (key: PlaceSortKey) => {
    if (key === sort) {
      setDir(dir === "asc" ? "desc" : "asc");
    } else {
      setSort(key);
      setDir("asc");
    }
  };

  return (
    <div className="content">
      <div className="section-intro">
        <div>
          <h2>The shape of your storage</h2>
          <p>
            {rows.length} of {data.places.length} places. Click a place to edit it, a room name to
            edit the room.
          </p>
        </div>
        <div className="table-filters">
          <select value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="">All rooms</option>
            {data.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <select value={cue} onChange={(e) => setCue(e.target.value as Cue | "")}>
            <option value="">All visibility</option>
            <option value="CUE">Cue</option>
            <option value="OPEN">Open</option>
            <option value="HIDDEN">Hidden</option>
          </select>
          <select value={placement} onChange={(e) => setPlacement(e.target.value as Placement | "")}>
            <option value="">All placements</option>
            {placements.map((p) => (
              <option key={p} value={p}>
                {pretty(p)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <section className="panel table-panel">
        <div className="place-table table-head">
          {PLACE_COLUMNS.map((col) => (
            <button key={col.key} className="sort-header" onClick={() => sortBy(col.key)}>
              {col.label}
              {sort === col.key && <i>{dir === "asc" ? "▲" : "▼"}</i>}
            </button>
          ))}
        </div>
        {rows.map(({ place, roomName, placement: derived, count, over }) => (
          <div
            className="place-table place-table-row"
            key={place.id}
            role="button"
            tabIndex={0}
            onClick={() => onEditPlace(place)}
            onKeyDown={(e) => e.key === "Enter" && onEditPlace(place)}
          >
            <span>
              <span className={`cue-dot ${place.cue.toLowerCase()}`} />
              <b>{place.name}</b>
              {place.notes && <small>{place.notes}</small>}
            </span>
            <span>
              <button
                className="room-link"
                onClick={(e) => {
                  e.stopPropagation();
                  const r = data.rooms.find((x) => x.id === place.roomId);
                  if (r) onEditRoom(r);
                }}
              >
                {roomName}
              </button>
            </span>
            <span>{pretty(place.cue)}</span>
            <span>{pretty(derived)}</span>
            <span className={over ? "over-capacity" : ""}>
              {count} / {place.capacity}
            </span>
          </div>
        ))}
        {rows.length === 0 && <Empty text="No places match these filters." />}
        <button className="add-place-row in-table" onClick={() => onAddPlace(room || undefined)}>
          ＋ Add place{room && ` in ${data.rooms.find((r) => r.id === room)?.name}`}
        </button>
      </section>
    </div>
  );
}

export function Items({
  data,
  query,
  actions,
}: {
  data: Data;
  query: string;
  actions: ItemActions;
}) {
  const q = query.toLowerCase();
  const items = data.items.filter(
    (i) => i.name.toLowerCase().includes(q) || (i.notes ?? "").toLowerCase().includes(q),
  );
  return (
    <div className="content">
      <div className="section-intro">
        <div>
          <h2>Every object, individually</h2>
          <p>{items.length} physical things, each with one clear home.</p>
        </div>
      </div>
      <section className="panel table-panel">
        <div className="item-table table-head">
          <span>Thing</span>
          <span>Lifecycle</span>
          <span>Required placement</span>
          <span>Home</span>
          <span>Right now</span>
          <span />
        </div>
        {items.map((i) => (
          <div
            className="item-table item-table-row"
            key={i.id}
            role="button"
            tabIndex={0}
            onClick={() => actions.onEdit(i)}
            onKeyDown={(e) => e.key === "Enter" && actions.onEdit(i)}
          >
            <span>
              <b>{i.name}</b>
              <small>{i.notes || pretty(i.placement)}</small>
            </span>
            <span>
              <i className="tag neutral">{pretty(i.lifecycle)}</i>
            </span>
            <span>{pretty(i.placement)}</span>
            <span>{address(data, i.home)}</span>
            <span className={i.location === "UNKNOWN" ? "bad-text" : ""}>
              {i.location === "IN_USE" ? "In use" : i.location === "UNKNOWN" ? "Unknown" : address(data, i.location)}
            </span>
            <button
              className="move-button"
              onClick={(e) => {
                e.stopPropagation();
                actions.onMove(i);
              }}
            >
              Move
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

export function pageTitle(tab: Tab, hour: number): string {
  if (tab === "items") return greeting(hour); // the landing tab keeps the warm hello
  if (tab === "places") return "Rooms & places";
  return pretty(tab);
}
