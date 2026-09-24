import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { holdContrast, PAPER_PEAK } from '../src/table/cards.ts';

// Card faces hold their paper's brightness under the tone mapping's shoulder (a spotlit table on
// High washed the ink out to grey). The hold is a patch on three's own standard shader, so these
// check it against the shader three really ships: if a three upgrade renames the lines it hooks,
// the patch would silently do nothing and the cards would fade again.

function compiled(): string {
  const m = new THREE.MeshStandardMaterial();
  holdContrast(m);
  const shader = { fragmentShader: THREE.ShaderLib.standard.fragmentShader, vertexShader: '', uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader.fragmentShader;
}

describe('card faces keep their contrast', () => {
  it("patches three's standard shader where the lighting is worked out", () => {
    const src = compiled();
    // the lighting runs on white paper, then the card's own colours are laid on
    expect(src).toContain('vec3 cardInk = material.diffuseContribution;');
    expect(src).toContain('material.diffuseContribution = vec3( 1.0 );');
    expect(src.indexOf('material.diffuseContribution = vec3( 1.0 );')).toBeGreaterThan(src.indexOf('#include <lights_physical_fragment>'));
    expect(src.indexOf('material.diffuseContribution = vec3( 1.0 );')).toBeLessThan(src.indexOf('#include <lights_fragment_begin>'));
    // the paper held at PAPER_PEAK, the ink scaled with it, before the light goes out
    expect(src).toContain(`${PAPER_PEAK.toFixed(3)} / max(`);
    expect(src).toContain('totalDiffuse *= cardInk * cardHold;');
    expect(src).toContain('totalSpecular *= cardHold;');
    expect(src.indexOf('totalSpecular *= cardHold;')).toBeLessThan(src.indexOf('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;'));
  });

  it('holds the paper under the point where the tone mapping starts to squeeze', () => {
    // NeutralToneMapping passes a colour through unchanged while its brightest channel, less the
    // 0.04 toe, stays under 0.76
    expect(PAPER_PEAK - 0.04).toBeLessThanOrEqual(0.76);
    expect(PAPER_PEAK).toBeGreaterThan(0.6);
  });

  it('shares one program between every face', () => {
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial({ color: '#808080' });
    holdContrast(a);
    holdContrast(b);
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    expect(a.customProgramCacheKey()).not.toBe(new THREE.MeshStandardMaterial().customProgramCacheKey());
  });
});
