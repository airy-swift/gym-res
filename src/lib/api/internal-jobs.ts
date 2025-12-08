
export async function markJobAsFailed(jobId: string, message: string) {
  const response = await fetch(`/api/internal/jobs`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jobId, status: 'failed', message }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Internal job update failed: ${response.status} ${response.statusText} ${payload}`);
  }
}
