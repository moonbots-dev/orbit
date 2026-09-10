import type { DeviceAdapter } from './types.js';

const key = Symbol.for('orbit.runtime.v1');
type Context = {
  target?: DeviceAdapter;
  attention: Set<(event: { message: string }) => void>;
};
function context(): Context {
  const scope = globalThis as typeof globalThis & { [key]?: Context };
  return (scope[key] ??= { attention: new Set() });
}

/** Runner integration. Installing a target opens no physical connection. */
export function setRuntimeTarget(target: DeviceAdapter | undefined) {
  context().target = target;
  context().attention.clear();
}
export function getRuntimeTarget(): DeviceAdapter {
  const target = context().target;
  if (!target) throw new Error('Start this program with orbit dev, or choose target: "simulator".');
  return target;
}
/** Receive attention requests from the local runner or simulator controls. */
export function onAttention(handler: (event: { message: string }) => void) {
  context().attention.add(handler);
  return { unsubscribe: () => context().attention.delete(handler) };
}
/** Runner integration; does not send notifications or invoke an AI service. */
export function dispatchAttention(message: string) {
  for (const handler of context().attention) handler({ message: message.slice(0, 240) });
}
