import * as React from 'react';
import { cn } from '../../lib/utils';

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  pillReady: boolean;
}

const TabsContext = React.createContext<TabsContextValue | undefined>(undefined);

interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ className, defaultValue = '', value: controlledValue, onValueChange, children, ...props }, ref) => {
    const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue);
    const value = controlledValue !== undefined ? controlledValue : uncontrolledValue;
    const handleValueChange = React.useCallback(
      (newValue: string) => {
        if (controlledValue === undefined) {
          setUncontrolledValue(newValue);
        }
        onValueChange?.(newValue);
      },
      [controlledValue, onValueChange]
    );

    return (
      <TabsContext.Provider value={{ value, onValueChange: handleValueChange, pillReady: false }}>
        <div ref={ref} className={cn('w-full', className)} {...props}>
          {children}
        </div>
      </TabsContext.Provider>
    );
  }
);
Tabs.displayName = 'Tabs';

const TabsList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, forwardedRef) => {
  const parentContext = React.useContext(TabsContext);
  const localRef = React.useRef<HTMLDivElement | null>(null);
  const pillRef = React.useRef<HTMLSpanElement | null>(null);
  const [pillReady, setPillReady] = React.useState(false);
  const hasPaintedRef = React.useRef(false);

  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      localRef.current = node;
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef) {
        (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [forwardedRef]
  );

  const syncPill = React.useCallback((animate: boolean) => {
    const bar = localRef.current;
    const pill = pillRef.current;
    if (!bar || !pill) return;
    const activeTab = bar.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!activeTab || activeTab.offsetWidth === 0) {
      setPillReady(false);
      return;
    }

    if (!animate) {
      const prev = pill.style.transition;
      pill.style.transition = 'none';
      pill.style.transform = `translate3d(${activeTab.offsetLeft}px, ${activeTab.offsetTop}px, 0)`;
      pill.style.width = `${activeTab.offsetWidth}px`;
      pill.style.height = `${activeTab.offsetHeight}px`;
      void pill.offsetWidth;
      pill.style.transition = prev;
    } else {
      pill.style.transform = `translate3d(${activeTab.offsetLeft}px, ${activeTab.offsetTop}px, 0)`;
      pill.style.width = `${activeTab.offsetWidth}px`;
      pill.style.height = `${activeTab.offsetHeight}px`;
    }
    setPillReady(true);
  }, []);

  React.useLayoutEffect(() => {
    const animate = hasPaintedRef.current;
    syncPill(animate);
    hasPaintedRef.current = true;
  }, [parentContext?.value, syncPill]);

  React.useEffect(() => {
    const bar = localRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => syncPill(false));
    ro.observe(bar);
    return () => ro.disconnect();
  }, [syncPill]);

  const listContext = React.useMemo<TabsContextValue | undefined>(
    () =>
      parentContext
        ? {
            ...parentContext,
            pillReady,
          }
        : undefined,
    [parentContext, pillReady]
  );

  return (
    <TabsContext.Provider value={listContext}>
      <div
        ref={setRefs}
        role="tablist"
        className={cn(
          't-tabs relative inline-flex h-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800/80 p-1 text-slate-500 dark:text-slate-400',
          className
        )}
        {...props}
      >
        <span
          ref={pillRef}
          aria-hidden="true"
          className={cn(
            't-tabs-pill rounded-lg bg-white dark:bg-slate-900 shadow-sm',
            !pillReady && 'opacity-0'
          )}
        />
        {children}
      </div>
    </TabsContext.Provider>
  );
});
TabsList.displayName = 'TabsList';

interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, onClick, ...props }, ref) => {
    const context = React.useContext(TabsContext);
    const isActive = context?.value === value;
    const pillReady = context?.pillReady ?? false;

    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        aria-selected={isActive}
        data-state={isActive ? 'active' : 'inactive'}
        onClick={(e) => {
          context?.onValueChange(value);
          onClick?.(e);
        }}
        className={cn(
          't-tab relative z-[1] inline-flex max-w-full overflow-hidden text-ellipsis items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:pointer-events-none disabled:opacity-50',
          isActive
            ? cn(
                'text-indigo-600 dark:text-indigo-400',
                !pillReady && 'bg-white dark:bg-slate-900 shadow-sm'
              )
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100',
          className
        )}
        {...props}
      />
    );
  }
);
TabsTrigger.displayName = 'TabsTrigger';

interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, children, ...props }, ref) => {
    const context = React.useContext(TabsContext);
    if (context?.value !== value) return null;

    return (
      <div
        ref={ref}
        role="tabpanel"
        className={cn(
          't-skel-reveal mt-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40',
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
TabsContent.displayName = 'TabsContent';

export { Tabs, TabsList, TabsTrigger, TabsContent };
