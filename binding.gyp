{
  "targets": [
    {
      "target_name": "stdio_bus_native",
      "sources": [
        "src/binding.c"
      ],
      "include_dirs": [
        "../../include"
      ],
      "cflags": ["-std=c11", "-Wall", "-Wextra"],
      "conditions": [
        ["OS=='linux' and target_arch=='x64'", {
          "defines": ["STDIO_BUS_USE_EPOLL"],
          "libraries": [
            "<(module_root_dir)/static_lib/x86_64-unknown-linux-gnu/libstdio_bus.a",
            "-lpthread"
          ]
        }],
        ["OS=='linux' and target_arch=='arm64'", {
          "defines": ["STDIO_BUS_USE_EPOLL"],
          "libraries": [
            "<(module_root_dir)/static_lib/aarch64-unknown-linux-gnu/libstdio_bus.a",
            "-lpthread"
          ]
        }],
        ["OS=='mac' and target_arch=='x64'", {
          "defines": ["STDIO_BUS_USE_KQUEUE"],
          "libraries": [
            "<(module_root_dir)/static_lib/x86_64-apple-darwin/libstdio_bus.a"
          ],
          "xcode_settings": {
            "OTHER_CFLAGS": ["-std=c11"]
          }
        }],
        ["OS=='mac' and target_arch=='arm64'", {
          "defines": ["STDIO_BUS_USE_KQUEUE"],
          "libraries": [
            "<(module_root_dir)/static_lib/aarch64-apple-darwin/libstdio_bus.a"
          ],
          "xcode_settings": {
            "OTHER_CFLAGS": ["-std=c11"]
          }
        }]
      ]
    }
  ]
}
