// Bun's rejects matchers are typed void; await still waits for runtime assertions.
/* oxlint-disable typescript/await-thenable */
import { expect, test } from 'bun:test';
import orbit from '@orbit/sdk';
import { createHost } from '@orbit/host';

const token = 'orbit-host-test-credential';
test('host requires credentials and shares one device with exclusive screen ownership', async () => {
  const host = createHost({ token, port: 0 });
  const config = { endpoint: host.endpoint, credentials: async () => token };
  let controller: Awaited<ReturnType<typeof orbit.connect>> | undefined;
  let observer: Awaited<ReturnType<typeof orbit.connect>> | undefined;
  try {
    expect((await fetch(`${host.endpoint}/devices`)).status).toBe(401);
    expect(
      (
        await fetch(`${host.endpoint}/devices`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Origin: 'https://untrusted.example',
          },
        })
      ).status,
    ).toBe(403);
    const devices = await orbit.discover({ host: config });
    expect(devices).toHaveLength(1);
    expect(devices[0].source).toBe('simulated');
    const target = { host: config, deviceId: devices[0].id };
    await expect(
      orbit.connect({
        target: {
          ...target,
          host: {
            endpoint: host.endpoint,
            credentials: async () => 'wrong-credential',
          },
        },
        keepAlive: false,
      }),
    ).rejects.toMatchObject({ code: 'connection-lost' });
    controller = await orbit.connect({
      target,
      control: ['screen'],
      keepAlive: false,
    });
    observer = await orbit.connect({ target, keepAlive: false });
    await expect(
      orbit.connect({ target, control: ['screen'], keepAlive: false }),
    ).rejects.toMatchObject({ code: 'busy' });
    const frame = new Promise((resolve) =>
      observer!.screen.on('frame', resolve),
    );
    await controller.screen.draw((frame) => {
      frame.clear('#000000');
      frame.circle({ center: frame.center, radius: 14, fill: '#ffffff' });
    });
    expect(await frame).toMatchObject({
      scene: { commands: [{ op: 'circle', value: { radius: 14 } }] },
    });
    const touch = new Promise((resolve) =>
      controller!.touch.on('down', resolve),
    );
    host.simulator.input.touch({ phase: 'down', position: { x: 30, y: 40 } });
    expect(await touch).toMatchObject({
      phase: 'down',
      position: { x: 30, y: 40 },
      source: 'simulated',
    });
    await controller.close();
    controller = await orbit.connect({
      target,
      control: ['screen'],
      keepAlive: false,
    });
    await controller.screen.draw((frame) => {
      frame.clear('#ffffff');
    });
  } finally {
    await controller?.close();
    await observer?.close();
    await host.close();
  }
}, 10_000);

test('stopping the host rejects open sessions and cancels held input', async () => {
  const host = createHost({ token, port: 0 });
  const device = await orbit.connect({
    target: {
      host: { endpoint: host.endpoint, credentials: async () => token },
      deviceId: host.simulator.info.id,
    },
    keepAlive: false,
  });
  try {
    await host.close();
    await expect(device.closed).rejects.toMatchObject({
      code: 'connection-lost',
    });
    expect(device.status).toBe('closed');
  } finally {
    await device.close();
  }
});

test('a supplied device is brokered with its own identity and bootstrap is restricted to the local lab', async () => {
  const { createSimulator } = await import('@orbit/sdk/simulation');
  const simulator = createSimulator();
  const info = {
    ...simulator.info,
    id: 'physical-test-double',
    source: 'physical' as const,
    firmwareVersion: 'test',
  };
  const device = {
    info,
    target: {
      ...simulator.target,
      async open(options: Parameters<typeof simulator.target.open>[0]) {
        return { ...(await simulator.target.open(options)), info };
      },
    },
  };
  const host = createHost({
    token,
    port: 0,
    device,
    localBootstrap: true,
    origins: ['http://localhost:3000'],
  });
  try {
    expect((await fetch(`${host.endpoint}/bootstrap`)).status).toBe(403);
    expect(
      (
        await fetch(`${host.endpoint}/bootstrap`, {
          headers: { Origin: 'https://untrusted.example' },
        })
      ).status,
    ).toBe(403);
    const bootstrap = await fetch(`${host.endpoint}/bootstrap`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(bootstrap.headers.get('Cache-Control')).toBe('no-store');
    expect(await bootstrap.json()).toEqual({ token, deviceId: info.id });
    expect(await (await fetch(`${host.endpoint}/health`)).json()).toMatchObject(
      { source: 'physical', physicalDeviceOpened: true },
    );
    expect(
      (await fetch(`${host.endpoint}/preview/input`, { method: 'POST' }))
        .status,
    ).toBe(405);
    const puck = await orbit.connect({
      target: {
        host: { endpoint: host.endpoint, credentials: async () => token },
        deviceId: info.id,
      },
      control: ['screen'],
      keepAlive: false,
    });
    try {
      expect(puck.info.source).toBe('physical');
      await puck.screen.draw((frame) => frame.clear('#000000'));
      expect(simulator.snapshot().scene?.background).toBe('#000000');
    } finally {
      await puck.close();
    }
  } finally {
    await host.close();
    await simulator.close();
  }
});
