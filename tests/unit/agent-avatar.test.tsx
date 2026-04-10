import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentAvatar } from '@/components/agents/AgentAvatar';

describe('AgentAvatar', () => {
  it('renders the first Unicode code point without splitting surrogate pairs', () => {
    render(<AgentAvatar presetId="gradient-sky" label="😀 Smile" />);

    expect(screen.getByText('😀')).toBeInTheDocument();
  });
});
