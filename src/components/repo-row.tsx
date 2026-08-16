import type { OverallStatus } from '../lib/favicon';
import { repoStatus } from '../lib/selectors';
import { formatRelative } from '../lib/time';
import type { IRepoState, RunState } from '../lib/types';
import { StatusIcon } from './status-icon';
import { WorkflowLine } from './workflow-line';

// The badge in front of the name: a tick, a cross, a spinner, or a question mark for a default
// branch that has never run.
const STATUS_GLYPH: Record<OverallStatus, RunState> = {
  success: 'success',
  failure: 'failure',
  running: 'running',
  idle: 'unknown',
};

const STATUS_TITLE: Record<OverallStatus, string> = {
  success: 'The default branch is green',
  failure: 'The default branch is failing',
  running: 'The default branch is building',
  idle: 'The default branch has not run',
};

export interface IRepoRowProps {
  repo: IRepoState;
  now: number;
  onOpen: (key: string) => void;
}

/**
 * One dashboard row: a repository plus the latest run of each of its workflows.
 *
 * The row carries its own verdict three times over — as a coloured rule down its left edge, as the
 * colour of the repository name, and as an icon in front of it — so the state of a long list can be
 * read down the margin without reading a word of it.
 */
export function RepoRow({ repo, now, onOpen }: IRepoRowProps) {
  const status = repoStatus(repo);
  return (
    <div className={`repo-row repo-row--${status}`}>
      <div className="repo-row__meta">
        <button
          className="repo-row__name"
          type="button"
          onClick={() => onOpen(repo.repo.key)}
          title={`${STATUS_TITLE[status]} — show the last runs of every workflow`}
        >
          <StatusIcon state={STATUS_GLYPH[status]} size={13} />
          <span className="repo-row__label">
            <span className="repo-row__owner">{repo.repo.owner}/</span>
            <span className="repo-row__repo">{repo.repo.name}</span>
          </span>
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
          <div className="run run--loading"><span className="skeleton" /></div> :
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
