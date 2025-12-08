const workflowRepo = process.env.GITHUB_WORKFLOW_REPO;
const workflowFile = process.env.GITHUB_WORKFLOW_FILE;
const workflowRef = process.env.GITHUB_WORKFLOW_REF;
const workflowToken = process.env.GITHUB_WORKFLOW_TOKEN;

function assertWorkflowConfig() {
  if (!workflowRepo) {
    throw new Error('Missing GITHUB_WORKFLOW_REPO environment variable.');
  }

  if (!workflowToken) {
    throw new Error('Missing GITHUB_WORKFLOW_TOKEN environment variable.');
  }
}

export async function dispatchJobWorkflow(jobId: string) {
  assertWorkflowConfig();

  const endpoint = `https://api.github.com/repos/${workflowRepo}/actions/workflows/${workflowFile}/dispatches`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${workflowToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'gym-reserver-api',
      Accept: 'application/vnd.github+json',
    },
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
