import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('BrandOrbLogo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the GeeClaw logo with a themed orb wrapper', async () => {
    const { BrandOrbLogo } = await import('@/components/branding/BrandOrbLogo');
    render(<BrandOrbLogo alt="GeeClaw" orbTheme="crimson" size={160} />);

    // expect(screen.getByAltText('GeeClaw')).toBeInTheDocument();
    expect(screen.getByTestId('brand-orb-logo')).toHaveAttribute('data-orb-theme', 'crimson');
  });

  it('supports demo-style explicit orb themes', async () => {
    const { BrandOrbLogo } = await import('@/components/branding/BrandOrbLogo');
    const { rerender } = render(<BrandOrbLogo alt="GeeClaw" orbTheme="blue" size={160} />);

    expect(screen.getByTestId('brand-orb-logo')).toHaveAttribute('data-orb-theme', 'blue');

    rerender(<BrandOrbLogo alt="GeeClaw" orbTheme="purple" size={160} />);
    expect(screen.getByTestId('brand-orb-logo')).toHaveAttribute('data-orb-theme', 'purple');
  });

  it('keeps themed surface styling instead of a generic white inner wash', async () => {
    const { BrandOrbLogo } = await import('@/components/branding/BrandOrbLogo');
    const { container } = render(<BrandOrbLogo alt="GeeClaw" orbTheme="green" size={160} />);

    expect(container.querySelector('.bg-white\\/18')).not.toBeInTheDocument();
  });

  it('shows the static fallback when WebGL2 is unavailable', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId: string) => {
      if (contextId === 'webgl2') {
        return null;
      }
      return null;
    });

    const { BrandOrbLogo } = await import('@/components/branding/BrandOrbLogo');
    render(<BrandOrbLogo alt="GeeClaw" orbTheme="orange" />);

    expect(screen.getByTestId('brand-orb-fallback')).toBeInTheDocument();
    expect(document.querySelector('.brand-orb-fallback-blob')).toBeInTheDocument();
  });

  it('hides the static fallback when WebGL2 is available', async () => {
    const fakeGl = {
      VERTEX_SHADER: 1,
      FRAGMENT_SHADER: 2,
      COMPILE_STATUS: 3,
      LINK_STATUS: 4,
      COLOR_BUFFER_BIT: 5,
      BLEND: 6,
      SRC_ALPHA: 7,
      ONE_MINUS_SRC_ALPHA: 8,
      TRIANGLES: 9,
      TEXTURE0: 10,
      TEXTURE_2D: 11,
      RGBA: 12,
      UNSIGNED_BYTE: 13,
      CLAMP_TO_EDGE: 14,
      LINEAR: 15,
      TEXTURE_WRAP_S: 16,
      TEXTURE_WRAP_T: 17,
      TEXTURE_MIN_FILTER: 18,
      TEXTURE_MAG_FILTER: 19,
      createShader: vi.fn(() => ({})),
      shaderSource: vi.fn(),
      compileShader: vi.fn(),
      getShaderParameter: vi.fn(() => true),
      getShaderInfoLog: vi.fn(() => ''),
      deleteShader: vi.fn(),
      createProgram: vi.fn(() => ({})),
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getProgramParameter: vi.fn(() => true),
      getProgramInfoLog: vi.fn(() => ''),
      deleteProgram: vi.fn(),
      createVertexArray: vi.fn(() => ({})),
      deleteVertexArray: vi.fn(),
      createTexture: vi.fn(() => ({})),
      deleteTexture: vi.fn(),
      getUniformLocation: vi.fn(() => ({})),
      bindTexture: vi.fn(),
      texImage2D: vi.fn(),
      texParameteri: vi.fn(),
      activeTexture: vi.fn(),
      viewport: vi.fn(),
      clearColor: vi.fn(),
      useProgram: vi.fn(),
      bindVertexArray: vi.fn(),
      enable: vi.fn(),
      blendFunc: vi.fn(),
      clear: vi.fn(),
      uniform1f: vi.fn(),
      uniform2f: vi.fn(),
      uniform3fv: vi.fn(),
      drawArrays: vi.fn(),
    };

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId: string) => {
      if (contextId === 'webgl2') {
        return fakeGl as unknown as WebGL2RenderingContext;
      }
      return null;
    });

    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    const caf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const { BrandOrbLogo } = await import('@/components/branding/BrandOrbLogo');
    render(<BrandOrbLogo alt="GeeClaw" orbTheme="orange" size={160} />);

    expect(screen.queryByTestId('brand-orb-fallback')).not.toBeInTheDocument();

    raf.mockRestore();
    caf.mockRestore();
  });
});
