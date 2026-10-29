import { useState } from "react"
import type { AtomValueNode } from "./index"

/**
 * A bounded, read-only tree over a value captured at sample time.
 *
 * The tree holds no live object references, so expanding it never reads the
 * application's value, runs accessors, or renders data that changed after the
 * snapshot was taken.
 */
export function ValueTree({ value }: { readonly value: AtomValueNode }) {
  return <ValueBranch node={value} />
}

function ValueBranch({ node }: { readonly node: AtomValueNode }) {
  const [open, setOpen] = useState(false)

  if (
    node.kind === "leaf" ||
    (node.entries.length === 0 && node.omitted === 0)
  ) {
    return <span>{node.preview}</span>
  }

  const total = node.entries.length + node.omitted
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {node.kind === "array"
          ? `Array (${total} entries)`
          : `Object (${total} keys)`}
      </summary>
      {open && (
        <ul style={{ listStyle: "none", margin: 0, paddingLeft: 16 }}>
          {node.entries.map((entry) => (
            <li key={entry.key}>
              <span>{entry.key}: </span>
              <ValueBranch node={entry.value} />
            </li>
          ))}
          {node.omitted > 0 && <li>… {node.omitted} more entries omitted</li>}
        </ul>
      )}
    </details>
  )
}
