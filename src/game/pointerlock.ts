/**
 * Windowed play: the pointer is held inside the game (Pointer Lock), so it cannot slip off the window while
 * scrolling by the edge. Locked, the browser hides its cursor and reports only movements: we keep a position of our
 * own, draw the cursor of whatever lies under it, and replay the mouse events there, so the game and its interface
 * work as before. The browser's Escape frees it (so does pausing); the next click in the map takes it again.
 */
export function holdPointer(canvas: HTMLCanvasElement, wanted: () => boolean, speed: () => number): { release(): void } {
  const cursor = document.createElement('div');
  cursor.className = 'vcursor';
  cursor.hidden = true;
  document.body.append(cursor);
  let x = 0;
  let y = 0;
  let over: Element | null = null;
  let pressed: Element | null = null;
  /** Locked moves in screen pixels (see MoveScale), and the size of the last few, to catch a stray spike. */
  const scale = new MoveScale();
  const recent: number[] = [];
  let lastX = NaN;
  let lastY = NaN;
  // Unlocked, the browser gives both the pointer's position and its movement: how they compare tells how movement
  // counts (already accelerated by the system, in CSS or device pixels) turn into the system cursor's pixels.
  window.addEventListener('mousemove', (e) => {
    if (!e.isTrusted || locked()) return;
    if (lastX === lastX) scale.add(Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY), Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0));
    lastX = e.clientX;
    lastY = e.clientY;
  }, { capture: true, passive: true });
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
    recent.length = 0;
    lastX = NaN;
    if (!locked()) {
      hover(null);
      over = null;
    }
    if (locked()) draw(document.elementFromPoint(x, y));
  });
  // The map picks what lies under the cursor a frame after a move (and animates its brackets): redraw then too, not
  // only at the next move.
  // So does a mode set on the page (body.targeting after A: the crosshair), whatever lies under the cursor.
  const restyle = new MutationObserver(() => locked() && over && draw(over));
  restyle.observe(canvas, { attributes: true, attributeFilter: ['style'] });
  restyle.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  /** The cursor the page asks for at the target (a custom image with its hot spot, else a plain arrow). */
  const draw = (target: Element | null) => {
    const css = target ? getComputedStyle(target).cursor : '';
    // The computed value is url("…") with any quote escaped; the game's SVG cursors hold brackets, so read up to
    // the closing quote, not the first ")".
    // Some browsers give it unquoted.
    const m = /url\("((?:[^"\\]|\\.)*)"\)\s*(\d+)?\s*(\d+)?/.exec(css) ?? /url\(([^\s"]+)\)\s*(\d+)?\s*(\d+)?/.exec(css);
    const [img, hx, hy] = m ? [m[1], Number(m[2] ?? 0), Number(m[3] ?? 0)] : [ARROW, 1, 1];
    hot = [hx, hy];
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
    place();
  };
  /** The drawn cursor's hot spot, and its move: a transform only (composited, no layout), done at each mouse move. */
  let hot = [1, 1];
  const place = () => (cursor.style.transform = `translate(${x - hot[0]}px, ${y - hot[1]}px)`);

  /** The moves since the last frame, replayed to the page once per frame (see replay). */
  let moved: MouseEvent | null = null;
  const flush = () => {
    const src = moved;
    moved = null;
    if (!src || !locked()) return;
    const target = pressed instanceof HTMLCanvasElement ? pressed : (document.elementFromPoint(x, y) ?? document.body);
    if (target !== over) {
      if (over) fire('pointerout', over, src);
      fire('pointerover', target, src);
      over = target;
      hover(target);
      // Its cursor style is read when it changes hands (the map's own changes come through the observer above).
      draw(target);
    }
    fire('pointermove', target, src);
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
      // The movement is the system's, acceleration included (unadjustedMovement is not asked for): one to one with
      // the system cursor, times the speed setting, with no acceleration of our own on top. A lone spike (Chrome sends
      // some) is cut down to the moves around it.
      const g = scale.value * speed() * despike(Math.hypot(dx, dy) * scale.value, recent);
      x = Math.min(window.innerWidth - 1, Math.max(0, x + dx * g));
      y = Math.min(window.innerHeight - 1, Math.max(0, y + dy * g));
      // The cursor moves at once; what lies under it (a hit test, the page's hover, its cursor style: work that can
      // force a layout) waits for the next frame, once however many moves came (Safari and Firefox send them at the
      // mouse's own rate, up to 1000 a second).
      place();
      if (!moved) requestAnimationFrame(flush);
      moved = src;
      return;
    }
    // The browser's own pointer events and clicks are swallowed only: the mouse ones are replayed.
    if (e.type !== 'mousedown' && e.type !== 'mouseup' && e.type !== 'wheel') return;
    // A press or a release lands where the cursor is now: the moves waiting are replayed first.
    flush();
    // A press on a canvas (the map, the minimap) keeps its moves and release there, as pointer capture would.
    const target = pressed instanceof HTMLCanvasElement ? pressed : (document.elementFromPoint(x, y) ?? document.body);
    if (e.type === 'mousedown') {
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
 * Screen pixels per unit of movementX/Y, learnt from unlocked moves (where the pointer's position shows how far the
 * system cursor really went). 1 until enough has been seen: browsers mostly give CSS pixels, some device pixels.
 */
export class MoveScale {
  private moved = 0;
  private counted = 0;
  value = 1;
  add(moved: number, counted: number): void {
    // Moves without movement (synthetic, or the first after a jump) say nothing; a wildly off one is a jump too.
    if (!counted || !moved || moved > 8 * counted || counted > 8 * moved) return;
    this.moved += moved;
    this.counted += counted;
    // Learnt once a few hundred pixels were seen, then refined; a fresh ratio a long way off resets the tally (a
    // window moved to another screen).
    if (this.moved < 300) return;
    const r = this.moved / this.counted;
    this.value = Math.min(4, Math.max(0.25, r));
    if (this.moved > 20000) {
      this.moved /= 2;
      this.counted /= 2;
    }
  }
}

/**
 * The share of a move to keep: all of it, unless it is far beyond the last few (`recent`, updated here), as no real
 * hand speeds up that much from one event to the next; then cut down to that bound.
 */
export function despike(size: number, recent: number[]): number {
  const limit = Math.max(60, 4 * Math.max(0, ...recent));
  const kept = Math.min(size, limit);
  recent.push(kept);
  if (recent.length > 4) recent.shift();
  return size > limit ? limit / size : 1;
}

const ARROW = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><path d='M2 2l7 19 3-8 8-3z' fill='#e8f2ff' stroke='#000' stroke-width='1.5' stroke-linejoin='round'/></svg>")}`;
