import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Select } from '@/components/ui/select';

describe('Select', () => {
  it('renders a positioned dropdown indicator instead of relying on background images', () => {
    const { container } = render(
      <Select aria-label="Search mode" defaultValue="web">
        <option value="web">web</option>
        <option value="llm-context">llm-context</option>
      </Select>,
    );

    const wrapper = container.firstElementChild;
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveClass('relative');

    const select = screen.getByRole('combobox', { name: 'Search mode' });
    expect(select).toHaveClass('pr-10');

    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveClass('pointer-events-none');
    expect(icon).toHaveClass('absolute');
    expect(icon).toHaveClass('right-3');
    expect(icon).toHaveClass('top-1/2');
  });
});
