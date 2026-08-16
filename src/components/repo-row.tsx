import { formatRelative } from '../lib/time';
import type { IRepoState } from '../lib/types';
import { WorkflowLine } from './workflow-line';

export interface IRepoRowProps {
  repo: IRepoState;
  now: number;
  onOpen: (key: string) => void;
}

/**
 * One dashboard row: a repository plus the latest run of each of its workflows.
 */
export function RepoRow({ repo, now, onOpen }: IRepoRowProps) {
  return (
    <div className="repo-row">
      <div className="repo-row__meta">
        <button
          className="repo-row__name"
          type="button"
          onClick={() => onOpen(repo.repo.key)}
          title="Show the last runs of every workflow"
        >
          <span className="repo-row__owner">{repo.repo.owner}/</span>
          <span className="repo-row__repo">{repo.repo.name}</span>
        </button>
        <div className="repo-row__badges">
          {repo.repo.isPrivate ? <span className="badge">private</span> : null}
          {repo.repo.archived ? <span className="badge">archived</span> : null}
          {repo.repo.source === 'manual' ? <span className="badge">pinned</span> : null}
          <span className="repo-row__pushed">pushed {formatRelative(repo.repo.pushedAt, now)}</span>
        </div>
      </div>

      <div className="repo-row__workflows">
        {repo.load === 'pending' || (repo.load === 'loading' && repo.workflows.length === 0) ?
          <div className="run run--empty"><span className="skeleton" /></div> :
          null}

        {repo.load === 'error' ?
            (
              <div className="run run--error">
                <span className="run__commit">{repo.error ?? 'Could not load workflow runs'}</span>
              </div>
            ) :
          null}

        {repo.workflows.map(group => (
          <WorkflowLine key={group.workflowId} group={group} now={now} />
        ))}
      </div>
    </div>
  );
}
