import type { ReactNode } from "react";

export function Stat({
  value,
  label,
  note,
  good,
}: {
  value: number;
  label: string;
  note: string;
  good?: boolean;
}) {
  return (
    <div className="stat">
      <span className={good ? "good" : ""}>{good ? "✓" : "·"}</span>
      <strong>{value}</strong>
      <p>{label}</p>
      <small>{note}</small>
    </div>
  );
}

export function PanelHead({
  title,
  subtitle,
  action,
  onClick,
}: {
  title: string;
  subtitle: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="panel-head">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      {action && <button onClick={onClick}>{action} →</button>}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <span>✓</span>
      <p>{text}</p>
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="rows">{children}</div>;
}
