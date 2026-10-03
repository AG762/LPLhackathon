import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// The stage for the opening and the hero: one object under one light, in a studio with no horizon.
// The object is the machine: a machined head (dark anodised body, brushed silver top plate, a lit slot)
// on a clear glass case that sits on a matching base. A file hovers in the beam above it. Scroll feeds
// the first file through the slot (it comes out as strips that settle in the glass case); the second
// file is under a legal hold, so a sheet of light closes over the slot and pushes it back up.
//
// The opening is the same scene: the slot ignites in the dark, a studio light sweeps across the top
// plate, and the camera pulls back as the beam comes up. Every pose is a pure function of the opening
// clock and the scroll progress, so scrolling back plays everything in reverse.

export interface StageFile {
  name: string
  kind: string
  client?: string
  stamp?: string
}

export interface Stage {
  setProgress(p: number): void
  setActive(active: boolean): void
  skipIntro(): void
  resize(): void
  dispose(): void
}

interface Options {
  intro: boolean // play the opening from black; otherwise start already lit
  still: boolean // reduced motion: draw the end of the story once, no loop
  onIntroStart?: () => void // the opening clock has started (shaders are compiled, first frame is up)
  onIntroDone?: () => void
}

/* ---------- dimensions (scene units; the floor is y = 0) ---------- */

const GATE_W = 2.3
const GATE_D = 0.92
const BASE_T = 0.09
const BIN_H = 1.42
const BODY_T = 0.24
const PLATE_T = 0.034
const GB = BASE_T + BIN_H // underside of the head
const GT = GB + BODY_T + PLATE_T // top of the silver plate
const SLOT_W = 1.2
const SLOT_D = 0.05
const DOC_W = 1.0
const DOC_H = 1.3
const HOVER_Y = GT + 0.2 + DOC_H / 2
const FED_Y = GB - DOC_H / 2 - 0.02
const STRIPS = 18
const INTRO_S = 3.3
const OBJ_TOP = HOVER_Y + DOC_H / 2 + 0.04
const OBJ_MID = OBJ_TOP / 2

const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const range = (p: number, a: number, b: number) => clamp01((p - a) / (b - a))
const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3)
const easeIn = (t: number) => Math.pow(clamp01(t), 2)
const easeInOut = (t: number) => {
  const x = clamp01(t)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}
const expoOut = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(t)))

// Seeded, so the pile of strips lands the same way on every visit.
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/* ---------- paper ---------- */

const SANS = '"Geist Variable", system-ui, sans-serif'

function drawPaper(c: CanvasRenderingContext2D, w: number, h: number, file: StageFile, seed: number) {
  const r = rng(seed)
  c.clearRect(0, 0, w, h)
  const g = c.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#f7f8f9')
  g.addColorStop(1, '#eceef1')
  c.fillStyle = g
  c.fillRect(0, 0, w, h)
  // Fibre: faint specks so the sheet doesn't read as flat plastic under the light.
  for (let i = 0; i < 6000; i++) {
    const v = 205 + r() * 50
    c.fillStyle = `rgba(${v},${v},${v + 3},${0.04 + r() * 0.05})`
    c.fillRect(r() * w, r() * h, 1 + r() * 2.5, 1 + r() * 2.5)
  }

  const m = w * 0.085
  c.textBaseline = 'alphabetic'
  c.fillStyle = '#69717c'
  c.font = `500 ${w * 0.026}px ${SANS}`
  c.fillText(file.kind, m, m + w * 0.02)
  c.textAlign = 'right'
  c.fillText('Branch drive', w - m, m + w * 0.02)
  c.textAlign = 'left'

  // The file name, as large as fits on one line.
  c.fillStyle = '#0b0d10'
  let size = w * 0.064
  c.font = `600 ${size}px ${SANS}`
  while (c.measureText(file.name).width > w - m * 2 && size > w * 0.03) {
    size -= 2
    c.font = `600 ${size}px ${SANS}`
  }
  let y = m + w * 0.12
  c.fillText(file.name, m, y)
  if (file.client) {
    y += w * 0.056
    c.fillStyle = '#4b535e'
    c.font = `400 ${w * 0.034}px ${SANS}`
    c.fillText(file.client, m, y)
  }
  y += w * 0.05
  c.fillStyle = '#0b0d10'
  c.fillRect(m, y, w - m * 2, Math.max(3, w * 0.0022))

  // Body copy, drawn as lines of grey: at this size real words would only read as noise.
  y += w * 0.07
  const bottom = file.stamp ? h - w * 0.36 : h - m * 1.6
  c.fillStyle = '#c6ccd3'
  const bar = w * 0.0085
  while (y < bottom) {
    const lines = 3 + Math.floor(r() * 4)
    for (let l = 0; l < lines && y < bottom; l++) {
      const full = w - m * 2
      const len = l === lines - 1 ? full * (0.3 + r() * 0.45) : full * (0.88 + r() * 0.12)
      c.beginPath()
      c.roundRect(m, y, len, bar, bar / 2)
      c.fill()
      y += w * 0.03
    }
    y += w * 0.036
  }

  if (file.stamp) {
    // The stamp is the point of this sheet, so it is set large enough to read from the back of the room.
    const sh = w * 0.1
    const sy = h - m * 1.6 - w * 0.15
    c.font = `600 ${w * 0.056}px ${SANS}`
    const tw = c.measureText(file.stamp).width
    c.fillStyle = '#0b0d10'
    c.beginPath()
    c.roundRect(m, sy, tw + w * 0.11, sh, sh / 2)
    c.fill()
    c.fillStyle = '#f5f6f7'
    c.fillText(file.stamp, m + w * 0.055, sy + sh * 0.69)
    c.fillStyle = '#4b535e'
    c.font = `400 ${w * 0.026}px ${SANS}`
    c.fillText('Do not delete. A hold overrides every retention rule.', m, sy + sh + w * 0.055)
  }

  c.fillStyle = '#8a929d'
  c.font = `500 ${w * 0.022}px ${SANS}`
  c.textAlign = 'right'
  c.fillText('1 / 1', w - m, h - m * 0.9)
  c.textAlign = 'left'
}

function paperTexture(file: StageFile, seed: number, maxAniso: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = Math.round((2048 * DOC_H) / DOC_W)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = maxAniso
  const paint = () => {
    drawPaper(canvas.getContext('2d')!, canvas.width, canvas.height, file, seed)
    tex.needsUpdate = true
  }
  paint()
  // Draw again once the web font is in, so the file name isn't set in a fallback face.
  document.fonts?.load(`600 40px ${SANS}`).then(paint, () => {})
  return tex
}

// Fine machined grooves and an engraved wordmark for the head's front face.
function faceTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 128
  const c = canvas.getContext('2d')!
  const w = canvas.width
  const h = canvas.height
  c.clearRect(0, 0, w, h)
  // Vent: fine horizontal grooves on the right third, each a dark cut with a lit lower lip.
  const x0 = w * 0.64
  const x1 = w * 0.985
  for (let i = 0; i < 9; i++) {
    const y = h * 0.16 + i * (h * 0.085)
    c.fillStyle = 'rgba(0,0,0,0.75)'
    c.beginPath()
    c.roundRect(x0, y, x1 - x0, 3, 1.5)
    c.fill()
    c.fillStyle = 'rgba(255,255,255,0.11)'
    c.fillRect(x0 + 2, y + 3, x1 - x0 - 4, 1.2)
  }
  // Wordmark, engraved: a dark cut and a faint highlight one pixel lower.
  c.font = `600 ${h * 0.36}px ${SANS}`
  c.textBaseline = 'middle'
  c.fillStyle = 'rgba(255,255,255,0.09)'
  c.fillText('ShredSafe', w * 0.03, h * 0.5 + 1.5)
  c.fillStyle = 'rgba(0,0,0,0.6)'
  c.fillText('ShredSafe', w * 0.03, h * 0.5)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  document.fonts?.load(`600 40px ${SANS}`).then(() => {
    // Redraw the wordmark in the right face once it's loaded.
    c.clearRect(0, 0, w * 0.6, h)
    c.fillStyle = 'rgba(255,255,255,0.09)'
    c.fillText('ShredSafe', w * 0.03, h * 0.5 + 1.5)
    c.fillStyle = 'rgba(0,0,0,0.6)'
    c.fillText('ShredSafe', w * 0.03, h * 0.5)
    tex.needsUpdate = true
  }, () => {})
  return tex
}

/* ---------- studio lighting for reflections ---------- */

function studioEnvironment(renderer: THREE.WebGLRenderer) {
  const env = new THREE.Scene()
  env.background = new THREE.Color(0x000000)
  const box = new THREE.BoxGeometry(1, 1, 1)
  const panel = (w: number, h: number, d: number, x: number, y: number, z: number, intensity: number) => {
    const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity, intensity * 1.05) }))
    m.scale.set(w, h, d)
    m.position.set(x, y, z)
    env.add(m)
    return m
  }
  panel(4, 0.1, 2.4, 0, 6, 0, 2.2) // overhead softbox
  panel(0.1, 5, 0.5, -4.2, 2, 5.2, 2.6) // front-left strip: a long reflection down the glass
  panel(0.1, 6, 0.7, -6, 1.8, 1.4, 10) // tall strip, left: the long highlight across the top plate
  panel(0.1, 4.5, 0.4, 6, 1.2, -0.6, 4.5) // narrower strip, right
  panel(8, 0.6, 0.1, 0, 0.9, -6, 2.4) // low rim from behind
  panel(10, 2.2, 0.1, 0, 2, 7, 0.22) // faint fill from the camera side
  const pmrem = new THREE.PMREMGenerator(renderer)
  const tex = pmrem.fromScene(env, 0.015).texture
  pmrem.dispose()
  box.dispose()
  env.traverse((o) => (o as THREE.Mesh).material && ((o as THREE.Mesh).material as THREE.Material).dispose())
  return tex
}

/* ---------- shaders ---------- */

const DITHER = /* glsl */ `
  float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`

// The beam: a cone that is bright where you look through its middle and soft at its edges.
const beamShader = (color: THREE.Color) => ({
  uniforms: { uColor: { value: color }, uIntensity: { value: 0 }, uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec3 vN; varying vec3 vV; varying float vY; varying vec2 vUv;
    void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal); vV = -mv.xyz; vUv = uv; vY = uv.y;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uIntensity; uniform float uTime;
    varying vec3 vN; varying vec3 vV; varying float vY; varying vec2 vUv;
    ${DITHER}
    void main(){
      float facing = abs(dot(normalize(vN), normalize(vV)));
      float core = pow(facing, 3.2);
      float fall = smoothstep(0.0, 0.55, vY) * mix(0.5, 1.0, vY);
      float streak = 0.88 + 0.12 * sin(vUv.x * 53.0 + uTime * 0.12) * sin(vUv.x * 23.0 - uTime * 0.08);
      float a = core * fall * streak * uIntensity;
      a += (hash12(gl_FragCoord.xy + uTime) - 0.5) / 255.0;
      gl_FragColor = vec4(uColor * a, 1.0);
    }`,
})

// The back of the studio: black, with the beam's spill on it. It fades to the fog colour at the floor,
// so there is no line where wall meets floor.
const wallShader = (fog: THREE.Color) => ({
  uniforms: { uIntensity: { value: 0 }, uFog: { value: fog } },
  vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */ `
    uniform float uIntensity; uniform vec3 uFog; varying vec3 vW;
    ${DITHER}
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
    void main(){
      vec2 q = vec2(vW.x / 7.0, (vW.y - 5.0) / 6.5);
      float glow = exp(-dot(q, q) * 1.5);
      float tex = 0.85 + 0.3 * noise(vW.xy * 0.7) + 0.08 * noise(vW.xy * 4.0);
      float ground = smoothstep(0.0, 4.5, vW.y);
      vec3 c = uFog + vec3(0.032, 0.035, 0.042) * glow * tex * ground * uIntensity;
      c += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
      gl_FragColor = vec4(c, 1.0);
    }`,
})

// Polished floor: a softened mirror image under the object, fading into the fog away from it.
const floorShader = {
  name: 'StudioFloor',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uIntensity: { value: 0 },
    uFog: { value: new THREE.Color() },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW;
    void main(){ vUv = textureMatrix * vec4(position, 1.0); vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color; uniform sampler2D tDiffuse; uniform float uIntensity; uniform vec3 uFog; varying vec4 vUv; varying vec3 vW;
    ${DITHER}
    void main(){
      vec2 uv = vUv.xy / vUv.w;
      float d = length(vW.xz * vec2(0.62, 1.0));
      // Sharper right under the object, softer further away, like honed stone.
      float r = 0.0015 + 0.009 * smoothstep(0.3, 3.5, d);
      float ang = hash12(gl_FragCoord.xy) * 6.2831;
      vec3 acc = texture2D(tDiffuse, uv).rgb; float tot = 1.0;
      for (int i = 0; i < 12; i++) {
        float fi = float(i);
        float rr = sqrt((fi + 0.5) / 12.0) * r;
        float a = ang + fi * 2.39996;
        float w = 1.0 - (fi + 0.5) / 14.0;
        acc += texture2D(tDiffuse, uv + vec2(cos(a), sin(a) * 0.6) * rr).rgb * w; tot += w;
      }
      vec3 refl = acc / tot * color;
      float pool = exp(-d * d * 0.16);
      vec3 c = uFog + refl * mix(0.15, 0.75, pool) + vec3(0.022, 0.024, 0.03) * pool * uIntensity;
      c = mix(c, uFog, smoothstep(2.5, 11.0, length(vW.xz)));
      c += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}

// Dust in the beam, out of focus: few, soft, slow.
const dustShader = {
  uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 }, uScale: { value: 1 }, uFloorY: { value: 1.8 } },
  vertexShader: /* glsl */ `
    uniform float uTime; uniform float uScale; uniform float uFloorY; attribute vec4 seed; varying float vA; varying float vSoft;
    void main(){
      vec3 p = position;
      p.y = mod(p.y - uTime * (0.025 + seed.x * 0.03), 7.0) + 0.3;
      p.x += sin(uTime * 0.13 + seed.y * 6.28) * 0.2;
      p.z += cos(uTime * 0.11 + seed.z * 6.28) * 0.2;
      float coneR = mix(1.6, 0.55, clamp(p.y / 9.0, 0.0, 1.0));
      // Only in the beam above the machine: never inside the glass case, where it would read as bubbles.
      vA = smoothstep(coneR, coneR * 0.2, length(p.xz)) * (0.25 + 0.75 * seed.w) * smoothstep(uFloorY, uFloorY + 0.5, p.y);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      // Larger motes read as further out of focus: softer and fainter.
      float size = 0.018 + 0.05 * seed.w * seed.w;
      vSoft = seed.w;
      vA /= 1.0 + seed.w * 2.5;
      gl_PointSize = max(1.5, uScale * size / -mv.z);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uIntensity; varying float vA; varying float vSoft;
    void main(){
      float d = length(gl_PointCoord - 0.5) * 2.0;
      float disc = mix(exp(-d * d * 5.0), smoothstep(1.0, 0.75, d) * 0.7, vSoft * 0.6);
      float a = disc * vA * uIntensity * 0.55;
      gl_FragColor = vec4(vec3(0.86, 0.9, 1.0) * a, 1.0);
    }`,
}

// Finish: a soft vignette and very light, slow grain (enough to stop banding, not enough to see).
const finishShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFade: { value: 1 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uFade; varying vec2 vUv;
    ${DITHER}
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec2 q = vUv - 0.5;
      c *= 1.0 - smoothstep(0.42, 1.05, length(q * vec2(1.0, 1.2))) * 0.55;
      float n = hash12(floor(gl_FragCoord.xy) + floor(uTime * 12.0) * 31.7) - 0.5;
      c += n * 0.011;
      c = max(c, vec3(0.0)) * uFade;
      gl_FragColor = vec4(c, 1.0);
    }`,
}

/* ---------- geometry ---------- */

function roundedRect(w: number, h: number, r: number, path: THREE.Path) {
  const x = -w / 2
  const y = -h / 2
  path.moveTo(x + r, y)
  path.lineTo(x + w - r, y)
  path.quadraticCurveTo(x + w, y, x + w, y + r)
  path.lineTo(x + w, y + h - r)
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  path.lineTo(x + r, y + h)
  path.quadraticCurveTo(x, y + h, x, y + h - r)
  path.lineTo(x, y + r)
  path.quadraticCurveTo(x, y, x + r, y)
  return path
}

// A rounded slab standing on y = 0, `t` tall, with a bevel all round. Optional slot through the middle.
function slab(w: number, d: number, t: number, radius: number, bevel: number, slot?: { w: number; d: number }) {
  const shape = roundedRect(w - bevel * 2, d - bevel * 2, Math.max(radius - bevel, 0.005), new THREE.Shape()) as THREE.Shape
  if (slot) shape.holes.push(roundedRect(slot.w + bevel * 2, slot.d + bevel * 2, (slot.d + bevel * 2) / 2.2, new THREE.Path()))
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(t - bevel * 2, 0.001),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 6,
    curveSegments: 24,
  })
  geo.rotateX(-Math.PI / 2)
  geo.computeBoundingBox()
  geo.translate(0, -geo.boundingBox!.min.y, 0)
  // Extruded geometry comes out faceted (every triangle its own normal), which makes the bevel sparkle
  // in dots. Weld it and smooth the normals so light runs along the edge in one clean line.
  geo.deleteAttribute('uv')
  geo.deleteAttribute('normal')
  const smooth = mergeVertices(geo, 1e-5)
  geo.dispose()
  smooth.computeVertexNormals()
  // Welding can leave a vertex touched only by zero-area triangles; give it a normal rather than NaN
  // (a single NaN pixel would spread through the bloom).
  const n = smooth.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i)
    const y = n.getY(i)
    const z = n.getZ(i)
    if (!(x * x + y * y + z * z > 1e-8)) n.setXYZ(i, 0, 1, 0)
  }
  // The brushed top plate needs texture coordinates to orient its grain: run them along x on top,
  // and keep them non-degenerate on every other face.
  const ps = smooth.attributes.position as THREE.BufferAttribute
  const uv = new Float32Array(ps.count * 2)
  for (let i = 0; i < ps.count; i++) {
    uv[i * 2] = ps.getX(i) + ps.getY(i) * 0.5
    uv[i * 2 + 1] = ps.getZ(i) + ps.getY(i)
  }
  smooth.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return smooth
}

interface Strip {
  geo: THREE.BufferGeometry
  base: Float32Array
  mesh: THREE.Mesh
  cx: number
  spread: number
  twist: number
  bend: number
  phase: number
  release: number
  px: number
  pz: number
  yaw: number
  lift: number
  waves: number
  layer: number
}

/* ---------- the stage ---------- */

export async function createStage(host: HTMLElement, cleared: StageFile, held: StageFile, opts: Options): Promise<Stage> {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
  // Checking shader logs blocks the main thread for seconds on some drivers; the shaders here are fixed.
  renderer.debug.checkShaderErrors = false
  const maxRatio = Math.min(window.devicePixelRatio || 1, 2)
  let ratio = maxRatio
  renderer.setPixelRatio(ratio)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.localClippingEnabled = true
  renderer.domElement.style.opacity = '0'
  host.appendChild(renderer.domElement)

  // Building the stage is split across tasks (see `nextTask`), so no single task blocks input for long.
  const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  const disposables: { dispose(): void }[] = []
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x)

  const fog = new THREE.Color(0x030405)
  const scene = new THREE.Scene()
  scene.background = fog
  const envTex = keep(studioEnvironment(renderer))
  await nextTask()
  scene.environment = envTex
  scene.environmentIntensity = 0

  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 80)

  /* studio */

  const wallMat = keep(new THREE.ShaderMaterial(wallShader(fog)))
  const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(70, 30)), wallMat)
  wall.position.set(0, 12, -13)
  scene.add(wall)

  const floor = new Reflector(keep(new THREE.PlaneGeometry(80, 80)), {
    textureWidth: 1024,
    textureHeight: 1024,
    color: 0x8f959e,
    shader: floorShader,
    multisample: 0,
  })
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)
  const floorMat = floor.material as THREE.ShaderMaterial
  floorMat.uniforms.uFog.value = fog

  const shade = new THREE.Mesh(keep(new THREE.PlaneGeometry(10, 10)), keep(new THREE.ShadowMaterial({ opacity: 0.32, color: 0x000000 })))
  shade.rotation.x = -Math.PI / 2
  shade.position.y = 0.002
  shade.receiveShadow = true
  scene.add(shade)

  // Contact shadow: a soft dark pool right under the base.
  {
    const cv = document.createElement('canvas')
    cv.width = 256
    cv.height = 128
    const c = cv.getContext('2d')!
    const g = c.createRadialGradient(128, 64, 0, 128, 64, 128)
    g.addColorStop(0, 'rgba(0,0,0,0.85)')
    g.addColorStop(0.45, 'rgba(0,0,0,0.5)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 256, 128)
    const aoTex = keep(new THREE.CanvasTexture(cv))
    const ao = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(GATE_W + 1.4, GATE_D + 1.1)),
      keep(new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false, toneMapped: false })),
    )
    ao.rotation.x = -Math.PI / 2
    ao.position.y = 0.003
    scene.add(ao)
  }

  // The beam: two nested cones, a soft outer one and a brighter core.
  const beamColor = new THREE.Color(0.62, 0.68, 0.8)
  const beams = [
    { r0: 0.35, r1: 2.0, k: 0.045 },
    { r0: 0.2, r1: 1.2, k: 0.055 },
  ].map(({ r0, r1, k }) => {
    const mat = keep(
      new THREE.ShaderMaterial({ ...beamShader(beamColor), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    )
    const m = new THREE.Mesh(keep(new THREE.CylinderGeometry(r0, r1, 11, 96, 1, true)), mat)
    m.position.y = 5.5 + GT - 0.2
    m.scale.y = 1
    scene.add(m)
    return { mat, k }
  })

  const DUST = 110
  const dr = rng(7)
  const dustPos = new Float32Array(DUST * 3)
  const dustSeed = new Float32Array(DUST * 4)
  for (let i = 0; i < DUST; i++) {
    const a = dr() * Math.PI * 2
    const rad = Math.sqrt(dr()) * 1.7
    dustPos.set([Math.cos(a) * rad, dr() * 7, Math.sin(a) * rad], i * 3)
    dustSeed.set([dr(), dr(), dr(), dr()], i * 4)
  }
  const dustGeo = keep(new THREE.BufferGeometry())
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
  dustGeo.setAttribute('seed', new THREE.BufferAttribute(dustSeed, 4))
  const dustMat = keep(new THREE.ShaderMaterial({ ...dustShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  dustMat.uniforms.uFloorY.value = GT
  const dust = new THREE.Points(dustGeo, dustMat)
  dust.frustumCulled = false
  scene.add(dust)

  /* lights: everything starts dark; the opening brings them up */

  const spot = new THREE.SpotLight(0xf1f4fa, 0, 0, 0.3, 0.9, 2)
  spot.position.set(0, 11.5, 0.9)
  spot.target.position.set(0, 1.3, 0)
  spot.castShadow = true
  spot.shadow.mapSize.set(1024, 1024)
  spot.shadow.bias = -0.0002
  spot.shadow.normalBias = 0.01
  spot.shadow.radius = 5
  spot.shadow.camera.near = 6
  spot.shadow.camera.far = 16
  scene.add(spot, spot.target)

  const key = new THREE.DirectionalLight(0xe2e8f3, 0)
  key.position.set(-4, 3, 7)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0xc9d4ea, 0)
  rim.position.set(3.5, 3.5, -6)
  scene.add(rim)

  /* the machine */

  const bodyMat = keep(
    new THREE.MeshPhysicalMaterial({ color: 0x1c1f24, metalness: 1, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.25 }),
  )
  const plateMat = keep(
    new THREE.MeshPhysicalMaterial({ color: 0xa6acb4, metalness: 1, roughness: 0.32, anisotropy: 0.75, anisotropyRotation: 0 }),
  )

  const head = new THREE.Group()
  head.position.y = GB
  scene.add(head)

  const body = new THREE.Mesh(keep(slab(GATE_W, GATE_D, BODY_T, 0.14, 0.035, { w: SLOT_W + 0.04, d: SLOT_D + 0.03 })), bodyMat)
  body.castShadow = true
  body.receiveShadow = true
  head.add(body)

  const plate = new THREE.Mesh(
    keep(slab(GATE_W - 0.06, GATE_D - 0.06, PLATE_T, 0.11, 0.012, { w: SLOT_W, d: SLOT_D })),
    plateMat,
  )
  plate.position.y = BODY_T - 0.002
  plate.castShadow = true
  plate.receiveShadow = true
  head.add(plate)

  // The light, deep inside the slot's throat.
  const slotMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4.5, 5.6), toneMapped: false }))
  const slot = new THREE.Mesh(keep(new THREE.PlaneGeometry(SLOT_W - 0.04, 0.018)), slotMat)
  slot.rotation.x = -Math.PI / 2
  slot.position.y = BODY_T * 0.55
  head.add(slot)
  const slotUnder = new THREE.Mesh(slot.geometry, slotMat)
  slotUnder.rotation.x = Math.PI / 2
  slotUnder.position.y = -0.004
  head.add(slotUnder)

  const slotLight = new THREE.PointLight(0xc8d6ff, 0, 2.5, 2)
  slotLight.position.set(0, GT + 0.14, 0.18)
  scene.add(slotLight)
  const underLight = new THREE.PointLight(0xc8d6ff, 0, 2.6, 2)
  underLight.position.set(0, GB - 0.3, 0.1)
  scene.add(underLight)

  // Front face: machined grooves and the engraved wordmark, plus one small status light.
  const faceTex = keep(faceTexture())
  const faceW = GATE_W - 0.42
  const faceH = (faceW * 128) / 2048
  const face = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(faceW, faceH)),
    keep(new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false })),
  )
  face.position.set(0, BODY_T * 0.5, GATE_D / 2 + 0.0015)
  head.add(face)

  const ledMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.7, 2.1), toneMapped: false }))
  const led = new THREE.Mesh(keep(new THREE.CircleGeometry(0.011, 24)), ledMat)
  led.position.set(faceW * 0.105, BODY_T * 0.5, GATE_D / 2 + 0.002)
  head.add(led)

  // The base the case stands on.
  const base = new THREE.Mesh(keep(slab(GATE_W, GATE_D, BASE_T, 0.14, 0.03)), bodyMat)
  base.castShadow = true
  base.receiveShadow = true
  scene.add(base)
  const lipMat = keep(new THREE.MeshPhysicalMaterial({ color: 0x4a4f57, metalness: 1, roughness: 0.38 }))
  const baseLip = new THREE.Mesh(keep(slab(GATE_W - 0.12, GATE_D - 0.12, 0.012, 0.09, 0.004)), lipMat)
  baseLip.position.y = BASE_T - 0.004
  scene.add(baseLip)

  // The glass case: only its reflections are drawn, added on top of whatever is inside it. Front faces
  // only, so lights inside the case (which light the strips) never glint off the far wall.
  const BIN_W = GATE_W - 0.14
  const BIN_D = GATE_D - 0.14
  const glassMat = keep(
    new THREE.MeshPhysicalMaterial({
      color: 0x000000,
      metalness: 0,
      roughness: 0.06,
      specularIntensity: 1,
      envMapIntensity: 1.5,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  const glass = new THREE.Mesh(keep(new RoundedBoxGeometry(BIN_W, BIN_H + 0.01, BIN_D, 6, 0.03)), glassMat)
  glass.position.y = BASE_T + BIN_H / 2
  glass.renderOrder = 2
  scene.add(glass)

  // Inside the case: a soft fall of light from the slot, and a low light that finds the strips.
  const glowCanvas = document.createElement('canvas')
  glowCanvas.width = 256
  glowCanvas.height = 256
  {
    const c = glowCanvas.getContext('2d')!
    const g = c.createRadialGradient(128, 0, 0, 128, 0, 256)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.35, 'rgba(255,255,255,0.28)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 256, 256)
  }
  const innerGlowMat = keep(
    new THREE.MeshBasicMaterial({
      map: keep(new THREE.CanvasTexture(glowCanvas)),
      color: new THREE.Color(0.75, 0.82, 1),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  const innerGlow = new THREE.Mesh(keep(new THREE.PlaneGeometry(BIN_W * 0.92, BIN_H)), innerGlowMat)
  innerGlow.position.set(0, BASE_T + BIN_H / 2, -0.05)
  scene.add(innerGlow)
  const pileLight = new THREE.PointLight(0xd8e2f5, 0, 2.2, 2)
  pileLight.position.set(0.3, BASE_T + 0.55, 0.25)
  scene.add(pileLight)

  /* the hold: a sheet of light that closes over the slot */

  const holdTexCanvas = document.createElement('canvas')
  holdTexCanvas.width = 512
  holdTexCanvas.height = 128
  {
    const c = holdTexCanvas.getContext('2d')!
    const g = c.createRadialGradient(256, 64, 0, 256, 64, 256)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.45, 'rgba(255,255,255,0.32)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 512, 128)
  }
  const holdTex = keep(new THREE.CanvasTexture(holdTexCanvas))
  const holdSheetMat = keep(
    new THREE.MeshBasicMaterial({
      map: holdTex,
      color: new THREE.Color(0.9, 1, 1.25),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  )
  const holdSheet = new THREE.Mesh(keep(new THREE.PlaneGeometry(GATE_W + 0.9, 0.7)), holdSheetMat)
  holdSheet.rotation.x = -Math.PI / 2
  holdSheet.position.y = GT + 0.06
  scene.add(holdSheet)
  const holdLineMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.5, 4.3), toneMapped: false, transparent: true, opacity: 0 }))
  const holdLine = new THREE.Mesh(keep(new THREE.BoxGeometry(GATE_W - 0.2, 0.01, 0.01)), holdLineMat)
  holdLine.position.set(0, GT + 0.06, 0)
  scene.add(holdLine)
  const holdLight = new THREE.PointLight(0xd4e0ff, 0, 4, 2)
  holdLight.position.set(0, GT + 0.35, 0.5)
  scene.add(holdLight)

  /* paper */

  const aniso = renderer.capabilities.getMaxAnisotropy()
  const texA = keep(paperTexture(cleared, 11, aniso))
  await nextTask()
  const texB = keep(paperTexture(held, 23, aniso))
  await nextTask()
  const edgeMat = keep(new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.9 }))
  const backMat = keep(new THREE.MeshStandardMaterial({ color: 0xe4e7eb, roughness: 0.92 }))
  const keepAbove = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GT)
  const keepBelow = new THREE.Plane(new THREE.Vector3(0, -1, 0), GB)
  // A little emissive from the sheet's own texture keeps it white under the beam instead of going grey.
  const faceMat = (map: THREE.Texture, clip: boolean) =>
    keep(
      new THREE.MeshStandardMaterial({
        map,
        emissiveMap: map,
        emissive: new THREE.Color(0.16, 0.165, 0.17),
        roughness: 0.82,
        clippingPlanes: clip ? [keepAbove] : [],
        transparent: clip,
      }),
    )
  const faceA = faceMat(texA, true)
  const faceB = faceMat(texB, false)
  const edgeClip = keep(edgeMat.clone())
  edgeClip.clippingPlanes = [keepAbove]
  edgeClip.transparent = true
  const backClip = keep(backMat.clone())
  backClip.clippingPlanes = [keepAbove]
  backClip.transparent = true

  const docGeo = (geo: THREE.BufferGeometry) => ({ geo, base: Float32Array.from(geo.attributes.position.array) })
  const docA = docGeo(keep(new THREE.BoxGeometry(DOC_W, DOC_H, 0.008, 12, 40, 1)))
  const docB = docGeo(keep(new THREE.BoxGeometry(DOC_W, DOC_H, 0.008, 12, 40, 1)))
  const meshA = new THREE.Mesh(docA.geo, [edgeClip, edgeClip, edgeClip, edgeClip, faceA, backClip])
  const meshB = new THREE.Mesh(docB.geo, [edgeMat, edgeMat, edgeMat, edgeMat, faceB, backMat])
  meshA.castShadow = meshB.castShadow = true
  meshA.receiveShadow = meshB.receiveShadow = true
  scene.add(meshA, meshB)

  // Strips: slices of file A's own sheet, so the shreds carry its lines of text.
  const stripMat = keep(new THREE.MeshStandardMaterial({ map: texA, roughness: 0.85, side: THREE.DoubleSide, clippingPlanes: [keepBelow] }))
  const sw = DOC_W / STRIPS
  const sr = rng(41)
  const strips: Strip[] = []
  const PILE_Y = BASE_T + 0.004
  for (let i = 0; i < STRIPS; i++) {
    const geo = keep(new THREE.BoxGeometry(sw * 0.9, DOC_H, 0.004, 1, 40, 1))
    const uv = geo.attributes.uv as THREE.BufferAttribute
    for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / STRIPS)
    const mesh = new THREE.Mesh(geo, stripMat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    scene.add(mesh)
    const cx = -DOC_W / 2 + (i + 0.5) * sw
    const side = cx / (DOC_W / 2)
    strips.push({
      geo,
      base: Float32Array.from(geo.attributes.position.array),
      mesh,
      cx,
      spread: side * 0.07 + (sr() - 0.5) * 0.06,
      twist: (sr() - 0.5) * 1.8,
      bend: (sr() - 0.5) * 0.28,
      phase: sr() * Math.PI * 2,
      release: sr() * 0.42,
      // Settled inside the case: lying mostly lengthwise, curled, overlapping.
      px: side * 0.3 + (sr() - 0.5) * 0.36,
      pz: (sr() - 0.5) * 0.3,
      yaw: (sr() - 0.5) * 0.6 + (sr() < 0.5 ? Math.PI / 2 : -Math.PI / 2),
      lift: 0.03 + sr() * 0.07,
      waves: 0.8 + sr() * 1.6,
      layer: i,
    })
  }

  /* post */

  // MSAA on the scene; on a 2x screen the extra pixels already smooth edges, so fewer samples will do.
  // Half-float targets need a colour-buffer extension some iPhones lack; without it the stage failed to build
  // and phones fell back to the still layout. Use plain 8-bit there instead.
  const halfFloat = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float')
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
    samples: maxRatio >= 2 ? 2 : 4,
  })
  const composer = new EffectComposer(renderer, target)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.55, 1.0)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())
  const finish = new ShaderPass(finishShader)
  composer.addPass(finish)

  /* per-frame posing */

  const pos = new THREE.Vector3()
  const look = new THREE.Vector3()
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 }
  let width = 1
  let height = 1
  let narrow = false

  function bendDoc(d: { geo: THREE.BufferGeometry; base: Float32Array }, curl: number, flutter: number, t: number) {
    const arr = d.geo.attributes.position.array as Float32Array
    for (let k = 0; k < arr.length; k += 3) {
      const y = d.base[k + 1] / DOC_H + 0.5 // 0 bottom, 1 top
      const x = d.base[k] / DOC_W // -0.5 .. 0.5
      arr[k] = d.base[k]
      arr[k + 1] = d.base[k + 1]
      // A soft bow down the sheet, a slight cup across it, and a little flutter.
      arr[k + 2] =
        d.base[k + 2] +
        curl * (y - 0.5) * (y - 0.5) * 0.5 +
        curl * x * x * 0.22 +
        flutter * Math.sin(t * 1.2 + y * 3 + x * 1.5) * 0.01
    }
    d.geo.attributes.position.needsUpdate = true
    d.geo.computeVertexNormals()
  }

  function poseStrips(docY: number, fallP: number, t: number) {
    const anyFed = docY - DOC_H / 2 < GB
    for (const s of strips) {
      s.mesh.visible = anyFed
      if (!anyFed) continue
      const f = easeInOut(clamp01((fallP - s.release) / 0.58))
      const arr = s.geo.attributes.position.array as Float32Array
      const sway = Math.sin(t * 0.9 + s.phase) * 0.05 * (1 - f)
      const cy = Math.cos(s.yaw)
      const sy = Math.sin(s.yaw)
      for (let k = 0; k < arr.length; k += 3) {
        const bx = s.base[k]
        const by = s.base[k + 1]
        const bz = s.base[k + 2]
        // Hanging under the head.
        const yf = docY + by
        const d = Math.max(0, GB - yf)
        const a = s.twist * d + sway * d
        const hx = s.cx + bx * Math.cos(a) - bz * Math.sin(a) + s.spread * d * d
        const hz = bx * Math.sin(a) + bz * Math.cos(a) + s.bend * d * d + sway * d * 0.4
        const hy = yf + Math.abs(s.bend) * d * d * 0.15
        if (f <= 0) {
          arr[k] = hx
          arr[k + 1] = hy
          arr[k + 2] = hz
          continue
        }
        // Lying in the pile on the case's floor, curled.
        const v = by / DOC_H + 0.5
        const lift = s.lift * Math.pow(Math.sin(v * Math.PI * s.waves + s.phase * 0.2), 2)
        const lx = by * 0.92
        const lz = bx
        const fx = s.px + lx * sy + lz * cy
        const fz = s.pz + lx * cy - lz * sy
        const fy = PILE_Y + s.layer * 0.0026 + lift + bz
        const arc = Math.sin(f * Math.PI) * 0.08
        arr[k] = lerp(hx, fx, f)
        arr[k + 1] = lerp(hy, fy, easeIn(f) * 0.6 + f * 0.4) + arc * (1 - v) * 0.3
        arr[k + 2] = lerp(hz, fz, f)
      }
      s.geo.attributes.position.needsUpdate = true
      s.geo.computeVertexNormals()
    }
    // Once the strips are below the head, they no longer need clipping (and can't be seen inside it).
    // (Moving the plane away rather than removing it keeps the same shader: no recompile mid-scroll.)
    keepBelow.constant = fallP > 0 ? 1000 : GB
  }

  let progress = 0
  let introT = opts.intro && !opts.still ? 0 : INTRO_S
  let introDone = !opts.intro || opts.still
  let skipping = false

  function frame(t: number) {
    const p = opts.still ? 0.95 : progress
    const k = clamp01(introT / INTRO_S)

    /* light levels (the opening brings them up) */
    const ignite = expoOut((introT - 0.1) / 0.9)
    const envUp = easeOut((introT - 0.35) / 1.6)
    const beamUp = easeOut((introT - 0.8) / 1.5)
    scene.environmentIntensity = 0.95 * envUp
    // The light sweep: the studio turns past the object during the opening, then drifts with scroll.
    scene.environmentRotation.y = lerp(-1.6, 0.25, easeInOut((introT - 0.15) / 2.9)) + Math.sin(t * 0.1) * 0.08 * k + p * 0.4
    spot.intensity = 280 * beamUp
    key.intensity = 0.4 * envUp
    rim.intensity = 1.1 * envUp
    for (const b of beams) {
      b.mat.uniforms.uIntensity.value = b.k * beamUp
      b.mat.uniforms.uTime.value = t
    }
    dustMat.uniforms.uIntensity.value = beamUp
    dustMat.uniforms.uTime.value = t
    wallMat.uniforms.uIntensity.value = beamUp
    floorMat.uniforms.uIntensity.value = beamUp

    /* file A: settles into the beam in the opening, then is fed through the slot */
    // The file drops into the beam once the camera has nearly settled, so it never crosses the headline.
    const arrive = easeOut((introT - 2.15) / 1.1)
    const feed = easeInOut(range(p, 0.13, 0.33))
    const bob = Math.sin(t * 0.8) * 0.02 * (1 - feed)
    const aY = lerp(lerp(HOVER_Y + 0.22, HOVER_Y, arrive), FED_Y, feed) + bob
    const aOpacity = clamp01(arrive * 1.6)
    faceA.opacity = edgeClip.opacity = backClip.opacity = aOpacity
    meshA.position.set(0, aY, 0)
    meshA.rotation.set(0, (Math.sin(t * 0.3) * 0.16 - 0.12) * (1 - feed) * arrive, Math.sin(t * 0.45) * 0.008 * (1 - feed))
    meshA.visible = feed < 1 && arrive > 0
    if (meshA.visible) bendDoc(docA, 0.16 * (1 - feed), 1 - feed, t)
    poseStrips(aY, range(p, 0.31, 0.43), t)

    /* file B: comes down, meets the sheet of light, is pushed back up and held there */
    const bArrive = easeOut(range(p, 0.43, 0.55))
    const bPress = easeInOut(range(p, 0.55, 0.59))
    const bPush = easeOut(range(p, 0.6, 0.7))
    const touchY = GT + 0.07 + DOC_H / 2
    const bY = lerp(HOVER_Y + 3.6, HOVER_Y, bArrive) + lerp(0, touchY - HOVER_Y, bPress) + lerp(0, HOVER_Y - touchY, bPush)
    meshB.visible = p > 0.43
    meshB.position.set(0, bY + Math.sin(t * 0.8) * 0.018 * bPush, 0)
    meshB.rotation.set(0, (Math.sin(t * 0.3) * 0.14 - 0.1) * bPush + (1 - bArrive) * 0.35, Math.sin(t * 0.45) * 0.01 * bPush)
    if (meshB.visible) bendDoc(docB, 0.16, bPush, t)

    const hold = easeOut(range(p, 0.575, 0.6))
    const holdFlash = Math.exp(-Math.max(0, p - 0.6) * 40) * hold
    holdSheetMat.opacity = hold * (0.1 + 0.14 * holdFlash + 0.02 * Math.sin(t * 2))
    holdLineMat.opacity = hold
    holdLine.scale.x = Math.max(0.001, hold)
    holdLight.intensity = hold * (0.06 + 0.22 * holdFlash)

    /* the slot: ignites in the opening, flares while shredding */
    const shredding = clamp01(1 - Math.abs(p - 0.24) / 0.12)
    const s = ignite * (0.85 + 0.08 * Math.sin(t * 1.5) + shredding * 1.4)
    slot.scale.x = Math.max(0.001, ignite)
    slotUnder.scale.x = slot.scale.x
    slotMat.color.setRGB(4 * s, 4.5 * s, 5.6 * s)
    slotLight.intensity = 0.1 * s
    // Lights the strips as they come through; off at rest, so it doesn't glint on the glass.
    underLight.intensity = shredding * 0.45 * ignite
    innerGlowMat.opacity = ignite * (0.035 + shredding * 0.22)
    pileLight.intensity = range(p, 0.32, 0.45) * 0.35
    const pulse = 0.55 + 0.45 * Math.sin(t * 2.2)
    const ledLevel = envUp * (hold > 0.5 ? 1.4 : shredding > 0.1 ? 1.6 : 0.6 + 0.3 * pulse)
    ledMat.color.setRGB(1.1 * ledLevel, 1.25 * ledLevel, 1.55 * ledLevel)

    /* camera: the opening pulls back from the slot; scroll then pushes in a little and drifts round */
    pointer.sx += (pointer.x - pointer.sx) * 0.05
    pointer.sy += (pointer.y - pointer.sy) * 0.05
    const c = easeInOut((introT - 0.1) / 2.3)
    const push = Math.sin(range(p, 0.1, 0.46) * Math.PI) * 0.07
    const orbit = lerp(0, -0.28, easeInOut(range(p, 0.1, 1)))
    const el = lerp(0.2, 0.13, easeInOut(range(p, 0, 1)))
    // On tall screens the last beat lifts the machine into the top half, clear of the words below it.
    const fin = easeInOut(range(p, 0.74, 0.86))
    const lift = narrow ? fin : 0
    const dist = framingDistance(lerp(narrow ? 0.52 : 0.64, 0.34, lift)) * (1 - push)
    const heroX = Math.sin(orbit) * dist * Math.cos(el)
    const heroY = OBJ_MID + Math.sin(el) * dist
    const heroZ = Math.cos(orbit) * dist * Math.cos(el)
    const near = narrow ? 1.6 : 1
    pos.set(lerp(0.9 * near, heroX, c), lerp(GT + 0.85 * near, heroY, c), lerp(2.5 * near, heroZ, c))
    pos.x += pointer.sx * 0.22 * k
    pos.y -= pointer.sy * 0.1 * k
    look.set(lerp(0.15, 0, c), lerp(GT - 0.05, OBJ_MID, c), 0)
    camera.position.copy(pos)
    camera.lookAt(look)

    // Frame the object in the lower part of the screen, under the headline. On wide screens the last
    // beat moves it right, to leave room for the words on the left.
    const region = lerp(narrow ? 0.665 : 0.625, 0.3, lift) // where the object's middle sits, from the top
    const offY = -(region - 0.5) * height * c
    const shift = narrow ? 0 : fin * 0.2
    camera.setViewOffset(width, height, -width * shift, offY, width, height)

    finish.uniforms.uTime.value = t
    finish.uniforms.uFade.value = opts.intro ? easeOut(introT / 0.5) * 0.6 + 0.4 : 1
  }

  // Distance at which the object fills its share of the screen: limited by height, and on narrow
  // screens by width.
  function framingDistance(share: number) {
    const vfov = (camera.fov * Math.PI) / 180
    const byHeight = (OBJ_TOP + 0.3) / share / (2 * Math.tan(vfov / 2))
    const byWidth = (GATE_W + 0.5) / Math.min(0.86, share * 1.65) / (2 * Math.tan(vfov / 2) * camera.aspect)
    return Math.max(byHeight, byWidth)
  }

  /* loop */

  const start = performance.now()
  let last = start
  let raf = 0
  let active = false
  let ready = false
  // Adaptive resolution: if frames run long once the opening is over, render fewer pixels.
  let slowSum = 0
  let slowN = 0

  const render = () => {
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    if (!introDone) {
      introT += dt * (skipping ? 5 : 1)
      if (introT >= INTRO_S) {
        introT = INTRO_S
        introDone = true
        opts.onIntroDone?.()
      }
    } else if (active && ratio > 1.25 && dt < 0.1) {
      slowSum += dt
      slowN++
      if (slowN === 90) {
        if (slowSum / slowN > 0.0175) {
          ratio = Math.max(1.25, ratio - 0.375)
          renderer.setPixelRatio(ratio)
          composer.setPixelRatio(ratio)
          resize()
        }
        slowSum = 0
        slowN = 0
      }
    }
    frame((now - start) / 1000)
    composer.render()
    if (active) raf = requestAnimationFrame(render)
  }

  function resize() {
    width = host.clientWidth || window.innerWidth
    height = host.clientHeight || window.innerHeight
    renderer.setSize(width, height, false)
    composer.setSize(width, height)
    // Bloom is soft by nature: run it at CSS resolution whatever the screen density.
    bloom.setSize(width, height)
    camera.aspect = width / height
    narrow = width / height < 1.1
    camera.fov = narrow ? 30 : 24
    camera.updateProjectionMatrix()
    dustMat.uniforms.uScale.value = (height * renderer.getPixelRatio()) / (2 * Math.tan(((camera.fov / 2) * Math.PI) / 180))
    if (ready && !active) render()
  }

  const onPointer = (e: PointerEvent) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1
  }
  if (!opts.still) window.addEventListener('pointermove', onPointer, { passive: true })

  resize()
  // Compile every shader before the first frame, off the main thread where the browser allows it,
  // so the page never freezes while the GPU driver works.
  // Everything is made visible while compiling (the renderer skips hidden objects), so nothing that
  // appears later in the story has to compile mid-scroll.
  frame(0)
  scene.traverse((o) => (o.visible = true))
  try {
    await renderer.compileAsync(scene, camera)
  } catch {
    // Older drivers: fall back to compiling on first render.
  }
  // Upload the big textures one per task.
  for (const t of [texA, texB, faceTex, envTex]) {
    await nextTask()
    renderer.initTexture(t)
  }
  await nextTask()
  // A first scene render compiles what compileAsync can't reach (shadow and mirror passes)...
  renderer.setRenderTarget(target)
  renderer.render(scene, camera)
  renderer.setRenderTarget(null)
  frame(0)
  await nextTask()
  // ...then the first full frame compiles the post passes. Then show the canvas and start the clock.
  composer.render()
  renderer.domElement.style.transition = 'opacity 400ms ease'
  renderer.domElement.style.opacity = '1'
  ready = true
  last = performance.now()
  if (!introDone) opts.onIntroStart?.()
  if (opts.still) render()

  return {
    setProgress(next) {
      progress = next
      if (next > 0.004 && !introDone) skipping = true
      if (!active) render()
    },
    setActive(next) {
      if (opts.still || next === active) return
      active = next
      cancelAnimationFrame(raf)
      if (active) {
        last = performance.now()
        raf = requestAnimationFrame(render)
      }
    },
    skipIntro() {
      if (!introDone) skipping = true
    },
    resize,
    dispose() {
      active = false
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onPointer)
      disposables.forEach((d) => d.dispose())
      floor.dispose()
      target.dispose()
      composer.dispose()
      bloom.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
