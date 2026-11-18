/**
 * Windowed play: the pointer is held inside the game (Pointer Lock), so it cannot slip off the window while
 * scrolling by the edge. Locked, the browser hides its cursor and reports only movements: we keep a position of our
 * own, draw the cursor of whatever lies under it, and replay the mouse events there, so the game and its interface
 * work as before. The browser's Escape frees it (so does pausing); the next click in the map takes it again.
 */
export function holdPointer(canvas: HTMLCanvasElement, wanted: () => boolean, feel: () => { speed: number; accel: number }): { release(): void } {
  const cursor = document.createElement('div');
  cursor.className = 'vcursor';
  cursor.hidden = true;
  document.body.append(cursor);
  let x = 0;
  let y = 0;
  let over: Element | null = null;
  let pressed: Element | null = null;
  /** When the last move came (ms), for its speed. */
  let lastMove = 0;
  /** Failed tries in a row (refused, or no answer within a second: WebKit can leave the request pending for good),
   * and no new try before `retryAt`; after three, none on this page: the plain cursor stays. */
  let failures = 0;
  let retryAt = 0;
  let waiting = 0;
  const failed = () => {
    clearTimeout(waiting);
    if (locked()) return;
    failures++;
    retryAt = performance.now() + 3000;
  };
  /** Moves right after the lock is taken: Safari sends one or two huge jumps then, which are dropped. */
  let settling = 0;
  const locked = () => document.pointerLockElement === canvas;

  canvas.addEventListener('pointerdown', (e) => {
    if (!e.isTrusted || e.pointerType !== 'mouse' || failures >= 3 || performance.now() < retryAt || locked() || document.fullscreenElement || !wanted()) return;
    x = e.clientX;
    y = e.clientY;
    // Never awaited: the game goes on with the plain cursor until the lock comes, if it does. Older Safari returns
    // nothing, some browsers throw instead of rejecting.
    retryAt = Infinity; // one request at a time
    clearTimeout(waiting);
    waiting = window.setTimeout(failed, 1000);
    try {
      void (canvas.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(failed);
    } catch {
      failed();
    }
  });
  document.addEventListener('pointerlockerror', failed);
  // A held pointer does not move the browser's :hover: the element under our cursor and its parents wear .vhover
  // instead, which the stylesheet lights like :hover.
  const hover = (target: Element | null) => {
    for (const el of document.querySelectorAll('.vhover')) el.classList.remove('vhover');
    for (let el = target; el && el !== document.body; el = el.parentElement) el.classList.add('vhover');
  };
  document.addEventListener('pointerlockchange', () => {
    cursor.hidden = !locked();
    if (locked()) {
      clearTimeout(waiting);
      failures = 0;
      retryAt = 0;
    }
    settling = 2;
    lastMove = 0;
    if (!locked()) {
      hover(null);
      over = null;
    }
    if (locked()) draw(document.elementFromPoint(x, y));
  });
  // The map picks what lies under the cursor a frame after a move (and animates its brackets): redraw then too, not
  // only at the next move.
  new MutationObserver(() => locked() && over === canvas && draw(canvas)).observe(canvas, { attributes: true, attributeFilter: ['style'] });

  /** The cursor the page asks for at the target (a custom image with its hot spot, else a plain arrow). */
  const draw = (target: Element | null) => {
    const css = target ? getComputedStyle(target).cursor : '';
    // The computed value is url("…") with any quote escaped; the game's SVG cursors hold brackets, so read up to
    // the closing quote, not the first ")".
    // Some browsers give it unquoted.
    const m = /url\("((?:[^"\\]|\\.)*)"\)\s*(\d+)?\s*(\d+)?/.exec(css) ?? /url\(([^\s"]+)\)\s*(\d+)?\s*(\d+)?/.exec(css);
    const [img, hx, hy] = m ? [m[1], Number(m[2] ?? 0), Number(m[3] ?? 0)] : [ARROW, 1, 1];
    if (cursor.dataset.img !== img) {
      cursor.dataset.img = img;
      cursor.style.backgroundImage = `url("${img}")`;
      // An image the browser cannot draw would leave no cursor at all: fall back to the plain arrow.
      const probe = new Image();
      probe.onerror = () => {
        if (cursor.dataset.img === img) cursor.style.backgroundImage = `url("${ARROW}")`;
      };
      probe.src = img.replace(/\\(.)/g, '$1');
    }
    cursor.style.transform = `translate(${x - hx}px, ${y - hy}px)`;
  };

  const fire = (type: string, target: Element, src: MouseEvent) => {
    const init = {
      bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y,
      button: src.button, buttons: src.buttons, shiftKey: src.shiftKey, ctrlKey: src.ctrlKey, altKey: src.altKey, metaKey: src.metaKey,
    };
    const ev = type.startsWith('pointer')
      ? new PointerEvent(type, { ...init, pointerId: (src as PointerEvent).pointerId ?? 1, pointerType: 'mouse', isPrimary: true })
      : type === 'wheel'
        ? new WheelEvent(type, { ...init, deltaX: (src as WheelEvent).deltaX, deltaY: (src as WheelEvent).deltaY, deltaMode: (src as WheelEvent).deltaMode })
        : new MouseEvent(type, init);
    target.dispatchEvent(ev);
  };

  // While locked, the browser's own mouse events (frozen at where the lock began) are swallowed before anyone sees
  // them, and replayed at our position instead. The mouse family drives it: every browser sends mousemove (with its
  // movement), mousedown and mouseup under a lock, while Safari sends no pointer events there.
  const replay = (e: Event) => {
    if (!locked() || !e.isTrusted) return;
    e.stopImmediatePropagation();
    const src = e as MouseEvent;
    if (e.type === 'mousemove') {
      const dx = src.movementX || 0;
      const dy = src.movementY || 0;
      const jump = Math.hypot(dx, dy) > 0.25 * Math.max(window.innerWidth, window.innerHeight);
      if (settling > 0 && jump) {
        settling--;
        return;
      }
      settling = 0;
      // The browser gives the mouse's own counts, without the system's acceleration: ours, so that a slow move aims
      // finely and a quick one crosses the screen.
      const dt = lastMove ? e.timeStamp - lastMove : 16;
      lastMove = e.timeStamp;
      const { speed, accel } = feel();
      const g = pointerGain(Math.hypot(dx, dy), dt, speed, accel);
      x = Math.min(window.innerWidth - 1, Math.max(0, x + dx * g));
      y = Math.min(window.innerHeight - 1, Math.max(0, y + dy * g));
    }
    // A press on a canvas (the map, the minimap) keeps its moves and release there, as pointer capture would.
    const target = pressed instanceof HTMLCanvasElement ? pressed : (document.elementFromPoint(x, y) ?? document.body);
    if (e.type === 'mousemove') {
      if (target !== over) {
        if (over) fire('pointerout', over, src);
        fire('pointerover', target, src);
        over = target;
        hover(target);
      }
      fire('pointermove', target, src);
      draw(target);
    } else if (e.type === 'mousedown') {
      pressed = target;
      fire('pointerdown', target, src);
      fire('mousedown', target, src);
    } else if (e.type === 'mouseup') {
      fire('pointerup', target, src);
      fire('mouseup', target, src);
      if (pressed === target && src.button === 0) fire('click', document.elementFromPoint(x, y) ?? target, src);
      pressed = null;
    } else if (e.type === 'wheel') {
      e.preventDefault();
      fire('wheel', target, src);
    }
  };
  for (const type of ['pointermove', 'pointerdown', 'pointerup', 'mousemove', 'mousedown', 'mouseup', 'click', 'wheel']) {
    window.addEventListener(type, replay, { capture: true, passive: false });
  }
  return { release: () => locked() && document.exitPointerLock() };
}

/**
 * How far the held cursor goes per count of the mouse, from the move's speed (counts per millisecond), like the
 * system's pointer acceleration: about `speed` when crawling, growing smoothly with the speed (eased in, so aiming
 * stays steady) up to `speed × (1 + 3 × accel)` past 3 counts/ms. `accel` 0 is a plain constant gain.
 */
export function pointerGain(dist: number, dt: number, speed: number, accel: number): number {
  // A move after a pause (or two in the same instant) has no meaningful time: a frame's worth.
  const v = dist / (dt > 0 && dt < 100 ? Math.max(dt, 4) : 16);
  const t = Math.min(1, Math.max(0, (v - 0.1) / 2.9));
  return speed * (1 + 3 * accel * t * t * (3 - 2 * t));
}

const ARROW = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><path d='M2 2l7 19 3-8 8-3z' fill='#e8f2ff' stroke='#000' stroke-width='1.5' stroke-linejoin='round'/></svg>")}`;
