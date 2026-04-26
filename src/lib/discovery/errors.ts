export class CandidateNotFoundError extends Error {
  candidateId: number;
  constructor(candidateId: number) {
    super(`discovery candidate not found: ${candidateId}`);
    this.name = 'CandidateNotFoundError';
    this.candidateId = candidateId;
  }
}

export class RejectionNotFoundError extends Error {
  targetId: string;
  constructor(targetId: string) {
    super(`discovery rejection not found: ${targetId}`);
    this.name = 'RejectionNotFoundError';
    this.targetId = targetId;
  }
}
