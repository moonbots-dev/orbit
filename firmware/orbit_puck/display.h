#pragma once
#include "orbit_wire.h"
#include "pixel_crc.h"
#include <Adafruit_GC9A01A.h>
#include <esp_heap_caps.h>

class DisplayFrames {
  uint16_t *front = nullptr, *back = nullptr;
  uint32_t pendingId = 0, expectedCRC = 0, encodedOffset = 0, pixelOffset = 0;
  bool active = false;
  PixelCRC pixelCRC;

public:
  uint32_t applied = 0, lastId = 0, lastCRC = 0, transferUs = 0, changedPixels = 0, lastDataAt = 0;
  bool beginMemory() {
    front = (uint16_t *)heap_caps_calloc(57600, 2, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    back = (uint16_t *)heap_caps_calloc(57600, 2, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    uint8_t emptyRow[480] = {};
    pixelCRC.begin(orbitwire::crc32(emptyRow, sizeof(emptyRow)));
    return front && back;
  }
  bool start(uint32_t id, uint32_t crc) {
    if (!front || !back)
      return false;
    pendingId = id;
    expectedCRC = crc;
    encodedOffset = pixelOffset = 0;
    active = true;
    lastDataAt = millis();
    return true;
  }
  void cancel(uint32_t id = 0) {
    if (!id || id == pendingId)
      active = false;
  }
  bool append(uint32_t id, uint32_t offset, const uint8_t *data, size_t size) {
    if (!active || id != pendingId || offset != encodedOffset || size % 4)
      return false;
    // Validate the entire chunk before modifying the staging framebuffer.
    uint32_t next = pixelOffset;
    for (size_t i = 0; i < size; i += 4) {
      uint16_t count = orbitwire::u16(data + i);
      if (!count || next + count > 57600) {
        active = false;
        return false;
      }
      next += count;
    }
    for (size_t i = 0; i < size; i += 4) {
      uint16_t count = orbitwire::u16(data + i), color = orbitwire::u16(data + i + 2);
      for (uint16_t j = 0; j < count; j++)
        back[pixelOffset++] = color;
    }
    encodedOffset += size;
    lastDataAt = millis();
    return true;
  }
  bool commit(uint32_t id, Adafruit_GC9A01A &lcd) {
    if (!active || id != pendingId || pixelOffset != 57600)
      return false;
    active = false;
    uint32_t crc = orbitwire::crc32((uint8_t *)back, 115200);
    if (crc != expectedCRC)
      return false;
    return presentRegion(id, lcd, 0, 0, 240, 240);
  }
  uint16_t *stagingPixels() { return back; }
  bool presentRegion(uint32_t id, Adafruit_GC9A01A &lcd, int x0, int y0, int x1, int y1) {
    if (!front || !back)
      return false;
    active = false;
    uint32_t start = micros();
    changedPixels = 0;
    uint16_t oldRow[240], newRow[240];
    lcd.startWrite();
    for (int y = y0; y < y1; y++) {
      memcpy(oldRow, front + y * 240, sizeof(oldRow));
      memcpy(newRow, oldRow, sizeof(newRow));
      memcpy(newRow + x0, back + y * 240 + x0, (x1 - x0) * 2);
      int left = x0, right = x1 - 1;
      while (left < x1 && oldRow[left] == newRow[left])
        left++;
      if (left == x1)
        continue;
      while (right > left && oldRow[right] == newRow[right])
        right--;
      int width = right - left + 1;
      lcd.setAddrWindow(left, y, width, 1);
      lcd.writePixels(newRow + left, width);
      memcpy(front + y * 240 + left, newRow + left, width * 2);
      pixelCRC.set(y, orbitwire::crc32(reinterpret_cast<uint8_t *>(newRow), sizeof(newRow)));
      changedPixels += width;
    }
    lcd.endWrite();
    transferUs = micros() - start;
    applied++;
    lastId = id;
    lastCRC = pixelCRC.value();
    return true;
  }
  void acknowledgeUnchanged(uint32_t id) {
    lastId = id;
    applied++;
    transferUs = changedPixels = 0;
  }
  void expire() {
    if (active && millis() - lastDataAt > 5000)
      active = false;
  }
};
