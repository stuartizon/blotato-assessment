export const REPLY_JOBS_QUEUE_NAME = 'reply-jobs';

// The pg-boss worker (issue 6) reads this shape off each job's data.
export interface ReplyJobQueuePayload {
  replyJobId: string;
}
