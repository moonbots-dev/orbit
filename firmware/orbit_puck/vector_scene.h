#pragma once
#include "src/plutovg/plutovg.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

namespace orbitvector {
static constexpr size_t MAX_SCENE = 65536, MAX_TRANSACTION = 131072;
inline uint32_t crcStep(uint32_t crc, const uint8_t *bytes, size_t size) {
  static uint32_t table[256];
  static bool ready = false;
  if (!ready) {
    for (unsigned i = 0; i < 256; i++) {
      uint32_t c = i;
      for (int k = 0; k < 8; k++)
        c = (c >> 1) ^ ((c & 1) ? 0xedb88320 : 0);
      table[i] = c;
    }
    ready = true;
  }
  for (size_t i = 0; i < size; i++)
    crc = table[(crc ^ bytes[i]) & 255] ^ (crc >> 8);
  return crc;
}
inline uint32_t crc32(const uint8_t *data, size_t n) {
  return crcStep(0xffffffff, data, n) ^ 0xffffffff;
}
struct Reader {
  const uint8_t *data;
  size_t size, at = 0;
  bool ok = true;
  uint8_t u8() {
    if (at >= size) {
      ok = false;
      return 0;
    }
    return data[at++];
  }
  uint16_t u16() {
    uint16_t a = u8(), b = u8();
    return a | (b << 8);
  }
  uint32_t u32() {
    uint32_t a = u16(), b = u16();
    return a | (b << 16);
  }
  float f32() {
    uint32_t v = u32();
    float f;
    memcpy(&f, &v, 4);
    if (!std::isfinite(f) || fabsf(f) > 1e6f)
      ok = false;
    return f;
  }
  int32_t signedVar() {
    uint32_t n = 0;
    for (int i = 0; i < 5; i++) {
      uint8_t b = u8();
      if (i == 4 && b > 15) {
        ok = false;
        return 0;
      }
      n |= uint32_t(b & 127) << (7 * i);
      if (!(b & 128))
        return int32_t((n >> 1) ^ uint32_t(-int32_t(n & 1)));
    }
    ok = false;
    return 0;
  }
  float coord() {
    float v = signedVar() / 16.f;
    if (fabsf(v) > 1e6f)
      ok = false;
    return v;
  }
  plutovg_color_t color() {
    float r = u8() / 255.f, g = u8() / 255.f, b = u8() / 255.f, a = u8() / 255.f;
    return {r, g, b, a};
  }
  bool done() const { return ok && at == size; }
};
struct Bounds {
  int left = 240, top = 240, right = 0, bottom = 0;
  void add(const Bounds &b) {
    left = std::min(left, b.left);
    top = std::min(top, b.top);
    right = std::max(right, b.right);
    bottom = std::max(bottom, b.bottom);
  }
  bool empty() const { return left >= right || top >= bottom; }
};
class Scene {
  std::vector<std::vector<uint8_t>> records;
  std::vector<Bounds> recordBounds;
  uint8_t background[4] = {0, 0, 0, 255};
  plutovg_surface_t *surface = nullptr;
  uint32_t *argb = nullptr;
  static bool geometry(Reader &r, plutovg_canvas_t *c) {
    const auto rule = r.u8();
    unsigned groups = r.u16(), segments = 0;
    int64_t x = 0, y = 0;
    if (rule > 1 || !groups || groups > 2048)
      return false;
    if (c)
      plutovg_canvas_set_fill_rule(c,
                                   rule ? PLUTOVG_FILL_RULE_EVEN_ODD : PLUTOVG_FILL_RULE_NON_ZERO);
    auto point = [&]() {
      x += r.signedVar();
      y += r.signedVar();
      if (abs(x) > 16000000 || abs(y) > 16000000)
        r.ok = false;
      return plutovg_point_t{float(x) / 16.f, float(y) / 16.f};
    };
    for (unsigned i = 0; i < groups && r.ok; i++) {
      uint8_t kind = r.u8();
      if (i == 0 && kind != 1)
        return false;
      if (kind == 1) {
        auto p = point();
        if (c)
          plutovg_canvas_move_to(c, p.x, p.y);
        segments++;
      } else if (kind == 2) {
        unsigned n = r.u16();
        if (!n || segments + n > 2048)
          return false;
        segments += n;
        for (unsigned j = 0; j < n && r.ok; j++) {
          auto p = point();
          if (c)
            plutovg_canvas_line_to(c, p.x, p.y);
        }
      } else if (kind == 3) {
        auto a = point(), b = point();
        if (c)
          plutovg_canvas_quad_to(c, a.x, a.y, b.x, b.y);
        segments++;
      } else if (kind == 4) {
        auto a = point(), b = point(), d = point();
        if (c)
          plutovg_canvas_cubic_to(c, a.x, a.y, b.x, b.y, d.x, d.y);
        segments++;
      } else if (kind == 5) {
        if (c)
          plutovg_canvas_close_path(c);
        segments++;
      } else
        return false;
      if (segments > 2048)
        return false;
    }
    return r.ok;
  }
  static void measure(plutovg_canvas_t *c, Bounds &bounds, float padding = 0) {
    plutovg_rect_t box, mapped;
    plutovg_matrix_t matrix;
    plutovg_path_extents(plutovg_canvas_get_path(c), &box, false);
    box.x -= padding;
    box.y -= padding;
    box.w += padding * 2;
    box.h += padding * 2;
    plutovg_canvas_get_matrix(c, &matrix);
    plutovg_matrix_map_rect(&matrix, &box, &mapped);
    if (!std::isfinite(mapped.x) || !std::isfinite(mapped.y) || !std::isfinite(mapped.w) ||
        !std::isfinite(mapped.h)) {
      bounds.add({0, 0, 240, 240});
      return;
    }
    auto clamp = [](float n) { return int(std::max(0.f, std::min(240.f, n))); };
    bounds.add({clamp(floorf(mapped.x) - 2), clamp(floorf(mapped.y) - 2),
                clamp(ceilf(mapped.x + mapped.w) + 2), clamp(ceilf(mapped.y + mapped.h) + 2)});
  }
  static bool paint(Reader &r, plutovg_canvas_t *c, Bounds *bounds) {
    uint8_t flags = r.u8();
    if (flags < 1 || flags > 3)
      return false;
    if (flags & 1) {
      auto color = r.color();
      if (c) {
        if (bounds)
          measure(c, *bounds);
        else {
          plutovg_canvas_set_color(c, &color);
          plutovg_canvas_fill_preserve(c);
        }
      }
    }
    if (flags & 2) {
      auto color = r.color();
      float width = r.f32();
      if (width <= 0 || width > 4096)
        return false;
      if (c) {
        if (bounds)
          measure(c, *bounds, width * 5);
        else {
          plutovg_canvas_set_color(c, &color);
          plutovg_canvas_set_line_width(c, width);
          plutovg_canvas_stroke(c);
        }
      }
    }
    return r.ok;
  }
  static bool command(const std::vector<uint8_t> &bytes, plutovg_canvas_t *c, int &depth,
                      Bounds *bounds = nullptr) {
    Reader r{bytes.data(), bytes.size()};
    uint8_t op = r.u8();
    if (c) {
      plutovg_canvas_new_path(c);
      plutovg_canvas_set_fill_rule(c, PLUTOVG_FILL_RULE_NON_ZERO);
    }
    switch (op) {
    case 1:
    case 2: {
      float x = r.f32(), y = r.f32(), rx = r.f32(), ry = op == 1 ? rx : r.f32();
      if (rx < 0 || ry < 0)
        return false;
      if (c)
        plutovg_canvas_ellipse(c, x, y, rx, ry);
      if (!paint(r, c, bounds))
        return false;
      break;
    }
    case 3:
    case 14: {
      auto number = [&]() { return op == 14 ? r.coord() : r.f32(); };
      float x = number(), y = number(), w = number(), h = number(), radius = number();
      if (radius < 0)
        return false;
      if (w < 0) {
        x += w;
        w = -w;
      }
      if (h < 0) {
        y += h;
        h = -h;
      }
      radius = std::min(radius, std::min(w, h) / 2);
      if (c)
        plutovg_canvas_round_rect(c, x, y, w, h, radius, radius);
      if (!paint(r, c, bounds))
        return false;
      break;
    }
    case 4: {
      float x = r.f32(), y = r.f32(), a = r.f32(), b = r.f32();
      if (c) {
        plutovg_canvas_move_to(c, x, y);
        plutovg_canvas_line_to(c, a, b);
      }
      if (!paint(r, c, bounds))
        return false;
      break;
    }
    case 5:
      if (!geometry(r, c) || !paint(r, c, bounds))
        return false;
      break;
    case 6:
      if (++depth > 32)
        return false;
      if (c)
        plutovg_canvas_save(c);
      break;
    case 7:
      if (--depth < 0)
        return false;
      if (c)
        plutovg_canvas_restore(c);
      break;
    case 8:
    case 9: {
      float x = r.f32(), y = r.f32();
      if (c) {
        if (op == 8)
          plutovg_canvas_translate(c, x, y);
        else
          plutovg_canvas_scale(c, x, y);
      }
      break;
    }
    case 10: {
      float v = r.f32();
      if (c)
        plutovg_canvas_rotate(c, v);
      break;
    }
    case 11: {
      float v = r.f32();
      if (v < 0 || v > 1)
        return false;
      if (c)
        plutovg_canvas_set_opacity(c, v);
      break;
    }
    case 12:
      if (!geometry(r, c))
        return false;
      if (c && !bounds)
        plutovg_canvas_clip(c);
      break;
    case 13: {
      float x = r.f32(), y = r.f32();
      unsigned w = r.u16(), h = r.u16(), format = r.u8();
      if (!w || !h || format > 1 || size_t(w) * h > 32768 ||
          size_t(w) * h * (format ? 2 : 4) != r.size - r.at)
        return false;
      if (c && bounds) {
        plutovg_canvas_rect(c, x, y, w, h);
        measure(c, *bounds);
        r.at = r.size;
      } else if (c) {
        std::vector<uint32_t> pixels(size_t(w) * h);
        for (auto &p : pixels) {
          unsigned red, green, blue, alpha = 255;
          if (format) {
            unsigned rgb = r.u16();
            red = (((rgb >> 11) & 31) * 255 + 15) / 31;
            green = (((rgb >> 5) & 63) * 255 + 31) / 63;
            blue = ((rgb & 31) * 255 + 15) / 31;
          } else {
            red = r.u8();
            green = r.u8();
            blue = r.u8();
            alpha = r.u8();
          }
          p = (alpha << 24) | (((red * alpha + 127) / 255) << 16) |
              (((green * alpha + 127) / 255) << 8) | ((blue * alpha + 127) / 255);
        }
        auto image = plutovg_surface_create_for_data(reinterpret_cast<uint8_t *>(pixels.data()), w,
                                                     h, w * 4);
        plutovg_matrix_t matrix;
        plutovg_matrix_init_translate(&matrix, x, y);
        plutovg_canvas_save(c);
        plutovg_canvas_set_texture(c, image, PLUTOVG_TEXTURE_TYPE_PLAIN, 1, &matrix);
        plutovg_canvas_fill_rect(c, x, y, w, h);
        plutovg_canvas_restore(c);
        plutovg_surface_destroy(image);
      } else
        r.at = r.size;
      break;
    }
    default:
      return false;
    }
    return r.done();
  }

public:
  Bounds dirty;
  uint32_t id = 0, checksum = 0, clearUs = 0, drawUs = 0, convertUs = 0;
  size_t sceneBytes = 0;
  bool unchanged = false;
  Scene() = default;
  ~Scene() { plutovg_surface_destroy(surface); }
  bool begin(uint32_t *buffer) {
    argb = buffer;
    if (!buffer)
      return false;
    surface =
        plutovg_surface_create_for_data(reinterpret_cast<uint8_t *>(buffer), 240, 240, 240 * 4);
    return surface;
  }
  bool apply(const uint8_t *bytes, size_t size, uint16_t *output, void (*poll)() = nullptr,
             uint32_t (*clock)() = nullptr) {
    dirty = Bounds{};
    unchanged = false;
    clearUs = drawUs = convertUs = 0;
    if (!surface || !output || size > MAX_TRANSACTION)
      return false;
    Reader r{bytes, size};
    uint32_t nextId = r.u32(), base = r.u32(), expected = r.u32();
    uint8_t bg[4];
    for (auto &b : bg)
      b = r.u8();
    unsigned count = r.u16(), changes = r.u16();
    if (!r.ok || !nextId || count > 1024 || changes > count || (base && base != id) ||
        (!base && changes != count))
      return false;
    std::vector<std::vector<uint8_t>> next =
        base ? records : std::vector<std::vector<uint8_t>>(count);
    next.resize(count);
    std::vector<bool> seen(count, false);
    size_t total = 6;
    for (unsigned i = 0; i < changes; i++) {
      unsigned index = r.u16();
      size_t length = r.u32();
      if (!r.ok || index >= count || seen[index] || !length || length > MAX_SCENE ||
          length > r.size - r.at)
        return false;
      seen[index] = true;
      next[index].assign(r.data + r.at, r.data + r.at + length);
      r.at += length;
    }
    if (!r.done())
      return false;
    uint32_t crc = crcStep(0xffffffff, bg, 4);
    uint8_t countBytes[2] = {uint8_t(count), uint8_t(count >> 8)};
    crc = crcStep(crc, countBytes, 2);
    int depth = 0;
    for (const auto &record : next) {
      total += 4 + record.size();
      if (total > MAX_SCENE || !command(record, nullptr, depth))
        return false;
      uint32_t n = record.size();
      uint8_t len[4] = {uint8_t(n), uint8_t(n >> 8), uint8_t(n >> 16), uint8_t(n >> 24)};
      crc = crcStep(crc, len, 4);
      crc = crcStep(crc, record.data(), record.size());
    }
    if (depth != 0 || (crc ^ 0xffffffff) != expected)
      return false;
    if (base && count == records.size() && changes == 0 && memcmp(bg, background, 4) == 0) {
      id = nextId;
      unchanged = true;
      return true;
    }
    // Bounds pass is geometric only: no fill, stroke, clipping or pixel rasterization.
    // State changes conservatively invalidate every drawable; otherwise only changed nodes.
    auto boundsCanvas = plutovg_canvas_create(surface);
    if (!boundsCanvas)
      return false;
    std::vector<Bounds> nextBounds(count);
    depth = 0;
    bool stateChanged = false;
    for (unsigned i = 0; i < count; i++) {
      command(next[i], boundsCanvas, depth, &nextBounds[i]);
      if (seen[i] && ((next[i][0] >= 6 && next[i][0] <= 12) ||
                      (base && i < records.size() && records[i][0] >= 6 && records[i][0] <= 12)))
        stateChanged = true;
    }
    plutovg_canvas_destroy(boundsCanvas);
    for (unsigned i = count; i < records.size(); i++)
      if (records[i][0] >= 6 && records[i][0] <= 12)
        stateChanged = true;
    if (!base || memcmp(bg, background, 4) != 0)
      dirty = {0, 0, 240, 240};
    else {
      for (unsigned i = 0; i < count; i++)
        if (stateChanged || seen[i]) {
          if (i < recordBounds.size())
            dirty.add(recordBounds[i]);
          dirty.add(nextBounds[i]);
        }
      for (unsigned i = count; i < recordBounds.size(); i++)
        dirty.add(recordBounds[i]);
    }
    if (dirty.empty()) {
      records.swap(next);
      recordBounds.swap(nextBounds);
      id = nextId;
      checksum = expected;
      sceneBytes = total;
      unchanged = true;
      return true;
    }
    uint32_t stamp = clock ? clock() : 0;
    auto c = plutovg_canvas_create(surface);
    if (!c)
      return false;
    plutovg_canvas_clip_rect(c, dirty.left, dirty.top, dirty.right - dirty.left,
                             dirty.bottom - dirty.top);
    plutovg_color_t color{bg[0] / 255.f, bg[1] / 255.f, bg[2] / 255.f, bg[3] / 255.f};
    plutovg_canvas_set_color(c, &color);
    plutovg_canvas_set_operator(c, PLUTOVG_OPERATOR_SRC);
    plutovg_canvas_fill_rect(c, dirty.left, dirty.top, dirty.right - dirty.left,
                             dirty.bottom - dirty.top);
    plutovg_canvas_set_operator(c, PLUTOVG_OPERATOR_SRC_OVER);
    if (clock) {
      clearUs = clock() - stamp;
      stamp = clock();
    }
    if (poll)
      poll();
    // Match Canvas defaults rather than the library's shorter miter limit.
    plutovg_canvas_set_miter_limit(c, 10);
    depth = 0;
    unsigned index = 0;
    for (const auto &record : next) {
      command(record, c, depth);
      if (poll && (++index % 8) == 0)
        poll();
    }
    plutovg_canvas_destroy(c);
    if (clock) {
      drawUs = clock() - stamp;
      stamp = clock();
    }
    if (poll)
      poll();
    // Convert in internal-memory rows. Interleaved word reads and halfword writes
    // across two PSRAM buffers are much slower than contiguous bulk copies.
    uint32_t sourceRow[240];
    uint16_t targetRow[240];
    for (int y = dirty.top; y < dirty.bottom; y++) {
      const size_t width = dirty.right - dirty.left;
      memcpy(sourceRow, argb + y * 240 + dirty.left, width * 4);
      for (unsigned x = 0; x < width; x++) {
        uint32_t p = sourceRow[x];
        targetRow[x] = uint16_t(((p >> 8) & 0xf800) | ((p >> 5) & 0x7e0) | ((p >> 3) & 31));
      }
      memcpy(output + y * 240 + dirty.left, targetRow, width * 2);
      if (poll && y % 32 == 0)
        poll();
    }
    if (clock)
      convertUs = clock() - stamp;
    records.swap(next);
    recordBounds.swap(nextBounds);
    memcpy(background, bg, 4);
    id = nextId;
    checksum = expected;
    sceneBytes = total;
    return true;
  }
};
} // namespace orbitvector
