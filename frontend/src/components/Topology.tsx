import type { ServicePaneData } from "../types";

interface Props {
  panes: ServicePaneData[];
}

export function Topology({ panes }: Props) {
  if (panes.length === 0) return null;

  return (
    <div className="topology">
      {panes.map((p, i) => (
        <div key={p.service} className="topology-node-wrap">
          {i > 0 && <span className="topology-arrow">→</span>}
          <div
            className={"topology-node" + (p.active ? " active" : p.reached ? " reached" : " pending")}
          >
            {p.service}
          </div>
        </div>
      ))}
    </div>
  );
}
