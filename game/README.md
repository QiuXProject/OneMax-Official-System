# SandGlitch // WebXR Physics Sandbox

SandGlitch is a small, self-contained browser game built with Three.js and WebXR. It is the interactive game layer for the OneMax repository: it is not a flat mock-up or a video, it uses the browser's immersive VR API when a compatible headset is connected.

## Run it

```bash
cd game
npm install
npm run dev
```

Open the Vite URL from a WebXR-capable browser and launch **Enter immersive VR**. The preview URL is served over HTTPS by Arena, which is suitable for testing the `navigator.xr` permission flow. There is deliberately no desktop gameplay mode: a headset session is required.

## Controls

- VR only: press the in-world **Pull Trigger // Start** button, use the thumbstick to move, and use a controller trigger to grab a nearby prop or punch a target. Release a grabbed prop to throw it with controller momentum.

## Included systems

- WebXR renderer with room-scale/local-floor reference space and two controller interaction rays.
- Custom rigid-body loop: gravity, restitution, friction, floor and arena bounds, approximate body-body collisions, impulses and throw momentum.
- Breakable crates, barrels and a wall made from individual slabs; destroyed objects spawn physical debris.
- Stylised glitch dummies with independently simulated body parts, ragdoll activation and re-spawning waves.
- Non-photoreal red impact particles and floor splats for the requested blood feedback, plus sparks and dust.
- Intro branding/menu, in-world VR HUD, score, waves, suit integrity and event feed.

The game intentionally uses procedural geometry and textures so it can run without downloading art assets or tracking a large binary bundle.
