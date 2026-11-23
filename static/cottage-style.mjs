// The "lofi" look for the cottage (sample, 0.9.48): one cel-shaded style for the room and for Yui, closer to
// lo-fi room games. Only active with ?style=lofi; without it nothing here runs and the classic look is unchanged.
//
// - Lit materials keep their colours, textures and lights, but each light falls off in a hard step instead of a
//   smooth gradient, and shiny highlights are toned down.
// - Areas in shade get a fine screen-space dot tone, like the screentone in manga.
// - A post pass draws ink lines where depth jumps (silhouettes) or folds (creases), then grades the colour:
//   shadows lean blue, a touch less saturation.
import * as T from "./engine/three.module.min.js"

export const STYLES = ["classic", "lofi"]

// Shared by every patched material, so the look can be tuned without recompiling shaders.
export const toneUniforms = {
  lofiEdge: { value: .06 },
  lofiSoft: { value: .045 },
  lofiFloor: { value: .78 },
  lofiSpec: { value: .35 },
  lofiTone: { value: .2 },
  lofiToneEdge: { value: .55 },
  lofiToneSize: { value: 4 },
}

const STEP = `
uniform float lofiEdge;
uniform float lofiSoft;
uniform float lofiFloor;
// A light either reaches a surface or it does not; past the edge it brightens only a little with the angle.
float lofiStep( const in float dotNL ) {
  return smoothstep( lofiEdge - lofiSoft, lofiEdge + lofiSoft, dotNL ) * mix( lofiFloor, 1.0, dotNL );
}
`
const LIT = "vec3 irradiance = dotNL * directLight.color;"
const chunk = name => STEP + T.ShaderChunk[name].replace(LIT, "vec3 irradiance = lofiStep( dotNL ) * directLight.color;")

// Runs after all lights are summed: weaker highlights, and the dot tone where little direct light arrives.
const AFTER_LIGHTS = `#include <lights_fragment_end>
{
  vec3 lofiAlbedo = max( material.diffuseColor, vec3( 1e-3 ) );
  float lofiLit = dot( reflectedLight.directDiffuse, vec3( .2126, .7152, .0722 ) )
    / ( dot( lofiAlbedo, vec3( .2126, .7152, .0722 ) ) * RECIPROCAL_PI );
  float lofiShade = 1.0 - smoothstep( 0.0, lofiToneEdge, lofiLit );
  vec2 lofiCell = mat2( .7071, -.7071, .7071, .7071 ) * gl_FragCoord.xy / lofiToneSize;
  float lofiDot = 1.0 - smoothstep( -.08, .08, length( fract( lofiCell ) - .5 ) - .46 * sqrt( lofiShade ) );
  float lofiMul = 1.0 - lofiTone * lofiDot * lofiShade;
  reflectedLight.directDiffuse *= lofiMul;
  reflectedLight.indirectDiffuse *= lofiMul;
  reflectedLight.directSpecular *= lofiSpec;
  reflectedLight.indirectSpecular *= lofiSpec;
}`
const TONE_UNIFORMS = "uniform float lofiSpec;\nuniform float lofiTone;\nuniform float lofiToneEdge;\nuniform float lofiToneSize;\n"

const patched = new WeakSet()
const PATCHABLE = ["MeshStandardMaterial", "MeshPhysicalMaterial", "MeshLambertMaterial"]

function patch(material) {
  if (patched.has(material) || !PATCHABLE.includes(material.type) || material.userData.lofiSkip) return
  patched.add(material)
  const before = material.onBeforeCompile
  const key = material.customProgramCacheKey
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer)
    Object.assign(shader.uniforms, toneUniforms)
    shader.fragmentShader = TONE_UNIFORMS + shader.fragmentShader
      .replace("#include <lights_physical_pars_fragment>", chunk("lights_physical_pars_fragment"))
      .replace("#include <lights_lambert_pars_fragment>", chunk("lights_lambert_pars_fragment"))
      .replace("#include <lights_fragment_end>", AFTER_LIGHTS)
  }
  material.customProgramCacheKey = () => `${key.call(material)}|lofi`
  material.needsUpdate = true
}

// Patches every lit material under root (new ones too when called again; each material only once).
export function stylize(root) {
  root.traverse(object => {
    if (!object.material || object.userData.hull) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) patch(material)
  })
}

// The dot tone is sized in screen pixels, so it stays the same on high-density screens.
export function setPixelRatio(ratio) {
  toneUniforms.lofiToneSize.value = 4 * ratio
}

// Ink lines from depth, then the colour grade. Reads the scene's depth texture (see scenePass in cottage.mjs).
// Uses 1/z: it changes linearly across any flat surface on screen, so a flat floor or wall gives no line however
// steeply it is seen, and only edges and folds do.
export const InkShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null }, texel: { value: new T.Vector2(1, 1) },
    near: { value: .05 }, far: { value: 120 }, ink: { value: .62 }, threshold: { value: .012 },
    shadowTint: { value: new T.Color(.74, .8, 1.1) }, saturation: { value: .88 }, enabled: { value: 1 },
  },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 texel; uniform float near; uniform float far;
    uniform float ink; uniform float threshold; uniform vec3 shadowTint; uniform float saturation; uniform float enabled;
    varying vec2 vUv;
    float inverseDepth(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      float z = near * far / (far - d * (far - near));
      return 1. / z;
    }
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      if (enabled < .5) { gl_FragColor = color; return; }
      float c = inverseDepth(vUv);
      float l = inverseDepth(vUv - vec2(texel.x, 0.)), r = inverseDepth(vUv + vec2(texel.x, 0.));
      float d = inverseDepth(vUv - vec2(0., texel.y)), u = inverseDepth(vUv + vec2(0., texel.y));
      // Only the nearer side of a jump draws the line, so it sits on the object's own edge and stays one pixel wide.
      float fold = max(abs(l + r - 2. * c), abs(d + u - 2. * c)) / c;
      float nearer = step(max(max(l, r), max(d, u)) * .995, c) + step(fold, threshold * 6.);
      float line = smoothstep(threshold, threshold * 2.5, fold) * min(1., nearer);
      // Far away (the sky and the distant valley) gets no lines.
      line *= 1. - smoothstep(18., 40., 1. / c);
      vec3 rgb = color.rgb;
      rgb *= 1. - ink * line * (.75 + .25 * (1. - dot(rgb, vec3(.333))));
      float luma = dot(rgb, vec3(.2126, .7152, .0722));
      rgb = mix(vec3(luma), rgb, saturation);
      rgb *= mix(shadowTint, vec3(1.), smoothstep(.05, .6, luma));
      gl_FragColor = vec4(rgb, color.a);
    }`,
}

// Yui in the lofi look: harder two-step shading, less self-light, a cool rim along her outline and an ink hull.
export const YUI_RAMP = { body: [150, 255], face: [228, 255] }

// Yui's own light (lofi). Characters in games like the reference are lit by a rig of their own rather than by
// the room: one key light from the front side that makes a single clean light/shade split, the shade a soft tinted
// colour rather than grey, a little ambient, and a rim of light along the far edge. Directions are in view space,
// so the split always reads well whatever the camera does; colours and strength follow the room (setCharacterLight).
// It replaces her self-lit glow and the room lights on her, so she is not flat-lit and does not glow at night.
export const characterLight = {
  // World space, turned with her (faceCharacterLight): the key stays at her upper left front wherever the camera is.
  keyDir: { value: new T.Vector3(-.55, .55, .63).normalize() },
  keyColor: { value: new T.Color(1, .96, .9) },
  shadeColor: { value: new T.Color(.82, .68, .66) },
  ambient: { value: new T.Color(.16, .17, .22) },
  rimDir: { value: new T.Vector3(.75, .25, -.6).normalize() },
  rimColor: { value: new T.Color(.55, .8, 1) },
}

const DAY = { key: new T.Color(1, .97, .92), ambient: new T.Color(.2, .2, .22), rim: new T.Color(1, .95, .85) }
// Night stays near neutral on her: the room grade already pushes dark pixels blue, and a blue key on top turned her dark hair navy.
const NIGHT = { key: new T.Color(.9, .86, .86), ambient: new T.Color(.16, .14, .16), rim: new T.Color(.5, .72, 1) }
const LAMP = new T.Color(1, .78, .55)
const mixed = new T.Color()

// night 0..1, lamp 0..1 (a warm lamp on at night), level 0..1 (how bright the room is around her).
// The key light belongs to her, not to the camera: upper left in front of her, turned with her body. Seen from the
// front she is lit as before; from behind, her back and the back of her head are in shade (no sheen there).
const KEY_LOCAL = new T.Vector3(-.55, .55, .63).normalize()
const UP = new T.Vector3(0, 1, 0)
export function faceCharacterLight(yaw) {
  characterLight.keyDir.value.copy(KEY_LOCAL).applyAxisAngle(UP, yaw)
}

export function setCharacterLight({ night = 0, lamp = 0, level = 1 }) {
  const u = characterLight
  mixed.copy(DAY.key).lerp(NIGHT.key, night).lerp(LAMP, lamp * night * .6)
  u.keyColor.value.copy(mixed).multiplyScalar(.7 + .3 * level)
  u.ambient.value.copy(DAY.ambient).lerp(NIGHT.ambient, night)
  u.rimColor.value.copy(DAY.rim).lerp(NIGHT.rim, night).multiplyScalar(.7 + .3 * night)
}

// kind: "body" (hands, legs, shoes), "cloth" (cardigan, skirt), "hair", "face" (skin of the face: mostly lit,
// shade only far round the side), "eye" (eyes, lashes, brows, mouth: never split by light).
// Colour (lofi second round): clothes read their texture a mip softer (the painted cloth grain turned into noise at
// cottage distances) and a little more saturated; hair gets a lifted lavender tone and a soft sheen from her key
// light (the anime "angel ring").
export const characterColour = { clothSaturation: 1.18, clothSoftness: 1.3, hairLift: .012, ringStrength: .32 }
export function lightCharacter(material, kind) {
  const before = material.onBeforeCompile
  const bias = { body: 0, cloth: 0, hair: 0, face: .35, eye: 2 }[kind]
  const rim = { body: 1, cloth: 1, hair: 1, face: .5, eye: 0 }[kind]
  const c = characterColour
  const cloth = kind !== "cloth" ? "" : `
        diffuseColor.rgb = max( mix( vec3( dot( diffuseColor.rgb, vec3( .299, .587, .114 ) ) ), diffuseColor.rgb, ${c.clothSaturation.toFixed(2)} ), 0.0 );`
  const hairTone = kind !== "hair" ? "" : `
        diffuseColor.rgb += vec3( .62, .56, .78 ) * ${c.hairLift.toFixed(3)};`
  // The angel ring, done the way mature toon shaders do it (Unity Toon Shader's "Angel Ring", Genshin-style hair maps):
  // a ring shape fixed on the hair, not worked out per pixel from the hair normals (on hair cards those point every
  // which way and a computed sheen breaks into glossy blotches). Yui has no painted ring map, so the ring is projected
  // around her head from the bind-pose position: a band at a fixed height on the crown whose edges zigzag like strand
  // tips. The light only sets how bright it is: full on the side her key light reaches, fading round the head, none
  // where the hair is in shade. Ears and ponytails lie outside the band's radius.
  const ring = kind !== "hair" ? "" : `
        vec3 fromCentre = vHairPos - vec3( 0.0, 1.06, .035 );
        float radius = length( fromCentre );
        float rise = fromCentre.y / max( radius, 1e-4 );
        // Strand tips: about 50 teeth round the head, each its own length (a hash per tooth), pointing down.
        float turn = atan( fromCentre.x, fromCentre.z ) * 8.0;
        float tooth = floor( turn );
        float length = fract( sin( tooth * 12.9898 ) * 43758.5453 );
        float teeth = abs( fract( turn ) - .5 ) * 2.0;
        float upper = .82 + .03 * teeth;
        float lower = .66 - ( .04 + .07 * length ) * ( 1.0 - teeth );
        float band = smoothstep( lower, lower + .025, rise ) * ( 1.0 - smoothstep( upper - .05, upper, rise ) );
        band *= smoothstep( .065, .078, radius ) * ( 1.0 - smoothstep( .092, .1, radius ) );
        float strand = dot( texture2D( map, vMapUv ).rgb, vec3( .333 ) );
        float towardLight = smoothstep( -.1, .6, dot( normal, keyDir ) );
        colour += vec3( .8, .76, .95 ) * charKeyColor * band * towardLight * lit * ( .6 + 1.2 * strand ) * ${c.ringStrength.toFixed(2)};`
  const ringVertex = kind !== "hair" ? null : `#include <begin_vertex>
        vHairPos = position;`
  const soft = kind !== "cloth" ? "" : `#include <map_fragment>`
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer)
    Object.assign(shader.uniforms, {
      charKeyDir: characterLight.keyDir, charKeyColor: characterLight.keyColor, charShade: characterLight.shadeColor,
      charAmbient: characterLight.ambient, charRimDir: characterLight.rimDir, charRimColor: characterLight.rimColor,
    })
    if (ringVertex) {
      shader.vertexShader = `varying vec3 vHairPos;
${shader.vertexShader.replace("#include <begin_vertex>", ringVertex)}`
      shader.fragmentShader = `varying vec3 vHairPos;
${shader.fragmentShader}`
    }
    shader.fragmentShader = `uniform vec3 charKeyDir; uniform vec3 charKeyColor; uniform vec3 charShade; uniform vec3 charAmbient;
uniform vec3 charRimDir; uniform vec3 charRimColor;
` + shader.fragmentShader.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
      {${cloth}${hairTone}
        vec3 base = diffuseColor.rgb;
        vec3 keyDir = normalize( ( viewMatrix * vec4( charKeyDir, 0.0 ) ).xyz );
        float lit = smoothstep( -.04, .04, dot( normal, keyDir ) + ${bias.toFixed(2)} );
        vec3 colour = mix( base * charShade, base, lit ) * charKeyColor + base * charAmbient;
        float edge = smoothstep( .66, .8, 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ) );
        colour += charRimColor * base * ${rim.toFixed(2)} * edge * smoothstep( -.2, .4, dot( normal, charRimDir ) );${ring}
        reflectedLight.directDiffuse = colour;
        reflectedLight.indirectDiffuse = vec3( 0.0 );
        reflectedLight.directSpecular = vec3( 0.0 );
        reflectedLight.indirectSpecular = vec3( 0.0 );
        totalEmissiveRadiance = vec3( 0.0 );
      }`)
    if (soft) shader.fragmentShader = shader.fragmentShader.replace(soft,
      `#ifdef USE_MAP
        diffuseColor *= texture2D( map, vMapUv, ${c.clothSoftness.toFixed(2)} );
      #endif`)
  }
  material.customProgramCacheKey = () => `yui-light-${kind}`
  material.needsUpdate = true
}

// A slightly larger, inside-out copy of each skinned mesh in a dark ink colour: the classic anime outline.
// Shares the mesh's geometry, skeleton and face shapes, so it follows every pose and expression.
export function addHull(mesh, { color = 0x2b2433, width = .0017 } = {}) {
  const material = new T.MeshBasicMaterial({ color, side: T.BackSide })
  material.onBeforeCompile = shader => {
    shader.uniforms.hullWidth = { value: width }
    shader.vertexShader = "uniform float hullWidth;\n" + shader.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>
      {
        vec3 hullNormal = normalize( normalMatrix * objectNormal );
        // About the same thickness on screen up close; thinner far away so a small Yui is not all outline.
        mvPosition.xyz += hullNormal * hullWidth * min( -mvPosition.z, 1.8 );
        gl_Position = projectionMatrix * mvPosition;
      }`)
  }
  material.customProgramCacheKey = () => "yui-hull"
  const hull = new T.SkinnedMesh(mesh.geometry, material)
  hull.bind(mesh.skeleton, mesh.bindMatrix)
  hull.morphTargetInfluences = mesh.morphTargetInfluences
  hull.morphTargetDictionary = mesh.morphTargetDictionary
  hull.frustumCulled = false
  hull.castShadow = hull.receiveShadow = false
  hull.raycast = () => {}
  hull.userData.hull = true
  hull.name = `${mesh.name}-hull`
  mesh.parent.add(hull)
  hull.position.copy(mesh.position)
  hull.quaternion.copy(mesh.quaternion)
  hull.scale.copy(mesh.scale)
  return hull
}
