// Abandoned basket tracker - editor-safe half. The real work happens in
// AbandonedCartTracker.rsc.tsx, which reads this module's settings and the
// site's cookie banner and so cannot be imported from the editor bundle.
//
// No props of its own. Whether baskets are watched at all, how long a basket
// waits before it counts as abandoned and whether reminders go out are all
// site-wide decisions living in the module's settings, not in one layout. This
// block is a placement marker: it says "watch baskets on every page using this
// layout", which is why installing the module drops one into the header layout
// for you.

function EditorPreview() {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
      padding: '0.5rem 0.9rem', borderRadius: '0.5rem', margin: '0.5rem',
      background: 'var(--color-surface-subtle, #f4f1ea)',
      border: '1px dashed var(--color-border, #e5e0d8)',
      color: 'var(--color-text-secondary, #6b6355)',
      fontSize: '0.8125rem', fontWeight: 600,
    }}>
      🛒 Abandoned basket tracker (invisible on the real site)
    </div>
  )
}

export const abandonedCartTrackerBlockComponent = {
  label: 'Abandoned basket tracker',
  fields: {},
  defaultProps: {},
  render: EditorPreview,
}
