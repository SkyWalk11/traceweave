interface JsonValueProps {
  value: unknown;
  indent: number;
}

function JsonValue({ value, indent }: JsonValueProps) {
  const pad = "  ".repeat(indent);
  const childPad = "  ".repeat(indent + 1);

  if (value === null || value === undefined) return <span className="json-null">null</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="json-punct">[]</span>;
    return (
      <>
        <span className="json-punct">[</span>
        {value.map((v, i) => (
          <div key={i}>
            {childPad}
            <JsonValue value={v} indent={indent + 1} />
            {i < value.length - 1 && <span className="json-punct">,</span>}
          </div>
        ))}
        {pad}
        <span className="json-punct">]</span>
      </>
    );
  }

  switch (typeof value) {
    case "object": {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) return <span className="json-punct">{"{}"}</span>;
      return (
        <>
          <span className="json-punct">{"{"}</span>
          {entries.map(([k, v], i) => (
            <div key={k}>
              {childPad}
              <span className="json-key">{k}</span>
              <span className="json-punct">: </span>
              <JsonValue value={v} indent={indent + 1} />
              {i < entries.length - 1 && <span className="json-punct">,</span>}
            </div>
          ))}
          {pad}
          <span className="json-punct">{"}"}</span>
        </>
      );
    }
    case "string":
      return <span className="json-string">"{value}"</span>;
    case "number":
      return <span className="json-number">{value}</span>;
    case "boolean":
      return <span className="json-boolean">{String(value)}</span>;
    default:
      return <span className="json-null">{String(value)}</span>;
  }
}

interface JsonViewProps {
  data: unknown;
}

export function JsonView({ data }: JsonViewProps) {
  return (
    <div className="json-view">
      <JsonValue value={data ?? {}} indent={0} />
    </div>
  );
}
