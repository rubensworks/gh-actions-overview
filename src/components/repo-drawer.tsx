import { useEffect } from 'react';
import type { IRepoState } from '../lib/types';
import { RunLine } from './workflow-line';

export interface IRepoDrawerProps {
  repo: IRepoState;
  now: number;
  onClose: () => void;
}

/**
 * A side panel with the last runs of every workflow of a single repository.
 */
export function RepoDrawer({ repo, now, onClose }: IRepoDrawerProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [ onClose ]);

  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-label={`Workflow runs of ${repo.repo.fullName}`}
        onClick={event => event.stopPropagation()}
      >
        <header className="drawer__header">
          <div>
            <h2 className="drawer__title">{repo.repo.fullName}</h2>
            <a
              className="link drawer__subtitle"
              href={`${repo.repo.htmlUrl}/actions`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open Actions on github.com
            </a>
          </div>
          <button className="button button--ghost" type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="drawer__body">
          {repo.workflows.length === 0 ?
            <p className="drawer__empty">No workflows found for this repository.</p> :
            null}
          {repo.workflows.map(group => (
            <section className="drawer__workflow" key={group.workflowId}>
              <h3 className="drawer__workflow-title">{group.name}</h3>
              {group.runs.length === 0 ?
                <p className="drawer__empty">No runs yet.</p> :
                  (
                    <div className="drawer__runs">
                      {group.runs.map(run => (
                        <RunLine key={run.id} run={run} workflowName={group.name} now={now} showRunNumber />
                      ))}
                    </div>
                  )}
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}
