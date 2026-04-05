/**
 * Every asset under https://cdn.aframe.io/ that A-Frame 1.3.0 may request:
 * - controller models referenced in the 1.3.0 bundle
 * - glTF sidecars (buffers, textures) required for those models
 * - fonts listed in the text component (FONT_BASE_URL + FONTS in src/components/text.js v1.3.0)
 *
 * Used by vendor-libs.mjs and verify-offline.mjs.
 */
export const AFRAME_13_CDN_PATHS = [
  // daydream-controls (+ texture from MTL map_Kd)
  'controllers/google/vr_controller_daydream.obj',
  'controllers/google/vr_controller_daydream.mtl',
  'controllers/google/vr_controller_daydream_tex.png',
  // gearvr-controls
  'controllers/samsung/gear_vr_controller.obj',
  'controllers/samsung/gear_vr_controller.mtl',
  // hand-controls
  'controllers/hands/leftHand.glb',
  'controllers/hands/rightHand.glb',
  'controllers/hands/leftHandLow.glb',
  'controllers/hands/rightHandLow.glb',
  'controllers/hands/leftHandHigh.glb',
  'controllers/hands/rightHandHigh.glb',
  // hand-tracking-controls (1.3 uses v3 paths)
  'controllers/oculus-hands/v3/left.glb',
  'controllers/oculus-hands/v3/right.glb',
  // hp-mixed-reality-controls
  'controllers/hp/mixed-reality/left.glb',
  'controllers/hp/mixed-reality/right.glb',
  // magicleap-controls
  'controllers/magicleap/magicleap-one-controller.glb',
  // oculus-go-controls + sidecars
  'controllers/oculus/go/oculus-go-controller.gltf',
  'controllers/oculus/go/oculus-go-controller.bin',
  'controllers/oculus/go/oculus-go-controller-texture.jpg',
  // oculus-touch-controls (gen1 / gen2 / v3)
  'controllers/oculus/oculus-touch-controller-left.gltf',
  'controllers/oculus/oculus-touch-controller-right.gltf',
  'controllers/oculus/oculus-touch-controller-gen2-left.gltf',
  'controllers/oculus/oculus-touch-controller-gen2-right.gltf',
  'controllers/oculus/oculus-touch-controller-v3-left.glb',
  'controllers/oculus/oculus-touch-controller-v3-right.glb',
  // valve-index-controls
  'controllers/valve/index/valve-index-left.glb',
  'controllers/valve/index/valve-index-right.glb',
  // vive-controls
  'controllers/vive/vr_controller_vive.obj',
  'controllers/vive/vr_controller_vive.mtl',
  // vive-focus-controls + sidecars
  'controllers/vive/focus-controller/focus-controller.gltf',
  'controllers/vive/focus-controller/focus-controller.bin',
  'controllers/vive/focus-controller/MIA_Ctrl_COL_png1024_B.png',
  'controllers/vive/focus-controller/MIA_Ctrl_trackpad.png',
  // windows-motion-controls (mirrored from @webxr-input-profiles/assets in vendor-libs.mjs)
  'controllers/microsoft/left.glb',
  'controllers/microsoft/right.glb',
  'controllers/microsoft/universal.glb',
  // text component fonts (BMFont + texture)
  'fonts/Aileron-Semibold.fnt',
  'fonts/Aileron-Semibold.png',
  'fonts/DejaVu-sdf.fnt',
  'fonts/DejaVu-sdf.png',
  'fonts/Exo2Bold.fnt',
  'fonts/Exo2Bold.png',
  'fonts/Exo2SemiBold.fnt',
  'fonts/Exo2SemiBold.png',
  'fonts/KelsonSans.fnt',
  'fonts/KelsonSans.png',
  'fonts/Monoid.fnt',
  'fonts/Monoid.png',
  'fonts/mozillavr.fnt',
  'fonts/mozillavr.png',
  'fonts/Roboto-msdf.json',
  'fonts/Roboto-msdf.png',
  'fonts/SourceCodePro.fnt',
  'fonts/SourceCodePro.png'
];
