// Node-only adapter around serialport's public binding interface.
import {
  DarwinBinding,
  type DarwinBindingInterface,
} from '@serialport/bindings-cpp';
import { read } from 'node:fs';
import { promisify } from 'node:util';
const readAsync = promisify(read);

export const nativeBinding: DarwinBindingInterface = {
  list: () => DarwinBinding.list(),
  async open(options) {
    if (process.platform !== 'darwin')
      throw new Error(
        'This physical adapter has only been brought up on macOS.',
      );
    const native = await DarwinBinding.open(options);
    if (process.platform === 'darwin' && 'fd' in native) {
      // VMIN=0 avoids CH343's long read latency, but the stock binding spins on
      // zero-byte reads. Yield for 2 ms when empty instead of occupying a core.
      native.read = async (buffer: Buffer, offset: number, length: number) => {
        while (native.isOpen && native.fd !== null) {
          try {
            const result = await readAsync(
              native.fd,
              buffer,
              offset,
              length,
              null,
            );
            if (result.bytesRead) return result;
          } catch (error) {
            if (
              !['EAGAIN', 'EWOULDBLOCK', 'EINTR'].includes(
                (error as NodeJS.ErrnoException).code ?? '',
              )
            )
              throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
        throw Object.assign(new Error('Serial port closed.'), {
          canceled: true,
        });
      };
    }
    return native;
  },
};
