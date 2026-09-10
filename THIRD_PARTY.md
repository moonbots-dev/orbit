# Third-party components

- The vendored PlutoVG rasterizer retains its MIT license at `firmware/orbit_puck/src/plutovg/LICENSE`, plus license notices in the included FreeType-derived and stb files. See `ORBIT-VENDOR.md` in that directory.
- Geist and Geist Mono font files are distributed with `public/fonts/OFL.txt` (SIL Open Font License).
- JavaScript and native dependencies retain their own licenses. They are resolved through `bun.lock`; the Mac application build bundles Bun, TypeScript and the web dependencies. Their installed license notices are copied into the built app's Resources/licenses directory.
