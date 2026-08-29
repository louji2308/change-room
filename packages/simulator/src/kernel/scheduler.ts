/**
 * Discrete-event scheduler.
 *
 * Future events are queued and processed in time order by the event loop.
 * This is the backbone of the time-based simulation (Simulator.md §5).
 */
export interface DiscreteEvent {
  time: number;
  type: string;
  componentId?: string;
  data?: Record<string, unknown>;
}

/**
 * A min-heap of events ordered by simulation time.
 * Duplicates at the same time are processed in insertion order.
 */
export class EventScheduler {
  private heap: DiscreteEvent[] = [];
  private seq = 0;
  private order = new Map<DiscreteEvent, number>();

  schedule(time: number, type: string, componentId?: string, data?: Record<string, unknown>): void {
    if (time < 0) {
      throw new Error("Cannot schedule an event in the past");
    }
    const ev: DiscreteEvent = { time, type, componentId, data };
    this.order.set(ev, this.seq++);
    this.heapPush(ev);
  }

  peek(): DiscreteEvent | undefined {
    return this.heap[0];
  }

  pop(): DiscreteEvent | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    this.order.delete(top);
    const last = this.heap.pop()!;
    if (this.heap.length > 0) this.heapSink(0, last);
    return top;
  }

  get size(): number {
    return this.heap.length;
  }

  private heapPush(ev: DiscreteEvent): void {
    this.heap.push(ev);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(ev, this.heap[parent])) {
        this.heap[i] = this.heap[parent];
        i = parent;
      } else {
        break;
      }
    }
    this.heap[i] = ev;
  }

  private heapSink(i: number, ev: DiscreteEvent): void {
    const n = this.heap.length;
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < n && this.less(this.heap[left], this.heap[smallest])) smallest = left;
      if (right < n && this.less(this.heap[right], this.heap[smallest])) smallest = right;
      if (smallest === i) break;
      this.heap[i] = this.heap[smallest];
      i = smallest;
    }
    this.heap[i] = ev;
  }

  private less(a: DiscreteEvent, b: DiscreteEvent): boolean {
    if (a.time !== b.time) return a.time < b.time;
    return (this.order.get(a) ?? 0) < (this.order.get(b) ?? 0);
  }
}
