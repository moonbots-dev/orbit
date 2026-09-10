# Firmware source

The Waveshare ESP32-S3-Touch-LCD-1.28 firmware in this repository is the existing `orbit-usb-1.1.0` baseline. Desktop/simulator development does not require it or modify it.

The sketch requires the Espressif Arduino ESP32 core, Adafruit GC9A01A and Adafruit GFX libraries. Its board profile uses ESP32-S3, 16 MB flash and enabled PSRAM. The sketch initializes the Waveshare-specific display, touch, IMU and USB-UART pins; it is not a generic ESP32 board image. Review those pins and your board revision before building or flashing.

The vector renderer can be tested on a Mac with `bash firmware/tests/verify-vector.sh`. Flashing is deliberately separate from the program runner. Use your Arduino tooling for an explicit hardware installation after checking the board settings. No automatic flashing command runs during install, build or simulation.
