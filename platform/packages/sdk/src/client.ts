import type {
  AdapterSession,
  Animation,
  AnimationCallback,
  AnimationOptions,
  ButtonEvent,
  ConnectOptions,
  Diagnostics,
  FrameOptions,
  FrameResult,
  ImuSample,
  InputEvent,
  Puck,
  Scene,
  ScreenEvent,
  SessionEvents,
  SwitchEvent,
  TouchEvents,
  Point,
} from './types.js';
import { realtimeClock, type Timer } from './clock.js';
import { Events, type Subscription } from './events.js';
import {
  aborted,
  asError,
  deferred,
  finite,
  integer,
  invalid,
  OrbitError,
  rejectAsync,
} from './errors.js';
import { createFrame, deepFreeze, validateScene } from './scene.js';
import { validateInput } from './input.js';

type Work = {
  scene: Scene;
  id: number;
  options: FrameOptions;
  abort: AbortController;
  result: ReturnType<typeof deferred<FrameResult>>;
  cleanup: () => void;
  done: boolean;
};

export function createSession(
  adapter: AdapterSession,
  options: ConnectOptions,
): Puck {
  const clock = options.clock ?? adapter.clock;
  const controlled = options.control?.includes('screen') ?? false;
  let status: Puck['status'] = 'connected',
    closePromise: Promise<void> | undefined;
  const ended = deferred<void>();
  const errors = new Events<SessionEvents>();
  const report = (e: OrbitError) => errors.emit('error', e);
  const inputs = new Events<{ input: InputEvent }>(report);
  const touches = new Events<TouchEvents>(report);
  const motion = new Events<{ sample: ImuSample }>(report);
  const buttons = new Events<Record<ButtonEvent['phase'], ButtonEvent>>(report);
  const switches = new Events<{ change: SwitchEvent }>(report);
  const frames = new Events<{ frame: ScreenEvent }>(report);
  const contacts = new Map<number, Point>(),
    buttonStates = new Map<string, ButtonEvent>(),
    switchStates = new Map<string, SwitchEvent>();
  let latestImu: ImuSample | undefined,
    sequence = 0,
    bootId = adapter.info.bootId,
    deviceTimeUs = -1;
  const retired = new Set<string>();
  const counters: Diagnostics = {
    receivedInputs: 0,
    inputGaps: 0,
    submittedFrames: 0,
    acknowledgedFrames: 0,
    supersededFrames: 0,
    pendingFrames: 0,
    screenControl: controlled,
  };
  // Counter storage is internal; callers receive immutable snapshots.
  const stats = { ...counters };
  const queue: Work[] = [];
  let inFlight: Work | undefined,
    nextFrameId = 0;
  let animation:
    | { handle: Animation; end(error?: OrbitError): void }
    | undefined;
  const subscribers: Subscription[] = [];
  const active = (operation: string) => {
    if (status !== 'connected')
      throw new OrbitError(
        'connection-lost',
        operation,
        'Device session is closed.',
      );
  };
  const neutralize = (
    event: InputEvent,
    reason: 'input-gap' | 'disconnected',
  ) => {
    const previousContacts = [...contacts],
      previousButtons = [...buttonStates];
    contacts.clear();
    buttonStates.clear();
    switchStates.clear();
    latestImu = undefined;
    for (const [contactId, position] of previousContacts)
      touches.emit('cancel', {
        ...event,
        type: 'touch',
        phase: 'cancel',
        contactId,
        position,
        reason,
      });
    for (const [id, previous] of previousButtons)
      if (previous.phase === 'down')
        buttons.emit('cancel', {
          ...event,
          type: 'button',
          id,
          phase: 'cancel',
        });
  };
  subscribers.push(
    adapter.onInput((raw) => {
      if (status !== 'connected') return;
      try {
        const event = validateInput(raw, adapter.capabilities);
        if (retired.has(event.bootId)) return;
        const changedBoot = event.bootId !== bootId;
        if (
          !changedBoot &&
          (event.sequence <= sequence || event.deviceTimeUs < deviceTimeUs)
        )
          return;
        if (sequence && (changedBoot || event.sequence !== sequence + 1)) {
          stats.inputGaps++;
          neutralize(event, 'input-gap');
        }
        if (changedBoot) {
          retired.add(bootId);
          bootId = event.bootId;
          if (retired.size > 32) retired.delete(retired.values().next().value!);
        }
        sequence = event.sequence;
        deviceTimeUs = event.deviceTimeUs;
        stats.receivedInputs++;
        switch (event.type) {
          case 'touch':
            // Keep raw observations, but a missed transition cannot revive a drag.
            if (event.phase !== 'down' && !contacts.has(event.contactId)) break;
            if (event.phase === 'down' || event.phase === 'move')
              contacts.set(event.contactId, event.position);
            else contacts.delete(event.contactId);
            touches.emit(event.phase, event as never);
            break;
          case 'imu':
            latestImu = event;
            motion.emit('sample', event);
            break;
          case 'button':
            if (
              event.phase !== 'down' &&
              buttonStates.get(event.id)?.phase !== 'down'
            )
              break;
            buttonStates.set(event.id, event);
            buttons.emit(event.phase, event);
            break;
          case 'switch':
            switchStates.set(event.id, event);
            switches.emit('change', event);
            break;
          case 'discontinuity':
            neutralize(
              event,
              event.reason === 'disconnected' ? 'disconnected' : 'input-gap',
            );
            break;
        }
        inputs.emit('input', event);
      } catch (error) {
        report(asError(error, 'input'));
      }
    }),
  );
  subscribers.push(
    adapter.onFrame((event) => {
      if (status === 'connected') {
        try {
          frames.emit(
            'frame',
            deepFreeze({
              ...event,
              scene: validateScene(
                event.scene,
                adapter.capabilities.viewport,
                adapter.capabilities.screen,
              ),
            }),
          );
        } catch (error) {
          report(asError(error, 'screen.frame'));
        }
      }
    }),
  );

  function finish(work: Work, value?: FrameResult, error?: unknown): void {
    if (work.done) return;
    work.done = true;
    work.cleanup();
    const index = queue.indexOf(work);
    if (index >= 0) queue.splice(index, 1);
    if (inFlight === work) inFlight = undefined;
    if (error) {
      work.abort.abort();
      work.result.reject(asError(error, 'screen.present'));
    } else if (value) {
      if (value.status === 'superseded') stats.supersededFrames++;
      else stats.acknowledgedFrames++;
      work.result.resolve(value);
    }
    pump();
  }
  function pump(): void {
    if (status !== 'connected' || inFlight || !queue.length) return;
    const work = queue.shift()!;
    inFlight = work;
    try {
      adapter
        .present(work.scene, work.id, {
          ...work.options,
          signal: work.abort.signal,
        })
        .then((result) => {
          if (
            result.frameId !== work.id ||
            !['superseded', 'acknowledged'].includes(result.status)
          )
            throw new OrbitError(
              'invalid-value',
              'screen.present',
              'Adapter returned an invalid frame acknowledgement.',
            );
          if (result.status === 'acknowledged') {
            if (result.acknowledgement !== work.options.acknowledgement)
              invalid(
                'screen.present',
                'Adapter acknowledged a different completion level.',
              );
            finite(result.hostTimeMs, 0, Number.MAX_SAFE_INTEGER, 'hostTimeMs');
            if (result.deviceTimeUs !== undefined)
              integer(
                result.deviceTimeUs,
                0,
                Number.MAX_SAFE_INTEGER,
                'deviceTimeUs',
              );
          }
          finish(work, result);
        })
        .catch((error) => finish(work, undefined, error));
    } catch (error) {
      finish(work, undefined, error);
    }
  }
  function present(
    scene: Scene,
    opts: FrameOptions = {},
    fromAnimation = false,
  ): Promise<FrameResult> {
    try {
      active('screen.present');
      aborted(opts.signal, 'screen.present');
      if (!controlled)
        throw new OrbitError(
          'busy',
          'screen.present',
          'Connect with control: ["screen"] to draw.',
        );
      if (animation && !fromAnimation)
        throw new OrbitError(
          'busy',
          'screen.present',
          'Stop screen animation before manual drawing.',
        );
      if (
        opts.queue !== undefined &&
        opts.queue !== 'latest' &&
        opts.queue !== 'fifo'
      )
        invalid('queue', 'Use latest or fifo.');
      const acknowledgement = opts.acknowledgement ?? 'accepted';
      if (
        !adapter.capabilities.screen.acknowledgements.includes(acknowledgement)
      )
        throw new OrbitError(
          'unsupported',
          'screen.present',
          'Requested acknowledgement is unsupported.',
        );
      const timeout = finite(
        opts.timeoutMs ?? 5000,
        1,
        2_147_483_647,
        'timeoutMs',
      );
      const validated = validateScene(
        scene,
        adapter.capabilities.viewport,
        adapter.capabilities.screen,
      );
      const work: Work = {
        scene: validated,
        id: ++nextFrameId,
        options: { ...opts, acknowledgement },
        abort: new AbortController(),
        result: deferred(),
        done: false,
        cleanup() {},
      };
      // Coalesce only the last replaceable frame, never an earlier FIFO request.
      const previous = queue.at(-1);
      if (
        (opts.queue ?? 'latest') === 'latest' &&
        previous &&
        (previous.options.queue ?? 'latest') === 'latest'
      ) {
        queue.pop();
        previous.done = true;
        previous.cleanup();
        stats.supersededFrames++;
        previous.result.resolve({ status: 'superseded', frameId: previous.id });
      }
      if (
        queue.length + (inFlight ? 1 : 0) >=
        adapter.capabilities.screen.maxQueuedFrames
      )
        throw new OrbitError(
          'queue-full',
          'screen.present',
          'Frame queue is full.',
        );
      const cancel = () =>
        finish(
          work,
          undefined,
          new OrbitError(
            'cancelled',
            'screen.present',
            'Frame submission canceled.',
          ),
        );
      const timer = clock.after(timeout, () =>
        finish(
          work,
          undefined,
          new OrbitError(
            'timeout',
            'screen.present',
            'Frame submission timed out.',
          ),
        ),
      );
      work.cleanup = () => {
        timer.cancel();
        opts.signal?.removeEventListener('abort', cancel);
      };
      opts.signal?.addEventListener('abort', cancel, { once: true });
      queue.push(work);
      stats.submittedFrames++;
      pump();
      return work.result.promise;
    } catch (error) {
      return Promise.reject(asError(error, 'screen.present'));
    }
  }
  function build(draw: (frame: import('./types.js').Frame) => void): Scene {
    const frame = createFrame(
      adapter.capabilities.viewport,
      adapter.capabilities.screen,
    );
    try {
      rejectAsync(draw(frame), 'screen.draw');
      return frame.build();
    } catch (error) {
      try {
        frame.build();
      } catch {}
      throw error;
    }
  }
  function animate(
    draw: AnimationCallback,
    opts: AnimationOptions = {},
  ): Animation {
    active('screen.animate');
    aborted(opts.signal, 'screen.animate');
    if (!controlled || animation)
      throw new OrbitError(
        'busy',
        'screen.animate',
        'Screen control is required and only one animation may run.',
      );
    const fps = finite(opts.fps ?? 60, 0.1, 240, 'fps');
    let state: Animation['state'] = 'running',
      timer: Timer | undefined;
    let accumulated = 0,
      started = clock.now(),
      previous: number | undefined,
      frameIndex = 0;
    const finished = deferred<void>(),
      onError = new Events<{ error: OrbitError }>();
    const controller = new AbortController();
    const abort = () =>
      end(new OrbitError('cancelled', 'screen.animate', 'Animation aborted.'));
    function end(error?: OrbitError): void {
      if (state === 'stopped') return;
      state = 'stopped';
      timer?.cancel();
      controller.abort();
      opts.signal?.removeEventListener('abort', abort);
      if (animation?.handle === handle) animation = undefined;
      if (error) {
        onError.emit('error', error);
        report(error);
        finished.reject(error);
      } else finished.resolve();
      onError.clear();
    }
    const tick = () => {
      if (state !== 'running') return;
      const now = clock.now();
      if (frameIndex === 0) {
        accumulated = 0;
        started = now;
      }
      const elapsedMs = accumulated + now - started;
      const timing = Object.freeze({
        elapsedMs,
        deltaMs: previous === undefined ? 0 : now - previous,
        frameIndex: frameIndex++,
      });
      previous = now;
      try {
        const scene = build((frame) => draw(frame, timing));
        if (state !== 'running') return;
        present(scene, { ...opts, signal: controller.signal }, true).catch(
          (error) => {
            if (state !== 'stopped') end(asError(error, 'screen.animate'));
          },
        );
        timer = clock.after(1000 / fps, tick);
      } catch (error) {
        end(asError(error, 'screen.animate'));
      }
    };
    const handle: Animation = {
      get state() {
        return state;
      },
      finished: finished.promise,
      pause() {
        if (state !== 'running') return;
        accumulated += clock.now() - started;
        state = 'paused';
        timer?.cancel();
      },
      resume() {
        if (state !== 'paused') return;
        state = 'running';
        started = clock.now();
        previous = undefined;
        timer = clock.after(0, tick);
      },
      stop: () => end(),
      onError: (handler) => {
        if (state === 'stopped')
          invalid('animation.onError', 'Animation is stopped.');
        return onError.on('error', handler);
      },
    };
    animation = { handle, end };
    opts.signal?.addEventListener('abort', abort, { once: true });
    // Set the animation origin when its first callback actually runs.
    timer = clock.after(0, () => {
      started = clock.now();
      tick();
    });
    return handle;
  }

  // A live Bun/Node session remains alive; manual-clock tests do not need this.
  const keepAlive =
    options.keepAlive ??
    (clock === realtimeClock && typeof window === 'undefined');
  const heartbeat = keepAlive ? setInterval(() => {}, 60_000) : undefined;
  const close = (failure?: OrbitError): Promise<void> => {
    if (closePromise) return closePromise;
    const closing = deferred<void>();
    closePromise = closing.promise;
    status = 'closing';
    const synthetic = {
      type: 'discontinuity' as const,
      reason: 'disconnected' as const,
      sequence: sequence + 1,
      bootId,
      deviceTimeUs: Math.max(0, deviceTimeUs),
      receivedTimeMs: clock.now(),
      source: adapter.info.source,
    };
    neutralize(synthetic, 'disconnected');
    inputs.emit('input', synthetic);
    animation?.end(failure);
    for (const work of [inFlight, ...queue])
      if (work)
        finish(
          work,
          undefined,
          failure ??
            new OrbitError('cancelled', 'screen.present', 'Session closed.'),
        );
    for (const sub of subscribers) sub.unsubscribe();
    if (heartbeat !== undefined) clearInterval(heartbeat);
    options.signal?.removeEventListener('abort', lifetimeAbort);
    errors.emit('disconnect', {
      reason: failure ? 'connection-lost' : 'closed',
      hostTimeMs: clock.now(),
    });
    touches.clear();
    motion.clear();
    buttons.clear();
    switches.clear();
    frames.clear();
    inputs.clear();
    errors.clear();
    Promise.resolve()
      .then(() => adapter.close())
      .then(
        () => {
          status = 'closed';
          if (failure) ended.reject(failure);
          else ended.resolve();
          closing.resolve();
        },
        (error) => {
          status = 'closed';
          ended.reject(error);
          closing.reject(error);
        },
      );
    return closePromise;
  };
  const lifetimeAbort = () => {
    void close(new OrbitError('cancelled', 'connect', 'Session aborted.'));
  };
  subscribers.push(
    adapter.onDisconnect((reason) => {
      void close(new OrbitError('connection-lost', 'connection', reason));
    }),
  );
  options.signal?.addEventListener('abort', lifetimeAbort, { once: true });

  const puck: Puck = {
    info: adapter.info,
    capabilities: adapter.capabilities,
    clock,
    get status() {
      return status;
    },
    closed: ended.promise,
    close: () => close(),
    on: (event, handler) => {
      active('on');
      return errors.on(event, handler);
    },
    screen: {
      size: adapter.capabilities.viewport,
      center: Object.freeze({
        x: adapter.capabilities.viewport.width / 2,
        y: adapter.capabilities.viewport.height / 2,
      }),
      capabilities: adapter.capabilities.screen,
      contains(p) {
        const { width, height } = adapter.capabilities.viewport;
        return (
          Number.isFinite(p.x) &&
          Number.isFinite(p.y) &&
          p.x >= 0 &&
          p.y >= 0 &&
          p.x <= width &&
          p.y <= height &&
          (adapter.capabilities.screen.shape !== 'circle' ||
            Math.hypot(p.x - width / 2, p.y - height / 2) <= width / 2)
        );
      },
      on: (_, handler) => {
        active('screen.on');
        return frames.on('frame', handler);
      },
      draw(draw, opts) {
        try {
          active('screen.draw');
          aborted(opts?.signal, 'screen.draw');
          if (!controlled || animation)
            throw new OrbitError(
              'busy',
              'screen.draw',
              'Screen control is required; stop any running animation before drawing.',
            );
          return present(build(draw), opts);
        } catch (e) {
          return Promise.reject(asError(e, 'screen.draw'));
        }
      },
      animate,
      createFrame: () => {
        active('screen.createFrame');
        return createFrame(
          adapter.capabilities.viewport,
          adapter.capabilities.screen,
        );
      },
      present,
    },
    touch: {
      capabilities: adapter.capabilities.touch,
      get contacts() {
        return Object.freeze(
          [...contacts].map(([contactId, position]) =>
            Object.freeze({ contactId, position }),
          ),
        );
      },
      on: (phase, handler) => {
        active('touch.on');
        return touches.on(phase, handler);
      },
    },
    imu: {
      get latest() {
        return latestImu;
      },
      on: (_, handler) => {
        active('imu.on');
        return motion.on('sample', handler);
      },
    },
    buttons: {
      ids: adapter.capabilities.buttons,
      get: (id) => buttonStates.get(id),
      on: (phase, handler) => {
        active('buttons.on');
        return buttons.on(phase, handler);
      },
    },
    switches: {
      ids: adapter.capabilities.switches,
      get: (id) => switchStates.get(id),
      on: (_, handler) => {
        active('switches.on');
        return switches.on('change', handler);
      },
    },
    inputs: {
      on: (handler) => {
        active('inputs.on');
        return inputs.on('input', handler);
      },
      stream(opts = {}) {
        const limit = integer(opts.buffer ?? 128, 1, 8192, 'buffer');
        return {
          [Symbol.asyncIterator]() {
            const buffer: InputEvent[] = [];
            let waiter:
                | ReturnType<typeof deferred<IteratorResult<InputEvent>>>
                | undefined,
              done = false,
              failure: OrbitError | undefined;
            const end = (error?: OrbitError) => {
              if (done) return;
              done = true;
              failure = error;
              inputSub.unsubscribe();
              disconnectSub.unsubscribe();
              opts.signal?.removeEventListener('abort', cancel);
              buffer.length = 0;
              if (error) waiter?.reject(error);
              else waiter?.resolve({ done: true, value: undefined });
              waiter = undefined;
            };
            const inputSub = inputs.on('input', (event) => {
              if (opts.kinds && !opts.kinds.includes(event.type)) return;
              if (waiter) {
                const w = waiter;
                waiter = undefined;
                w.resolve({ done: false, value: event });
              } else if (buffer.length >= limit)
                end(
                  new OrbitError(
                    'queue-full',
                    'inputs.stream',
                    'Input consumer is too slow; stream ended to preserve transition continuity.',
                  ),
                );
              else buffer.push(event);
            });
            const disconnectSub = errors.on('disconnect', () => end());
            const cancel = () =>
              end(
                new OrbitError(
                  'cancelled',
                  'inputs.stream',
                  'Input stream canceled.',
                ),
              );
            opts.signal?.addEventListener('abort', cancel, { once: true });
            if (opts.signal?.aborted) cancel();
            else if (status !== 'connected') end();
            return {
              next(): Promise<IteratorResult<InputEvent>> {
                if (failure) return Promise.reject(failure);
                if (buffer.length)
                  return Promise.resolve({
                    done: false,
                    value: buffer.shift()!,
                  });
                if (done)
                  return Promise.resolve({ done: true, value: undefined });
                if (waiter)
                  return Promise.reject(
                    new OrbitError(
                      'busy',
                      'inputs.stream',
                      'Await the previous next() before requesting another sample.',
                    ),
                  );
                waiter = deferred();
                return waiter.promise;
              },
              async return(): Promise<IteratorResult<InputEvent>> {
                end();
                return { done: true, value: undefined };
              },
            };
          },
        };
      },
    },
    diagnostics: {
      snapshot: () =>
        Object.freeze({
          ...stats,
          pendingFrames: queue.length + (inFlight ? 1 : 0),
        }),
    },
  };
  return Object.freeze(puck);
}
