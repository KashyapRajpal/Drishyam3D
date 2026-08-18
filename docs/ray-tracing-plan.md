# Ray Tracing Rendering Plan

Plan for adding ray-traced rendering to Drishyam3D in two execution modes:

- **CPU** — a Web Worker reference renderer that traces into an `ImageData`/bitmap.
- **GPU** — a WebGPU compute renderer with the same camera, materials, lights, and BVH data.

The Cornell Box is the correctness and progressive-path-tracing demo. Imported glTF
meshes are the real-time demo, initially using one ray-traced hard shadow ray per visible
pixel while the existing raster mesh pass supplies primary visibility.

## Important platform decision

As of August 2026, the current
[WGSL specification](https://gpuweb.github.io/gpuweb/wgsl/) does not expose a portable
hardware ray-tracing pipeline, acceleration structure, or ray-query API in browsers; the
GPU Web working group is still discussing ray queries/acceleration structures as future
work. The GPU mode must therefore use WGSL compute shaders and traverse a software BVH.
This is still GPU ray tracing, but it is not access to the hardware RT cores exposed by
native Vulkan, DirectX 12, or Metal APIs.

Do not make this feature wait for a future browser extension. Keep the traversal layer
behind a small interface so a native or future WebGPU ray-query backend can replace the
software traversal later.

## Planning and implementation strategy

This document is the implementation contract, not only a roadmap. Planning, architecture
changes, cross-module interface decisions, and final phase reviews should use the strongest
available reasoning model (currently GPT-5.6 Sol). Once a work packet below has stable
inputs, outputs, invariants, and tests, it can be handed to a faster/cheaper coding model.

Do not hard-code a model ID into repository automation. Model names and availability
change. At execution time, choose the fastest coding-capable model available in Codex that
can complete the packet; if GPT-5.3-Codex/Spark is offered in the active Codex model
selector, it is a reasonable implementation candidate. Current official model guidance
positions GPT-5.6 Sol for complex work, Terra for balanced cost/capability, and Luna for
cost-sensitive high-volume work:
[OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model).

Use the following routing rule:

| Work | Default model class | Escalate when |
|---|---|---|
| Architecture, contracts, phase decomposition | Frontier planner | Always use for changes that affect two or more module contracts |
| One bounded implementation packet | Fast/cost-sensitive coding model | The packet's contract is ambiguous or two implementation attempts fail |
| Mechanical tests, fixtures, docs, cleanup | Fast/cost-sensitive coding model | A failure reveals an architectural decision |
| WGSL traversal, synchronization, GPU validation debugging | Strong coding model | Escalate to frontier planner/reviewer for persistent correctness failures |
| Phase integration and review | Frontier planner/reviewer | Always at a phase boundary |

Every implementation handoff must name exactly one packet ID, list the allowed files,
state non-goals, and require the packet's verification commands. The implementer must not
silently widen the packet. If an interface is insufficient, it should stop and report the
specific contract change needed so the planning model can revise this document first.

## Modularity rules

The current renderer architecture is intentionally polymorphic. Preserve that strategy:

```text
UI / editor controls
        |
        v
engine facade + render-mode coordinator
        |
        +------------------+------------------+
        v                  v                  v
existing raster       CPU ray scene      WebGPU scene
renderers              + worker            registry
                                              |
                                  +-----------+-----------+
                                  v                       v
                           path-trace renderer     hybrid-shadow renderer

asset parser --> RayScene --> prepare --> BLAS/TLAS --> pack --> CPU or GPU consumers
```

Dependency rules:

1. `raytracing/core/` is pure JavaScript. It must not import DOM, React, WebGL, WebGPU,
   workers, or renderer classes.
2. `raytracing/acceleration/` depends only on `core/`. BVH building and CPU traversal must
   be runnable under Jest without browser globals.
3. `raytracing/cpu/` may depend on `core/` and `acceleration/`; only the controller may
   touch canvas/worker APIs. The integrator remains a pure function over explicit state.
4. `raytracing/gpu/` owns packing and resource helpers. It must not parse glTF, build UI
   state, or mutate the source `RayScene`.
5. Renderer classes record work; they do not parse assets, construct BVHs, own cameras,
   or create their own animation loops. `webgpu-scene.js` remains the sole WebGPU RAF and
   command-encoder owner.
6. The hybrid renderer may reuse shared mesh buffers, but it must own and destroy only its
   G-buffer/shadow/composite resources. Ownership must be explicit for every GPU resource.
7. The facade/coordinator is orchestration only. Algorithms belong in the modules above.
8. React components invoke facade methods and display state; no ray/BVH/GPU algorithms
   belong in `App.jsx`.
9. No module reads another module's private fields. Shared state crosses a documented
   function or message contract.
10. New behavior is additive. Existing `mesh`, `splat`, WebGL, and WebGPU raster paths
    must continue to work while unfinished ray modes remain feature-gated.

## Product modes

Keep the existing **Renderer** setting (`WebGL` / `WebGPU`) separate from a new
**Render Mode** setting:

| Render mode | Execution | Intended use | First deliverable |
|---|---|---|---|
| Raster | Existing WebGL/WebGPU pipeline | Editing and fallback | Unchanged |
| Ray Trace — CPU | Web Worker | Correctness oracle, small offline previews | Progressive Cornell Box |
| Ray Trace — GPU | WebGPU compute | Interactive previews | Progressive Cornell Box |
| Hybrid Shadows | WebGPU raster + compute | Real-time glTF editing | Ray-traced direct-light shadows |

CPU ray tracing should be available even when WebGPU is unavailable. GPU ray tracing and
hybrid shadows require the WebGPU backend. Switching ray execution mode must retain the
same scene and camera rather than re-importing the asset.

## Current architecture findings

1. [webgpu-scene.js](../scripts/engine/webgpu-scene.js) owns the camera, animation tick,
   canvas resize, frame loop, command encoder, and a renderer registry keyed by
   `drawable.kind`. A GPU ray tracer fits as another `Renderer` implementation.
2. [renderer.js](../scripts/engine/renderers/renderer.js) assumes a GPU device and command
   encoder. The CPU renderer should not be forced into this class; it needs a parallel
   facade/scene implementation that shares ray-scene data but owns workers and bitmap
   presentation.
3. [gltf-parser.js](../scripts/engine/gltf-parser.js) currently parses only the first
   primitive of the first mesh, requires normals and indices, ignores node transforms,
   and returns only a base-color texture. It also uploads buffers in backend-specific
   functions. This is insufficient for a useful ray scene or general glTF shadows.
4. [webgpu-facade.js](../scripts/engine/webgpu-facade.js) receives typed geometry only
   briefly before converting it into GPU-only drawables. Ray tracing needs retained local
   geometry/instance/material data plus BLAS/TLAS buffers.
5. [mesh-renderer.js](../scripts/engine/renderers/mesh-renderer.js) currently owns a
   forward color/depth pass. Hybrid shadows need either a small G-buffer pass or an
   expanded forward target containing world position/normal/material data.
6. The app currently treats a loaded asset as one drawable. The MVP can keep that product
   constraint, but the internal ray-scene format should already support multiple mesh
   instances and materials.
7. The camera exposes its world-space eye and view matrix, but ray generation also needs
   explicit right/up/forward basis vectors and FOV. Add and test that shared camera-frame
   utility once for CPU and GPU modes; add matrix inversion for glTF normal transforms.

## Shared ray-scene contract

Introduce a backend-neutral representation before implementing either tracer:

```js
{
  geometries: [{ positions, normals, texCoords, indices, bounds }],
  instances:  [{ geometryIndex, materialIndex, worldMatrix, inverseWorldMatrix }],
  materials:  [{ baseColor, emissive, metallic, roughness, baseColorImage }],
  lights:     [{ type: 'rect' | 'point' | 'directional', position, u, v, color, intensity }],
  camera:     { eye, target, up, fovY },
  environment: { color },
}
```

Use a two-level acceleration structure from the first implementation:

- One **BLAS** per unique `Geometry`, built in that geometry's local space and reused by
  every instance of the geometry.
- One scene **TLAS** over `Instance` world-space bounds. TLAS leaves reference instances;
  each instance names its BLAS root, material, world transform, and inverse transform.

This is still a software acceleration structure built on the CPU and traversed by CPU JS
or WGSL. “BLAS/TLAS” describes its organization; it does not imply browser access to
hardware RT acceleration structures.

Define one packed GPU/worker layout with explicit byte offsets. Use `vec4`-aligned records
in WGSL even where only three components are needed. Suggested MVP buffers:

- `Triangle`: three `u32` vertex indices and its source geometry ID.
- `Vertex`: position, normal, UV.
- `BvhNode`: AABB min + child/first primitive; AABB max + primitive count.
- `Instance`: world/inverse-world transforms, BLAS root, geometry ID, and material ID.
- `Material`: base color, emissive, metallic, roughness, texture index/flags.
- `FrameUniforms`: camera basis, camera position, resolution, sample index,
  bounce limit, light data, and deterministic RNG seed.

CPU and GPU intersection rules must match: Moller-Trumbore triangle tests, slab AABB
tests, epsilon policy, normal orientation, closest-hit ordering, and miss color.

Concrete core shapes:

```js
// Geometry stays in local/object space and can be instanced many times.
Geometry = {
  id: number,                         // stable within the SceneAsset
  revision: number,                   // incremented only when this geometry changes
  positions: Float32Array,           // xyz, required
  normals: Float32Array,             // xyz, required after import normalization
  texCoords: Float32Array,           // uv; zero-filled when absent
  indices: Uint32Array,              // triangles; length % 3 === 0
  bounds: { min: [x,y,z], max: [x,y,z], center: [x,y,z], radius },
}

Instance = {
  id: number,                         // stable within the SceneAsset
  geometryIndex: number,
  materialIndex: number,
  worldMatrix: Float32Array,         // 16, column-major
  inverseWorldMatrix: Float32Array,  // 16, column-major
}

Material = {
  baseColor: [r,g,b,a],              // linear
  emissive: [r,g,b],                 // linear
  emissiveStrength: number,
  metallic: number,
  roughness: number,
  baseColorImageIndex: number,       // -1 when absent
}

RectLight = {
  type: 'rect', center: [x,y,z], u: [x,y,z], v: [x,y,z],
  color: [r,g,b], intensity: number,
}
```

`prepareRayScene()` validates and normalizes the scene without applying instance
transforms. GPU packing may concatenate geometry arrays, but vertex positions/normals
remain in local space. It returns:

```js
{
  geometries, instances, materials, lights, environment, bounds,
}
```

Preserve geometry and instance IDs through preparation, BLAS/TLAS building, packing, and
hits so diagnostics can identify both the source mesh and scene node.

### Core JavaScript contracts

Use JSDoc types in the first implementation; do not add TypeScript only for this feature.
All functions below return new values or documented owned buffers. They do not mutate
their input.

```js
// raytracing/core/ray-scene.js
export function createEmptyRayScene(): RayScene
export function validateRayScene(scene): { ok: boolean, errors: string[] }
export function prepareRayScene(scene): PreparedRayScene
export function computeSceneBounds(scene): Bounds
export function computeInstanceBounds(geometryBounds, worldMatrix): Bounds

// raytracing/core/camera-rays.js
export function createCameraFrame({ eye, target, up, fovY, aspect }): CameraFrame
export function generateCameraRay(cameraFrame, pixelX, pixelY, width, height, jitter): Ray

// raytracing/acceleration/bvh-builder.js (generic deterministic partitioner)
export function buildMedianBvh(records, options = {}): BuiltBvh

// raytracing/acceleration/blas-builder.js
export function buildBlas(geometry, geometryIndex, options = {}): BuiltBlas

// raytracing/acceleration/tlas-builder.js
export function buildTlas(scene, blases, options = {}): BuiltTlas

// raytracing/acceleration/acceleration-structure.js
export function buildAccelerationStructures(scene, options = {}): AccelerationStructures
export function updateAccelerationStructures(previous, scene, revisions): AccelerationStructures

// raytracing/acceleration/intersections.js
export function intersectAabb(ray, min, max, tMin, tMax): number | null
export function intersectTriangle(ray, geometry, triangleIndex, tMin, tMax): LocalHit | null
export function intersectBlas(rayLocal, geometry, blas, tMin, tMax, anyHit = false): LocalHit | null
export function intersectTlas(rayWorld, scene, acceleration, tMin, tMax, anyHit = false): Hit | null

// raytracing/cpu/path-integrator.js
export function traceSample(ray, scene, acceleration, rngState, settings): LinearRgb
```

Required shape semantics:

- `positions`, `normals`, and `texCoords` are tightly packed `Float32Array`s.
- `indices` and all cross-buffer references are `Uint32Array`s, including assets that
  originally used 8- or 16-bit indices.
- Geometry coordinates are right-handed local space; instances place them in right-handed
  world space. Front faces use counter-clockwise winding.
- All colors are linear RGB internally. Convert sRGB textures on sampling and convert to
  sRGB only in the display pass.
- A world `Ray` is `{ origin: [x,y,z], direction: [x,y,z] }` with normalized direction.
  A BLAS-local ray preserves the affine-transformed direction without renormalizing it.
- A `LocalHit` contains `{ t, triangleIndex, barycentric, geometricNormal,
  shadingNormal, frontFace }` in geometry-local space.
- A `Hit` contains `{ t, triangleIndex, instanceIndex, materialIndex, barycentric,
  position, geometricNormal, shadingNormal, frontFace }`; position/normals are world-space.
- `tMin` is inclusive, `tMax` is exclusive. Primary rays use `1e-4`; spawned rays use a
  scale-aware offset described below.
- A miss is `null`, never a sentinel hit with infinite distance.
- `PreparedRayScene` is immutable after acceleration structures are built. Geometry edits
  replace the affected `Geometry` with an incremented per-geometry revision, rebuilding
  those BLASes and the TLAS; transform edits replace instances and rebuild only the TLAS.

Camera-ray convention is shared literally by CPU and WGSL:

```text
forward = normalize(target - eye)
right   = normalize(cross(forward, requestedUp))
up      = cross(right, forward)
ndcX    =  2 * ((pixelX + jitterX) / width) - 1
ndcY    =  1 - 2 * ((pixelY + jitterY) / height)
dir     = normalize(forward
          + right * ndcX * aspect * tan(fovY / 2)
          + up    * ndcY * tan(fovY / 2))
```

Pixel `(0,0)` is top-left and jitter components are in `[0,1)`. Reject an eye equal to
target and an up vector parallel to forward with clear errors rather than returning NaNs.

### Revisions and invalidation

Use explicit monotonically increasing revision numbers rather than object-identity checks:

```js
{
  geometryRevision: 0,  // positions/indices -> rebuild affected BLASes and the TLAS
  instanceRevision: 0,  // add/remove/transform instances -> rebuild only the TLAS
  materialRevision: 0,  // material/texture edits -> repack materials and reset samples
  lightRevision: 0,     // light edits -> update uniforms and reset samples
  cameraRevision: 0,    // camera/viewport edits -> update uniforms and reset samples
  settingsRevision: 0,  // bounce/sampling edits -> reset samples
}
```

The coordinator computes a render key from all six fields. `geometryRevision` rebuilds
only changed geometry BLASes and then the TLAS. `instanceRevision` rebuilds the TLAS but
reuses every BLAS. Material/light/camera/settings changes rebuild neither. All six reset
path-tracing accumulation. Hybrid hard shadows do not accumulate, so camera/light changes
update uniforms but do not allocate or rebuild acceleration structures.

Extend, do not replace, the existing stats object:

```js
{
  backend: 'webgl' | 'webgpu' | 'cpu',
  renderMode: 'raster' | 'raytrace-cpu' | 'raytrace-gpu' | 'hybrid-shadows',
  fps,
  frameMs,
  triangleCount,
  instanceCount,
  spp: 0,
  raysPerSecond: 0,
  blasBuildMs: 0,
  tlasBuildMs: 0,
  passMs: { trace: null, display: null, shadow: null, ...existingPasses },
  diagnostics: { stackOverflows: 0, nonFinite: 0 },
}
```

Use `0` for an applicable measured zero and `null`/omission for an unavailable metric.
Do not report estimated GPU timings as measured values when timestamp queries are absent.

### Scene asset and renderer selection

Parsing and rendering must meet at a single retained asset contract:

```js
{
  sourceName: 'Cornell Box',
  rayScene,                 // backend-neutral source of truth
  rasterPrimitives,         // typed arrays grouped for raster upload
  preparedRayScene,         // local geometry + instances; immutable per revisions
  acceleration,             // { blases, tlas }; created lazily and cached by revision
  revisions,
}
```

The facade creates backend drawables from this asset. A WebGPU mesh drawable keeps its
existing `kind: 'mesh'` and gains a non-GPU metadata sidecar identifying the retained
scene asset/revision. Do not duplicate positions just to give each renderer a different
drawable kind.

Use this backward-compatible mesh shape during the glTF expansion:

```js
{
  kind: 'mesh',
  primitives: [{ buffers, texture, indexCount, indexFormat, material,
                 worldMatrix, instanceIndex }],
  vertexCount,              // sum of primitive index counts, for current stats
  bounds,
  rayTracing: { asset, geometryRevision, instanceRevision },
}
```

Primitive cube/sphere and old tests may continue to pass `{ buffers, texture,
vertexCount }`; a pure `getMeshPrimitives(drawable)` adapter returns that legacy shape as
a one-element primitive list with an identity `worldMatrix`. New glTF drawables use
`primitives`. Raster rendering issues one indexed draw per instance primitive, using
`view * userModel * primitive.worldMatrix`. Each primitive gets its own material uniform
buffer and bind group—do not overwrite one shared material uniform several times before a
single queue submission, because every draw would observe the final queued value.

Ray tracing uses the same effective instance transform:
`effectiveWorld = userModel * instance.worldMatrix`. A changing user script therefore
increments `instanceRevision` and rebuilds only the TLAS; BLASes remain cached. Progressive
CPU/GPU path tracing pauses user-script animation by default so accumulation can converge.
If the user explicitly resumes animation, accumulation resets on each changed transform.
Hybrid shadows keep scripts running and rebuild the TLAS for rigid transform changes; TLAS
refit/root-transform fast paths are follow-up optimizations if profiling requires them.

Change WebGPU selection from a single `kind -> renderer` map to a small dispatch matrix:

| Drawable kind | `raster` | `raytrace-gpu` | `hybrid-shadows` |
|---|---|---|---|
| `mesh` | `MeshRenderer` | `RayTraceRenderer` | `HybridShadowRenderer` |
| `splat` | current selected splat renderer | unsupported | unsupported |

`rendererFor(drawable, renderMode)` owns this decision. A missing ray sidecar returns a
clear capability error instead of falling back silently. CPU mode is outside this matrix
because it uses a worker and 2D presentation rather than the WebGPU command encoder.

Mode switching calls `prepare()` on the incoming renderer but does not release the shared
asset. Replacing an asset calls `releaseDrawable(previous)` on **every registered renderer**;
each implementation releases only its own cached resources and must be idempotent. Hybrid
borrows raster vertex/index buffers and never destroys them. Full scene destruction calls
every renderer's `destroy()` once.

The mode coordinator exposes one UI-facing contract:

```js
createRayTracingCoordinator({ rasterEngine, cpuCanvas, onError }) -> {
  getCapabilities(),                 // each mode -> { available, reason? }
  setSceneAsset(sceneAsset),         // retains one asset; invalidates old async work
  setRenderMode(mode),               // async; resolves after incoming mode is prepared
  setRayTracingSettings(partial),
  setLight(light),
  resetAccumulation(),
  pause(),
  resume(),
  getStats(),
  destroy(),
}
```

Only one presentation loop is active. Entering CPU mode pauses the WebGL/WebGPU scene RAF
and starts the worker; leaving it increments the CPU generation, stops presentation, and
resumes the selected raster/GPU mode. Add explicit `pause()`/`resume()` to engine scenes;
do not abuse `destroy()` for a temporary mode change.

Changing `backend` while CPU mode is visible may recreate the hidden raster engine, but
must not discard the retained `SceneAsset` or restart CPU accumulation. GPU-only modes
must transition to `raster` with an explicit UI action before switching to WebGL; the
coordinator itself rejects the invalid combination.

Camera state crosses modes as plain data: `{ target, rotationX, rotationY, zoom }`. Extend
`Camera` with `getState()`, `setState(state)`, and idempotent `destroy()` that removes the
exact bound DOM handlers it registered. Only the visible canvas has active camera input.

`setRenderMode()` rejects with an error carrying code `UNSUPPORTED_RENDER_MODE` and the
capability reason when unavailable. It never silently changes the requested mode.

### glTF extraction contract

`parseGltfAsset(source)` must return data, not GPU handles:

```js
{
  sourceName,
  scenes: [{ rootNodeIndices }],
  defaultSceneIndex,
  nodes: [{ name, children, localMatrix, worldMatrix, meshIndex }],
  meshes: [{ primitives: [{ mode, attributes, indices, materialIndex }] }],
  materials: [{ baseColor, baseColorImageIndex, emissive, metallic, roughness,
                alphaMode, doubleSided }],
  images: [ImageBitmap | null],
  bounds,
}
```

Accessor extraction must honor both accessor and buffer-view byte offsets, byte stride,
component type, normalized integer conversion, and accessor element type. Copy strided or
misaligned data into tightly packed arrays; do not create a typed-array view at an invalid
alignment. Sparse accessors may initially return a clear unsupported-feature error.

Traverse only the selected/default glTF scene. Compute world matrices parent-first as
`parentWorld * local`; if a node provides `matrix`, it takes precedence over TRS. Compose
TRS in glTF order `T * R * S`, with quaternion `[x,y,z,w]`. Detect cycles defensively even
though valid glTF graphs are acyclic. Multiple nodes may instance the same mesh.

`assetToRayScene(asset)` creates one local-space `Geometry` per unique glTF mesh primitive
and one `Instance` per `(scene node, mesh primitive)` reference, so repeated nodes share
geometry/BLAS data while retaining per-primitive materials.
`prepareRayScene()` preserves these transforms. `assetToRasterPrimitives(asset)` groups
typed arrays, instance world matrices, and material/image references for backend upload.
Neither function closes `ImageBitmap`s; asset/coordinator destruction owns image lifetime.

### Packed buffer layouts

The CPU builder produces typed records first; `gpu-scene-packer.js` is the only module
that converts them into WGSL-compatible byte layouts. All records use little-endian data
and 16-byte alignment.

**Vertex — 48 bytes**

| Offset | WGSL/JS type | Meaning |
|---:|---|---|
| 0 | `vec4<f32>` | local/object-space position xyz, w unused |
| 16 | `vec4<f32>` | local/object-space shading normal xyz, w unused |
| 32 | `vec2<f32>` | UV |
| 40 | `vec2<f32>` | padding |

**Triangle — 16 bytes**

| Offset | Type | Meaning |
|---:|---|---|
| 0 | `u32` | vertex index 0 |
| 4 | `u32` | vertex index 1 |
| 8 | `u32` | vertex index 2 |
| 12 | `u32` | source geometry index |

**BVH node — 32 bytes**

| Offset | Type | Meaning |
|---:|---|---|
| 0 | `vec3<f32>` | AABB minimum |
| 12 | `u32` | internal: left-child node; leaf: first primitive offset |
| 16 | `vec3<f32>` | AABB maximum |
| 28 | `u32` | internal: `0`; leaf: primitive count (`1..4`) |

Internal children are stored consecutively: right child is `leftChild + 1`. The builder
must reserve both child slots before recursively filling either subtree. BLAS leaf values
are triangle indices; TLAS leaf values are instance indices. Both live in one packed
`array<u32>` because traversal knows whether it is inside a BLAS or TLAS. BVH packing puts
the TLAS first, so a non-empty scene's TLAS root is node `0`, then appends every BLAS while
adjusting child-node and leaf-reference offsets.

Packing returns metadata `{ tlasNodeCount, tlasLeafCount, blasNodeOffset,
blasLeafOffset, instanceCount }`. When transforms change but instance count is stable, the
TLAS node/leaf counts are stable too: overwrite only the TLAS prefixes of the combined
node/leaf GPU buffers plus the instance buffer with `queue.writeBuffer`. Adding/removing an
instance may shift BLAS offsets, so repack/reupload the combined buffers while still
reusing the already-built BLAS objects. Never rebuild or re-upload vertex/triangle buffers
for a transform-only change.

Storage buffers cannot be zero-sized. For an empty logical array, GPU helpers allocate one
zeroed dummy record while retaining logical counts of zero. `FrameUniforms.flags` bit 0 is
`HAS_TLAS`; shaders check it before reading node 0. Instance flag bit 0 is
`FLIPS_HANDEDNESS` as defined in the traversal rules below.

**Instance — 144 bytes**

| Offset | Type | Meaning |
|---:|---|---|
| 0 | `mat4x4<f32>` | local-to-world matrix |
| 64 | `mat4x4<f32>` | world-to-local inverse matrix |
| 128 | `vec4<u32>` | BLAS root node, geometry index, material index, flags |

The shader derives the normal transform as the transpose of the inverse matrix's upper
3x3. A BLAS root of `0xffffffff` means empty geometry and must immediately miss.

**Material — 64 bytes**

| Offset | Type | Meaning |
|---:|---|---|
| 0 | `vec4<f32>` | linear base color RGBA |
| 16 | `vec4<f32>` | emissive RGB + emissive strength |
| 32 | `vec4<f32>` | metallic, roughness, alpha cutoff, index of refraction |
| 48 | `vec4<u32>` | base-color texture, flags, reserved, reserved |

Use `0xffffffff` for no texture. MVP path tracing reads base color and emissive only;
other fields are packed now to keep the layout stable for later PBR work.

`FrameUniforms` is 192 bytes and is declared once in `gpu-ray-layout.js` with exported byte
offsets, then mirrored verbatim in WGSL:

| Offset | Type | Meaning |
|---:|---|---|
| 0 | `vec4<f32>` | camera position xyz, w unused |
| 16 | `vec4<f32>` | camera right xyz, w unused |
| 32 | `vec4<f32>` | camera up xyz, w unused |
| 48 | `vec4<f32>` | camera forward xyz, `tan(fovY/2)` in w |
| 64 | `vec4<u32>` | width, height, accumulated sample index, frame seed |
| 80 | `vec4<u32>` | max bounces, samples/frame, light type, flags |
| 96 | `vec4<f32>` | ray epsilon, exposure, environment intensity, pad |
| 112 | `vec4<f32>` | linear environment/background RGB, pad |
| 128 | `vec4<f32>` | light position/direction xyz, intensity |
| 144 | `vec4<f32>` | rectangular-light U vector xyz, pad |
| 160 | `vec4<f32>` | rectangular-light V vector xyz, pad |
| 176 | `vec4<f32>` | linear light color RGB, pad |

Light type is `0 = directional`, `1 = point`, `2 = rectangle`. A unit test writes
recognizable values and asserts every byte offset. Diagnostics are a separate 16-byte
storage record containing atomic `stackOverflowCount`, `nonFiniteCount`, `rayCount`, and
one reserved `u32`; clear it before each measured frame and copy it to a MAP_READ staging
buffer asynchronously, never blocking the render loop.

Use this bind-group contract for `raytrace.wgsl`:

| Group/binding | Resource |
|---|---|
| `0/0` | `FrameUniforms` uniform buffer |
| `0/1` | read-only vertex storage buffer |
| `0/2` | read-only triangle storage buffer |
| `0/3` | read-only BVH-node storage buffer |
| `0/4` | read-only BVH leaf-reference storage buffer |
| `0/5` | read-only instance storage buffer |
| `0/6` | read-only material storage buffer |
| `0/7` | read-write diagnostics storage buffer |
| `1/0` | previous accumulation sampled texture |
| `1/1` | next accumulation `rgba16float` write-only storage texture |

The trace stage uses seven storage buffers. Capability detection must verify
`device.limits.maxStorageBuffersPerShaderStage >= 7` and return a clear unavailable reason
before creating a pipeline when the adapter cannot support this layout.

The display pipeline uses its own minimal bind group containing only the current
accumulation texture and display uniforms. Keep trace and display layouts separate so a
future denoiser can be inserted without changing scene bindings. Use explicit bind-group
layouts rather than `layout: 'auto'`; tests and hot shader reloads need stable contracts.

### Numerical policy

- Triangle intersection epsilon: `1e-8` for determinant rejection.
- Primary `tMin`: `1e-4 * max(1, scene.bounds.radius)`.
- Spawn origin: `hit.position + orientedGeometricNormal * rayEpsilon`, where the normal
  points into the outgoing ray hemisphere.
- Shadow `tMax`: point/area light distance minus `rayEpsilon`; directional light uses the
  scene diagonal times two.
- Normalize interpolated shading normals. Fall back to the geometric normal if the result
  is non-finite or near zero.
- Flip only the reported oriented normal for a back-face hit; retain the geometric winding
  normal for debugging.
- Clamp random samples away from exactly zero before logarithm, division, or square root.
- Tone mapping MVP: Reinhard `c / (1 + c)`, followed by linear-to-sRGB. CPU and GPU use
  the same formula.

## Proposed files

```text
scripts/engine/raytracing/
  core/
    ray-scene.js               # schema, validation, preparation, instance bounds
    camera-rays.js             # camera basis and deterministic ray generation
    cornell-box.js             # deterministic procedural reference scene
    random.js                  # seeded uint32 PRNG shared by CPU tests/spec
  acceleration/
    bvh-builder.js             # generic deterministic median partitioner
    blas-builder.js            # triangle records + local-space BLAS
    tlas-builder.js            # instance records + world-space TLAS
    acceleration-structure.js  # caching and revision-aware rebuild orchestration
    intersections.js           # CPU AABB/triangle/BLAS/TLAS reference traversal
  cpu/
    path-integrator.js         # pure material, light, and bounce integration
    cpu-ray-worker.js          # message-driven progressive worker
    cpu-ray-controller.js      # scheduling, cancellation, tile presentation
  gpu/
    gpu-scene-packer.js        # the only RayScene -> WGSL buffer conversion
    gpu-ray-helpers.js         # buffers, textures, bind groups, pipelines
    gpu-ray-layout.js          # sizes/offsets shared with packing tests
  hybrid/
    gbuffer-layout.js          # formats and resize/resource helpers

scripts/engine/renderers/
  raytrace-renderer.js         # WebGPU progressive path tracer
  hybrid-shadow-renderer.js    # G-buffer + compute shadow + composite passes

scripts/engine/
  raytracing-coordinator.js    # revisions, BLAS/TLAS lifetime, mode orchestration
  cpu-ray-facade.js            # Canvas2D/worker engine facade

assets/shaders/
  raytrace.wgsl                # ray generation, BVH traversal, path integration
  hybrid-gbuffer.wgsl          # raster primary visibility
  hybrid-shadow.wgsl           # one shadow ray per visible pixel/sample
  hybrid-composite.wgsl        # direct lighting * visibility + material color

__tests__/
  ray-scene.test.js
  camera-rays.test.js
  bvh-builder.test.js
  blas-builder.test.js
  tlas-builder.test.js
  intersections.test.js
  cornell-box.test.js
  path-integrator.test.js
  gpu-scene-packer.test.js
  raytrace-renderer.test.js
  hybrid-shadow-renderer.test.js

visual/
  ray-cases.mjs                # deterministic Cornell + glTF shadow cases
```

## Algorithm specifications

### Deterministic BLAS/TLAS MVP

Use the same deterministic median-split binary builder for BLAS and TLAS. It is easier to
verify than SAH and sufficient to establish traversal. SAH and refitting are measured
optimizations, not MVP scope.

The generic builder receives `{ id, min, max, centroid }` records:

1. A BLAS creates one record per local-space triangle. A TLAS creates one record per
   instance using the world-space AABB obtained by transforming all eight corners of its
   geometry bounds.
2. Make a leaf when the range has four or fewer records.
3. Otherwise choose the axis with the largest centroid-bounds extent. Resolve ties in
   `x`, then `y`, then `z` order.
4. Stable-sort by centroid on that axis; break equal-centroid ties with record `id`
   (triangle ID for BLAS, instance ID for TLAS).
5. Split at `floor(count / 2)`. Reserve two consecutive child nodes, store the left-child
   index in the parent, then recursively fill the reserved nodes.
6. Store leaf IDs in traversal order in the structure's leaf-reference array.
7. Reject non-finite geometry and non-invertible instance transforms before building.
   Empty geometry produces an empty BLAS; a scene with no instances produces an empty
   TLAS and renders the environment.

The builder returns:

```js
BuiltBlas = {
  geometryIndex,
  nodes,
  triangleIndices: Uint32Array,
  maxDepth,
  leafCount,
  buildMs,
}

BuiltTlas = {
  nodes,
  instanceIndices: Uint32Array,
  maxDepth,
  leafCount,
  buildMs,
}

AccelerationStructures = {
  blases: BuiltBlas[],       // same index order as scene.geometries
  tlas: BuiltTlas,
  blasBuildMs,
  tlasBuildMs,
}
```

BLAS traversal receives a ray transformed by the instance's inverse matrix:

```text
localOrigin    = inverseWorld * vec4(worldOrigin, 1)
localDirection = inverseWorld * vec4(worldDirection, 0)
```

Do **not** normalize `localDirection`: retaining the affine parameter means local
triangle-hit `t` remains comparable to the world ray's `t`, including under non-uniform
scale. After a local hit, compute world position from `worldOrigin + t*worldDirection`.
Transform local normals by `transpose(inverseWorld)` and normalize. If the world matrix's
upper-3x3 determinant is negative, set instance flag bit 0 and reverse the transformed
geometric and shading normals so world-space winding/front-face semantics remain correct.

TLAS closest-hit traversal keeps the current closest world `t`, tests each referenced
instance's BLAS with that `tMax`, and returns geometry, triangle, instance, and material
IDs. Any-hit traversal exits on the first BLAS hit in range. Use separate 64-entry stacks
for the TLAS and current BLAS. Fail preparation when either built depth is too large;
never silently skip nodes on stack overflow.

Cache BLAS by `(geometry.id, geometry.revision)`. Scene `geometryRevision` tells the
coordinator to rescan geometry cache keys; unchanged per-geometry revisions reuse their
BLASes. Transform-only changes rebuild the TLAS from cached BLAS geometry bounds. The MVP
rebuilds rather than refits the TLAS because the deterministic CPU builder is the
reference; add refitting only after profiling.

### Path integration MVP

For each sample:

```text
radiance = 0
throughput = 1
ray = camera ray with sub-pixel jitter

for bounce in [0, maxBounces):
  hit = closest BVH hit
  if miss:
    radiance += throughput * environment
    break

  radiance += throughput * material.emissive

  if material is diffuse and a light exists:
    sample one point on the rectangular light
    trace an any-hit shadow ray
    if visible:
      add throughput * BRDF * emittedRadiance * geometryTerm / lightPdf

  sample cosine-weighted diffuse hemisphere
  throughput *= material.baseColor
  spawn next ray using the numerical policy

  after bounce 2:
    survival = clamp(max(throughput), 0.05, 0.95)
    terminate when random > survival
    throughput /= survival
```

Use next-event estimation for non-specular surfaces. In the diffuse-only MVP, add emission
from an intersected area-light triangle only for the primary camera ray (`bounce === 0`);
later diffuse bounces receive that light only through next-event estimation. This avoids
double-counting without introducing MIS yet and must match in CPU and WGSL.
For a rectangular light, U and V are half-extent vectors: sample
`center + (2*r1-1)*U + (2*r2-1)*V`, area is `4*length(cross(U,V))`, and area PDF is
`1/area`. Direct contribution uses Lambertian `baseColor/pi`, both surface and light
cosines, inverse squared distance, and emitted radiance `lightColor*intensity`. Reject
samples whose surface or light cosine is non-positive.
Default settings: `maxBounces = 4`, `samplesPerFrame = 1`, fixed seed `0x12345678` for
tests, randomized seed for interactive use.

Use xorshift32 exactly: replace zero seed with `0x6d2b79f5`; then apply
`x ^= x << 13`, `x ^= x >>> 17`, `x ^= x << 5`, truncating to unsigned 32-bit after each
state transition. Convert to `[0,1)` with `(x >>> 8) * (1 / 16777216)`. Define this in
`random.js`, copy it verbatim into WGSL, and test the first ten outputs against fixed
expected values. Starting at `0x12345678`, the states are `0x87985aa5`, `0x155b24a3`,
`0x4820f4c4`, `0x81b3ac98`, `0x703a0788`, `0x29a8e24d`, `0x89ca4f1d`, `0xc5186e29`,
`0xd37862a7`, and `0x3ab14b11`.

### CPU worker protocol

The MVP uses **one worker**, not a pool. This avoids cloning the whole scene/BLAS/TLAS per worker
or requiring cross-origin-isolated `SharedArrayBuffer`. A pool is a follow-up after memory
and scaling measurements.

Main thread to worker:

```js
{ type: 'init', generation, preparedScene, acceleration, settings }
{ type: 'update-instances', generation, instances, tlas, instanceRevision }
{ type: 'render', generation, width, height, cameraFrame, passIndex, tileSize: 32 }
{ type: 'cancel', generation }
{ type: 'destroy' }
```

Worker to main thread:

```js
{ type: 'ready', generation }
{ type: 'tile', generation, x, y, width, height, spp, rgbaBuffer }
{ type: 'pass-complete', generation, spp, elapsedMs, rays }
{ type: 'error', generation, message, stack }
```

The worker owns `Float32Array` running-average RGB plus one uniform SPP count, using the
same update equation as the GPU path. A tile message contains tone-mapped
`Uint8ClampedArray` RGBA bytes and transfers its buffer. Check for cancel/generation
changes between tiles and at least once per bounce loop. The controller ignores every
message whose generation is not current.

Use a dedicated CPU presentation canvas or replace the viewport canvas when entering CPU
mode: a canvas that has already returned a WebGL/WebGPU context cannot later become a 2D
canvas. The coordinator must retain `RayScene`, camera pose, and revisions outside the
backend instance so canvas replacement does not require asset re-import.

### GPU path-tracing passes

`RayTraceRenderer.record(frame, drawable)` records exactly two passes:

1. **Trace compute pass** — workgroup size `8 x 8`; dispatch
   `ceil(width/8) x ceil(height/8)`. Read scene/BLAS/TLAS/uniform buffers and previous
   accumulation, then write the next running-average linear color.
2. **Display render pass** — fullscreen triangle; read the running average, tone-map,
   convert to sRGB, and write `targetView`.

Use ping-pong `rgba16float` accumulation textures because a shader must not sample and
write the same texture in one pass. To avoid half-float overflow, RGB stores a running
average, not an ever-growing sum:
`next = (previous * oldSpp + batchSampleSum) / (oldSpp + batchSpp)`; alpha is `1`.
The display pass therefore reads the average directly (it does not divide again). Store
sample count in a uniform `u32` while every pixel receives the same number of samples.
Recreate both textures on resize. A reset sets sample count to zero and clears both
textures before the next trace dispatch.

The renderer owns pipelines, bind groups, accumulation textures, scene storage buffers,
and diagnostics. It borrows `frame.targetView`, device, camera matrices, and the immutable
source ray drawable. `releaseDrawable()` destroys only buffers created by the ray drawable;
`destroy()` is idempotent and destroys all renderer-owned resources.

### Hybrid shadow passes

Record three ordered passes in the same command encoder:

1. **G-buffer raster pass**: depth `depth24plus`; normal `rgba16float`; albedo
   `rgba8unorm`; world position `rgba16float` for the MVP. Clear alpha to zero so compute
   can skip background pixels. Position reconstruction from depth is an optimization.
2. **Shadow compute pass**: one invocation per pixel, `8 x 8` workgroups. For pixels with
   valid G-buffer alpha, offset the origin and perform any-hit TLAS-to-BLAS traversal. Write one
   visibility value to the red channel of an `rgba8unorm` storage texture; write
   `[visibility, 0, 0, 1]`.
3. **Composite render pass**: fullscreen triangle into `targetView`, applying
   `albedo * (ambient + visibility * NdotL * lightRadiance)` and tone mapping.

MVP lights are directional and point. A point-light shadow hit counts only when
`hit.t < distanceToLight - epsilon`. Back-face culling in the G-buffer must match current
raster behavior, but BVH shadow traversal is two-sided unless the material explicitly
becomes one-sided in a later phase.

Hybrid binding ownership:

- G-buffer group 0: frame/model matrices; group 1: per-primitive material uniform,
  sampler, and base-color texture. Use the existing 1x1 default texture when absent.
- Shadow group 0: shadow/frame uniform plus the same six read-only ray-scene buffers used
  by the path tracer; group 1: world-position and normal textures plus write-only shadow
  texture.
- Composite group 0: albedo, normal, shadow textures and one display/light uniform.

Use explicit pipeline layouts. Sharing a helper that creates the six scene-buffer layout
entries is encouraged; sharing whole bind groups between path tracing and hybrid modes is
not, because their lifetimes and non-scene bindings differ.

Resize creates a complete new G-buffer set before destroying the old set. Bind groups are
rebuilt only when pipeline, scene buffers, or attachment views change—not every frame.

## Implementation packets

One coding-agent task implements one packet. Complete packets in dependency order and run
the listed focused command plus `npm test -- --runInBand` before handoff. A packet is not
complete when tests are skipped, existing tests are weakened, or unrelated files are
reformatted.

Each handoff prompt should use this template:

```text
Implement packet RT-XXX from docs/ray-tracing-plan.md.

Read the packet, the contracts it references, and the current versions of its allowed
files. Stay within Allowed files. Preserve all existing APIs unless the packet explicitly
changes one. Implement the requirements, add the named tests, run the focused verification
and the full Jest suite, then report changed files, test results, and any contract mismatch.

Do not begin another packet. Do not redesign adjacent modules. If the documented contract
cannot work, stop and explain the smallest required document/interface change.
```

### RT-001 — Camera-ray math

**Depends on:** none.

**Allowed files:** `scripts/engine/matrix.js`, `scripts/engine/camera.js`, new
`scripts/engine/raytracing/core/camera-rays.js`, and
`__tests__/camera-rays.test.js`/existing matrix-camera tests.

**Requirements:** add a non-mutating 4x4 inverse with singular-matrix failure; define and
test matrix convention; create an orthonormal camera frame from eye/target/up/FOV/aspect;
generate normalized center/corner rays with explicit sub-pixel jitter; add the camera
state/lifecycle methods specified above while preserving `setPose`. Existing raster camera
behavior must not change. No renderer or UI integration.

**Focused verification:**
`npm test -- --runInBand __tests__/matrix.test.js __tests__/camera.test.js __tests__/camera-rays.test.js`

**Done when:** identity and known transform inverses pass; multiplying a matrix by its
inverse is identity within `1e-5`; an odd-sized image's center pixel with `[0.5, 0.5]`
jitter points at the camera target.

### RT-002 — Ray-scene core

**Depends on:** RT-001.

**Allowed files:** new `scripts/engine/raytracing/core/ray-scene.js` and
`__tests__/ray-scene.test.js`.

**Requirements:** add the JSDoc types, `createEmptyRayScene`, validation,
`prepareRayScene`, local geometry bounds, eight-corner world instance bounds, inverse
transform validation, unique stable geometry/instance IDs, per-geometry revisions,
material index validation, and aggregate scene bounds. Convert all indices to
`Uint32Array`. Validation returns all detected errors in stable order and never
logs or throws; preparation throws one aggregate error for an invalid scene. Do not bake
instance transforms into vertices. No glTF knowledge and no GPU packing.

**Focused verification:** `npm test -- --runInBand __tests__/ray-scene.test.js`

**Done when:** tests cover empty scene, one local-space triangle, two transformed instances
sharing geometry, rotated/non-uniform-scale eight-corner bounds, singular transforms,
invalid indices/materials, and stable scene bounds.

### RT-003 — Procedural Cornell Box

**Depends on:** RT-002.

**Allowed files:** new `scripts/engine/raytracing/core/cornell-box.js` and
`__tests__/cornell-box.test.js`.

**Requirements:** return a valid `RayScene` using reusable local-space unit-quad and
unit-cube geometry helpers plus explicit instance transforms.
Canonical coordinates are room `x=[-1,1]`, `y=[0,2]`, `z=[-1,1]`, open at `z=1`;
camera eye `[0,1,3.2]`, target `[0,1,0]`, FOV 40 degrees; ceiling rectangle light at
center `[0,1.99,-0.2]` with half-extent vectors `[0.25,0,0]` and `[0,0,0.2]`;
white `[0.73,0.73,0.73]`, red-left `[0.65,0.05,0.05]`, green-right
`[0.12,0.45,0.15]`, and emissive `[1,0.95,0.8]` at strength `15`; short box center
`[-0.38,0.3,0.1]`, size `[0.6,0.6,0.6]`, yaw `-18` degrees; tall box center
`[0.35,0.6,-0.25]`, size `[0.55,1.2,0.55]`, yaw `15` degrees. Normals face into the
room. Use a shared local unit quad for room/emitter instances and one shared local unit cube
for both box instances, demonstrating BLAS reuse. Generate 36 instanced triangles total:
10 room, 12 per box, and 2 emitter. No renderer code.

**Focused verification:** `npm test -- --runInBand __tests__/cornell-box.test.js`

**Done when:** scene validation succeeds; expected material/light counts and bounds are
asserted; all triangle indices are in range; non-emissive room normals face inward.

### RT-004 — Brute-force intersections

**Depends on:** RT-002.

**Allowed files:** new `scripts/engine/raytracing/acceleration/intersections.js` and
`__tests__/intersections.test.js`.

**Requirements:** implement slab AABB and Moller-Trumbore triangle intersection, closest
brute-force scene traversal across instances, world-to-local ray transformation without
direction renormalization, barycentric shading-normal interpolation, inverse-transpose
world normals, mirrored-transform winding, two-sided hits, and the numerical policy above.
Do not implement a BVH in this packet.

**Focused verification:** `npm test -- --runInBand __tests__/intersections.test.js`

**Done when:** deterministic tests cover closest hit, miss, parallel ray, edge hit,
back-face hit, inside-AABB origin, `tMin` self-hit rejection, and degenerate triangle.

### RT-005 — Deterministic generic BVH and BLAS

**Depends on:** RT-004.

**Allowed files:** new acceleration modules `bvh-builder.js` and `blas-builder.js`, updates
to `intersections.js`, and focused `bvh-builder.test.js`, `blas-builder.test.js`, and
intersection tests. Do not add TLAS/instance traversal yet.

**Requirements:** implement the exact generic median-split algorithm, the 32-byte logical
node contract, local-space triangle records, one BLAS per geometry, and closest-hit/any-hit
BLAS traversal with a 64-entry stack. Return diagnostics instead of silently overflowing.
No TLAS, instances, WGSL, or GPU buffers.

**Focused verification:**
`npm test -- --runInBand __tests__/bvh-builder.test.js __tests__/blas-builder.test.js __tests__/intersections.test.js`

**Done when:** BLAS and local brute-force hits match for at least 1,000 seeded random rays;
every child/leaf/bounds invariant passes; empty and degenerate inputs are covered; identical
input produces identical node and triangle-reference order.

### RT-005A — TLAS and two-level traversal

**Depends on:** RT-005.

**Allowed files:** new `tlas-builder.js` and `acceleration-structure.js`, updates to
`intersections.js`, and focused `tlas-builder.test.js`/intersection tests. Do not change
the generic node layout or BLAS partitioning.

**Requirements:** build world-space TLAS records from eight-corner transformed geometry
bounds; implement closest-hit/any-hit TLAS-to-BLAS traversal, affine local rays without
renormalization, inverse-transpose normals, mirrored-winding flags, separate 64-entry
stacks, and revision-aware BLAS reuse/TLAS rebuilds.

**Focused verification:**
`npm test -- --runInBand __tests__/tlas-builder.test.js __tests__/blas-builder.test.js __tests__/intersections.test.js`

**Done when:** two-level and brute-force hits match for at least 1,000 seeded rays over
scenes containing shared geometry, rotation, non-uniform scale, and a mirrored instance;
TLAS invariants pass; transform-only rebuilds reuse BLAS object identity; closest world
`t`, normals, and instance/material IDs match the oracle.

### RT-006 — Seeded RNG and CPU integrator

**Depends on:** RT-003, RT-005A.

**Allowed files:** new `scripts/engine/raytracing/core/random.js`,
`scripts/engine/raytracing/cpu/path-integrator.js`, and
`__tests__/path-integrator.test.js`.

**Requirements:** implement xorshift32, uniform float conversion, cosine hemisphere
sampling, rectangular-light sampling, direct shadow rays, Lambertian bounces, emission,
Russian roulette, Reinhard tone mapping, and linear/sRGB conversions. Every random draw
comes from explicit state. No workers, DOM, or full-image loop.

**Focused verification:** `npm test -- --runInBand __tests__/path-integrator.test.js`

**Done when:** fixed RNG vectors pass; a miss returns environment; an unoccluded diffuse
point is brighter than an occluded one; emitted radiance is visible; seeded samples are
repeatable and finite.

### RT-007 — CPU worker and controller

**Depends on:** RT-001, RT-003, RT-005A, RT-006.

**Allowed files:** new `scripts/engine/raytracing/cpu/cpu-ray-worker.js`,
`cpu-ray-controller.js`, `__tests__/cpu-ray-controller.test.js`, and Jest setup only if a
minimal Worker mock requires it.

**Requirements:** implement the exact message protocol, 32x32 tiled progressive loop,
worker-owned float accumulation, stale-generation cancellation, transferable RGBA tiles,
stats, error forwarding, and idempotent destroy. The controller accepts injected
`workerFactory` and `presentTile` functions so Jest needs no real browser worker/canvas.

**Focused verification:** `npm test -- --runInBand __tests__/cpu-ray-controller.test.js`

**Done when:** tests cover init/render ordering, stale tile rejection, reset generation,
pass completion stats, worker error, and double destroy. Full image rendering is not UI
integrated yet.

### RT-008 — GPU buffer packer

**Depends on:** RT-002, RT-005A.

**Allowed files:** new `scripts/engine/raytracing/gpu/gpu-ray-layout.js`,
`gpu-scene-packer.js`, and `__tests__/gpu-scene-packer.test.js`.

**Requirements:** pack local vertices, triangles, instances, materials, TLAS-first combined
BVH nodes, and combined leaf references to the exact layouts above using
`ArrayBuffer`/`DataView`. Adjust concatenated vertex/triangle/node/leaf offsets and write
each packed instance's BLAS root. Return packing metadata and support an in-place logical
TLAS-prefix repack when instance count is stable. Export byte sizes and offsets. Reject
non-finite values, invalid references, and values exceeding `u32`. No `GPUDevice` usage.

**Focused verification:** `npm test -- --runInBand __tests__/gpu-scene-packer.test.js`

**Done when:** tests inspect every field by byte offset, pack two instances sharing one
BLAS only once, verify adjusted TLAS/BLAS child and leaf offsets, cover empty dummy-buffer
metadata, prove a transform-only update changes only TLAS/instance byte ranges, and prove
input arrays are not mutated.

### RT-009 — glTF parser/data split

**Depends on:** RT-002.

**Allowed files:** `scripts/engine/gltf-parser.js`, new
`scripts/engine/gltf-upload.js`, focused glTF fixtures under `__tests__/fixtures/`, and
`__tests__/gltf-parser.test.js`. Do not edit a renderer or React.

**Requirements:** preserve `parseGltfForBackend` behavior while separating parsed asset
data from WebGL/WebGPU upload. First make current single-primitive behavior flow through a
backend-neutral asset. Retain source typed arrays/material metadata for ray conversion.
This packet is a compatibility refactor only—no new glTF feature support.

**Focused verification:** `npm test -- --runInBand __tests__/gltf-parser.test.js`

**Done when:** existing sample/folder paths still return equivalent drawables in mocked
WebGL/WebGPU tests and the parsed asset can be converted to a valid one-geometry RayScene.

### RT-010 — glTF static-scene expansion

**Depends on:** RT-009.

**Allowed files:** the parser/upload files and glTF tests/fixtures from RT-009 plus pure
matrix helpers when required. Do not edit renderers or UI.

**Requirements:** support all scene-referenced nodes, mesh primitives with triangle mode,
node TRS/matrix transforms, mesh instancing, and multiple materials using the currently
supported external-buffer accessor forms. Produce both raster primitive payloads and a
valid RayScene. Emit clear errors for unsupported primitive modes and deferred features.

**Focused verification:**
`npm test -- --runInBand __tests__/gltf-parser.test.js __tests__/ray-scene.test.js`

**Done when:** a fixture with two nodes, two primitives, two materials, non-uniform scale,
and mesh instancing produces shared local RayScene geometries, correct instance transforms,
and matching raster payloads without duplicating the instanced geometry arrays.

### RT-010A — glTF accessor and GLB robustness

**Depends on:** RT-010.

**Allowed files:** the parser/upload files and glTF tests/fixtures from RT-009/RT-010 plus
pure geometry helpers for normal generation. Do not edit renderers or UI.

**Requirements:** implement accessor byte stride, normalized integer conversion, multiple
external buffers, absent indices, absent normals, and `uint32` indices; parse GLB v2 header
and JSON/BIN chunks with length/type validation. Copy misaligned/strided accessors into
tight arrays. Reject sparse accessors, Draco/meshopt, skins, morphs, and alpha blend/mask
with feature-specific errors.

**Focused verification:** `npm test -- --runInBand __tests__/gltf-parser.test.js`.

**Done when:** fixtures cover strided positions, normalized attributes, missing normals
and indices, a 32-bit index accessor, multiple buffers, valid GLB, malformed GLB, and each
deferred-feature error.

### RT-010B — WebGPU multi-primitive mesh drawable

**Depends on:** RT-010A.

**Allowed files:** `scripts/engine/webgpu-facade.js`,
`scripts/engine/renderers/mesh-renderer.js`, `scripts/engine/webgpu-helpers.js` only when a
generic buffer helper is missing, and focused mesh-renderer/facade tests. No glTF parsing,
ray traversal, or UI changes.

**Requirements:** implement the backward-compatible `primitives` drawable contract and
pure legacy adapter above; upload every raster primitive; draw each with its own texture,
material uniform buffer, bind group, and instance world matrix while sharing camera and
user-model matrices; preserve existing cube/sphere/single-primitive behavior and stats.
Cache per-drawable primitive GPU state, release it idempotently, and do not destroy
textures/buffers borrowed by hybrid rendering until the asset itself is replaced.

**Focused verification:** mesh-renderer tests plus
`npm test -- --runInBand __tests__/webgpu-facade.test.js`.

**Done when:** mocked recording of a two-primitive drawable performs two indexed draws
with distinct material bind groups; legacy drawables still perform one; replacement and
destroy release every owned resource once.

### RT-011 — GPU resource helpers

**Depends on:** RT-008.

**Allowed files:** new `scripts/engine/raytracing/gpu/gpu-ray-helpers.js` and
`__tests__/gpu-ray-helpers.test.js`.

**Requirements:** create/destroy scene storage buffers, uniform/diagnostic buffers,
ping-pong accumulation textures, clear pass, and bind groups from injected device/pipeline
objects. Add helpers for partial TLAS-prefix/instance-buffer writes without recreating
static vertex/triangle buffers. Validate device storage-buffer limits before allocation.
No renderer/RAF logic.

**Focused verification:** `npm test -- --runInBand __tests__/gpu-ray-helpers.test.js`

**Done when:** mocked-device tests assert usage flags, aligned sizes, resize replacement,
limit failures, bind-group resources, and idempotent cleanup.

### RT-012 — GPU direct-light renderer

**Depends on:** RT-001, RT-003, RT-005A, RT-008, RT-011.

**Allowed files:** new `scripts/engine/renderers/raytrace-renderer.js`,
`assets/shaders/raytrace.wgsl`, and `__tests__/raytrace-renderer.test.js`.

**Requirements:** implement `Renderer` lifecycle and the two-pass GPU contract. First WGSL
milestone is primary rays, closest-hit TLAS-to-BLAS traversal, emission/environment, one sampled
direct light, and hard shadows. Set max bounces to one in this packet; no progressive
indirect bounces yet. WGSL structures must match RT-008 layouts exactly.

**Focused verification:** `npm test -- --runInBand __tests__/raytrace-renderer.test.js`

**Done when:** mocked tests assert preparation, dispatch dimensions, pass order, resize,
reset, and cleanup; shader compilation is manually validated in Chrome with Cornell Box
before integration is marked complete.

### RT-013 — Progressive GPU path integration

**Depends on:** RT-006, RT-012.

**Allowed files:** raytrace renderer/shader/tests from RT-012.

**Requirements:** port the specified PRNG/integrator to WGSL, add bounded multi-bounce
iteration, ping-pong accumulation, samples-per-frame, reset keys, Russian roulette, and
diagnostic counters. Do not add new materials or denoising.

**Focused verification:** `npm test -- --runInBand __tests__/raytrace-renderer.test.js`

**Done when:** a deterministic low-resolution GPU readback is within documented tolerance
of CPU direct-light output; SPP increases only on stable revisions and resets on all six
revision changes.

### RT-014 — WebGPU registry integration

**Depends on:** RT-012; RT-013 may follow without interface changes.

**Allowed files:** `scripts/engine/webgpu-scene.js`,
`scripts/engine/webgpu-facade.js`, `scripts/engine/renderers/renderer.js` only if the
documented optional hook is needed, and relevant facade/scene tests.

**Requirements:** register ray tracing without putting algorithms in `webgpu-scene.js`;
add facade methods `loadRayScene`, `loadCornellBox`, `setRenderMode`, and
`setRayTracingSettings`; preserve the current mesh/splat renderer selection. BLAS
preparation occurs only on geometry revision; instance revision reuses BLASes and rebuilds
only the TLAS, partially uploading its prefixes/instances when count is stable. Add
idempotent scene `pause()`/`resume()` without accumulating RAF callbacks.
Pause user-script animation (not camera/rendering) on entry to progressive CPU/GPU ray
mode and restore its prior state on exit; hybrid mode keeps it running. Existing drawable
behavior remains default.

**Focused verification:**
`npm test -- --runInBand __tests__/webgpu-facade.test.js __tests__/raytrace-renderer.test.js`

**Done when:** mocked mode switches select the right renderer, retain camera/scene state,
and release only the outgoing mode's owned resources; all existing WebGPU tests pass.

### RT-015 — Hybrid G-buffer foundation

**Depends on:** RT-010B, RT-014.

**Allowed files:** new `scripts/engine/raytracing/hybrid/gbuffer-layout.js`,
`scripts/engine/renderers/hybrid-shadow-renderer.js`, `hybrid-gbuffer.wgsl`,
`hybrid-composite.wgsl`,
`__tests__/hybrid-shadow-renderer.test.js`, and the minimal registry/facade lines needed
to register it.

**Requirements:** implement the exact G-buffer and composite passes, attachment resize,
multi-primitive static opaque glTF draws, directional/point direct lighting, and a constant
visibility of one. Keep a stable binding slot for the shadow texture but populate a 1x1
white fallback in this packet. No BVH bindings or shadow compute yet.

**Focused verification:**
`npm test -- --runInBand __tests__/hybrid-shadow-renderer.test.js __tests__/webgpu-facade.test.js`

**Done when:** mocked G-buffer/composite ordering and lifecycle tests pass; the selected
multi-primitive glTF fixture matches raster materials/lighting closely enough for shadow
integration; resize and double destroy produce zero validation errors.

### RT-015A — Hybrid any-hit hard shadows

**Depends on:** RT-008, RT-011, RT-015.

**Allowed files:** the hybrid renderer/tests from RT-015, new
`assets/shaders/hybrid-shadow.wgsl`, and minimal facade/stats lines. Do not change glTF
parsing, the shared BLAS/TLAS format, or UI.

**Requirements:** insert the specified shadow compute pass between G-buffer and composite;
bind the shared packed scene/BLAS/TLAS; implement two-sided any-hit traversal, directional and
point-light `tMax`, scale-aware normal bias, `rgba8unorm` visibility output, and stats
timing label `shadow`. No soft shadows, animation BVH refit, skinning, morphs, or denoising.

**Focused verification:**
`npm test -- --runInBand __tests__/hybrid-shadow-renderer.test.js __tests__/webgpu-facade.test.js`

**Done when:** mocked three-pass ordering/lifecycle tests pass and the selected glTF manual
fixture shows stable cast, receive, and contact shadows with zero WebGPU validation errors.

### RT-016 — CPU facade and mode coordinator

**Depends on:** RT-007, RT-010A.

**Allowed files:** new `scripts/engine/cpu-ray-facade.js`,
`scripts/engine/raytracing-coordinator.js`, `scripts/engine/app-facade.js`, the minimal
`webgl-facade.js`/`scene.js` changes needed for idempotent pause/resume, and focused facade
tests (`__tests__/cpu-ray-facade.test.js` and
`__tests__/raytracing-coordinator.test.js`). No React changes.

**Requirements:** implement the exact coordinator contract; orchestrate retained
RayScene/revisions and the CPU controller using an injected 2D canvas; preserve camera pose
when changing execution mode; guarantee one active presentation loop; expose the same
settings/stats concepts as GPU mode; terminate workers on destroy. Do not add UI yet.

**Focused verification:**
`npm test -- --runInBand __tests__/cpu-ray-facade.test.js __tests__/raytracing-coordinator.test.js __tests__/camera.test.js`.

**Done when:** a programmatic Cornell load produces progressive tiles through an injected
presentation spy, mode exit terminates the worker, and returning to GPU mode can reuse the
retained scene.

### RT-016A — Dual-context viewport presentation

**Depends on:** RT-016.

**Allowed files:** a new focused viewport component under `ui/src/`, the minimal `App.jsx`
and stylesheet changes required to mount it, and UI build/tests. No engine algorithms or
settings controls.

**Requirements:** mount separate raster/WebGPU and CPU 2D canvases in the same viewport;
show exactly one; route camera input to the visible canvas; preserve existing canvas sizing
semantics; pass the CPU canvas into the coordinator; keep existing
canvas IDs/test hooks on the raster canvas unless the visual harness is deliberately
updated in RT-018.

**Focused verification:** `npm --prefix ui run build` and the full root Jest suite.

**Done when:** switching presentation does not request two context types from one canvas,
does not resize-loop, and preserves camera state and current scene in both directions.

### RT-017 — Editor controls and stats

**Depends on:** RT-014, RT-015A, RT-016A.

**Allowed files:** `ui/src/App.jsx`, new focused UI components/hooks, `ui/src/styles.css`,
and UI tests if introduced. Engine algorithms are out of scope.

**Requirements:** add Examples/Cornell Box, render-mode controls, capability gating,
settings named in Phase 5, reset/pause, and extended stats. Extract ray controls from
`App.jsx`; do not make that component materially larger. Preserve existing splat settings
and asset workflows. Show animation pause/resume separately from accumulation pause/resume
so resuming transforms has an explicit convergence cost.

**Focused verification:** `npm --prefix ui run build` and full root Jest suite.

**Done when:** all valid mode transitions work without reload; invalid combinations are
disabled with reasons; errors use the existing error surface; keyboard/mouse camera input
targets the visible canvas only.

### RT-018 — Ray visual harness and release gate

**Depends on:** RT-013, RT-015A, RT-017.

**Allowed files:** `visual/`, `package.json`, ray-specific docs, and minimal test hooks in
UI/engine code.

**Requirements:** add seeded CPU/GPU Cornell cases, accumulation-reset capture, and glTF
shadow cases; compare linear output using RMSE/SSIM rather than only pixelmatch; document
local fixtures and hardware/adapter metadata; run existing splat visual cases unchanged.

**Focused verification:** `npm run visual` after locally generating explicitly reviewed
goldens; `npm test -- --runInBand`; `npm --prefix ui run build`.

**Done when:** acceptance criteria have recorded evidence and no golden is updated merely
to hide an unexplained regression.

### Packet and phase review protocol

The planning/review model performs a short review after every packet and a full integration
review at each phase boundary.

Packet review:

1. Compare changed files with the packet's allow-list.
2. Check exported signatures and packed offsets against this document.
3. Confirm new tests fail for a plausible broken implementation, not merely execute lines.
4. Run the focused command and full Jest suite; run the UI build when UI/import boundaries
   changed.
5. Inspect resource ownership, mutation, error propagation, and deterministic behavior.
6. Record any deliberate deviation in this document before the next dependent packet.

Phase review:

1. Run every packet gate in the phase from a clean checkout/worktree state.
2. Exercise the phase exit scenario manually and record browser/GPU adapter/resolution.
3. Confirm existing raster mesh and splat behavior is unchanged.
4. Check that no lower layer imports from a higher layer.
5. Check mode/asset replacement and double-destroy with validation enabled.
6. Update packet status below only after evidence exists.

Implementation status:

| Packet | Status | Evidence |
|---|---|---|
| RT-001 | Complete | `de98c31`; matrix/camera/camera-ray focused tests |
| RT-002 | Complete | `9427022`; `npm test -- --runInBand __tests__/ray-scene.test.js` |
| RT-003 | Complete | `a54aab7`; `npm test -- --runInBand __tests__/cornell-box.test.js` |
| RT-004 | Complete | `fe34b29`; `npm test -- --runInBand __tests__/intersections.test.js` |
| RT-005 | Complete | `dcc422b`; BVH/BLAS/intersection focused tests, including 1,000 seeded rays |
| RT-005A | Complete | `46c90d6`; TLAS/BLAS/intersection focused tests, including 1,000 seeded rays |
| RT-006 through RT-010 | Not started | — |
| RT-010A | Not started | — |
| RT-010B | Not started | — |
| RT-011 through RT-015 | Not started | — |
| RT-015A | Not started | — |
| RT-016 | Not started | — |
| RT-016A | Not started | — |
| RT-017 through RT-018 | Not started | — |

Split this row as packets begin. Use only `Not started`, `In progress`, `Blocked`, or
`Complete`; link the completing commit/PR and name the verification commands in Evidence.

## Implementation phases

### Phase 0 — Lock scope and measurements

- Define MVP material support: diffuse/base color and emissive area lights. Treat
  metallic/roughness and textured path tracing as follow-ups; hybrid mode should retain
  base-color textures from the start.
- Define the performance scenes and target hardware before optimizing. Suggested gates:
  Cornell Box at 512 x 512; and a 50k–100k triangle glTF at viewport resolution.
- Add stats fields for render mode, rays/sec, samples per pixel (SPP), separate BLAS/TLAS
  build times, triangle/instance counts, and GPU pass timing.
- Use deterministic seeds in tests; never compare noisy, unseeded captures.

Exit: the mode names, supported material subset, fixtures, and measurement protocol are
documented and agreed.

**Packets:** planning gate only; no implementation packet starts until this exit is
accepted.

### Phase 1 — Shared scene extraction and glTF correctness

- Split `parseGltfAsset` into parsing and backend upload. Return retained typed arrays,
  materials, images, node transforms, and primitive ranges.
- Support every triangle primitive in every mesh referenced by the scene graph, not only
  `meshes[0].primitives[0]`.
- Retain node transforms as instances and apply them correctly at render/traversal time,
  including inverse-transpose normal handling; do not bake duplicate world-space meshes.
- Add missing practical cases: absent normals (generate them), absent indices (generate
  sequential indices), `UNSIGNED_INT` indices, multiple buffers, and GLB embedded chunks.
- Reject or clearly defer non-triangle primitive modes, skinning, morph targets, alpha
  blending, and compressed Draco/meshopt geometry.
- Change drawable creation so raster GPU buffers and ray-scene data derive from the same
  parsed asset instead of parsing twice.

Exit: a multi-primitive glTF fixture produces correct local geometries, world-space
instances, materials, and raster drawable without regressing current asset loading.

**Packets:** RT-001, RT-002, RT-009, RT-010, RT-010A, RT-010B.

### Phase 2 — Cornell Box and CPU reference tracer

- Add `createCornellBoxScene()` with five room planes, red/green walls, two boxes, and a
  rectangular ceiling emitter. Build it from explicit triangles so it exercises the same
  path as imported meshes.
- Implement tested AABB and triangle intersections in plain JavaScript.
- Build the deterministic median-split BLAS/TLAS specified above on the main thread;
  move construction to a worker before integrating large glTF assets if measurement shows
  visible UI stalls.
- Implement a CPU path integrator: camera rays, Lambertian bounce sampling, next-event
  estimation for the rectangular light, shadow rays, Russian roulette after several
  bounces, and linear-to-sRGB display conversion.
- Render tiles in one Web Worker for the MVP. Transfer scene buffers once, return tile
  pixel buffers, and progressively accumulate samples without blocking camera/UI input.
- Restart accumulation when camera, resolution, scene transform, light, material, or
  integrator settings change. Use a monotonically increasing generation ID to discard
  stale worker results.

Exit: the CPU mode renders a recognizable, deterministic Cornell Box with direct shadows,
indirect color bleeding, and no main-thread stalls.

**Packets:** RT-003 through RT-005, RT-005A, RT-006 through RT-007, then RT-016 and
RT-016A for presentation integration.

### Phase 3 — WebGPU compute path tracer

- Pack the exact Phase 2 scene/BLAS/TLAS into storage buffers.
- Add a `RayTraceRenderer` with:
  1. an `rgba16float` accumulation texture,
  2. a compute pass that traces one or more samples per pixel,
  3. a display/tone-map pass to the swap-chain texture,
  4. reset logic keyed to camera/scene/settings revisions.
- Start with one invocation per pixel and a bounded iterative traversal stack in WGSL.
  Record stack overflow/debug counters in a small diagnostics buffer.
- Match CPU sampling and shading semantics, allowing floating-point tolerance rather than
  pixel identity.
- Cap work per animation frame using `samplesPerFrame`; preserve orbit responsiveness by
  temporarily dropping to one sample while the camera moves.
- Guard buffer and texture dimensions against WebGPU device limits and report actionable
  errors through the existing `onError` path.

Exit: GPU Cornell Box output converges toward the CPU reference and resets correctly on
every scene/camera change. No GPU validation errors or leaked textures/buffers occur during
mode switching and resize.

**Packets:** RT-008, RT-011 through RT-014.

### Phase 4 — Real-time ray-traced shadows for glTF

Implement this as a hybrid renderer rather than a full path-traced editor viewport:

1. Rasterize glTF primary visibility into a G-buffer containing world position (or
   reconstruct it from depth), world normal, material/base color, and depth.
2. Dispatch a compute pass over visible pixels. Trace toward a directional/point light;
   return visibility `0` when TLAS/BLAS traversal finds any hit before the light and `1`
   otherwise.
3. Composite base color, direct lighting, ambient term, and visibility into the canvas.
4. Add a small world-space normal bias and a scale-aware epsilon to avoid self-shadowing.
5. Add optional 4–8 jittered rays plus temporal accumulation for soft shadows from a
   rectangular light. Hard shadows ship first.

The glTF scene must both cast and receive shadows. The MVP does not inject hidden geometry:
the manual/visual fixture includes a ground-plane primitive in the glTF alongside the
object. Automatic editor ground planes and multi-asset scenes are follow-ups.

For animation, distinguish transform-only and deforming changes:

- Transform-only: rebuild the TLAS while reusing every mesh BLAS. TLAS refitting is a
  measured follow-up.
- Skinned/morphed mesh: explicitly unsupported in the MVP; refitting/rebuilding its BLAS
  every frame is separate work.

Exit: an opaque static glTF mesh casts and receives a stable real-time shadow while the
camera or light moves, with the shadow pass time visible in the stats overlay.

**Packets:** RT-015 and RT-015A.

### Phase 5 — UI, lifecycle, and editor integration

- Keep `backend` as `webgl | webgpu`; add `renderMode` as
  `raster | raytrace-cpu | raytrace-gpu | hybrid-shadows`.
- Add `Examples > Cornell Box` and make it select the last-used CPU/GPU ray execution
  mode. Do not package the Cornell Box as glTF; procedural data is deterministic and
  easier to test.
- Add compact controls for SPP, max bounces, samples/frame, light type/intensity, shadow
  softness, accumulation reset, and pause/resume.
- Disable invalid combinations with an explanation: GPU modes require WebGPU; splats stay
  on their existing renderers; CPU mode uses a conservative resolution/sample preset.
- Preserve the active parsed scene and camera across mode changes. Rebuild BLASes only for
  geometry changes and the TLAS only for geometry/instance changes.
- Extend `getStats()` and `StatsOverlay` for BLAS/TLAS build time, SPP, rays/sec, and trace,
  denoise/composite pass times.
- Ensure `destroy()` terminates workers, invalidates pending messages, and destroys every
  accumulation/G-buffer/storage resource.

Exit: the user can load Cornell Box or a glTF, switch supported modes, edit/view the
scene, and return to raster mode without a reload or resource accumulation.

**Packets:** RT-016, RT-016A, and RT-017.

### Phase 6 — Quality and performance follow-ups

- Texture atlas or bindless-emulation strategy for multiple glTF base-color textures.
- Metallic-roughness BRDF, emissive glTF materials, environment lighting, MIS, and
  physically based tone mapping.
- TLAS refitting for multiple moving rigid objects; BLAS refit/rebuild for deforming mesh
  support only if that later enters scope.
- GPU BLAS/TLAS construction only if profiling shows worker-built construction is a
  bottleneck.
- Temporal/spatial shadow denoising, then low-SPP path-tracing denoising.
- Adaptive sampling and dynamic resolution while interacting.
- Optional WASM/SIMD CPU intersection kernel after the JavaScript reference is proven.

**Packet:** create new bounded packets only after profiling/review; these are deliberately
not part of the RT-001 through RT-018 MVP packet set (including RT-005A, RT-010A,
RT-010B, RT-015A, and RT-016A).

## Integration changes by existing file

- [gltf-parser.js](../scripts/engine/gltf-parser.js): become a complete asset-to-ray-scene
  parser and keep backend upload separate.
- [webgpu-facade.js](../scripts/engine/webgpu-facade.js): retain parsed scene data, cache
  per-geometry BLASes, rebuild TLASes on instance changes, and expose `setRenderMode`,
  `setRayTracingSettings`, and `loadCornellBox`.
- [webgpu-scene.js](../scripts/engine/webgpu-scene.js): register the two new GPU renderer
  strategies and expose revision/reset signals. It should not contain traversal logic.
- [mesh-renderer.js](../scripts/engine/renderers/mesh-renderer.js): remain the raster mode;
  share mesh resources where practical with the hybrid G-buffer renderer.
- [app-facade.js](../scripts/engine/app-facade.js): route CPU ray mode without pretending
  it is WebGL, and report capability flags to the UI.
- [App.jsx](../ui/src/App.jsx): add render-mode/example controls, settings, stats, and
  capability/error states. Extract these controls from the already large component while
  doing the integration.
- [matrix.js](../scripts/engine/matrix.js) and [camera.js](../scripts/engine/camera.js): add
  tested matrix inversion, camera ray-basis support, state transfer, and listener cleanup.

## Test and verification strategy

### Unit tests

- Known ray/triangle hit, miss, back-face, parallel, and edge cases.
- AABB hit ordering and rays originating inside a box.
- BLAS/TLAS traversal matches brute force over randomized instanced scenes.
- Every source triangle appears exactly once in its BLAS leaves; every instance appears
  exactly once in TLAS leaves; all bounds enclose descendants.
- Two instances of one geometry share one BLAS; changing only either transform preserves
  BLAS identity/content and changes only the TLAS.
- Non-uniform and mirrored transforms preserve closest-hit `t`, world normals, and
  front-face classification versus brute force.
- Cornell Box triangle/material/light counts and stable bounds.
- Camera center/corner rays match between CPU data and packed GPU uniforms.
- Accumulation resets for every revision source and not for unrelated UI changes.
- glTF nodes, multiple primitives/materials, generated indices/normals, and `uint32` data.

### GPU integration tests

- Mocked lifecycle tests for pipeline creation, resize, dispatch dimensions, mode switch,
  accumulation reset, and cleanup.
- Read back a tiny deterministic output (for example 16 x 16, one-bounce direct light)
  and compare selected pixels or luminance ranges with the CPU tracer.
- Assert BLAS/TLAS traversal diagnostic counters stay at zero for test scenes.

### Visual tests

- Cornell Box: CPU/GPU direct-only, 1 bounce, and multi-bounce seeded captures.
- Cornell Box camera move: confirm accumulation clears instead of ghosting.
- glTF: unoccluded, fully occluded, contact shadow, grazing light, and camera/light motion.
- Compare in linear space with a noise-aware RMSE/SSIM threshold; ordinary pixelmatch is
  too brittle for Monte Carlo output.

### Manual compatibility matrix

- Chrome and Edge on Apple Silicon, Intel integrated graphics, and one discrete GPU.
- WebGPU unavailable/denied, device lost, resize, background/foreground tab, and repeated
  mode switching.
- Small Cornell scene, medium static glTF, 32-bit-index glTF, textured glTF, and an asset
  exceeding the configured triangle/memory budget.

## Acceptance criteria

1. CPU and GPU modes consume the same ray-scene and produce materially matching seeded
   direct-light Cornell Box images within a documented tolerance.
2. Every unique geometry owns one reusable local-space BLAS; the scene owns one TLAS, and
   transform-only changes rebuild only that TLAS on both CPU and GPU paths.
3. Progressive Cornell Box rendering shows direct shadows and diffuse color bleeding;
   camera movement clears stale accumulation immediately.
4. A representative static opaque glTF both casts and receives ray-traced shadows in the
   WebGPU hybrid mode.
5. Hybrid shadows stay interactive at the agreed reference resolution/hardware; the
   measured target is recorded after the baseline benchmark rather than promised before
   profiling.
6. Unsupported assets/features fail clearly and raster rendering remains available.
7. Mode switches, canvas resize, asset reload, and engine destruction leak neither workers
   nor GPU resources and produce no WebGPU validation errors.
8. Existing mesh and splat tests plus the new ray tracing unit/visual suites pass.

## Recommended delivery order

1. Shared ray-scene contract and corrected glTF extraction.
2. Cornell Box, intersection tests, and brute-force CPU image.
3. Worker CPU renderer and BVH.
4. GPU BLAS/TLAS traversal and direct-light Cornell Box.
5. Progressive GPU path integration and accumulation.
6. Hybrid glTF hard shadows.
7. Soft shadows, temporal filtering, and broader PBR material support.

This sequence intentionally makes the CPU renderer the correctness oracle, then reuses
its scene/BLAS/TLAS contract on the GPU, and only then integrates the latency-sensitive
glTF shadow path.
