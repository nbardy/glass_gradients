# Bathroom Window Shader Viewer

This viewer runs Shadertoy-style packs in this repo as a local WebGL2 webpage.

## Run it

From the repo root:

```bash
python3 -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173/viewer/
```

## Shader packs

The viewer scans repo subfolders and lists any folder that contains an `image.glsl` file.

Each pack can contain:

- `image.glsl` required
- `common.glsl` optional
- `buffer_a.glsl` optional
- `README.md` optional

The current pack is loaded directly from its folder, so you can keep variants in subfolders and switch between them from the dropdown in the UI.

## Live iteration

- Use the control panel to adjust the main look-dev parameters live.
- Use the shader pack dropdown to switch between packs found in subfolders.
- Use `Reload GLSL` after editing any of the `.glsl` files or adding a new shader folder.
- Use `Reset accumulation` if you want to restart temporal accumulation manually.

## Notes

- This must be served over HTTP. Opening `viewer/index.html` via `file://` will not work because the page fetches shader files and scans folder listings.
- The viewer uses WebGL2 and a ping-pong accumulation buffer to emulate the Shadertoy `Buffer A` feedback pass.
