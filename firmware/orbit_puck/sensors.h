#pragma once
#include <Wire.h>

class Sensors {
  uint8_t imuAddress = 0;
  bool contact = false, bootHeld = false;
  uint16_t x = 120, y = 120;
  uint32_t lastTouchPoll = 0, lastImuPoll = 0, lastTouchRead = 0;
  bool read(uint8_t address, uint8_t reg, uint8_t *data, uint8_t n) {
    Wire.beginTransmission(address); Wire.write(reg);
    if (Wire.endTransmission(false) != 0 || Wire.requestFrom(address, n) != n) { errors++; return false; }
    for (int i = 0; i < n; i++) data[i] = Wire.read(); return true;
  }
  bool write(uint8_t address, uint8_t reg, uint8_t value) {
    Wire.beginTransmission(address); Wire.write(reg); Wire.write(value); return Wire.endTransmission() == 0;
  }
public:
  uint8_t touchId = 0, imuId = 0;
  uint16_t imuHz = 50, touchHz = 80;
  uint32_t errors = 0, imuSamples = 0, touchEvents = 0;
  void begin() {
    Wire.begin(6, 7); Wire.setClock(400000); Wire.setTimeOut(10);
    pinMode(13, OUTPUT); digitalWrite(13, LOW); delay(10); digitalWrite(13, HIGH); delay(100);
    read(0x15, 0xA7, &touchId, 1);
    write(0x15, 0xFE, 0xFF); // CST816: disable auto-sleep.
    write(0x15, 0xFA, 0x60); // Touch and change interrupts; no gesture mapping.
    pinMode(5, INPUT_PULLUP); pinMode(0, INPUT_PULLUP);
    for (uint8_t address : {uint8_t(0x6a), uint8_t(0x6b)}) {
      uint8_t id = 0;
      if (read(address, 0, &id, 1) && id == 5) { imuAddress = address; imuId = id; break; }
    }
    if (imuId) {
      // QMI8658: register auto-increment, +/-8g, +/-512 deg/s, 250 Hz ODR.
      bool ok = write(imuAddress, 8, 0) && write(imuAddress, 2, 0x60) && write(imuAddress, 3, 0x25) && write(imuAddress, 4, 0x45) && write(imuAddress, 6, 0) && write(imuAddress, 8, 3);
      if (!ok) imuId = 0;
    }
  }
  template <typename Emit> void poll(Emit emit) {
    uint32_t now = millis(); char payload[400];
    bool boot = digitalRead(0) == LOW;
    if (boot != bootHeld) { bootHeld = boot; snprintf(payload, sizeof(payload), "\"type\":\"button\",\"id\":\"boot\",\"phase\":\"%s\"", boot ? "down" : "up"); emit(payload); }
    if (now - lastTouchPoll >= 1000 / touchHz) {
      lastTouchPoll = now; uint8_t data[6];
      if (read(0x15, 1, data, 6)) {
        lastTouchRead = now;
        bool down = (data[1] & 15) == 1;
        uint16_t nextX = ((data[2] & 15) << 8) | data[3], nextY = ((data[4] & 15) << 8) | data[5];
        if (nextX > 239 || nextY > 239) { nextX = x; nextY = y; }
        if (down != contact || (down && (nextX != x || nextY != y))) {
          const char *phase = down ? (contact ? "move" : "down") : "up";
          x = nextX; y = nextY; contact = down; touchEvents++;
          snprintf(payload, sizeof(payload), "\"type\":\"touch\",\"phase\":\"%s\",\"contactId\":0,\"position\":{\"x\":%u,\"y\":%u}", phase, x, y); emit(payload);
        }
      } else if (contact && now - lastTouchRead > 200) {
        contact = false; touchEvents++;
        snprintf(payload, sizeof(payload), "\"type\":\"touch\",\"phase\":\"cancel\",\"contactId\":0,\"reason\":\"device-cancelled\""); emit(payload);
      }
    }
    if (imuId && imuHz && now - lastImuPoll >= 1000 / imuHz) {
      lastImuPoll = now; uint8_t data[12];
      if (read(imuAddress, 0x35, data, 12)) {
        float values[6];
        for (int i = 0; i < 6; i++) {
          int16_t raw = int16_t(uint16_t(data[i * 2]) | uint16_t(data[i * 2 + 1]) << 8);
          values[i] = i < 3 ? raw * (9.80665f / 4096.f) : raw * (0.01745329252f / 64.f);
        }
        imuSamples++;
        snprintf(payload, sizeof(payload), "\"type\":\"imu\",\"acceleration\":[%.5f,%.5f,%.5f],\"angularVelocity\":[%.6f,%.6f,%.6f]", values[0], values[1], values[2], values[3], values[4], values[5]); emit(payload);
      }
    }
  }
};
