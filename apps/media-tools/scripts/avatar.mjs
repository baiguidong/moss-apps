import { SphereGeometry, Mesh, MeshStandardMaterial, Group, Scene, Float32BufferAttribute } from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'

// The exporter uses the browser FileReader interface for its binary output.
class BinaryReader {
  readAsArrayBuffer(blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer
      this.onloadend?.()
    })
  }
}
export async function createAvatar() {
  globalThis.FileReader ??= BinaryReader
  const scene = new Scene()
  const bone = (parent, name, x = 0, y = 0, z = 0) => {
    const joint = new Group()
    joint.name = name
    joint.position.set(x, y, z)
    parent.add(joint)
    return joint
  }
  const materials = new Map()
  function oval(parent, name, xyz, radii, color) {
    if (!materials.has(color))
      materials.set(color, new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 }))
    const mesh = new Mesh(new SphereGeometry(1, 32, 20), materials.get(color))
    mesh.name = name
    mesh.position.set(...xyz)
    mesh.scale.set(...radii)
    parent.add(mesh)
    return mesh
  }
  function morph(mesh, shapes) {
    const geometry = mesh.geometry
    const pos = geometry.attributes.position
    geometry.morphTargetsRelative = true
    geometry.morphAttributes.position = Object.entries(shapes).map(([name, [width, height]]) => {
      const delta = new Float32Array(pos.count * 3)
      for (let i = 0; i < pos.count; i++) {
        delta[3 * i] = pos.getX(i) * (width - 1)
        delta[3 * i + 1] = pos.getY(i) * (height - 1)
      }
      const attr = new Float32BufferAttribute(delta, 3)
      attr.name = name
      return attr
    })
    mesh.updateMorphTargets()
  }
  const shell = '#e9eadc',
    green = '#65aaa0',
    dark = '#1d363a',
    light = '#b3ffe3',
    coral = '#f09971'
  const root = bone(scene, 'Armature')
  const hips = bone(root, 'Hips', 0, 1)
  const spine = bone(hips, 'Spine', 0, 0.035)
  const spine1 = bone(spine, 'Spine1', 0, 0.09)
  const chest = bone(spine1, 'Spine2', 0, 0.095)
  const neck = bone(chest, 'Neck', 0, 0.14)
  const head = bone(neck, 'Head', 0, 0.13)
  oval(chest, 'Jacket', [0, -0.11, 0], [0.237, 0.245, 0.155], green)
  oval(chest, 'Collar', [0, 0.048, 0.012], [0.18, 0.065, 0.14], shell)
  oval(chest, 'Pocket', [0, -0.13, 0.15], [0.095, 0.047, 0.014], dark)
  for (let i = -1; i <= 1; i++)
    oval(chest, 'Indicator' + i, [i * 0.033, -0.13, 0.163], [0.008, 0.008, 0.007], i === 0 ? coral : light)
  oval(head, 'Helmet', [0, 0.045, 0], [0.274, 0.236, 0.221], shell)
  oval(head, 'Visor', [0, 0.047, 0.12], [0.242, 0.178, 0.139], dark)
  oval(head, 'Antenna', [0.12, 0.28, -0.015], [0.014, 0.09, 0.014], green)
  oval(head, 'Beacon', [0.12, 0.362, -0.015], [0.034, 0.034, 0.034], coral)
  const mouth = oval(head, 'Speaker', [0, -0.022, 0.248], [0.056, 0.009, 0.008], light)
  const visemes = {
    sil: [1, 1],
    aa: [0.94, 5],
    E: [1.2, 2.5],
    I: [1.35, 1.55],
    O: [0.67, 4.2],
    U: [0.55, 3.2],
    PP: [0.88, 0.55],
    SS: [1.18, 1.2],
    TH: [1, 2],
    DD: [0.98, 2.1],
    FF: [1.15, 1.35],
    kk: [0.95, 3.6],
    nn: [1, 1.4],
    RR: [0.85, 2.8],
    CH: [0.78, 2.65],
  }
  morph(mouth, Object.fromEntries(Object.entries(visemes).map(([name, value]) => ['viseme_' + name, value])))
  for (const [side, sign] of [
    ['Left', 1],
    ['Right', -1],
  ]) {
    const eye = bone(head, side + 'Eye', 0.09 * sign, 0.09, 0.248)
    const lens = oval(eye, side + 'Lens', [0, 0, 0], [0.022, 0.036, 0.009], light)
    morph(lens, {
      ['eyeBlink' + side]: [1, 0.12],
      ['browDown' + side]: [1, 0.9],
      ['eyeLookIn' + side]: [1, 1],
      ['eyeLookOut' + side]: [1, 1],
    })
    oval(head, side + 'Ear', [0.259 * sign, 0.042, 0], [0.035, 0.088, 0.085], green)
    const shoulder = bone(chest, side + 'Shoulder', 0.12 * sign, 0.007, 0)
    const arm = bone(shoulder, side + 'Arm', 0.06 * sign)
    const forearm = bone(arm, side + 'ForeArm', 0, 0.17)
    const hand = bone(forearm, side + 'Hand', 0, 0.15)
    for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
      let parent = hand
      for (let i = 1; i <= 3; i++) parent = bone(parent, side + 'Hand' + finger + i, 0, 0.012)
    }
    const sleeve = oval(chest, side + 'Sleeve', [sign * 0.225, -0.12, 0], [0.068, 0.148, 0.079], shell)
    sleeve.rotation.z = sign * 0.19
    oval(chest, side + 'Glove', [sign * 0.253, -0.248, 0.013], [0.064, 0.072, 0.068], dark)
    const thigh = bone(hips, side + 'UpLeg', sign * 0.095)
    const leg = bone(thigh, side + 'Leg', 0, 0.46)
    const foot = bone(leg, side + 'Foot', 0, 0.44)
    bone(foot, side + 'ToeBase', 0, 0.095, 0.015)
    oval(hips, side + 'Trouser', [sign * 0.095, -0.29, 0], [0.083, 0.242, 0.092], dark)
    oval(hips, side + 'Boot', [sign * 0.095, -0.51, 0.03], [0.091, 0.069, 0.12], shell)
  }
  // Ground reference for TalkingHead's automatic hip/foot balance.
  oval(hips, 'Stand', [0, -0.985, 0], [0.001, 0.001, 0.001], dark).visible = false
  return new Uint8Array(await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false }))
}
