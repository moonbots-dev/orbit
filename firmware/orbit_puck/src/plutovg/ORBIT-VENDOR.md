PlutoVG 1.3.3, MIT, https://github.com/sammycage/plutovg
Pinned commit: f63f9b59dda96c7d1ca3c76e9b33e5ae4b91fab1
Source and public header copied from the pinned revision, with the build and portability changes documented below. LICENSE and embedded FreeType/stb notices retained.
Orbit build configuration in plutovg-private.h disables unused image-file writing and filesystem font discovery. The renderer is single-threaded; C11 atomics disabled for the Xtensa toolchain.

Portability patch: `plutovg_memfill32` and two color buffers use `uint32_t` rather than `unsigned int`, with `<stdint.h>` included. Xtensa's C library defines uint32_t as unsigned long, so the upstream mixture is rejected by current GCC. Both remain exactly 32-bit; no rendering algorithm changes. Arduino's loop stack is explicitly 32 KiB to accommodate FreeType rasterizer scratch space.
