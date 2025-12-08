const workflowRepo = process.env.GITHUB_WORKFLOW_REPO;
const workflowFile = process.env.GITHUB_WORKFLOW_FILE ?? 'trigger-job.yml';
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

export async function dispatchJobWorkflow(jobId: string): Promise<void> {
  assertWorkflowConfig();

  const endpoint = `https://api.github.com/repos/${workflowRepo}/actions/workflows/${workflowFile}/dispatches`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({
      ref: workflowRef,
      inputs: { jobId },
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Workflow dispatch failed: ${response.status} ${response.statusText} ${payload}`);
  }
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
    return undefined;
  }

  const data = (await response.json()) as {
    workflow_runs?: Array<{ html_url?: string; jobs_url?: string }>;
  };

  const latestRun = data.workflow_runs?.[0];

  if (!latestRun) {
    return {};
  }

  const actionsUrl = latestRun.html_url;
  let jobUrl: string | undefined;

  if (latestRun.jobs_url) {
    try {
      const jobsResponse = await fetch(latestRun.jobs_url, {
        method: 'GET',
        headers: baseHeaders,
      });

      if (jobsResponse.ok) {
        const jobsPayload = (await jobsResponse.json()) as {
          jobs?: Array<{ html_url?: string }>;
        };

        const firstJobHtmlUrl = jobsPayload.jobs?.[0]?.html_url;

        if (firstJobHtmlUrl) {
          jobUrl = firstJobHtmlUrl;
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
