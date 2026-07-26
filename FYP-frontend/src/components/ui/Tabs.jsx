import React, {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '../../lib/cn';

const TabsContext = createContext(null);

function useTabs(component) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`<${component}> must be rendered inside <Tabs>`);
  return ctx;
}

/**
 * Tab set implementing the WAI-ARIA Tabs pattern.
 *
 * Keyboard (this is the part hand-rolled tab strips always miss):
 *   ArrowRight/ArrowLeft (or Up/Down when vertical) move between tabs,
 *   Home/End jump to first/last, and movement WRAPS. Only the active tab is in
 *   the tab sequence (roving tabindex), so Tab moves *out* of the strip into
 *   the panel rather than walking through every tab.
 *
 * Activation is automatic (focus selects) which is the recommended behaviour
 * when panels are cheap to render. Pass `activationMode="manual"` when a panel
 * triggers a network request, so arrowing past it does not fire fetches.
 *
 * @param {object} props
 * @param {string} [props.value] Controlled active tab value.
 * @param {string} [props.defaultValue] Uncontrolled initial tab.
 * @param {(value: string) => void} [props.onValueChange]
 * @param {'line'|'pill'|'enclosed'} [props.variant='line']
 * @param {'horizontal'|'vertical'} [props.orientation='horizontal']
 * @param {'automatic'|'manual'} [props.activationMode='automatic']
 * @param {boolean} [props.lazy=false] Only mount a panel once it is first shown.
 * @param {string} [props.className]
 * @param {React.ReactNode} props.children
 */
export function Tabs({
  value,
  defaultValue,
  onValueChange,
  variant = 'line',
  orientation = 'horizontal',
  activationMode = 'automatic',
  lazy = false,
  className,
  children,
  ...rest
}) {
  const uid = useId();
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const active = controlled ? value : internal;

  // Which panels have ever been shown, for `lazy`. Held in STATE (not a ref
  // mutated during render): a ref would not re-render the newly-revealed panel,
  // and mutating one mid-render is unsafe under concurrent rendering.
  // Adjusted during render (React's documented "state derived from a prop
  // change" pattern) rather than in an effect, so a lazily-mounted panel is
  // present in the SAME commit the user switches to it — an effect would paint
  // one empty frame first. The membership check makes it settle immediately.
  const [seen, setSeen] = useState(() => (active === undefined ? new Set() : new Set([active])));
  if (active !== undefined && !seen.has(active)) {
    setSeen((prev) => (prev.has(active) ? prev : new Set(prev).add(active)));
  }

  const select = useCallback(
    (next) => {
      if (!controlled) setInternal(next);
      onValueChange?.(next);
    },
    [controlled, onValueChange],
  );

  const ctx = useMemo(
    () => ({
      uid,
      active,
      select,
      variant,
      orientation,
      activationMode,
      lazy,
      seen,
    }),
    [uid, active, select, variant, orientation, activationMode, lazy, seen],
  );

  return (
    <TabsContext.Provider value={ctx}>
      <div
        data-orientation={orientation}
        className={cn(orientation === 'vertical' && 'flex gap-6', className)}
        {...rest}
      >
        {children}
      </div>
    </TabsContext.Provider>
  );
}

const LIST_VARIANTS = {
  line: 'gap-1 border-b border-subtle',
  pill: 'gap-1 rounded-field bg-surface-sunken p-1',
  enclosed: 'gap-1 border-b border-subtle',
};

/**
 * The `role="tablist"` container. Horizontal lists scroll rather than wrap, so
 * a doctor dashboard with eight tabs does not turn into a two-row strip on a
 * phone.
 *
 * @param {object} props
 * @param {React.ReactNode} [props.actions] Right-aligned slot (filters, buttons).
 * @param {boolean} [props.fullWidth=false] Stretch triggers to fill the row.
 * @param {string} [props['aria-label']] Name the tab set when no visible heading precedes it.
 * @param {string} [props.className]
 */
export function TabList({ actions, fullWidth = false, className, children, ...rest }) {
  const { orientation, variant } = useTabs('TabList');
  const isVertical = orientation === 'vertical';

  return (
    <div
      className={cn(
        isVertical ? 'shrink-0' : 'flex items-end justify-between gap-4',
        !isVertical && 'ui-scrollbar overflow-x-auto',
      )}
    >
      <div
        role="tablist"
        aria-orientation={orientation}
        className={cn(
          'flex',
          isVertical ? 'min-w-[10rem] flex-col border-b-0 border-r border-subtle pr-1' : 'items-center',
          LIST_VARIANTS[variant] ?? LIST_VARIANTS.line,
          fullWidth && !isVertical && 'w-full [&>*]:flex-1',
          className,
        )}
        {...rest}
      >
        {children}
      </div>
      {actions && !isVertical && <div className="flex shrink-0 items-center gap-2 pb-2">{actions}</div>}
    </div>
  );
}

const TRIGGER_VARIANTS = {
  line:
    'relative px-4 py-2.5 -mb-px border-b-2 border-transparent text-muted ' +
    'hover:text-default hover:border-strong ' +
    'aria-selected:border-primary-900 aria-selected:text-primary-900 ' +
    'dark:aria-selected:border-primary-600 dark:aria-selected:text-primary-700',
  pill:
    'rounded-control px-4 py-2 text-muted hover:text-default ' +
    'aria-selected:bg-surface aria-selected:text-default aria-selected:shadow-soft',
  enclosed:
    'relative px-4 py-2.5 -mb-px rounded-t-field border border-transparent text-muted ' +
    'hover:text-default ' +
    'aria-selected:border-subtle aria-selected:border-b-surface aria-selected:bg-surface aria-selected:text-default',
};

/**
 * One tab button.
 *
 * @param {object} props
 * @param {string} props.value Must match a `<TabPanel value>`.
 * @param {React.ReactNode} [props.icon]
 * @param {React.ReactNode} [props.badge] Trailing count/status slot.
 * @param {boolean} [props.disabled]
 * @param {string} [props.className]
 * @param {React.ReactNode} props.children
 */
export function TabTrigger({ value, icon, badge, disabled = false, className, children, ...rest }) {
  const { uid, active, select, variant, orientation, activationMode } = useTabs('TabTrigger');
  const ref = useRef(null);
  const selected = active === value;

  const handleKeyDown = (event) => {
    const list = ref.current?.closest('[role="tablist"]');
    if (!list) return;
    const tabs = Array.from(list.querySelectorAll('[role="tab"]:not([disabled])'));
    const index = tabs.indexOf(ref.current);
    if (index === -1) return;

    const isVertical = orientation === 'vertical';
    const next = isVertical ? 'ArrowDown' : 'ArrowRight';
    const prev = isVertical ? 'ArrowUp' : 'ArrowLeft';

    let target = null;
    if (event.key === next) target = tabs[(index + 1) % tabs.length];
    else if (event.key === prev) target = tabs[(index - 1 + tabs.length) % tabs.length];
    else if (event.key === 'Home') target = tabs[0];
    else if (event.key === 'End') target = tabs[tabs.length - 1];
    else if ((event.key === 'Enter' || event.key === ' ') && activationMode === 'manual') {
      event.preventDefault();
      select(value);
      return;
    } else return;

    event.preventDefault();
    target?.focus();
    if (activationMode === 'automatic') target?.click();
  };

  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={`ui-tab-${uid}-${value}`}
      aria-selected={selected}
      aria-controls={`ui-tabpanel-${uid}-${value}`}
      // Roving tabindex: only the selected tab is reachable with Tab.
      tabIndex={selected ? 0 : -1}
      disabled={disabled || undefined}
      onClick={() => select(value)}
      onKeyDown={handleKeyDown}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap',
        'font-body text-label-lg transition-[color,background-color,border-color] duration-150',
        'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
        'focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-50',
        TRIGGER_VARIANTS[variant] ?? TRIGGER_VARIANTS.line,
        className,
      )}
      {...rest}
    >
      {icon && (
        <span aria-hidden="true" className="inline-flex shrink-0 items-center [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </span>
      )}
      {children}
      {badge != null && <span className="ml-0.5 shrink-0">{badge}</span>}
    </button>
  );
}

/**
 * Content region for a tab.
 *
 * The panel is focusable (`tabIndex={0}`) so that after Tabbing out of the tab
 * strip, keyboard users land on the content they just selected. Hidden panels
 * stay mounted by default to preserve scroll position and form state; opt into
 * `lazy` on `<Tabs>` when a panel is expensive.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {boolean} [props.keepMounted=true] Render hidden panels in the DOM.
 * @param {string} [props.className]
 * @param {React.ReactNode} props.children
 */
export function TabPanel({ value, keepMounted = true, className, children, ...rest }) {
  const { uid, active, lazy, seen } = useTabs('TabPanel');
  const selected = active === value;
  const wasSeen = seen.has(value);

  if (!selected && (!keepMounted || (lazy && !wasSeen))) return null;

  return (
    <div
      role="tabpanel"
      id={`ui-tabpanel-${uid}-${value}`}
      aria-labelledby={`ui-tab-${uid}-${value}`}
      hidden={!selected}
      tabIndex={selected ? 0 : -1}
      className={cn(
        'min-w-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-focus',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        selected && 'pt-5 animate-ui-fade-in',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export default Tabs;
