import { formatAbsolute, formatDuration, formatRelative, runDuration } from '../lib/time';
import type { IWorkflowGroup, IWorkflowRun } from '../lib/types';
import { isActive } from '../lib/types';
import { StatusIcon } from './status-icon';

function BranchIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M4 3.5 V10 M4 10 a1.5 1.5 0 1 0 0 3 a1.5 1.5 0 1 0 0 -3 M4 2 a1.5 1.5 0 1 0 0 3 a1.5 1.5 0 1 0 0 -3
        M12 2 a1.5 1.5 0 1 0 0 3 a1.5 1.5 0 1 0 0 -3 M12 5 v1.5 a2 2 0 0 1 -2 2 H6.5"
      />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M6 3.5 H3.5 v9 h9 V10 M9.5 3.5 H12.5 V6.5 M12.5 3.5 L7.5 8.5" />
    </svg>
  );
}

export interface IRunLineProps {
  run: IWorkflowRun;
  workflowName: string;
  now: number;
  showRunNumber?: boolean;
}

/**
 * A single line describing one workflow run.
 */
export function RunLine({ run, workflowName, now, showRunNumber = false }: IRunLineProps) {
  const duration = runDuration(run.startedAt, run.updatedAt, isActive(run.state), now);
  return (
    <a
      className={`run run--${run.state}`}
      href={run.htmlUrl}
      target="_blank"
      rel="noreferrer noopener"
      title={`${workflowName} #${run.runNumber} — ${run.event} — ${formatAbsolute(run.createdAt)}`}
    >
      <StatusIcon state={run.state} />
      <span className="run__workflow">
        {workflowName}
        {showRunNumber ? <span className="run__number"> #{run.runNumber}</span> : null}
      </span>
      <span className="run__branch">
        <BranchIcon />
        <span className="run__branch-name">{run.branch}</span>
      </span>
      <span className="run__commit">{run.commitMessage}</span>
      <span className="run__time">{formatRelative(run.createdAt, now)}</span>
      <span className="run__duration">{formatDuration(duration)}</span>
      <span className="run__open"><ExternalIcon /></span>
    </a>
  );
}

export interface IWorkflowLineProps {
  group: IWorkflowGroup;
  now: number;
}

/**
 * The latest run of a single workflow, or a placeholder when it never ran.
 */
export function WorkflowLine({ group, now }: IWorkflowLineProps) {
  const latest = group.runs[0];
  if (latest === undefined) {
    return (
      <div className="run run--empty">
        <StatusIcon state="unknown" />
        <span className="run__workflow">{group.name}</span>
        <span className="run__commit run__commit--muted">No runs yet</span>
      </div>
    );
  }
  return <RunLine run={latest} workflowName={group.name} now={now} />;
}
