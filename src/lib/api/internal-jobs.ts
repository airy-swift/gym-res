
import { patchFirestoreRestDocument } from '@/lib/firebase/firestore-rest';

export async function markJobAsFailed(jobId: string, message: string) {
  await patchFirestoreRestDocument('jobs/' + jobId, {
    status: 'failed',
    message,
    updatedAt: new Date(),
  }, ['status', 'message', 'updatedAt', 'userId', 'password']);
}
