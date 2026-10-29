/** @jsxImportSource solid-js */
import { createSignal, For, Show } from "solid-js"
import type { AtomValueNode } from "../index"

/**
 * A bounded, read-only tree over a value captured at sample time.
 *
 * The tree holds no live object references, so expanding it never reads the
 * application's value, runs accessors, or renders data that changed after the
 * snapshot was taken.
 */
export function ValueTree(props: { readonly value: AtomValueNode }) {
  return <ValueBranch node={props.value} />
}

function ValueBranch(props: { readonly node: AtomValueNode }) {
  const [open, setOpen] = createSignal(false)
  const expandable = () =>
    props.node.kind !== "leaf" &&
    (props.node.entries.length > 0 || props.node.omitted > 0)
  const total = () => props.node.entries.length + props.node.omitted

  return (
    <Show when={expandable()} fallback={<span>{props.node.preview}</span>}>
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          {props.node.kind === "array"
            ? `Array (${total()} entries)`
            : `Object (${total()} keys)`}
        </summary>
        <Show when={open()}>
          <ul
            style={{ "list-style": "none", margin: 0, "padding-left": "16px" }}
          >
            <For each={props.node.entries}>
              {(entry) => (
                <li>
                  <span>{entry.key}: </span>
                  <ValueBranch node={entry.value} />
                </li>
              )}
            </For>
            <Show when={props.node.omitted > 0}>
              <li>… {props.node.omitted} more entries omitted</li>
            </Show>
          </ul>
        </Show>
      </details>
    </Show>
  )
}
