/**
 * Purpose: Socket position watcher that keeps DOM sockets aligned after layout changes.
 */
import { DOMSocketPosition } from 'rete-render-utils';

export class LiveDOMSocketPosition extends DOMSocketPosition<any, any> {
  private ro: ResizeObserver | null = null;
  private observed = new WeakSet<HTMLElement>();
  private elementToNodeId = new WeakMap<HTMLElement, string>();
  private pending = new Set<string>();
  private raf = 0;

  constructor(private onQueue: () => void = () => undefined) {
    super();
  }

  override attach(scope: any) {
    super.attach(scope);
    if (typeof ResizeObserver === 'undefined') return;
    if (this.ro) return;

    this.ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const nodeId = this.elementToNodeId.get(entry.target as HTMLElement);
        if (nodeId) this.queue(nodeId);
      }
    });

    const area = (this as any).area;
    if (!area) return;

    const observeAll = () => {
      if (!this.ro) return;
      for (const [id, view] of area.nodeViews?.entries?.() ?? []) {
        const el = view?.element as HTMLElement | undefined;
        if (!el) continue;
        if (this.observed.has(el)) continue;
        this.observed.add(el);
        this.elementToNodeId.set(el, String(id));
        try {
          this.ro.observe(el);
        } catch {
          // ignore
        }
      }
    };

    observeAll();
    area.addPipe((ctx: any) => {
      if (ctx?.type === 'rendered' && ctx.data?.type === 'node') {
        observeAll();
      }
      return ctx;
    });
  }

  destroy() {
    if (this.raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.pending.clear();
    this.ro?.disconnect();
    this.ro = null;
  }

  private queue(nodeId: string) {
    this.pending.add(nodeId);
    this.onQueue();
    if (typeof requestAnimationFrame === 'undefined') return;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      void this.flush();
    });
  }

  private async flush() {
    const area = (this as any).area;
    if (!area) return;
    const ids = Array.from(this.pending);
    this.pending.clear();

    for (const nodeId of ids) {
      const items = (this as any).sockets
        ?.snapshot?.()
        ?.filter((item: any) => String(item.nodeId) === String(nodeId));
      if (!items || items.length === 0) continue;

      await Promise.all(
        items.map(async (item: any) => {
          const position = await (this as any).calculatePosition(
            String(nodeId),
            item.side,
            String(item.key),
            item.element
          );
          if (position) item.position = position;
        })
      );

      (this as any).emitter?.emit?.({ nodeId: String(nodeId) });
    }
  }
}
