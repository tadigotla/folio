import { TopNav } from '../../components/TopNav';
import { ChatPanel } from '../../components/agent/ChatPanel';
import { todayLocal } from '../../lib/time';

export const dynamic = 'force-dynamic';

export default function ChatPage() {
  const scopeDate = todayLocal();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-16">
      <div className="pt-6">
        <TopNav />
      </div>

      <div className="mt-8 h-[70vh]">
        <ChatPanel scopeDate={scopeDate} />
      </div>
    </div>
  );
}
