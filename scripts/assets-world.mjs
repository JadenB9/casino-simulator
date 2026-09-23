#!/usr/bin/env node
// The floor's third-party models and textures, built from the local staging folder into
// client/public/assets/{models,textures}. Everything here is CC0 (see models/credits.json).
//
//   node scripts/assets-world.mjs [staging folder]
//
// Characters: Quaternius Ultimate Modular Men/Women (only the files Poly Pizza marks CC0). Each
// keeps its Idle, Walk and Run clips, loses the unused UV/colour attributes, gets matte
// materials, and goes through `gltf-transform optimize --compress quantize` (never meshopt or
// draco: the client has no decoder for them). outfits.json maps each outfit's mesh/material
// pairs to the Look's colour slots (shared/src/look.ts).
// Props: Quaternius, Kenney and Poly Haven pieces, recoloured where the palette needs it.
// Textures: ambientCG and Poly Haven maps, resized and re-encoded to WebP.
//
// Outputs are committed, so the game builds without the staging folder.

import { mkdirSync, writeFileSync, existsSync, rmSync, statSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
// The gltf-transform libraries and sharp come with @gltf-transform/cli (a dev dependency).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const stage = process.argv[2] ?? join(process.env.HOME ?? '', 'Projects/casino-simulator/.planning/research/assets');
if (!existsSync(stage)) {
  console.error('usage: node scripts/assets-world.mjs <staging folder>');
  process.exit(1);
}
const MODELS = 'client/public/assets/models';
const TEXTURES = 'client/public/assets/textures';
mkdirSync(MODELS, { recursive: true });
mkdirSync(TEXTURES, { recursive: true });
const tmp = join(tmpdir(), `casino-world-${process.pid}`);
mkdirSync(tmp, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const cli = 'node_modules/.bin/gltf-transform';
const credits = [];
const kb = (f) => Math.round(statSync(f).size / 1024);

function optimize(src, dst, extra = []) {
  execFileSync(cli, ['optimize', src, dst, '--compress', 'quantize', '--simplify', 'false', ...extra], { stdio: ['ignore', 'ignore', 'inherit'] });
}

// --- characters -----------------------------------------------------------------------------
const Q = join(stage, 'quaternius-polypizza');
const KEEP = ['Idle', 'Walk', 'Run'];

/**
 * Look slots per (mesh/material). Anything not listed keeps its authored colour (shirts under a
 * jacket, ties, eyes, earrings, soles). `*` matches any mesh. Checked by eye against a debug
 * palette in the dev floor's lineup (?dev=floor&lineup=1).
 */
const CHARACTERS = [
  {
    body: 'm', outfit: 'suit', src: 'modular-men/BusinessMan.glb', page: 'https://poly.pizza/m/JFrLIKqvCH',
    parts: { 'Suit_Body/Suit': 'top', 'Suit_Legs/Suit': 'bottom', 'Suit_Feet/Black': 'shoes', '*/Skin': 'skin', 'Suit_Head/Hair': 'hair', 'Suit_Head/Eyebrows': 'brows' },
  },
  {
    body: 'm', outfit: 'casual', src: 'modular-men/CasualCharacter.glb', page: 'https://poly.pizza/m/kZ3DmIoGip',
    parts: { 'Casual2_Body/LightBrown': 'top', 'Casual2_Legs/LightBlue': 'bottom', 'Casual2_Feet/Red_Dark': 'shoes', '*/Skin': 'skin', 'Casual2_Head/Skin_Darker': 'skinShade', 'Casual2_Head/Hair': 'hair', 'Casual2_Head/Eyebrows': 'brows' },
  },
  {
    body: 'm', outfit: 'hoodie', src: 'modular-men/HoodieCharacter.glb', page: 'https://poly.pizza/m/gKLBoRsyKe',
    parts: { 'Casual_Body/Purple': 'top', 'Casual_Legs/LightBlue': 'bottom', 'Casual_Feet/Purple': 'shoes', '*/Skin': 'skin', 'Casual_Head/Hair': 'hair', 'Casual_Head/Eyebrows': 'brows' },
  },
  {
    body: 'm', outfit: 'punk', src: 'modular-men/Punk.glb', page: 'https://poly.pizza/m/BTALZymknF',
    parts: { 'Punk_Body/Black': 'top', 'Punk_Legs/LightBlue': 'bottom', 'Punk_Feet/Black': 'shoes', '*/Skin': 'skin', 'Punk_Head/Red': 'hair', 'Punk_Head/Red_Dark': 'hairShade', 'Punk_Head/Eyebrows': 'brows' },
  },
  {
    body: 'm', outfit: 'beach', src: 'modular-men/BeachCharacter.glb', page: 'https://poly.pizza/m/DojKLcO34E',
    parts: { 'Beach_Body/LightBrown': 'top', 'Beach_Legs/Red_Dark': 'bottom', 'Beach_Feet/Red_Dark': 'shoes', '*/Skin': 'skin', 'Beach_Head/Hair': 'hair', 'Beach_Head/Eyebrows': 'brows' },
  },
  {
    body: 'f', outfit: 'dress', src: 'modular-women/AnimatedWoman_nIItLV9nxS.glb', page: 'https://poly.pizza/m/nIItLV9nxS',
    parts: { 'Formal_Body/LimeGreen': 'top', 'Formal_Legs/LimeGreen': 'top', 'Formal_Feet/Red': 'shoes', '*/Skin': 'skin', 'Formad_Head/Red': 'hair', 'Formad_Head/Brown': 'brows' },
  },
  {
    body: 'f', outfit: 'smart', src: 'modular-women/AnimatedWoman_qJ2gsTUBHL.glb', page: 'https://poly.pizza/m/qJ2gsTUBHL',
    parts: { 'Casual_Body/White': 'top', 'Casual_Legs/Orange': 'bottom', 'Casual_Feet/Grey': 'shoes', '*/Skin': 'skin', 'Casual_Head/Hair_Blond': 'hair', 'Casual_Head/Hair_Brown': 'brows' },
  },
  {
    body: 'f', outfit: 'punk', src: 'modular-women/Punk.glb', page: 'https://poly.pizza/m/djXoqejw6w',
    parts: { 'Punk_Body/Pink': 'top', 'Punk_Legs/Black': 'bottom', 'Punk_Feet/Black': 'shoes', '*/Skin': 'skin', 'Punk_Head/Pink': 'hair', 'Punk_Head/Hair_Brown': 'brows' },
  },
];

const outfits = { version: 1, clips: KEEP, m: {}, f: {} };
for (const c of CHARACTERS) {
  const doc = await io.read(join(Q, c.src));
  const root = doc.getRoot();
  for (const anim of root.listAnimations()) {
    const name = anim.getName().replace(/^.*\|/, '');
    if (KEEP.includes(name)) anim.setName(name);
    else anim.dispose();
  }
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const sem of ['TEXCOORD_0', 'COLOR_0']) {
        const a = prim.getAttribute(sem);
        if (a) {
          prim.setAttribute(sem, null);
          if (a.listParents().length <= 1) a.dispose();
        }
      }
    }
  }
  // One skinned mesh per character. The four parts (head, body, legs, feet) are bound to the same
  // 62 joints with the same inverse bind matrices, so their primitives can live on one mesh and
  // one skin. Merging before quantizing gives them one quantization volume; the client then joins
  // the primitives into a single draw call. Each primitive remembers its part for outfits.json.
  const skinned = root.listNodes().filter((n) => n.getMesh() && n.getSkin());
  const keep = skinned[0].getMesh();
  for (const n of skinned) {
    const mesh = n.getMesh();
    for (const prim of mesh.listPrimitives()) {
      prim.setExtras({ part: mesh.getName() });
      if (mesh !== keep) {
        keep.addPrimitive(prim);
        mesh.removePrimitive(prim);
      }
    }
    if (mesh !== keep) {
      const skin = n.getSkin();
      n.dispose();
      mesh.dispose();
      if (skin.listParents().filter((p) => p.propertyType === 'Node').length === 0) skin.dispose();
    }
  }
  keep.setName('Character');
  // cloth and skin, not metal
  for (const m of root.listMaterials()) m.setMetallicFactor(0).setRoughnessFactor(0.82);
  const src = join(tmp, `${c.body}-${c.outfit}.glb`);
  const file = `char-${c.body}-${c.outfit}.glb`;
  await io.write(src, doc);
  optimize(src, join(MODELS, file), ['--flatten', 'false', '--join', 'false', '--instance', 'false', '--palette', 'false', '--texture-compress', 'false']);
  // three's GLTFLoader drops primitive extras, so resolve each primitive's slot here, in the
  // order the loader creates them (one SkinnedMesh per primitive, in file order)
  const built = (await io.read(join(MODELS, file))).getRoot().listMeshes()[0];
  const prims = built.listPrimitives().map((p) => {
    const part = p.getExtras().part;
    const mat = p.getMaterial()?.getName() ?? '';
    return { part, material: mat, slot: c.parts[`${part}/${mat}`] ?? c.parts[`*/${mat}`] ?? null };
  });
  outfits[c.body][c.outfit] = { file, parts: c.parts, prims };
  credits.push({ file, from: c.src, author: 'Quaternius', license: 'CC0 1.0', url: c.page });
  console.log(`  ${file.padEnd(28)} ${kb(join(MODELS, file))} KB`);
}
writeFileSync(join(MODELS, 'outfits.json'), JSON.stringify(outfits, null, 1) + '\n');

// --- props ----------------------------------------------------------------------------------
const PP = join(stage, 'polypizza-props');
const HI = join(Q, 'house-interior');
const KF = join(stage, 'kenney-food-kit/Models/GLB format');
const PH = join(stage, 'polyhaven-models');
const PROPS = [
  { file: 'palm.glb', src: join(PP, 'PalmTree__Quaternius__A6cKJYFsIb.glb'), author: 'Quaternius', url: 'https://poly.pizza/m/A6cKJYFsIb' },
  { file: 'plant-a.glb', src: join(HI, 'Houseplant__IBLX2Jz90O.glb'), author: 'Quaternius', url: 'https://poly.pizza/m/IBLX2Jz90O' },
  { file: 'plant-b.glb', src: join(PP, 'Houseplant__Quaternius__bfLOqIV5uP.glb'), author: 'Quaternius', url: 'https://poly.pizza/m/bfLOqIV5uP' },
  // walnut frame, oxblood leather seat
  { file: 'stool.glb', src: join(HI, 'Stool__TvaOenUAni.glb'), author: 'Quaternius', url: 'https://poly.pizza/m/TvaOenUAni', recolor: { Wood: '#2e1a10', Cushin: '#4a0d12' } },
  { file: 'couch.glb', src: join(HI, 'CouchLarge__6MoOyPtetL.glb'), author: 'Quaternius', url: 'https://poly.pizza/m/6MoOyPtetL' },
  { file: 'lamp-floor.glb', src: join(HI, 'LightFloor__sRBBvofo58.glb'), author: 'Quaternius', url: 'https://poly.pizza/m/sRBBvofo58' },
  { file: 'door.glb', src: join(HI, 'DoorDouble__blrNJIEdns.glb'), author: 'Quaternius', url: 'https://poly.pizza/m/blrNJIEdns' },
  { file: 'chandelier-low.glb', src: join(PP, 'LightChandelier__Quaternius__q3k8I8YYX9.glb'), author: 'Quaternius', url: 'https://poly.pizza/m/q3k8I8YYX9' },
  { file: 'bottle-tall.glb', src: join(PP, 'Bottle__Quaternius__FAHsHFXfTf.glb'), author: 'Quaternius', url: 'https://poly.pizza/m/FAHsHFXfTf' },
  { file: 'bottle-red.glb', src: join(KF, 'wine-red.glb'), author: 'Kenney', url: 'https://kenney.nl/assets/food-kit' },
  { file: 'bottle-white.glb', src: join(KF, 'wine-white.glb'), author: 'Kenney', url: 'https://kenney.nl/assets/food-kit' },
  { file: 'glass-cocktail.glb', src: join(KF, 'cocktail.glb'), author: 'Kenney', url: 'https://kenney.nl/assets/food-kit' },
  // High setting only: a hero chandelier (no transmission materials)
  { file: 'chandelier-high.glb', src: join(PH, 'Chandelier_02/Chandelier_02_1k.gltf'), author: 'Poly Haven', url: 'https://polyhaven.com/a/Chandelier_02', size: 512 },
];
for (const p of PROPS) {
  const doc = await io.read(p.src);
  for (const m of doc.getRoot().listMaterials()) {
    const hex = p.recolor?.[m.getName()];
    if (hex) m.setBaseColorFactor([...srgbToLinear(hex), 1]);
  }
  const src = join(tmp, basename(p.file));
  await io.write(src, doc);
  optimize(src, join(MODELS, p.file), ['--texture-compress', 'webp', '--texture-size', String(p.size ?? 1024)]);
  credits.push({ file: p.file, from: p.src.slice(stage.length + 1), author: p.author, license: 'CC0 1.0', url: p.url });
  console.log(`  ${p.file.padEnd(28)} ${kb(join(MODELS, p.file))} KB`);
}

// --- textures -------------------------------------------------------------------------------
const MAPS = [
  { file: 'marble-tiles.webp', src: 'polyhaven-textures/marble_01/marble_01_diff_1k.jpg', size: 1024, author: 'Poly Haven', url: 'https://polyhaven.com/a/marble_01' },
  { file: 'marble-black.webp', src: 'ambientcg/Marble006/Marble006_1K-JPG_Color.jpg', size: 512, author: 'ambientCG', url: 'https://ambientcg.com/view?id=Marble006' },
  { file: 'wood-dark.webp', src: 'polyhaven-textures/dark_wood/dark_wood_diff_1k.jpg', size: 512, author: 'Poly Haven', url: 'https://polyhaven.com/a/dark_wood' },
  { file: 'wood-panel.webp', src: 'polyhaven-textures/dark_paneled_wood/dark_paneled_wood_diff_1k.jpg', size: 1024, author: 'Poly Haven', url: 'https://polyhaven.com/a/dark_paneled_wood' },
  { file: 'velvet.webp', src: 'polyhaven-textures/velour_velvet/velour_velvet_diff_1k.jpg', size: 256, author: 'Poly Haven', url: 'https://polyhaven.com/a/velour_velvet' },
  { file: 'carpet-normal.webp', src: 'ambientcg/Carpet013/Carpet013_1K-JPG_NormalGL.jpg', size: 512, author: 'ambientCG', url: 'https://ambientcg.com/view?id=Carpet013', quality: 90 },
];
for (const t of MAPS) {
  const out = join(TEXTURES, t.file);
  await sharp(join(stage, t.src)).resize(t.size, t.size).webp({ quality: t.quality ?? 80 }).toFile(out);
  credits.push({ file: `../textures/${t.file}`, from: t.src, author: t.author, license: 'CC0 1.0', url: t.url });
  console.log(`  ${t.file.padEnd(28)} ${kb(out)} KB`);
}

writeFileSync(join(MODELS, 'credits.json'), JSON.stringify(credits, null, 1) + '\n');
rmSync(tmp, { recursive: true, force: true });
const total = [...readdirSync(MODELS).map((f) => join(MODELS, f)), ...readdirSync(TEXTURES).map((f) => join(TEXTURES, f))].reduce((s, f) => s + statSync(f).size, 0);
console.log(`world assets: ${credits.length} files, ${Math.round(total / 1024)} KB`);

function srgbToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
}
