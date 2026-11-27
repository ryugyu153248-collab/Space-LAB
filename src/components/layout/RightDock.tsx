import { useStore, type RightTab } from '@/stores/store';
import { RightPanel as InfoPanel } from '@/components/panels/RightPanel';
import { ManeuverPanel } from '@/components/panels/ManeuverPanel';
import { ConjunctionPanel } from '@/components/panels/ConjunctionPanel';
import { EventsPanel } from '@/components/panels/EventsPanel';
import { CoveragePanel } from '@/components/panels/CoveragePanel';
import { ReportPanel } from '@/components/panels/ReportPanel';
import { TelemetryPanel } from '@/components/panels/TelemetryPanel';

const TABS: [RightTab, string][] = [['info', 'Properties'], ['telemetry', 'Telemetry'], ['maneuver', 'Maneuver'], ['conjunction', 'Conjunction'], ['events', 'Events'], ['coverage', 'Coverage'], ['report', 'Reports']];

/** Right dock: object data (Info) and the function panels (forms / tables), shown as a vertical stack. */
export function RightDock() {
  const { rightTab, setRightTab } = useStore();
  return (
    <div className="h-full flex flex-col bg-panel">
      <div className="flex shrink-0 border-b border-edge overflow-x-auto">
        {TABS.map(([k, l]) => <button key={k} className={`px-3 py-1.5 text-[11px] whitespace-nowrap border-b-2 ${rightTab === k ? 'text-accent border-accent' : 'text-slate-500 border-transparent hover:text-slate-300'}`} onClick={() => setRightTab(k)}>{l}</button>)}
      </div>
      <div className={`flex-1 min-h-0 overflow-y-auto overflow-x-auto ${rightTab === 'info' ? '' : 'stack-panel'}`}>
        {rightTab === 'info' && <InfoPanel />}
        {rightTab === 'telemetry' && <TelemetryPanel />}
        {rightTab === 'maneuver' && <ManeuverPanel />}
        {rightTab === 'conjunction' && <ConjunctionPanel />}
        {rightTab === 'events' && <EventsPanel />}
        {rightTab === 'coverage' && <CoveragePanel />}
        {rightTab === 'report' && <ReportPanel />}
      </div>
    </div>
  );
}
