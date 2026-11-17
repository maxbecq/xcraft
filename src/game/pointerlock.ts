/**
 * Windowed play: the pointer is held inside the game (Pointer Lock), so it cannot slip off the window while
 * scrolling by the edge. Locked, the browser hides its cursor and reports only movements: we keep a position of our
 * own, draw the cursor of whatever lies under it, and replay the mouse events there, so the game and its interface
 * work as before. The browser's Escape frees it (so does pausing); the next click in the map takes it again.
 */
export function holdPointer(canvas: HTMLCanvasElement, wanted: () => boolean): { release(): void } {
  const cursor = document.createElement('div');
  cursor.className = 'vcursor';
  cursor.hidden = true;
  document.body.append(cursor);
  let x = 0;
  let y = 0;
  let over: Element | null = null;
  let pressed: Element | null = null;
  const locked = () => document.pointerLockElement === canvas;

  canvas.addEventListener('pointerdown', (e) => {
    if (!e.isTrusted || e.pointerType !== 'mouse' || locked() || document.fullscreenElement || !wanted()) return;
    x = e.clientX;
    y = e.clientY;
    void (canvas.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {});
  });
  document.addEventListener('pointerlockchange', () => {
    cursor.hidden = !locked();
    if (locked()) draw(document.elementFromPoint(x, y));
  });

  /** The cursor the page asks for at the target (a custom image with its hot spot, else a plain arrow). */
  const draw = (target: Element | null) => {
    const css = target ? getComputedStyle(target).cursor : '';
    // The computed value is url("…") with any quote escaped; the game's SVG cursors hold brackets, so read up to
    // the closing quote, not the first ")".
    const m = /url\("((?:[^"\\]|\\.)*)"\)\s*(\d+)?\s*(\d+)?/.exec(css);
    const [img, hx, hy] = m ? [m[1], Number(m[2] ?? 0), Number(m[3] ?? 0)] : [ARROW, 1, 1];
    if (cursor.dataset.img !== img) {
      cursor.dataset.img = img;
      cursor.style.backgroundImage = `url("${img}")`;
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
  // them, and replayed at our position instead.
  const replay = (e: Event) => {
    if (!locked() || !e.isTrusted) return;
    e.stopImmediatePropagation();
    const src = e as MouseEvent;
    if (e.type === 'pointermove') {
      x = Math.min(window.innerWidth - 1, Math.max(0, x + src.movementX));
      y = Math.min(window.innerHeight - 1, Math.max(0, y + src.movementY));
    }
    // A press on a canvas (the map, the minimap) keeps its moves and release there, as pointer capture would.
    const target = pressed instanceof HTMLCanvasElement ? pressed : (document.elementFromPoint(x, y) ?? document.body);
    if (e.type === 'pointermove') {
      if (target !== over) {
        if (over) fire('pointerout', over, src);
        fire('pointerover', target, src);
        over = target;
      }
      fire('pointermove', target, src);
      draw(target);
    } else if (e.type === 'pointerdown') {
      pressed = target;
      fire('pointerdown', target, src);
      fire('mousedown', target, src);
    } else if (e.type === 'pointerup') {
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

const ARROW = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><path d='M2 2l7 19 3-8 8-3z' fill='#e8f2ff' stroke='#000' stroke-width='1.5' stroke-linejoin='round'/></svg>")}`;
