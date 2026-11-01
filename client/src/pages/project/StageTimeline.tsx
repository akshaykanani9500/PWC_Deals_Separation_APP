/** Stage bars for the project overview. Click a bar to open that stage. */
import { useNavigate } from 'react-router-dom';
import type { ProjectDetail } from '@shared/types';
import Timeline from '../../components/Timeline';

export default function StageTimeline({ detail }: { detail: ProjectDetail }) {
  const nav = useNavigate();
  const stages = [...detail.stages].sort((a, b) => a.sort_order - b.sort_order);
  return (
    <Timeline labelWidth={150}
      items={stages.map((s, i) => ({
        id: s.stage_id, label: `${i + 1}. ${s.name}`, sublabel: `${Math.round(s.percent_complete ?? 0)}% done`,
        start: s.start_date, end: s.end_date, progress: s.percent_complete,
        tone: (s.percent_complete ?? 0) >= 100 ? 'bg-green/60' : s.stage_id === detail.project.current_stage_id ? 'bg-brand-bright/70' : 'bg-blue/50',
        onClick: () => nav(`/projects/${detail.project.project_id}/stages/${s.stage_id}`),
        ariaLabel: `Open stage ${s.name}`,
      }))} />
  );
}
