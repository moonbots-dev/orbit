#include "boot_frame.h"
#include "display.h"
#include "orbit_wire.h"
#include "sensors.h"
#include "vector_scene.h"
#include <Adafruit_GC9A01A.h>
#include <SPI.h>
#include <esp_timer.h>

SET_LOOP_TASK_STACK_SIZE(32 * 1024);

// Waveshare ESP32-S3-Touch-LCD-1.28: CH343 UART, GC9A01A, CST816 and QMI8658.
// No Wi-Fi, BLE, microphone, persistent settings or user-program execution.
Adafruit_GC9A01A lcd(9, 8, 14);
orbitwire::Decoder decoder;
DisplayFrames display;
orbitvector::Scene vectorScene;
std::vector<uint8_t> vectorUpload;
uint32_t vectorUploadId = 0, vectorUploadSize = 0, vectorUploadCRC = 0, vectorUploadAt = 0;
uint32_t renderUs = 0, vectorBytes = 0;
void pollInputs();
void cancelVector() {
  vectorUpload.clear();
  vectorUploadId = 0;
}
bool applyVector(const uint8_t *bytes, size_t size) {
  uint32_t start = micros();
  if (!vectorScene.apply(bytes, size, display.stagingPixels(), pollInputs, micros))
    return false;
  renderUs = micros() - start;
  vectorBytes = size;
  if (vectorScene.unchanged) {
    display.acknowledgeUnchanged(vectorScene.id);
    return true;
  }
  return display.presentRegion(vectorScene.id, lcd, vectorScene.dirty.left, vectorScene.dirty.top,
                               vectorScene.dirty.right, vectorScene.dirty.bottom);
}
Sensors sensors;
char deviceId[32], bootId[64];
uint32_t inputSequence = 0, droppedInputs = 0, lastHeartbeat = 0, lastHost = 0;
uint8_t brightness = 255;
bool displayReady = false;

void reply(uint32_t seq, bool ok, const char *fields = "") {
  char json[900];
  snprintf(json, sizeof(json), "{\"ok\":%s%s}", ok ? "true" : "false", fields);
  orbitwire::send(0x82, seq, json);
}
void hello(uint32_t seq) {
  char json[900];
  snprintf(json, sizeof(json),
           "{\"ok\":true,\"id\":\"%s\",\"bootId\":\"%s\",\"firmware\":\"orbit-usb-1.1.0\","
           "\"width\":240,\"height\":240,\"baud\":921600,\"touchId\":%u,\"imuId\":%u,"
           "\"psramBytes\":%u,\"displayReady\":%s,\"renderer\":\"vector-v1\",\"imuHz\":%u,"
           "\"touchHz\":%u,\"brightness\":%u}",
           deviceId, bootId, sensors.touchId, sensors.imuId, ESP.getPsramSize(),
           displayReady ? "true" : "false", sensors.imuHz, sensors.touchHz, brightness);
  orbitwire::send(0x81, seq, json);
}
void stats(uint32_t seq, uint8_t kind = 0x82) {
  char json[900];
  snprintf(json, sizeof(json),
           "{\"ok\":true,\"bootId\":\"%s\",\"deviceTimeUs\":%llu,\"clearUs\":%lu,\"drawUs\":%lu,"
           "\"convertUs\":%lu,\"renderUs\":%lu,\"sceneCRC\":%lu,\"vectorBytes\":%lu,"
           "\"framesApplied\":%lu,\"lastFrameId\":%lu,\"frameCRC\":%lu,\"lcdTransferUs\":%lu,"
           "\"changedPixels\":%lu,\"wireErrors\":%lu,\"sensorErrors\":%lu,\"droppedInputs\":%lu,"
           "\"imuSamples\":%lu,\"touchEvents\":%lu,\"imuHz\":%u,\"touchHz\":%u,\"brightness\":%u}",
           bootId, (unsigned long long)esp_timer_get_time(), vectorScene.clearUs,
           vectorScene.drawUs, vectorScene.convertUs, renderUs, vectorScene.checksum, vectorBytes,
           display.applied, display.lastId, display.lastCRC, display.transferUs,
           display.changedPixels, decoder.errors, sensors.errors, droppedInputs, sensors.imuSamples,
           sensors.touchEvents, sensors.imuHz, sensors.touchHz, brightness);
  orbitwire::send(kind, seq, json, kind == 0x91);
}
void input(const char *fields) {
  if (millis() - lastHost > 3000)
    return;
  char json[768];
  uint32_t seq = ++inputSequence;
  snprintf(json, sizeof(json),
           "{%s,\"sequence\":%lu,\"bootId\":\"%s\",\"deviceTimeUs\":%llu,\"source\":\"physical\"}",
           fields, seq, bootId, (unsigned long long)esp_timer_get_time());
  if (!orbitwire::send(0x90, seq, json, true))
    droppedInputs++;
}
void pollInputs() { sensors.poll(input); }
void command(uint8_t kind, uint32_t seq, const uint8_t *payload, size_t size) {
  lastHost = millis();
  switch (kind) {
  case 1:
    if (!size) {
      hello(seq);
      return;
    }
    break;
  case 2:
    if (size == 8 && display.start(orbitwire::u32(payload), orbitwire::u32(payload + 4))) {
      reply(seq, true);
      return;
    }
    break;
  case 3:
    if (size >= 12 && display.append(orbitwire::u32(payload), orbitwire::u32(payload + 4),
                                     payload + 8, size - 8)) {
      reply(seq, true);
      return;
    }
    break;
  case 4:
    if (size == 4 && display.commit(orbitwire::u32(payload), lcd)) {
      stats(seq);
      return;
    }
    break;
  case 5:
    if (size == 4) {
      display.cancel(orbitwire::u32(payload));
      cancelVector();
      reply(seq, true);
      return;
    }
    break;
  case 6:
    if (size == 5) {
      uint16_t imuHz = orbitwire::u16(payload), touchHz = orbitwire::u16(payload + 2);
      if (imuHz <= 100 && touchHz >= 10 && touchHz <= 120) {
        sensors.imuHz = imuHz;
        sensors.touchHz = touchHz;
        brightness = payload[4];
        ledcWrite(2, brightness);
        hello(seq);
        return;
      }
    }
    break;
  case 7:
    if (!size) {
      stats(seq);
      return;
    }
    break;
  case 8:
    if (applyVector(payload, size)) {
      cancelVector();
      stats(seq);
      return;
    }
    break;
  case 9:
    if (size == 12 && orbitwire::u32(payload) &&
        orbitwire::u32(payload + 4) <= orbitvector::MAX_TRANSACTION &&
        orbitwire::u32(payload + 4) >= 20) {
      cancelVector();
      vectorUploadId = orbitwire::u32(payload);
      vectorUploadSize = orbitwire::u32(payload + 4);
      vectorUploadCRC = orbitwire::u32(payload + 8);
      vectorUpload.reserve(vectorUploadSize);
      vectorUploadAt = millis();
      reply(seq, true);
      return;
    }
    break;
  case 10:
    if (size > 8 && vectorUploadId && orbitwire::u32(payload) == vectorUploadId &&
        orbitwire::u32(payload + 4) == vectorUpload.size() &&
        vectorUpload.size() + size - 8 <= vectorUploadSize) {
      vectorUpload.insert(vectorUpload.end(), payload + 8, payload + size);
      vectorUploadAt = millis();
      reply(seq, true);
      return;
    }
    break;
  case 11:
    if (size == 4 && vectorUploadId && orbitwire::u32(payload) == vectorUploadId &&
        vectorUpload.size() == vectorUploadSize &&
        orbitwire::u32(vectorUpload.data()) == vectorUploadId &&
        orbitwire::crc32(vectorUpload.data(), vectorUpload.size()) == vectorUploadCRC) {
      bool ok = applyVector(vectorUpload.data(), vectorUpload.size());
      cancelVector();
      if (ok) {
        stats(seq);
        return;
      }
    }
    break;
  }
  reply(seq, false, ",\"code\":\"invalid-command\"");
}
void setup() {
  Serial.setRxBufferSize(16384);
  Serial.setTxBufferSize(8192);
  Serial.begin(921600);
  uint64_t chip = ESP.getEfuseMac();
  snprintf(deviceId, sizeof(deviceId), "esp32-%012llx", (unsigned long long)chip);
  snprintf(bootId, sizeof(bootId), "%s-%08lx", deviceId, esp_random());
  SPI.begin(10, 12, 11, 9);
  lcd.begin(40000000);
  lcd.setRotation(0);
  lcd.fillScreen(0);
  ledcAttach(2, 20000, 8);
  ledcWrite(2, brightness);
  displayReady = display.beginMemory();
  uint32_t *vectorBuffer =
      static_cast<uint32_t *>(heap_caps_malloc(240 * 240 * 4, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  displayReady = displayReady && vectorScene.begin(vectorBuffer);
  if (displayReady) {
    display.start(0, BOOT_FRAME_CRC);
    display.append(0, 0, (const uint8_t *)BOOT_FRAME_RLE, sizeof(BOOT_FRAME_RLE));
    display.commit(0, lcd);
  }
  sensors.begin();
  hello(0);
}
void loop() {
  uint32_t start = micros();
  while (Serial.available() && micros() - start < 3000)
    decoder.push(Serial.read(), command);
  sensors.poll(input);
  display.expire();
  if (vectorUploadId && millis() - vectorUploadAt > 5000)
    cancelVector();
  if (millis() - lastHeartbeat >= 1000) {
    lastHeartbeat = millis();
    stats(0, 0x91);
  }
  delay(1);
}
