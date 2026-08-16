import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetupScreen } from '../../src/components/setup-screen';
import { SOURCE_URL } from '../../src/lib/links';

afterEach(cleanup);

function noConnect(): Promise<void> {
  return Promise.resolve();
}

let browsed: string[] = [];

function renderSetup(
  onConnect: (token: string, remember: boolean) => Promise<void> = noConnect,
  initialError?: string,
): HTMLInputElement {
  browsed = [];
  render(
    <SetupScreen
      onConnect={onConnect}
      onBrowse={owner => browsed.push(owner)}
      initialError={initialError}
    />,
  );
  return screen.getByPlaceholderText('github_pat_...');
}

describe('SetupScreen', () => {
  it('links to the fine-grained token page', () => {
    renderSetup();
    expect(screen.getByText('Create a fine-grained token').getAttribute('href'))
      .toBe('https://github.com/settings/personal-access-tokens/new');
  });

  it('spells out the two permissions the token needs', () => {
    renderSetup();
    expect(screen.getByText(/Metadata: read-only/u)).toBeDefined();
    expect(screen.getByText(/Actions: read-only/u)).toBeDefined();
  });

  describe('source link', () => {
    it('invites the reader to check the source from the lead paragraph', () => {
      renderSetup();
      const link = screen.getByText('read the source');
      expect(link.getAttribute('href')).toBe(SOURCE_URL);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noreferrer noopener');
    });

    it('names the repository in the page footer', () => {
      renderSetup();
      const link = screen.getByText('rubensworks/gh-actions-overview');
      expect(link.getAttribute('href')).toBe(SOURCE_URL);
      expect(link.closest('.setup__footer')).not.toBeNull();
    });
  });

  it('keeps the token field masked', () => {
    expect(renderSetup().type).toBe('password');
  });

  it('shows an error carried over from a previous attempt', () => {
    renderSetup(noConnect, 'Stored token could not be used');
    expect(screen.getByRole('alert').textContent).toBe('Stored token could not be used');
  });

  it('refuses an empty token without calling out', () => {
    const onConnect = vi.fn(noConnect);
    renderSetup(onConnect);
    fireEvent.click(screen.getByText('Connect'));
    expect(screen.getByRole('alert').textContent).toBe('Paste a token first.');
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('refuses a token of only whitespace', () => {
    const onConnect = vi.fn(noConnect);
    const input = renderSetup(onConnect);
    fireEvent.change(input, { target: { value: '   ' }});
    fireEvent.click(screen.getByText('Connect'));
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('trims the token and remembers it by default', async() => {
    const onConnect = vi.fn(noConnect);
    const input = renderSetup(onConnect);
    fireEvent.change(input, { target: { value: '  github_pat_1  ' }});
    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith('github_pat_1', true));
  });

  it('honours "don\'t remember me"', async() => {
    const onConnect = vi.fn(noConnect);
    const input = renderSetup(onConnect);
    fireEvent.change(input, { target: { value: 'github_pat_1' }});
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith('github_pat_1', false));
  });

  it('shows a busy state while the token is checked', async() => {
    let release = (): void => undefined;
    const onConnect = vi.fn(async() => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const input = renderSetup(onConnect);
    fireEvent.change(input, { target: { value: 'github_pat_1' }});
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(screen.getByText('Checking token…')).toBeDefined());
    release();
    await waitFor(() => expect(screen.getByText('Connect')).toBeDefined());
  });

  it('reports a rejected token', async() => {
    const onConnect = vi.fn(async() => {
      throw new Error('Token is invalid or expired');
    });
    const input = renderSetup(onConnect);
    fireEvent.change(input, { target: { value: 'github_pat_1' }});
    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Token is invalid or expired'));
  });

  describe('browsing without a token', () => {
    it('reports the owner that was entered', () => {
      renderSetup();
      fireEvent.change(screen.getByPlaceholderText('comunica'), { target: { value: 'comunica' }});
      fireEvent.click(screen.getByText('Browse'));
      expect(browsed).toEqual([ 'comunica' ]);
    });

    it('trims whitespace and a leading at-sign', () => {
      renderSetup();
      fireEvent.change(screen.getByPlaceholderText('comunica'), { target: { value: '  @rubensworks ' }});
      fireEvent.click(screen.getByText('Browse'));
      expect(browsed).toEqual([ 'rubensworks' ]);
    });

    it('refuses an empty owner', () => {
      renderSetup();
      fireEvent.click(screen.getByText('Browse'));
      expect(browsed).toEqual([]);
      expect(screen.getByRole('alert').textContent).toBe('Enter a user or organisation first.');
    });

    it('explains the anonymous rate limit', () => {
      renderSetup();
      expect(screen.getByText(/60 anonymous requests an hour/u)).toBeDefined();
    });
  });

  it('reports a non-Error rejection', async() => {
    const onConnect = vi.fn(async() => {
      // eslint-disable-next-line no-throw-literal
      throw 'exploded';
    });
    const input = renderSetup(onConnect);
    fireEvent.change(input, { target: { value: 'github_pat_1' }});
    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('exploded'));
  });
});
