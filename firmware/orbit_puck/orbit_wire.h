#pragma once
#include <Arduino.h>

namespace orbitwire {
constexpr size_t MAX_PAYLOAD = 4096;
inline uint16_t u16(const uint8_t *p) { return p[0] | uint16_t(p[1]) << 8; }
inline uint32_t u32(const uint8_t *p) { return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24; }
inline void put16(uint8_t *p, uint16_t v) { p[0] = v; p[1] = v >> 8; }
inline void put32(uint8_t *p, uint32_t v) { for (int i = 0; i < 4; i++) p[i] = v >> (8 * i); }
inline uint32_t crc32(const uint8_t *p, size_t size) {
  static uint32_t table[256]; static bool ready = false;
  if (!ready) { for (uint32_t i = 0; i < 256; i++) { uint32_t c = i; for (int b = 0; b < 8; b++) c = (c >> 1) ^ ((c & 1) ? 0xedb88320 : 0); table[i] = c; } ready = true; }
  uint32_t crc = 0xffffffff;
  for (size_t i = 0; i < size; i++) crc = (crc >> 8) ^ table[(crc ^ p[i]) & 255];
  return crc ^ 0xffffffff;
}

inline bool send(uint8_t kind, uint32_t sequence, const char *json, bool droppable = false) {
  uint8_t raw[1024], encoded[2050];
  size_t n = strlen(json); if (n > 1012) return false;
  raw[0] = 1; raw[1] = kind; put32(raw + 2, sequence); put16(raw + 6, n);
  memcpy(raw + 8, json, n); put32(raw + n + 8, crc32(raw, n + 8));
  size_t size = 0; encoded[size++] = 0x7e;
  for (size_t i = 0; i < n + 12; i++) {
    if (raw[i] == 0x7e || raw[i] == 0x7d) { encoded[size++] = 0x7d; encoded[size++] = raw[i] ^ 0x20; }
    else encoded[size++] = raw[i];
  }
  encoded[size++] = 0x7e;
  if (droppable && Serial.availableForWrite() < int(size)) return false;
  return Serial.write(encoded, size) == size;
}

class Decoder {
  uint8_t buffer[MAX_PAYLOAD + 12]; size_t length = 0;
  bool active = false, escaped = false, discard = false;
public:
  uint32_t errors = 0;
  template <typename Handler> void push(uint8_t byte, Handler handler) {
    if (byte == 0x7e) {
      if (active && !discard && (length || escaped)) {
        if (escaped || length < 12 || buffer[0] != 1 || u16(buffer + 6) != length - 12 || u32(buffer + length - 4) != crc32(buffer, length - 4)) errors++;
        else handler(buffer[1], u32(buffer + 2), buffer + 8, length - 12);
      }
      active = true; length = 0; escaped = false; discard = false; return;
    }
    if (!active || discard) return;
    if (!escaped && byte == 0x7d) { escaped = true; return; }
    if (length == sizeof(buffer)) { errors++; discard = true; return; }
    buffer[length++] = escaped ? byte ^ 0x20 : byte; escaped = false;
  }
};
}
