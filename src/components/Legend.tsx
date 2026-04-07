type Props = {
  collapsed: boolean
  onToggleCollapse: () => void
  options: { id: string; text: string; envIndices?: number[] }[]
  envColors: string[]
  envLabels: string[]
  selectedFilterIds: Set<string>
  onSelectedFilterIdsChange: (next: Set<string>) => void
  totalKeyCount: number
  filteredKeyCount: number
}

export function Legend({
  collapsed,
  onToggleCollapse,
  options,
  envColors,
  envLabels,
  selectedFilterIds,
  onSelectedFilterIdsChange,
  totalKeyCount,
  filteredKeyCount,
}: Props) {
  const filterActive = selectedFilterIds.size > 0

  const toggleFilter = (id: string) => {
    const next = new Set(selectedFilterIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectedFilterIdsChange(next)
  }

  const clearFilters = () => onSelectedFilterIdsChange(new Set())

  return (
    <div className="rounded-xl border border-zinc-200 bg-white/80 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/80">
      <button
        type="button"
        onClick={onToggleCollapse}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-zinc-800 dark:text-zinc-100"
      >
        <span>Legend</span>
        <span className="text-zinc-500">{collapsed ? 'Show' : 'Hide'}</span>
      </button>
      {!collapsed && (
        <div className="space-y-3 border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <ul className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            <li>
              <strong className="text-zinc-900 dark:text-white">Black:</strong> All values equal
            </li>
            {envColors.map((color, index) => (
              <li key={`legend-env-${index}`} className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full ring-1 ring-black/10 dark:ring-white/10"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                <span>
                  Value unique to {envLabels[index] ?? `Env ${index + 1}`}
                </span>
              </li>
            ))}
            <li>
              <strong className="text-zinc-900 dark:text-white">Blended:</strong> Value shared between a subset of envs
            </li>
            <li>
              <strong className="text-zinc-700 dark:text-zinc-300">Gray:</strong> No value set on this env
            </li>
          </ul>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Filter comparison rows</h2>
              {filterActive && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs font-medium text-violet-700 underline decoration-dotted hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-200"
                >
                  Clear filters
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Narrow the matrix to keys that match presence or value patterns—same value on specific envs, unique to one
              env, all different, missing on an env, and more. Tick one or more filters; a row shows if it matches{' '}
              <strong>any</strong> selection. No ticks = show every key ({totalKeyCount}).
            </p>
            {filterActive && (
              <p className="mt-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Showing {filteredKeyCount} of {totalKeyCount} keys
              </p>
            )}
            <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
              {options.map(({ id, text, envIndices }) => (
                <li key={id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/80">
                    <input
                      type="checkbox"
                      className="mt-0.5 shrink-0"
                      checked={selectedFilterIds.has(id)}
                      onChange={() => toggleFilter(id)}
                    />
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span>{text}</span>
                      {envIndices?.map((envIndex) => (
                        <span
                          key={`${id}-${envIndex}`}
                          className="inline-block h-3 w-3 rounded-full ring-1 ring-black/10 dark:ring-white/10"
                          style={{ backgroundColor: envColors[envIndex] ?? '#94a3b8' }}
                          aria-label={`Env ${envIndex + 1}`}
                          title={`Env ${envIndex + 1}`}
                        />
                      ))}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
