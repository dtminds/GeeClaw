import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuickActionWindow } from '@/components/quick-actions/QuickActionWindow';

describe('QuickActionWindow', () => {
  it('defaults to the invoked mode and allows switching tabs', () => {
    const onRun = vi.fn();

    render(
      <QuickActionWindow
        initialActionId="translate"
        input={{ text: 'hello', source: 'clipboard', obtainedAt: 1 }}
        actions={[
          {
            id: 'translate',
            title: 'Translate',
            kind: 'translate',
            shortcut: 'CommandOrControl+Shift+1',
            enabled: true,
            outputMode: 'copy',
          },
          {
            id: 'reply',
            title: 'Reply',
            kind: 'reply',
            shortcut: 'CommandOrControl+Shift+2',
            enabled: true,
            outputMode: 'copy',
          },
        ]}
        onRun={onRun}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Translate' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'Reply' }));

    expect(screen.getByRole('tab', { name: 'Reply' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Run Reply' }));
    expect(onRun).toHaveBeenCalledWith('reply');
  });
});
