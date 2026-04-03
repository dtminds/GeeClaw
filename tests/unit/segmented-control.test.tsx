import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SegmentedControl } from '@/components/ui/segmented-control';

describe('SegmentedControl', () => {
  it('renders skills-style segment chrome and highlights the active option', () => {
    const onValueChange = vi.fn();

    render(
      <SegmentedControl
        ariaLabel="Subscription mode"
        value="standard"
        onValueChange={onValueChange}
        options={[
          { value: 'standard', label: 'Standard' },
          { value: 'codeplan', label: 'Code Plan' },
        ]}
        fullWidth
      />,
    );

    const group = screen.getByRole('group', { name: 'Subscription mode' });
    const active = screen.getByRole('button', { name: 'Standard' });
    const inactive = screen.getByRole('button', { name: 'Code Plan' });

    expect(group.className).toContain('rounded-full');
    expect(group.className).toContain('border-border/60');
    expect(group.className).toContain('bg-muted/40');
    expect(active.className).toContain('bg-foreground');
    expect(active.className).toContain('text-background');
    expect(active.className).toContain('shadow-sm');
    expect(inactive.className).toContain('text-muted-foreground');
    expect(inactive.className).not.toContain('bg-foreground');

    fireEvent.click(inactive);

    expect(onValueChange).toHaveBeenCalledWith('codeplan');
  });

  it('supports wider multi-option protocol segments', () => {
    const onValueChange = vi.fn();

    render(
      <SegmentedControl
        ariaLabel="Protocol"
        value="openai-completions"
        onValueChange={onValueChange}
        options={[
          { value: 'openai-completions', label: 'OpenAI Completions' },
          { value: 'openai-responses', label: 'OpenAI Responses' },
          { value: 'anthropic-messages', label: 'Anthropic' },
        ]}
        fullWidth
      />,
    );

    const options = screen.getAllByRole('button');

    expect(options).toHaveLength(3);
    expect(options[0]?.className).toContain('flex-1');
    expect(options[1]?.className).toContain('text-muted-foreground');

    fireEvent.click(screen.getByRole('button', { name: 'Anthropic' }));

    expect(onValueChange).toHaveBeenCalledWith('anthropic-messages');
  });
});
