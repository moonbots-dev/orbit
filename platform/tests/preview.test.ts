import { expect, test } from 'bun:test';
import orbit from '@orbit/sdk';
import { createSimulator } from '@orbit/sdk/simulation';
import { createPreview } from '@orbit/host/preview';

test('standalone preview serves its bundle and routes authenticated virtual inputs', async () => {
  const simulator = createSimulator();
  const preview = createPreview({ simulator, port: 0 });
  const puck = await orbit.connect({
    target: simulator.target,
    control: ['screen'],
    keepAlive: false,
  });
  try {
    const response = await fetch(preview.url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    );
    const html = await response.text();
    const config = JSON.parse(
      html.match(/id="orbit-config" type="application\/json">([^<]+)</)![1],
    );
    const bundle = await fetch(`${preview.url}/preview.js`);
    expect(bundle.status).toBe(200);
    expect((await bundle.text()).length).toBeGreaterThan(1000);
    expect((await fetch(`${preview.url}/preview/snapshot`)).status).toBe(401);
    expect(
      (
        await fetch(preview.url, {
          headers: { Origin: 'https://unrelated.example' },
        })
      ).status,
    ).toBe(403);
    const headers = {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      Origin: preview.url,
    };
    let touched = false;
    puck.touch.on('down', (event) => {
      touched = event.position.x === 100;
    });
    const inject = (event: object) =>
      fetch(`${preview.url}/preview/input`, {
        method: 'POST',
        headers,
        body: JSON.stringify(event),
      });
    expect(
      (
        await inject({
          type: 'touch',
          phase: 'down',
          position: { x: 100, y: 100 },
        })
      ).status,
    ).toBe(200);
    expect(touched).toBe(true);
    expect((await inject({ type: 'cancel' })).status).toBe(200);
    expect(puck.touch.contacts).toEqual([]);
    expect(
      (
        await inject({
          type: 'touch',
          phase: 'move',
          position: { x: 100, y: 100 },
        })
      ).status,
    ).toBe(400);
    await puck.screen.draw((frame) => {
      frame.clear('#ffffff');
    });
    const snapshot = await fetch(`${preview.url}/preview/snapshot`, {
      headers,
    }).then((r) => r.json());
    expect(snapshot.scene.background).toBe('#ffffff');
  } finally {
    await puck.close();
    await preview.close();
    await simulator.close();
  }
});
