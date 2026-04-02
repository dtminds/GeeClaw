import { useEffect, useMemo, useRef, useState } from 'react';
// import geeclawLogo from '@/assets/logo.svg';
import noiseWatercolorTexture from '@/assets/noise-watercolor.png';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import type { ColorTheme } from '@/theme/color-themes';
import {
  resolveBrandOrbTheme,
  type BrandOrbMode,
  type BrandOrbTheme,
  type BrandOrbThemePreference,
} from './brand-orb-theme';

const VERTEX_SHADER = `#version 300 es
precision highp float;

out vec4 out_position;
out vec2 out_uv;

const vec4 blitFullscreenTrianglePositions[6] = vec4[](
  vec4(-1.0, -1.0, 0.0, 1.0),
  vec4(3.0, -1.0, 0.0, 1.0),
  vec4(-1.0, 3.0, 0.0, 1.0),
  vec4(-1.0, -1.0, 0.0, 1.0),
  vec4(3.0, -1.0, 0.0, 1.0),
  vec4(-1.0, 3.0, 0.0, 1.0)
);

void main() {
  out_position = blitFullscreenTrianglePositions[gl_VertexID];
  out_uv = out_position.xy * 0.5 + 0.5;
  out_uv.y = 1.0 - out_uv.y;
  gl_Position = out_position;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

#define E (2.71828182846)
#define pi (3.14159265358979323844)
#define NUM_OCTAVES (4)

in vec2 out_uv;
out vec4 fragColor;

uniform float u_time;
uniform float u_stateTime;
uniform vec2 u_viewport;

uniform sampler2D uTextureNoise;
uniform vec3 u_bloopColorMain;
uniform vec3 u_bloopColorLow;
uniform vec3 u_bloopColorMid;
uniform vec3 u_bloopColorHigh;

struct ColoredSDF {
  float distance;
  vec4 color;
};

struct SDFArgs {
  vec2 st;
  float duration;
  float time;
};

float scaled(float edge0, float edge1, float x) { return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0); }
float fixedSpring(float t, float d) {
  float s = mix(1.0 - exp(-E * 2.0 * t) * cos((1.0 - d) * 115.0 * t), 1.0, clamp(t, 0.0, 1.0));
  return s * (1.0 - t) + t;
}

vec3 blendLinearBurn_13_5(vec3 base, vec3 blend, float opacity) {
  return (max(base + blend - vec3(1.0), vec3(0.0))) * opacity + base * (1.0 - opacity);
}

vec4 permute(vec4 x) { return mod((x * 34.0 + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec3 fade(vec3 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
float rand(vec2 n) { return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453); }

float noise(vec2 p) {
  vec2 ip = floor(p);
  vec2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  float res = mix(
    mix(rand(ip), rand(ip + vec2(1.0, 0.0)), u.x),
    mix(rand(ip + vec2(0.0, 1.0)), rand(ip + vec2(1.0, 1.0)), u.x),
    u.y
  );
  return res * res;
}

float fbm(vec2 x) {
  float v = 0.0;
  float a = 0.5;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < NUM_OCTAVES; ++i) {
    v += a * noise(x);
    x = rot * x * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

float cnoise(vec3 P) {
  vec3 Pi0 = floor(P); vec3 Pi1 = Pi0 + vec3(1.0);
  Pi0 = mod(Pi0, 289.0); Pi1 = mod(Pi1, 289.0);
  vec3 Pf0 = fract(P); vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = vec4(Pi0.z); vec4 iz1 = vec4(Pi1.z);
  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0); vec4 ixy1 = permute(ixy + iz1);
  vec4 gx0 = ixy0 / 7.0; vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(vec4(0.0), gx0) - 0.5);
  gy0 -= sz0 * (step(vec4(0.0), gy0) - 0.5);
  vec4 gx1 = ixy1 / 7.0; vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(vec4(0.0), gx1) - 0.5);
  gy1 -= sz1 * (step(vec4(0.0), gy1) - 0.5);
  vec3 g000 = vec3(gx0.x, gy0.x, gz0.x); vec3 g100 = vec3(gx0.y, gy0.y, gz0.y);
  vec3 g010 = vec3(gx0.z, gy0.z, gz0.z); vec3 g110 = vec3(gx0.w, gy0.w, gz0.w);
  vec3 g001 = vec3(gx1.x, gy1.x, gz1.x); vec3 g101 = vec3(gx1.y, gy1.y, gz1.y);
  vec3 g011 = vec3(gx1.z, gy1.z, gz1.z); vec3 g111 = vec3(gx1.w, gy1.w, gz1.w);
  vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
  float n000 = dot(g000, Pf0); float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z)); float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z)); float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz)); float n111 = dot(g111, Pf1);
  vec3 fade_xyz = fade(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
  return 2.2 * n_xyz;
}

ColoredSDF getOrb(SDFArgs args) {
  ColoredSDF sdf;
  float entryAnimation = fixedSpring(scaled(0.0, 2.0, args.duration), 0.92);

  float baseRadius = 0.37;
  float entryScale = mix(0.9, 1.0, entryAnimation);
  float radius = baseRadius * entryScale;

  vec2 adjusted_st = args.st;

  float scaleFactor = 1.0 / (2.0 * radius);
  vec2 uv = adjusted_st * scaleFactor + 0.5;
  uv.y = 1.0 - uv.y;

  float noiseScale = 1.25;
  float windSpeed = 0.12;
  float warpPower = 0.35;
  float waterColorNoiseScale = 18.0;
  float waterColorNoiseStrength = 0.02;
  float textureNoiseScale = 1.0;
  float textureNoiseStrength = 0.15;
  float verticalOffset = 0.09;
  float waveSpread = 1.0;
  float layer1Amplitude = 1.5;
  float layer1Frequency = 1.0;
  float layer2Amplitude = 1.4;
  float layer2Frequency = 1.0;
  float layer3Amplitude = 1.3;
  float layer3Frequency = 1.0;
  float fbmStrength = 1.2;
  float fbmPowerDamping = 0.55;
  float overallSoundScale = 1.0;
  float blurRadius = 1.0;
  float timescale = 1.0;

  float time = args.time * timescale * 0.85;
  verticalOffset += 1.0 - waveSpread;

  float noiseX = cnoise(vec3(uv * 1.0 + vec2(0.0, 74.8572), time * 0.3));
  float noiseY = cnoise(vec3(uv * 1.0 + vec2(203.91282, 10.0), time * 0.3));
  uv += vec2(noiseX * 2.0, noiseY) * warpPower;

  float noiseA = cnoise(vec3(uv * waterColorNoiseScale + vec2(344.91282, 0.0), time * 0.3)) +
                 cnoise(vec3(uv * waterColorNoiseScale * 2.2 + vec2(723.937, 0.0), time * 0.4)) * 0.5;
  uv += noiseA * waterColorNoiseStrength;
  uv.y -= verticalOffset;

  vec2 textureUv = uv * textureNoiseScale;
  float textureSampleR0 = texture(uTextureNoise, textureUv).r;
  float textureSampleG0 = texture(uTextureNoise, vec2(textureUv.x, 1.0 - textureUv.y)).g;
  float textureNoiseDisp0 = mix(textureSampleR0 - 0.5, textureSampleG0 - 0.5, (sin(time) + 1.0) * 0.5) * textureNoiseStrength;

  textureUv += vec2(63.861, 368.937);
  float textureSampleR1 = texture(uTextureNoise, textureUv).r;
  float textureSampleG1 = texture(uTextureNoise, vec2(textureUv.x, 1.0 - textureUv.y)).g;
  float textureNoiseDisp1 = mix(textureSampleR1 - 0.5, textureSampleG1 - 0.5, (sin(time) + 1.0) * 0.5) * textureNoiseStrength;

  textureUv += vec2(272.861, 829.937);
  textureUv += vec2(180.302, 819.871);
  float textureSampleR3 = texture(uTextureNoise, textureUv).r;
  float textureSampleG3 = texture(uTextureNoise, vec2(textureUv.x, 1.0 - textureUv.y)).g;
  float textureNoiseDisp3 = mix(textureSampleR3 - 0.5, textureSampleG3 - 0.5, (sin(time) + 1.0) * 0.5) * textureNoiseStrength;
  uv += textureNoiseDisp0;

  vec2 st_fbm = uv * noiseScale;
  vec2 q = vec2(0.0);
  q.x = fbm(st_fbm * 0.5 + windSpeed * time);
  q.y = fbm(st_fbm * 0.5 + windSpeed * time);
  vec2 r = vec2(0.0);
  r.x = fbm(st_fbm + 1.0 * q + vec2(0.3, 9.2) + 0.15 * time);
  r.y = fbm(st_fbm + 1.0 * q + vec2(8.3, 0.8) + 0.126 * time);
  float f = fbm(st_fbm + r - q);
  float fullFbm = (f + 0.6 * f * f + 0.7 * f + 0.5) * 0.5;
  fullFbm = pow(fullFbm, fbmPowerDamping);
  fullFbm *= fbmStrength;

  blurRadius = blurRadius * 1.5;
  overallSoundScale = overallSoundScale;

  vec2 snUv = (uv + vec2((fullFbm - 0.5) * 1.2) + vec2(0.0, 0.025) + textureNoiseDisp0) * vec2(layer1Frequency, 1.0);
  float sn = noise(snUv * 2.0 + vec2(0.0, time * 0.5)) * 2.0 * layer1Amplitude;
  float sn2 = smoothstep(sn - 1.2 * blurRadius, sn + 1.2 * blurRadius, (snUv.y - 0.5 * waveSpread) * 5.0 + 0.5);

  vec2 snUvBis = (uv + vec2((fullFbm - 0.5) * 0.85) + vec2(0.0, 0.025) + textureNoiseDisp1) * vec2(layer2Frequency, 1.0);
  float snBis = noise(snUvBis * 4.0 + vec2(293.0, time * 1.0)) * 2.0 * layer2Amplitude;
  float sn2Bis = smoothstep(snBis - 0.9 * blurRadius, snBis + 0.9 * blurRadius, (snUvBis.y - 0.6 * waveSpread) * 5.0 + 0.5);

  vec2 snUvThird = (uv + vec2((fullFbm - 0.5) * 1.1) + textureNoiseDisp3) * vec2(layer3Frequency, 1.0);
  float snThird = noise(snUvThird * 6.0 + vec2(153.0, time * 1.2)) * 2.0 * layer3Amplitude;
  float sn2Third = smoothstep(snThird - 0.7 * blurRadius, snThird + 0.7 * blurRadius, (snUvThird.y - 0.9 * waveSpread) * 6.0 + 0.5);

  sn2 = pow(sn2, 0.8);
  sn2Bis = pow(sn2Bis, 0.9);

  vec3 sinColor;
  sinColor = blendLinearBurn_13_5(u_bloopColorMain, u_bloopColorLow, 1.0 - sn2);
  sinColor = blendLinearBurn_13_5(sinColor, mix(u_bloopColorMain, u_bloopColorMid, 1.0 - sn2Bis), sn2);
  sinColor = mix(sinColor, mix(u_bloopColorMain, u_bloopColorHigh, 1.0 - sn2Third), sn2 * sn2Bis);

  sdf.color = vec4(sinColor, 1.0);
  sdf.distance = length(adjusted_st) - radius;

  return sdf;
}

void main() {
  vec2 st = out_uv - 0.5;
  st.y *= u_viewport.y / u_viewport.x;

  SDFArgs args;
  args.st = st;
  args.time = u_time;
  args.duration = u_stateTime;

  ColoredSDF res = getOrb(args);

  float clampingTolerance = 0.0075;
  float clampedShape = smoothstep(clampingTolerance, 0.0, res.distance);
  float alpha = res.color.a * clampedShape;

  fragColor = vec4(res.color.rgb * alpha, alpha);
}`;

type ThemeColors = {
  main: [number, number, number];
  low: [number, number, number];
  mid: [number, number, number];
  high: [number, number, number];
};

type ThemeSurfaceStyle = {
  fallbackBase: string;
  fallbackBlob: string;
  fallbackRingShadow: string;
  outerGlow: string;
  innerTint: string;
  innerShadow: string;
  logoShadow: string;
};

const ORB_THEME_COLORS: Record<BrandOrbTheme, Record<BrandOrbMode, ThemeColors>> = {
  orange: {
    light: {
      main: [1.0, 0.95, 0.7],
      low: [0.95, 0.75, 0.4],
      mid: [0.98, 0.7, 0.6],
      high: [1.0, 1.0, 1.0],
    },
    dark: {
      main: [1.0, 0.95, 0.7],
      low: [0.95, 0.75, 0.4],
      mid: [0.98, 0.7, 0.6],
      high: [1.0, 1.0, 1.0],
    },
  },
  blue: {
    light: {
      main: [0.7, 0.85, 1.0],
      low: [0.4, 0.6, 0.9],
      mid: [0.5, 0.7, 1.0],
      high: [0.9, 0.95, 1.0],
    },
    dark: {
      main: [0.7, 0.85, 1.0],
      low: [0.4, 0.6, 0.9],
      mid: [0.5, 0.7, 1.0],
      high: [0.9, 0.95, 1.0],
    },
  },
  purple: {
    light: {
      main: [0.9, 0.75, 1.0],
      low: [0.6, 0.45, 0.9],
      mid: [0.7, 0.55, 1.0],
      high: [0.95, 0.9, 1.0],
    },
    dark: {
      main: [0.9, 0.75, 1.0],
      low: [0.6, 0.45, 0.9],
      mid: [0.7, 0.55, 1.0],
      high: [0.95, 0.9, 1.0],
    },
  },
  green: {
    light: {
      main: [0.75, 1.0, 0.85],
      low: [0.4, 0.8, 0.6],
      mid: [0.5, 0.9, 0.7],
      high: [0.9, 1.0, 0.95],
    },
    dark: {
      main: [0.75, 1.0, 0.85],
      low: [0.4, 0.8, 0.6],
      mid: [0.5, 0.9, 0.7],
      high: [0.9, 1.0, 0.95],
    },
  },
  crimson: {
    light: {
      main: [1.0, 0.75, 0.75],
      low: [0.9, 0.5, 0.5],
      mid: [1.0, 0.6, 0.6],
      high: [1.0, 0.9, 0.9],
    },
    dark: {
      main: [1.0, 0.75, 0.75],
      low: [0.9, 0.5, 0.5],
      mid: [1.0, 0.6, 0.6],
      high: [1.0, 0.9, 0.9],
    },
  },
};

const ORB_THEME_SURFACES: Record<BrandOrbTheme, ThemeSurfaceStyle> = {
  orange: {
    fallbackBase: 'radial-gradient(circle at 30% 26%, rgba(255,243,222,0.62) 0%, rgba(255,219,170,0.24) 15%, rgba(255,255,255,0) 30%), radial-gradient(circle at 50% 56%, rgba(255,182,96,0.96) 0%, rgba(232,110,32,0.92) 44%, rgba(122,42,12,0.98) 100%)',
    fallbackBlob: 'radial-gradient(circle at 36% 30%, rgba(255,242,219,0.78) 0%, rgba(255,213,156,0.18) 15%, rgba(255,179,101,0.34) 31%, rgba(233,110,34,0.86) 60%, rgba(112,36,10,0.96) 100%)',
    fallbackRingShadow: 'inset 0 0 20px rgba(255,219,170,0.12), inset 0 -14px 30px rgba(99,28,8,0.26), 0 0 28px rgba(240,125,42,0.2)',
    outerGlow: 'radial-gradient(circle, rgba(255,153,74,0.34) 0%, rgba(255,153,74,0.12) 50%, rgba(255,153,74,0) 78%)',
    innerTint: 'radial-gradient(circle at 34% 30%, rgba(255,236,208,0.42) 0%, rgba(255,185,109,0.12) 26%, rgba(255,255,255,0) 52%)',
    innerShadow: 'inset 0 -18px 34px rgba(100,29,9,0.26), inset 0 0 0 1px rgba(255,214,165,0.08)',
    logoShadow: 'drop-shadow-[0_18px_28px_rgba(124,42,13,0.24)]',
  },
  blue: {
    fallbackBase: 'radial-gradient(circle at 30% 26%, rgba(226,245,255,0.58) 0%, rgba(165,220,255,0.2) 15%, rgba(255,255,255,0) 30%), radial-gradient(circle at 50% 56%, rgba(101,194,255,0.96) 0%, rgba(38,111,240,0.92) 46%, rgba(10,31,122,0.98) 100%)',
    fallbackBlob: 'radial-gradient(circle at 36% 30%, rgba(232,247,255,0.76) 0%, rgba(186,228,255,0.16) 15%, rgba(96,194,255,0.32) 31%, rgba(31,102,232,0.84) 60%, rgba(8,28,110,0.96) 100%)',
    fallbackRingShadow: 'inset 0 0 20px rgba(179,227,255,0.12), inset 0 -14px 30px rgba(10,28,92,0.26), 0 0 28px rgba(50,127,255,0.2)',
    outerGlow: 'radial-gradient(circle, rgba(86,171,255,0.34) 0%, rgba(86,171,255,0.12) 50%, rgba(86,171,255,0) 78%)',
    innerTint: 'radial-gradient(circle at 34% 30%, rgba(224,243,255,0.42) 0%, rgba(119,198,255,0.12) 26%, rgba(255,255,255,0) 52%)',
    innerShadow: 'inset 0 -18px 34px rgba(11,31,103,0.28), inset 0 0 0 1px rgba(175,223,255,0.08)',
    logoShadow: 'drop-shadow-[0_18px_28px_rgba(13,47,131,0.24)]',
  },
  purple: {
    fallbackBase: 'radial-gradient(circle at 30% 26%, rgba(244,233,255,0.58) 0%, rgba(216,179,255,0.2) 15%, rgba(255,255,255,0) 30%), radial-gradient(circle at 50% 56%, rgba(182,118,255,0.96) 0%, rgba(109,52,224,0.92) 46%, rgba(43,18,104,0.98) 100%)',
    fallbackBlob: 'radial-gradient(circle at 36% 30%, rgba(247,237,255,0.76) 0%, rgba(223,188,255,0.16) 15%, rgba(186,120,255,0.32) 31%, rgba(102,47,214,0.84) 60%, rgba(41,17,98,0.96) 100%)',
    fallbackRingShadow: 'inset 0 0 20px rgba(224,191,255,0.12), inset 0 -14px 30px rgba(45,18,103,0.28), 0 0 28px rgba(143,88,255,0.2)',
    outerGlow: 'radial-gradient(circle, rgba(163,100,255,0.34) 0%, rgba(163,100,255,0.12) 50%, rgba(163,100,255,0) 78%)',
    innerTint: 'radial-gradient(circle at 34% 30%, rgba(245,231,255,0.4) 0%, rgba(192,127,255,0.12) 26%, rgba(255,255,255,0) 52%)',
    innerShadow: 'inset 0 -18px 34px rgba(52,20,111,0.28), inset 0 0 0 1px rgba(220,191,255,0.08)',
    logoShadow: 'drop-shadow-[0_18px_28px_rgba(72,29,146,0.24)]',
  },
  green: {
    fallbackBase: 'radial-gradient(circle at 30% 26%, rgba(229,255,237,0.58) 0%, rgba(162,245,194,0.2) 15%, rgba(255,255,255,0) 30%), radial-gradient(circle at 50% 56%, rgba(107,239,148,0.96) 0%, rgba(26,156,86,0.92) 46%, rgba(6,83,43,0.98) 100%)',
    fallbackBlob: 'radial-gradient(circle at 36% 30%, rgba(236,255,242,0.76) 0%, rgba(180,245,205,0.16) 15%, rgba(102,233,150,0.3) 31%, rgba(22,147,78,0.84) 60%, rgba(5,76,39,0.96) 100%)',
    fallbackRingShadow: 'inset 0 0 20px rgba(183,247,210,0.12), inset 0 -14px 30px rgba(7,77,40,0.28), 0 0 28px rgba(39,184,101,0.2)',
    outerGlow: 'radial-gradient(circle, rgba(70,201,117,0.34) 0%, rgba(70,201,117,0.12) 50%, rgba(70,201,117,0) 78%)',
    innerTint: 'radial-gradient(circle at 34% 30%, rgba(235,255,240,0.4) 0%, rgba(118,238,164,0.12) 26%, rgba(255,255,255,0) 52%)',
    innerShadow: 'inset 0 -18px 34px rgba(7,76,39,0.28), inset 0 0 0 1px rgba(182,246,206,0.08)',
    logoShadow: 'drop-shadow-[0_18px_28px_rgba(8,89,46,0.22)]',
  },
  crimson: {
    fallbackBase: 'radial-gradient(circle at 30% 26%, rgba(255,232,232,0.58) 0%, rgba(255,180,180,0.2) 15%, rgba(255,255,255,0) 30%), radial-gradient(circle at 50% 56%, rgba(255,109,109,0.96) 0%, rgba(212,40,56,0.92) 46%, rgba(105,5,24,0.98) 100%)',
    fallbackBlob: 'radial-gradient(circle at 36% 30%, rgba(255,238,238,0.76) 0%, rgba(255,196,196,0.16) 15%, rgba(255,132,132,0.32) 31%, rgba(205,34,50,0.84) 60%, rgba(95,4,22,0.96) 100%)',
    fallbackRingShadow: 'inset 0 0 20px rgba(255,201,201,0.12), inset 0 -14px 30px rgba(90,5,22,0.28), 0 0 28px rgba(227,60,76,0.2)',
    outerGlow: 'radial-gradient(circle, rgba(239,74,93,0.34) 0%, rgba(239,74,93,0.12) 50%, rgba(239,74,93,0) 78%)',
    innerTint: 'radial-gradient(circle at 34% 30%, rgba(255,235,235,0.4) 0%, rgba(255,139,139,0.12) 26%, rgba(255,255,255,0) 52%)',
    innerShadow: 'inset 0 -18px 34px rgba(97,4,23,0.3), inset 0 0 0 1px rgba(255,201,201,0.08)',
    logoShadow: 'drop-shadow-[0_18px_28px_rgba(118,10,31,0.24)]',
  },
};

function getSystemMode(): BrandOrbMode {
  if (typeof window === 'undefined') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Failed to create WebGL shader');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader) || 'Unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(error);
  }

  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();

  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error('Failed to create WebGL program');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program) || 'Unknown program link error';
    gl.deleteProgram(program);
    throw new Error(error);
  }

  return program;
}

type NoiseTextureLoad = {
  texture: WebGLTexture;
  ready: Promise<void>;
  cancel: () => void;
};

function loadNoiseTexture(gl: WebGL2RenderingContext): NoiseTextureLoad {
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error('Failed to create noise texture');
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([128, 128, 255, 255]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  let canceled = false;
  const image = new Image();
  const ready = new Promise<void>((resolve, reject) => {
    image.onload = () => {
      if (canceled) {
        return;
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      resolve();
    };
    image.onerror = () => {
      if (canceled) {
        return;
      }
      reject(new Error('Failed to load noise texture'));
    };
  });
  image.src = noiseWatercolorTexture;

  return {
    texture,
    ready,
    cancel: () => {
      canceled = true;
      image.onload = null;
      image.onerror = null;
      image.src = '';
    },
  };
}

export function BrandOrbLogo({
  // alt,
  size = 160,
  orbTheme = 'auto',
  className,
  // logoClassName,
}: {
  // alt: string;
  size?: number;
  orbTheme?: BrandOrbThemePreference;
  className?: string;
  // logoClassName?: string;
}) {
  const appTheme = useSettingsStore((state) => state.theme);
  const colorTheme = useSettingsStore((state) => state.colorTheme);
  const [systemMode, setSystemMode] = useState<BrandOrbMode>(getSystemMode);
  const [webglStatus, setWebglStatus] = useState<'checking' | 'supported' | 'unsupported'>('checking');
  const [isVisualReady, setIsVisualReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const textureRef = useRef<WebGLTexture | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (event?: MediaQueryListEvent) => {
      const prefersDark = event ? event.matches : mediaQuery.matches;
      setSystemMode(prefersDark ? 'dark' : 'light');
    };

    update();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener('change', update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  const mode = appTheme === 'system' ? systemMode : appTheme;
  const resolvedTheme = resolveBrandOrbTheme({
    orbTheme,
    colorTheme: colorTheme as ColorTheme,
    mode,
  });
  const themeColors = useMemo(() => ORB_THEME_COLORS[resolvedTheme][mode], [mode, resolvedTheme]);
  const surfaceStyle = useMemo(() => ORB_THEME_SURFACES[resolvedTheme], [resolvedTheme]);
  const showFallback = webglStatus === 'unsupported';
  const showCanvas = webglStatus === 'supported' && isVisualReady;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true });

    if (!gl) {
      setWebglStatus('unsupported');
      return undefined;
    }

    setWebglStatus('supported');
    setIsVisualReady(false);

    let didCancel = false;
    const program = createProgram(gl);
    const vao = gl.createVertexArray();
    const noiseTexture = loadNoiseTexture(gl);
    textureRef.current = noiseTexture.texture;
    const textureLocation = gl.getUniformLocation(program, 'uTextureNoise');
    const mainColorLocation = gl.getUniformLocation(program, 'u_bloopColorMain');
    const lowColorLocation = gl.getUniformLocation(program, 'u_bloopColorLow');
    const midColorLocation = gl.getUniformLocation(program, 'u_bloopColorMid');
    const highColorLocation = gl.getUniformLocation(program, 'u_bloopColorHigh');
    const timeLocation = gl.getUniformLocation(program, 'u_time');
    const stateTimeLocation = gl.getUniformLocation(program, 'u_stateTime');
    const viewportLocation = gl.getUniformLocation(program, 'u_viewport');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const start = performance.now();
    let elapsedTime = 0;
    let previousFrameTime = performance.now();
    let visualReadyTime: number | null = null;

    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    noiseTexture.ready
      .then(() => {
        if (didCancel) {
          return;
        }
        visualReadyTime = performance.now();
        setIsVisualReady(true);
      })
      .catch(() => {
        if (didCancel) {
          return;
        }
        visualReadyTime = performance.now();
        setIsVisualReady(true);
      });

    const renderFrame = (now: number) => {
      if (didCancel) {
        return;
      }

      const deltaSeconds = Math.min((now - previousFrameTime) / 1000, 0.1);
      previousFrameTime = now;
      elapsedTime += deltaSeconds * 0.95;

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (!visualReadyTime) {
        frameRef.current = window.requestAnimationFrame(renderFrame);
        return;
      }

      const stateTime = Math.max(0, (now - Math.max(start, visualReadyTime)) / 1000);
      gl.uniform1f(timeLocation, elapsedTime);
      gl.uniform1f(stateTimeLocation, stateTime);
      gl.uniform2f(viewportLocation, canvas.width, canvas.height);
      if (textureRef.current) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textureRef.current);
        gl.uniform1i(textureLocation, 0);
      }
      gl.uniform3fv(mainColorLocation, themeColors.main);
      gl.uniform3fv(lowColorLocation, themeColors.low);
      gl.uniform3fv(midColorLocation, themeColors.mid);
      gl.uniform3fv(highColorLocation, themeColors.high);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      frameRef.current = window.requestAnimationFrame(renderFrame);
    };

    frameRef.current = window.requestAnimationFrame(renderFrame);

    return () => {
      didCancel = true;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      noiseTexture.cancel();
      if (textureRef.current) {
        gl.deleteTexture(textureRef.current);
        textureRef.current = null;
      }
      if (vao) {
        gl.deleteVertexArray(vao);
      }
      gl.deleteProgram(program);
    };
  }, [size, themeColors]);

  return (
    <div
      data-testid="brand-orb-logo"
      data-orb-theme={resolvedTheme}
      className={cn('relative isolate inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <div
        data-testid={showFallback ? 'brand-orb-fallback' : undefined}
        aria-hidden="true"
        className={cn(
          'absolute inset-0 rounded-full',
          'transition-opacity duration-300',
          showFallback ? 'opacity-100' : 'opacity-0',
        )}
        style={{ background: surfaceStyle.fallbackBase }}
      />
      <div
        aria-hidden="true"
        className={cn(
          'brand-orb-fallback-blob pointer-events-none absolute inset-[8%] rounded-full blur-xl transition-opacity duration-300',
          showFallback ? 'opacity-100' : 'opacity-0',
        )}
        style={{ background: surfaceStyle.fallbackBlob }}
      />
      <div
        aria-hidden="true"
        className={cn(
          'brand-orb-fallback-ring pointer-events-none absolute inset-[3%] rounded-full border transition-opacity duration-300',
          showFallback ? 'opacity-100' : 'opacity-0',
          'border-white/10',
        )}
        style={{ boxShadow: surfaceStyle.fallbackRingShadow }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-[-10%] rounded-full blur-2xl"
        style={{ background: surfaceStyle.outerGlow }}
      />
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={cn(
          'absolute inset-0 h-full w-full rounded-full transition-opacity duration-300',
          showCanvas ? 'opacity-100' : 'opacity-0',
        )}
      />
      {/* <img
        src={geeclawLogo}
        alt={alt}
        className={cn('relative z-10 h-[62%] w-[62%]', surfaceStyle.logoShadow, logoClassName)}
      /> */}
    </div>
  );
}
