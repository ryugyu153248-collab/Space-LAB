import { useState } from 'react';
import { useStore } from '@/stores/store';
import { jumpTo } from '@/engine/simulation/runtime';
import { USER_EVENT_TYPES, handlers } from '@/engine/events/EventManager';
import { EVENT_COLORS, type EventType } from '@/engine/events/EventTypes';
import { formatUtc } from '@/engine/orbital/time';
import { Chip } from '../common/ui';

const stateTone = (s: string): 'green' | 'yellow' | 'red' => (s === 'failed' ? 'red' : s === 'completed' ? 'green' : 'yellow');

export function EventsPanel() {
  const { events, eventInfo, satellites, selectedId, secondId, createEvent, updateEvent, duplicateEvent, removeEvent, setEditingEvent } = useStore();
  const t = useStore((s) => s.clock.time);
  const [type, setType] = useState<EventType>('burn');
  const name = (id: string) => satellites.find((s) => s.id === id)?.name ?? id;
  const create = () => {
    const objs = type === 'collision' || type === 'docking' ? [selectedId, secondId].filter(Boolean) as string[] : selectedId ? [selectedId] : [];
    const e = createEvent(type, t, objs);
    setEditingEvent(e.id);
  };
  const sorted = [...events].sort((a, b) => a.start - b.start);
  const timeState = (e: (typeof events)[number]) => (!e.enabled ? 'disabled' : eventInfo[e.id]?.status === 'failed' ? 'failed' : t < e.start ? 'scheduled' : e.end && t < e.end ? 'active' : 'completed');
  return (
    <div className="h-full flex flex-col text-[11px]">
      <div className="p-2 flex items-center gap-2 border-b border-edge">
        <select className="btn" value={type} onChange={(e) => setType(e.target.value as EventType)}>{USER_EVENT_TYPES.map((k) => <option key={k} value={k}>{handlers[k].label}</option>)}</select>
        <button className="btn btn-on" onClick={create}>+ Create event at sim time</button>
        <span className="text-slate-500">Eclipse, Access and Communication events are computed from geometry and shown on the timeline (not user-scheduled). Orbit-changing events recompute trajectories deterministically.</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full num"><thead className="text-slate-500 text-left sticky top-0 bg-panel"><tr><th className="px-2"></th><th>Name</th><th>Type</th><th>Start (UTC)</th><th>Objects</th><th>State</th><th>Notes</th><th></th></tr></thead>
          <tbody>{sorted.map((e) => (
            <tr key={e.id} className={`hover:bg-slate-800/50 ${e.enabled ? '' : 'opacity-50'}`}>
              <td className="px-2"><span className="inline-block w-2 h-2 rounded" style={{ background: EVENT_COLORS[e.type] }} /></td>
              <td><button className="text-accent" onClick={() => jumpTo(e.start)}>{e.name}</button></td><td>{e.type}</td><td>{formatUtc(e.start)}</td>
              <td>{e.objects.map(name).join(' → ')}</td><td><Chip level={stateTone(timeState(e))}>{timeState(e)}</Chip></td>
              <td className="text-slate-400 max-w-[320px] truncate" title={(eventInfo[e.id]?.messages ?? []).join(' · ')}>{(eventInfo[e.id]?.messages ?? []).join(' · ')}</td>
              <td className="whitespace-nowrap"><button className="btn !py-0" onClick={() => setEditingEvent(e.id)}>edit</button> <button className="btn !py-0" onClick={() => duplicateEvent(e.id)}>dup</button> <button className="btn !py-0" onClick={() => updateEvent(e.id, { enabled: !e.enabled })}>{e.enabled ? 'off' : 'on'}</button> <button className="btn !py-0" onClick={() => removeEvent(e.id)}>del</button></td>
            </tr>))}
            {!sorted.length && <tr><td colSpan={8} className="px-3 py-3 text-slate-600">No events yet.</td></tr>}
          </tbody></table>
      </div>
    </div>
  );
}
