import orbit, { type Point } from '@orbit/sdk';
import { createCanvasRenderer } from '@orbit/sdk/canvas';

const config = JSON.parse(
  document.querySelector('#orbit-config')!.textContent!,
) as { token: string; deviceId: string };
const status = document.querySelector<HTMLElement>('#status')!;
const canvas = document.querySelector<HTMLCanvasElement>('#screen')!;
const renderer = createCanvasRenderer(canvas);
const headers = {
  Authorization: `Bearer ${config.token}`,
  'Content-Type': 'application/json',
};
const report = (error: unknown) => {
  status.textContent = error instanceof Error ? error.message : String(error);
};

// One request at a time preserves input transition order. Intermediate pointer
// moves are coalesced; down/up/cancel are never replaced.
type VirtualInput =
  | {
      type: 'touch';
      phase: 'down' | 'move' | 'up' | 'cancel';
      position?: Point;
    }
  | { type: 'button'; id: string; phase: 'down' | 'up' }
  | { type: 'switch'; id: string; value: boolean }
  | { type: 'cancel' };
const pending: VirtualInput[] = [];
let sending = false;
async function drain(): Promise<void> {
  if (sending) return;
  sending = true;
  try {
    while (pending.length) {
      const response = await fetch('/preview/input', {
        method: 'POST',
        headers,
        body: JSON.stringify(pending.shift()),
      });
      if (!response.ok)
        throw new Error('Virtual input was rejected. Release and try again.');
    }
  } catch (error) {
    pending.length = 0;
    report(error);
    await fetch('/preview/input', {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'cancel' }),
    }).catch(() => {});
  } finally {
    sending = false;
  }
}
function input(event: VirtualInput): void {
  const previous = pending.at(-1);
  if (
    event.type === 'touch' &&
    event.phase === 'move' &&
    previous?.type === 'touch' &&
    previous.phase === 'move'
  )
    pending[pending.length - 1] = event;
  else if (pending.length < 32) pending.push(event);
  else {
    pending.length = 0;
    pending.push({ type: 'cancel' });
  }
  void drain();
}

try {
  const puck = await orbit.connect({
    target: {
      host: {
        endpoint: location.origin,
        credentials: async () => config.token,
      },
      deviceId: config.deviceId,
    },
    keepAlive: false,
  });
  let receivedFrame = false;
  puck.screen.on('frame', (event) => {
    receivedFrame = true;
    renderer.draw(event.scene);
  });
  puck.on('error', report);
  puck.on('disconnect', () => {
    status.textContent = 'Program stopped. Reconnecting…';
    setTimeout(() => location.reload(), 1200);
  });
  const snapshot = await fetch('/preview/snapshot', { headers }).then(
    (response) => response.json(),
  );
  if (!receivedFrame && snapshot.scene) renderer.draw(snapshot.scene);
  status.textContent = `${puck.screen.size.width} × ${puck.screen.size.height} · Connected`;
  const point = (event: PointerEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    const border = parseFloat(getComputedStyle(canvas).borderLeftWidth);
    const width = rect.width - border * 2,
      height = rect.height - border * 2;
    return {
      x: Math.max(
        0,
        Math.min(
          puck.screen.size.width,
          ((event.clientX - rect.left - border) / width) *
            puck.screen.size.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          puck.screen.size.height,
          ((event.clientY - rect.top - border) / height) *
            puck.screen.size.height,
        ),
      ),
    };
  };
  let pointer: number | undefined;
  canvas.addEventListener('pointerdown', (event) => {
    if (pointer !== undefined || !puck.screen.contains(point(event))) return;
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    input({ type: 'touch', phase: 'down', position: point(event) });
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId === pointer)
      input({ type: 'touch', phase: 'move', position: point(event) });
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId === pointer) {
      pointer = undefined;
      input({ type: 'touch', phase: 'up', position: point(event) });
    }
  });
  canvas.addEventListener('lostpointercapture', () => {
    if (pointer !== undefined) {
      pointer = undefined;
      input({ type: 'touch', phase: 'cancel' });
    }
  });
  const talk = document.querySelector<HTMLButtonElement>('#talk')!;
  let talkHeld = false;
  const press = () => {
    if (!talkHeld) {
      talkHeld = true;
      input({ type: 'button', id: 'talk', phase: 'down' });
    }
  };
  const release = () => {
    if (talkHeld) {
      talkHeld = false;
      input({ type: 'button', id: 'talk', phase: 'up' });
    }
  };
  talk.addEventListener('pointerdown', (event) => {
    talk.setPointerCapture(event.pointerId);
    press();
  });
  talk.addEventListener('pointerup', release);
  talk.addEventListener('lostpointercapture', release);
  talk.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      press();
    }
  });
  talk.addEventListener('keyup', release);
  document
    .querySelector<HTMLInputElement>('#mute')!
    .addEventListener('change', (event) =>
      input({
        type: 'switch',
        id: 'mute',
        value: (event.target as HTMLInputElement).checked,
      }),
    );
  window.addEventListener('blur', () => {
    pointer = undefined;
    talkHeld = false;
    input({ type: 'cancel' });
  });
  window.addEventListener('pagehide', () => {
    void fetch('/preview/input', {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'cancel' }),
      keepalive: true,
    });
    void puck.close();
    renderer.dispose();
  });
} catch (error) {
  report(error);
  setTimeout(() => location.reload(), 1500);
}
