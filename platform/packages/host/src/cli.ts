import { createHost } from './index.js';
const token = process.env.ORBIT_HOST_TOKEN;
if (!token)
  throw new Error(
    'Set ORBIT_HOST_TOKEN to a local credential of at least 16 characters.',
  );
const port = Number(process.env.ORBIT_HOST_PORT ?? 4401);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid ORBIT_HOST_PORT.');
const host = createHost({ token, port });
console.log(`Orbit simulator host: ${host.endpoint}`);
console.log(
  'Credentials are read from ORBIT_HOST_TOKEN; no physical device is opened.',
);
process.once('SIGINT', () => {
  void host.close();
});
process.once('SIGTERM', () => {
  void host.close();
});
