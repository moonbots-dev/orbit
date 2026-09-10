# @orbit/host

Optional Bun host for a shared virtual Orbit. Runs on `127.0.0.1`; it never opens hardware. It uses protocol version 1 for SDK clients and is separate from the earlier lab-v1 host.

```ts
import { createHost } from '@orbit/host';

const host = createHost({ token: process.env.ORBIT_HOST_TOKEN! });
console.log(host.endpoint); // Default http://127.0.0.1:4401
// Later: await host.close();
```

Supply a token of 16–256 characters. Discovery uses an Authorization header; WebSocket authentication happens in the first message. Credentials stay out of URLs and host logs. The default browser allowlist permits localhost:3000; pass `origins` to configure it. Only one connection can control a screen; multiple connections may observe. Closing a session releases its grant.

```ts
const host = {
  endpoint: 'http://127.0.0.1:4401',
  credentials: async () => process.env.ORBIT_HOST_TOKEN!,
};
const devices = await orbit.discover({ host });
const puck = await orbit.connect({
  target: { host, deviceId: devices[0].id },
  control: ['screen'],
});
```

The host limits connections, message sizes, request rates, outstanding presentations and socket buffering. There is no automatic reconnect or device selection; applications decide those policies. To share custom simulation settings, pass an explicit `simulator`; its owner closes it separately.

## Visual preview

```ts
import { createSimulator } from '@orbit/sdk/simulation';
import { createPreview } from '@orbit/host/preview';

const simulator = createSimulator();
const preview = createPreview({ simulator }); // Default port 4402.
console.log(preview.url);
const puck = await orbit.connect({ target: simulator.target, control: ['screen'] });
```

Open the printed URL to see scenes from your program and inject virtual touchscreen, talk button and mute switch events. This is a developer tool; it does not dictate those controls' behavior. It creates an ephemeral local credential, starts no external service, and does not take the screen grant. `preview.close()` stops the server; also close your puck and simulator.

Build before starting: the host package includes a bundled browser renderer. Use `bun --watch your-program.ts` during iteration. There is no image generation or firmware update in this path.
