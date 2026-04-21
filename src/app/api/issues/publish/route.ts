import { redirect } from 'next/navigation';
import { publishIssue } from '../../../../lib/issue';

export async function POST() {
  publishIssue();
  redirect('/');
}
