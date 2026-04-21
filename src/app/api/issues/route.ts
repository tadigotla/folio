import {
  createDraftIssue,
  DraftAlreadyExistsError,
} from '../../../lib/issues';

export async function POST() {
  try {
    const issue = createDraftIssue();
    return Response.json({ id: issue.id }, { status: 201 });
  } catch (err) {
    if (err instanceof DraftAlreadyExistsError) {
      return Response.json(
        { error: 'draft_exists', draft_id: err.draftId },
        { status: 409 },
      );
    }
    throw err;
  }
}
