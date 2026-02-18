const workflowRepo = process.env.GITHUB_WORKFLOW_REPO;
const workflowFile = process.env.GITHUB_WORKFLOW_FILE ?? 'trigger-job.yml';
const hitWorkflowFile = process.env.GITHUB_HIT_WORKFLOW_FILE ?? 'hit-scheduler.yml';
const workflowOwner = workflowRepo?.split('/')?.[0];
const workflowRepoName = workflowRepo?.split('/')?.[1];
const workflowRef = process.env.GITHUB_WORKFLOW_REF ?? 'main';
const workflowToken = process.env.GITHUB_WORKFLOW_TOKEN;

function assertWorkflowConfig() {
  if (!workflowRepo) {
    throw new Error('Missing GITHUB_WORKFLOW_REPO environment variable.');
  }

  if (!workflowToken) {
    throw new Error('Missing GITHUB_WORKFLOW_TOKEN environment variable.');
  }
}

const baseHeaders = {
  Authorization: `Bearer ${workflowToken}`,
  'Content-Type': 'application/json',
  'User-Agent': 'gym-reserver-api',
  Accept: 'application/vnd.github+json',
};

async function dispatchWorkflow(workflowFileName: string, inputs?: Record<string, string>): Promise<void> {
  assertWorkflowConfig();

  const endpoint = `https://api.github.com/repos/${workflowRepo}/actions/workflows/${workflowFileName}/dispatches`;
  const payload: { ref: string; inputs?: Record<string, string> } = {
    ref: workflowRef,
  };

  if (inputs && Object.keys(inputs).length > 0) {
    payload.inputs = inputs;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Workflow dispatch failed: ${response.status} ${response.statusText} ${bodyText}`);
  }
}

export async function dispatchJobWorkflow(jobId: string, label?: string): Promise<void> {
  await dispatchWorkflow(workflowFile, {
    jobId,
    title: `via API ${label ?? '-'}`,
  });
}

export async function dispatchHitWorkflow(groupId?: string): Promise<void> {
  const normalizedGroupId = typeof groupId === 'string' ? groupId.trim() : '';
  if (normalizedGroupId) {
    await dispatchWorkflow(hitWorkflowFile, { group_id: normalizedGroupId });
    return;
  }

  await dispatchWorkflow(hitWorkflowFile);
}

export async function getLatestWorkflowInfo(): Promise<{ actionsUrl?: string; jobUrl?: string }> {
  assertWorkflowConfig();

  const runsEndpoint = `https://api.github.com/repos/${workflowRepo}/actions/workflows/${workflowFile}/runs?per_page=1`;
  const response = await fetch(runsEndpoint, {
    method: 'GET',
    headers: baseHeaders,
  });

  if (!response.ok) {
    const payload = await response.text();
    console.error('Failed to fetch workflow runs', response.status, payload);
    return {};
  }

  const data = (await response.json()) as {
    workflow_runs?: Array<{ id?: number; html_url?: string; jobs_url?: string }>;
  };

  const latestRun = data.workflow_runs?.[0];

  if (!latestRun) {
    return {};
  }

  const actionsUrl = latestRun.html_url;
  let jobUrl: string | undefined;

  if (latestRun?.jobs_url) {
    try {
      const jobsResponse = await fetch(latestRun.jobs_url, {
        method: 'GET',
        headers: baseHeaders,
      });

      if (jobsResponse.ok) {
        const jobsPayload = (await jobsResponse.json()) as {
          jobs?: Array<{ id?: number; html_url?: string }>;
        };

        const firstJob = jobsPayload.jobs?.[0];

        if (firstJob?.id && workflowOwner && workflowRepoName && latestRun.id) {
          jobUrl = `https://github.com/${workflowOwner}/${workflowRepoName}/actions/runs/${latestRun.id}/job/${firstJob.id}`;
        } else if (firstJob?.html_url) {
          jobUrl = firstJob.html_url;
        }
      } else {
        console.warn('Failed to fetch jobs list for run');
      }
    } catch (error) {
      console.error('Failed to fetch job html_url for run', error);
    }
  }

  return { actionsUrl, jobUrl };
}
