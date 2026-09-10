#pragma once
#include <cstdint>
// CRC32 concatenation for fixed 480-byte RGB565 rows. Recompute only changed rows;
// combining their CRCs preserves the checksum of the complete framebuffer.
class PixelCRC {
  uint32_t rows[240] = {}, shift[32] = {};

public:
  void begin(uint32_t emptyRowCRC) {
    for (unsigned i = 0; i < 240; i++)
      rows[i] = emptyRowCRC;
    for (unsigned i = 0; i < 32; i++) {
      uint32_t c = uint32_t(1) << i;
      for (unsigned k = 0; k < 480 * 8; k++)
        c = (c >> 1) ^ ((c & 1) ? 0xedb88320 : 0);
      shift[i] = c;
    }
  }
  void set(unsigned row, uint32_t crc) { rows[row] = crc; }
  uint32_t value() const {
    uint32_t crc = 0;
    for (unsigned y = 0; y < 240; y++) {
      uint32_t shifted = 0, v = crc;
      unsigned i = 0;
      while (v) {
        if (v & 1)
          shifted ^= shift[i];
        v >>= 1;
        i++;
      }
      crc = shifted ^ rows[y];
    }
    return crc;
  }
};
