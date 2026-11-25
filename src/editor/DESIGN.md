# Map Editor — Kiến trúc chung (DESIGN.md, chỉ để dev đọc, không build vào HTML)

## Quy ước repo
- Three.js r128, Vanilla JS, không ES module, không backend, không timestamp/random trong build.
- `mapeditor.html` là 1 file tự chứa, build từ `src/editor/*.js` + `src/editor/editor.css` bằng `tools/build-editor.mjs`
  (làm theo mẫu `tools/build.mjs`: inline `lib/three.min.js` + `lib/fflate.min.js` + `lib/FBXLoader.js`
  + `lib/GLTFLoader.js` + `lib/OBJLoader.js` (2 cái sau có thì inline, chưa có thì placeholder rỗng)
  + `lib/GLTFExporter.js` (đợt 2, xuất .GLB) + `lib/Reflector.js` (đợt 3, nước phản chiếu),
  placeholder `__EDITOR_STYLE__ __THREE__ __FFLATE__ __FBXLOADER__ __GLTFLOADER__ __OBJLOADER__ __GLTFEXPORTER__ __REFLECTOR__ __EDITOR_JS__`;
  kiểm tra không có chuỗi `</script` trong phần inline; ghi thêm `.zwork/build/editor.js` để kiểm tra).
- Giao diện tiếng Việt, dark charcoal, phone-first (panel thu gọn được, nút >=40px, chạm xoay camera).
- Mọi nút/panel phải chạy thật; nút nào chưa làm được thì KHÔNG vẽ ra.
- KHÔNG sửa `src/original/`. Chỉ worker D được sửa `tools/build.mjs` (thêm `13-editor-patch.js` vào parts) và `README.md`.

## Namespace + thứ tự script (build-editor.mjs nối theo đúng thứ tự này)
`var ED = ED || {}` — global duy nhất. Mỗi module gán `ED.Core`, `ED.Viewport`, ...
1. `00-core.js` — state, project JSON, undo/redo, selection, persistence (IDB/localStorage)
2. `01-viewport.js` — renderer, camera, gizmo, chọn object, input chuột/chạm/bàn phím
3. `02-ui.js` — toolbar, panel, hierarchy UI, inspector UI, console, perf HUD, toast
4. `03-assets.js` — primitive builders, asset library, kéo-thả, import GLB/FBX/OBJ
4b. `14-building.js` — (đợt 2) part nhà lắp ghép, snap, gộp nhà, prefab
5. `04-terrain.js` — heightmap, brush, paint (+ đợt 2: import heightmap ảnh xám, erosion)
6. `05-environment.js` — ngày/đêm, sương mù, mưa/tuyết/gió, preset
7. `06-fx.js` — particle FX
8. `07-character.js` — import FBX Mixamo, preview, skeleton, animation
   (+ đợt 3: IK 2 xương, bone weight heatmap, constraint xoay theo khớp)
8b. `11-animation.js` — (đợt 2) timeline/keyframe, clip tự tạo, state machine, crossfade, root motion
   (+ đợt 3: track scale, kéo keyframe snap lưới 0.05s, copy/paste keyframe)
9. `08-npc-ai.js` — NPC, patrol waypoint, AI, quest (+ đợt 2: AI attack thuần cho Play)
9b. `16-nodes.js` — (đợt 3) node editor trực quan: state machine / AI behavior / quest chain
   (canvas vẽ node, đọc/ghi đúng field project đã có; chỉ thêm field mới `prerequisites`)
9c. `17-physics.js` — (đợt 3) physics-lite: trọng lực + nhảy, capsule-vs-box, thùng đẩy được,
   prop rơi (đứng TRƯỚC `09-play.js` để Play Mode dùng được qua guard typeof)
10. `09-play.js` — Play Mode (+ đợt 2: quái đánh lại, 4 skill, quest chạy thật, hồi sinh)
   (+ đợt 3: wiring physics-lite + SFX khi dùng skill/trúng đòn, qua guard typeof)
11. `10-game-link.js` — load world thật từ mongvolam + export patch (worker D)
12. `12-nav.js` — (đợt 2) A* trên lưới, lưới chặn, debug overlay
13. `13-material.js` — (đợt 2) texture map, preset vật liệu, UV preview
14. `15-export.js` — (đợt 2) export GLB thật, nhạc nền ambient
   (+ đợt 3: export .gltf + .bin tách riêng, chụp PNG viewport, SFX tổng hợp
   WebAudio 5 loại, playlist nhiều bài, mute/volume)
15. `99-boot.js` — khởi tạo tất cả, gọi theo thứ tự (worker A)

## Quy tắc Node-test được (BẮT BUỘC cho mọi module)
- KHÔNG truy cập `document`/`window`/`THREE` ở top-level. Mọi khởi tạo trong `init()`.
- Logic thuần (serialize, undo/redo, terrain math, patch apply, validate) viết thành hàm thuần,
  không phụ thuộc DOM/THREE để `tools/test-mapeditor.cjs` load bằng `vm` + stub THREE mà test được.

## Project JSON schema v1
```js
{ version: 1, name: 'Tên project',
  terrain: { size: 96, segments: 64, heights: [/* (segments+1)^2 số, y */],
             paints: [/* cùng độ dài, 0=cỏ 1=đất 2=đá 3=cát 4=nước */] },
  env: { timeOfDay: 10, fog: 0.01, weather: 'none', wind: 0.5, preset: 'thanh-co',
         /* Đợt 3: */ fogColor: '', fogHeight: 0.5,
         shadow: { enabled: true, mapSize: 1024, bias: 0 },
         water: { reflect: true, color: '#4da39e', opacity: 0.85 } },
  objects: [ { id, type, category, name, pos:[x,y,z], rot:[x,y,z], scale:[x,y,z],
               color, material:{roughness, metalness, opacity},
               locked:false, visible:true, parent:null, extra:{...} } ],
  npcs: [ { id, name, level, faction, type, dialogue, interactRadius,
            pos:[x,z], patrol:[ [x,z], ... ], ai:'idle'|'patrol'|'wander'|'follow'|'chase'|'attack',
            /* Đợt 3: */ aiStates:[...], aiTransitions:[ { from, to, condition:{ type, radius?, seconds?, pct? } } ] } ],
  quests: [ { id, name, desc, target, reward,
              /* Đợt 3: */ prerequisites:[ /* id quest phải xong trước, không vòng tròn */ ] } ],
  characters: [ { id, name, level, faction, hp, atk, def, speed, fbxKey,
                  /* Đợt 3: */ boneConstraints:{ 'mixamorig:Hips': { min:[x,y,z], max:[x,y,z] }, ... } } ],
  /* Đợt 3 — field mới, project cũ không có thì module tự mặc định []/{}
     khi đọc (ED.Core.load gán nguyên project object nên field được giữ):
     track scale trong animations[].tracks[].prop ('scale.x'|'scale.y'|'scale.z'),
     npcs[].aiStates/aiTransitions, quests[].prerequisites,
     characters[].boneConstraints, env.shadow/env.water/env.fogColor/env.fogHeight. */
  animations: [ { id, name, targetType:'object'|'bone', targetId, duration,
                  tracks:[ { prop:'pos.x'|'rot.y'|'scale.x'|..., keys:[ { t, v } ] } ] } ],
  stateMachines: { charId: { current, states:[...], transitions:[ { from, to, condition } ], clips:{ state: clipRef } } },
  buildings: [ { id, name, parts:[objId...] } ],
  prefabs: [ { id, name, parts:[ { type, pos, rot, scale, color, material } ] } ] }
```
- `objects[].type`: terrain, house, temple, bridge, lantern, tree, rock, water, prop, npc,
  monster, character, fx, light, collider, waypoint. `category`: Environment/Buildings/Props/
  Characters/Effects. NPC trong scene cũng có 1 object type 'npc' (mesh) + 1 entry trong `npcs[]`
  (dữ liệu) — cùng `id`, giữ đồng bộ qua `ED.Core.syncNpcObject(npc)`.
- `extra` theo type: light {intensity, lightColor}, collider {shape:'box'|'sphere', trigger},
  fx {fxType, count, speed}, waypoint {next}, character {fbxKey, anim}.

## API chung (các module khác gọi qua các hàm này, không chạm trực tiếp state)
- `ED.Core.newProject(name)` / `ED.Core.serialize()` / `ED.Core.load(jsonObj)` /
  `ED.Core.addObject(def)` -> obj / `ED.Core.removeObject(id)` / `ED.Core.getObject(id)` /
  `ED.Core.listObjects()` / `ED.Core.select(id|null)` / `ED.Core.selectedId` /
  `ED.Core.pushHistory(label)` / `ED.Core.undo()` / `ED.Core.redo()` /
  `ED.Core.markDirty()` / `ED.Core.saveProject(name)` / `ED.Core.loadProject(name)` (IDB, async).
- `ED.Viewport.init(container)` / `ED.Viewport.syncObject(obj)` (tạo/cập nhật mesh theo obj) /
  `ED.Viewport.removeMesh(id)` / `ED.Viewport.setGizmoMode('move'|'rotate'|'scale')` /
  `ED.Viewport.focus(id?)` / `ED.Viewport.setCameraPreset('persp'|'ortho'|'iso'|'top'|'front'|'side')` /
  `ED.Viewport.meshes` = {id: THREE.Group} / `ED.Viewport.setPlayMode(bool)`.
- `ED.UI.log(msg)` (console panel) / `ED.UI.toast(msg)` / `ED.UI.refreshHierarchy()` /
  `ED.UI.refreshInspector()` / `ED.UI.setPerf({fps, calls, tris, verts, mem})`.
- `ED.Assets.buildMesh(type, opts)` -> THREE.Group (primitive builders; worker B).
- `ED.Terrain.applyBrush(cx, cz, mode, size, strength, falloff)` (thuần, đổi heights) /
  `ED.Terrain.paintAt(cx, cz, mat, size)` / `ED.Terrain.rebuildMesh()`.
- `ED.Character.importFbx(file)` -> Promise<{id, clips, bones}> (worker C, dùng THREE.FBXLoader + fflate).
- `ED.GameLink.loadWorldFromGame()` / `ED.GameLink.exportPatch()` (worker D).

## Undo/redo
- Snapshot toàn bộ project JSON (string) trước mỗi thay đổi có ý nghĩa; stack tối đa 50.
- Ctrl+Z / Ctrl+Y; nút Undo/Redo trên toolbar cũng gọi `ED.Core.undo()/redo()`.

## Persistence
- IDB `mongvolam_editor_v1`: store `projects` (keyPath `name`, value {name, json, updatedAt}),
  store `assets` (keyPath `key`, value {key, name, size, data:ArrayBuffer}).
- localStorage `mongvolam_editor_prefs_v1` (JSON: panel states, snap, gizmo mode...).
- localStorage `mongvolam_editor_audio_v1` (đợt 3, JSON: {volume 0..1, muted, currentIndex,
  tracks:[{id, key, name, ext, size}]} — âm lượng/mute/playlist nhạc nền + SFX).
- Patch chung với game: localStorage `mongvolam_editor_patch_v1`
  `{version:1, npcsMoved:[{id,x,z}], npcsAdded:[{...npc}], propsAdded:[{type,x,z,rotY,scale}]}`.

## File ownership (không ai sửa file của người khác)
- A: tools/build-editor.mjs, src/editor/editor.template.html, src/editor/editor.css,
  src/editor/00-core.js, 01-viewport.js, 02-ui.js, 99-boot.js
- B: src/editor/03-assets.js, 04-terrain.js, 05-environment.js, 06-fx.js
  (+ vendor lib/GLTFLoader.js, lib/OBJLoader.js r128 NẾU tải được từ three.js r128 chính thức;
   không tải được thì chỉ import FBX + ghi rõ vào báo cáo, KHÔNG vẽ nút GLB/OBJ giả)
- C: src/editor/07-character.js, 08-npc-ai.js, 09-play.js
- D: src/editor/10-game-link.js, src/13-editor-patch.js, tools/test-mapeditor.cjs, README.md
  (+ sửa tools/build.mjs: chỉ thêm '13-editor-patch.js' vào parts, trước '06-boot.js')

## Đợt 2 — ownership bổ sung (coordinator tích hợp)
- Animation: 11-animation.js (mới) + 07-character.js (chỉ thêm API preview).
- Material: 13-material.js (mới) + 02-ui.js (chỉ thêm section Inspector).
- Building: 14-building.js (mới) + 03-assets.js (đăng ký part + builder).
- Nav: 12-nav.js (mới, chỉ 1 file).
- Play: 09-play.js + 08-npc-ai.js (chỉ thêm logic AI attack thuần).
- Export: 15-export.js (mới) + 04-terrain.js (heightmap + erosion) + vendor lib/GLTFExporter.js.
- Tích hợp (coordinator, không worker nào được sửa): tools/build-editor.mjs
  (thêm 5 file vào ORDERED + placeholder __GLTFEXPORTER__), editor.template.html
  (khối __GLTFEXPORTER__), 99-boot.js (5 _callInit), editor.css (append CSS 5 module),
  01-viewport.js (hook ED.Material.applyToMesh ×2), 09-play.js (wiring nhạc ambient),
  DESIGN.md, README.md, tools/test-mapeditor2.cjs (harness đợt 2).
- Quy tắc đợt 2: 09-play.js gọi ED.Nav/ED.Animation/ED.Export qua guard typeof;
  worker Play kết thúc không để lại báo cáo viết — coordinator đã xác minh trực
  tiếp code (09-play.js 871→1751 dòng, 08-npc-ai.js 1010→1128 dòng, node --check OK)
  rồi mới tích hợp.

## Đợt 3 — ownership bổ sung (coordinator tích hợp)
- Skeleton: 07-character.js (chỉ thêm API thuần IK/weight/constraint + panel Character).
- Nodes: 16-nodes.js (mới, chỉ 1 file) — đọc/ghi đúng field project đã có
  (stateMachines / npcs[].aiStates+aiTransitions / quests[].prerequisites);
  khi ED.Animation/ED.NpcAi đã load thì uỷ quyền cho hàm thuần của chúng,
  chưa load thì dùng bản dự phòng cùng ngữ nghĩa.
- Timeline: 11-animation.js (chỉ thêm track scale + snap/kéo/copy-paste keyframe).
- Physics: 17-physics.js (mới, chỉ 1 file) + 09-play.js (chỉ thêm wiring qua guard
  typeof ED.Physics; chưa nối thì Play chạy như cũ, không crash).
- Environment: 05-environment.js (shadow/water/fog) + 01-viewport.js
  (nước Reflector + refreshWater) + vendor lib/Reflector.js r128.
- Export+Audio: 15-export.js (chỉ 1 file: .gltf/.bin tách riêng, PNG, SFX, playlist).
- Tích hợp (coordinator, không worker nào được sửa): tools/build-editor.mjs
  (thêm 2 file vào ORDERED — 16-nodes.js sau 08-npc-ai.js, 17-physics.js trước
  09-play.js — + placeholder __REFLECTOR__), editor.template.html
  (khối __REFLECTOR__ sau __GLTFEXPORTER__), 99-boot.js (_callInit('Nodes');
  Physics không có init nên không gọi), DESIGN.md, README.md,
  tools/test-mapeditor2.cjs (chỉ sửa 1 assert cũ: prop ví dụ 'scale.x' ->
  'foo.x', vì scale từ đợt 3 là prop hợp lệ), tools/test-mapeditor3.cjs
  (harness đợt 3, 110 assert).
- Quy tắc đợt 3: KHÔNG sửa src/original/, KHÔNG sửa mongvolam.html hay
  tools/build.mjs — game giữ nguyên (hash mongvolam.html vẫn
  8792425df06eca92538eba790eaf4dec798a0c8c, commit 4634940f).

## Đợt 4 — ownership bổ sung (coordinator tích hợp)
- Terrain: 04-terrain.js (chỉ 1 file: texture procedural, .raw/.r16, chunk 4x4,
  erosion thủy lực) — UI tự tạo trong init của module, không sửa 02-ui.js.
- Material: 13-material.js + 02-ui.js (chỉ section Vật liệu & Texture).
- Building: 14-building.js (chỉ 1 file: param mái/tường/cửa).
- Skeleton: 07-character.js (chỉ 1 file: panel số liệu bone weight + retarget).
- AI: 08-npc-ai.js + 09-play.js + 01-viewport.js (chỉ thêm getter getTerrainMesh).
- Export+Audio: 15-export.js (chỉ 1 file: ZIP + SFX 3D + nhạc ngữ cảnh)
  + vendor lib/jszip.min.js (JSZip 3.10.1 UMD, cdnjs).
- Tích hợp (coordinator, không worker nào được sửa): tools/build-editor.mjs
  (placeholder __JSZIP__ + libChecks), editor.template.html
  (khối __JSZIP__ sau __REFLECTOR__), editor.css (append CSS 4 module),
  01-viewport.js (syncTerrain uỷ quyền Terrain.rebuildMesh khi có chunk —
  KHÔNG vẽ mesh đất đơn nữa để tránh z-fight; _groundPoint raycast 16 chunk;
  perf HUD thêm "Chunk x/16"), 02-ui.js (setPerf hiển thị chunk),
  15-export.js (GLB lấy đủ 16 chunk qua getChunkMeshes),
  09-play.js (wiring setCombatMode: update() sau _updateMonsterAttacks,
  stop() sau stopAmbient), DESIGN.md, README.md, tools/test-mapeditor4.cjs.
- Quy tắc đợt 4: KHÔNG sửa src/original/, KHÔNG sửa mongvolam.html hay
  tools/build.mjs — game giữ nguyên (hash mongvolam.html vẫn
  8792425df06eca92538eba790eaf4dec798a0c8c, commit 4634940f).
  Project JSON v1 mở rộng field (project cũ vẫn mở được):
  objects[].material thêm aoMap/emissiveMap (key tex:<id>);
  objects[].extra.buildingParams {roof:{curvature,slope,tileColor{front,back,left,right}},
  wall:{height,thickness,color}, door:{height,width}};
  npcs[].searchDuration (mặc định 5s), aiState runtime 'alert'/'search'
  (không lưu vào project, chỉ sống trong phiên Play);
  localStorage mongvolam_editor_audio_v1 thêm contextMusic/exploreTrackId/combatTrackId.
  ED.Terrain.getMesh() chỉ trả chunk đầu (tương thích cũ); code mới dùng
  getChunkMeshes()/getChunkInfo(). ED.Viewport.getTerrainMesh() delegate
  ED.Terrain.getMesh() rồi mới tới mesh riêng của Viewport.
