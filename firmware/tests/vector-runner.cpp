#include "../orbit_puck/pixel_crc.h"
#include "../orbit_puck/vector_scene.h"
#include <fstream>
#include <iostream>
#include <iterator>
int main(int argc, char **argv) {
  std::vector<uint32_t> argb(57600);
  std::vector<uint16_t> pixels(57600, 0x1234);
  PixelCRC frameCRC;
  frameCRC.begin(0);
  for (unsigned y = 0; y < 240; y++)
    frameCRC.set(y, orbitvector::crc32(reinterpret_cast<uint8_t *>(pixels.data() + y * 240), 480));
  orbitvector::Scene scene;
  if (!scene.begin(argb.data()))
    return 2;
  for (int i = 1; i + 2 < argc; i += 3) {
    std::ifstream input(argv[i], std::ios::binary);
    std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(input)), {});
    auto before = pixels;
    auto id = scene.id, crc = scene.checksum;
    bool ok = scene.apply(bytes.data(), bytes.size(), pixels.data());
    bool expected = std::string(argv[i + 2]) == "yes";
    if (ok != expected || (!ok && (before != pixels || id != scene.id || crc != scene.checksum))) {
      std::cerr << "Unexpected result: " << argv[i] << " accepted=" << ok << "\n";
      return 3;
    }
    if (ok) {
      for (int y = scene.dirty.top; y < scene.dirty.bottom; y++)
        frameCRC.set(y,
                     orbitvector::crc32(reinterpret_cast<uint8_t *>(pixels.data() + y * 240), 480));
      if (frameCRC.value() !=
          orbitvector::crc32(reinterpret_cast<uint8_t *>(pixels.data()), 115200)) {
        std::cerr << "Pixel CRC mismatch";
        return 4;
      }
      std::ofstream output(argv[i + 1], std::ios::binary);
      output.write(reinterpret_cast<char *>(pixels.data()), pixels.size() * 2);
    }
    std::cout << argv[i] << " " << ok << " " << scene.id << "\n";
  }
}
