import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import {
  Building2, FileText, Activity, ShieldCheck, Code2,
  Layers, Beaker, GraduationCap, BookOpen, CircleHelp, Workflow, MessageCircleQuestion,
  Scale,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import Monitor from './pages/Monitor';
import ReportDetail from './pages/ReportDetail';
import DataQuality from './pages/DataQuality';
import Genie from './pages/Genie';
import RegulatorQA from './pages/RegulatorQA';
import Archive from './pages/Archive';
import Orsa from './pages/Orsa';
import Afr from './pages/Afr';
import Sfcr from './pages/Sfcr';
import Rsr from './pages/Rsr';
import InternalControls from './pages/InternalControls';
import Architecture from './pages/Architecture';
import LifeReserving from './pages/LifeReserving';
import LifeUWRisk from './pages/LifeUWRisk';
import OverlaysRegister from './pages/OverlaysRegister';
import ActuarialLab from './pages/ActuarialLab';
import LabModelDetail from './pages/LabModelDetail';
import Today from './pages/Today';
import ReportingCycle from './pages/ReportingCycle';
import Learn from './pages/Learn';
import Whatif from './pages/Whatif';
import FeedDetail from './pages/FeedDetail';
import OrsaDraft from './pages/OrsaDraft';
import Workbench from './pages/Workbench';
import RoadmapStub from './pages/RoadmapStub';
import AgentArchitecture from './pages/AgentArchitecture';
import Governance from './pages/Governance';
import ModelDevelopment from './pages/ModelDevelopment';
import Pillar1Overview from './pages/Pillar1Overview';
import Pillar2Overview from './pages/Pillar2Overview';
import Pillar3Overview from './pages/Pillar3Overview';
import Breadcrumb from './components/Breadcrumb';
import ResetDemoButton from './components/ResetDemoButton';
import DemoModeToggle from './components/DemoModeToggle';
import WorkbenchAssistant from './components/WorkbenchAssistant';

interface NavEntry {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

interface NavSection {
  heading: string;
  entries: NavEntry[];
}

interface DoorLink {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tagline: string;
  accent: 'amber' | 'blue' | 'violet' | 'emerald';
}

const DOORS: DoorLink[] = [
  { to: '/today',           icon: Activity, label: 'Control Tower',   tagline: 'Where are we now?',         accent: 'amber' },
  { to: '/reporting-cycle', icon: Layers,   label: 'Reporting Cycle', tagline: 'Three pillars.',            accent: 'blue' },
  { to: '/governance',      icon: Scale,    label: 'Governance',      tagline: 'Audit, approvals, AI activity.', accent: 'violet' },
  { to: '/agents',          icon: MessageCircleQuestion, label: 'Workbench AI', tagline: 'Supervisor + 8 specialists.', accent: 'emerald' },
];

const NAV_SECTIONS: NavSection[] = [
  {
    heading: 'Actuarial Lab',
    entries: [
      { to: '/lab',                icon: Beaker,        label: 'Models' },
      { to: '/model-development',  icon: BookOpen,      label: 'Model Development' },
      { to: '/overlays',           icon: Layers,        label: 'Overlays Register' },
      { to: '/whatif',             icon: CircleHelp,    label: 'What-if scenarios' },
    ],
  },
  {
    heading: 'Data',
    entries: [
      { to: '/ingestion',          icon: Workflow,      label: 'Ingestion' },
      { to: '/data-quality',       icon: ShieldCheck,   label: 'Data quality' },
    ],
  },
];

function NavLink({ entry }: { entry: NavEntry }) {
  const { pathname } = useLocation();
  const active = pathname === entry.to || (entry.to !== '/' && pathname.startsWith(entry.to));
  const Icon = entry.icon;
  return (
    <Link
      to={entry.to}
      className={`flex items-center gap-2.5 pl-3 pr-3 py-1.5 text-[13px] font-medium transition-colors border-l-2 ${
        active
          ? 'border-blue-400 bg-white/[0.04] text-white'
          : 'border-transparent text-gray-400 hover:text-white hover:bg-white/[0.03]'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate flex-1">{entry.label}</span>
    </Link>
  );
}

function NavSectionHeader({ heading }: { heading: string }) {
  return (
    <div className="px-3 pt-4 pb-1.5 text-[11px] tracking-wide font-semibold text-gray-500">
      {heading}
    </div>
  );
}

function DoorRow({ door }: { door: DoorLink }) {
  const { pathname } = useLocation();
  const active = pathname.startsWith(door.to);
  const cls = {
    amber:   { dot: 'bg-amber-400',   text: active ? 'text-amber-300'   : 'text-amber-300/70' },
    blue:    { dot: 'bg-blue-400',    text: active ? 'text-blue-300'    : 'text-blue-300/70' },
    violet:  { dot: 'bg-violet-400',  text: active ? 'text-violet-300'  : 'text-violet-300/70' },
    emerald: { dot: 'bg-emerald-400', text: active ? 'text-emerald-300' : 'text-emerald-300/70' },
  }[door.accent];
  const Icon = door.icon;
  return (
    <Link to={door.to}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${
        active ? 'bg-white/10' : 'hover:bg-white/5'
      }`}>
      <div className={`w-7 h-7 rounded-md flex items-center justify-center ${cls.dot}/20`} style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
        <Icon className={`w-4 h-4 ${cls.text}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-bold leading-tight ${active ? 'text-white' : 'text-gray-200'}`}>{door.label}</div>
        <div className="text-[10px] text-gray-500 truncate">{door.tagline}</div>
      </div>
    </Link>
  );
}

function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[268px] bg-[#1e293b] text-white flex flex-col">
      {/* Brand — links back to the Workbench (top-level /) */}
      <Link to="/" className="flex items-center gap-3 px-4 py-3.5 border-b border-white/10 hover:opacity-90 transition-opacity">
        <FileText className="w-5 h-5 text-blue-400 shrink-0" />
        <div className="min-w-0">
          <h1 className="text-base font-bold tracking-tight truncate">Actuarial Workbench</h1>
          <p className="text-[10px] text-gray-400 truncate">Bricksurance SE — Composite</p>
        </div>
      </Link>

      {/* Primary doors — Workbench brand above doubles as Home */}
      <div className="px-2 pt-3 pb-1 space-y-1">
        {DOORS.map((d) => <DoorRow key={d.to} door={d} />)}
      </div>

      <div className="mx-3 mt-2 mb-1 h-px bg-white/10" />

      {/* Operational tools */}
      <nav className="flex-1 flex flex-col gap-0.5 p-2 overflow-y-auto">
        {NAV_SECTIONS.map((section) => (
          <div key={section.heading}>
            <NavSectionHeader heading={section.heading} />
            {section.entries.map((entry) => <NavLink key={entry.to} entry={entry} />)}
          </div>
        ))}
      </nav>

      {/* Learn tile — secondary, tucked at the bottom */}
      <LearnTile />

      {/* Footer */}
      <div className="border-t border-white/10 p-3 flex items-center gap-2 text-[10px] text-gray-400">
        <Building2 className="w-3 h-3 shrink-0" />
        <SignedInUser />
        <div className="ml-auto flex items-center gap-1">
          <DemoModeToggle />
          <ResetDemoButton />
          <BackstageLink />
        </div>
      </div>
    </aside>
  );
}

function LearnTile() {
  const { pathname } = useLocation();
  const active = pathname.startsWith('/learn');
  return (
    <div className="px-3 pt-2 pb-1">
      <Link
        to="/learn"
        className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md border transition-colors ${
          active
            ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200'
            : 'bg-white/[0.03] border-white/10 text-gray-400 hover:text-emerald-200 hover:border-emerald-400/30'
        }`}
      >
        <GraduationCap className="w-4 h-4 text-emerald-300/80 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold leading-tight">Learn</div>
          <div className="text-[10px] text-gray-500 truncate">How Solvency II works</div>
        </div>
      </Link>
    </div>
  );
}

function SignedInUser() {
  const [user, setUser] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/me')
      .then((r) => r.json())
      .then((d) => setUser(d.user || null))
      .catch(() => setUser(null));
  }, []);
  if (!user) return <span className="text-[10px] text-gray-500">signed out</span>;
  return (
    <span title={user} className="text-[10px] text-gray-400 truncate max-w-[140px]">
      {user}
    </span>
  );
}

function BreadcrumbStrip() {
  const location = useLocation();
  const crumbs = (location.state as { crumbs?: unknown } | null)?.crumbs;
  if (!crumbs) return null;
  return (
    <div className="max-w-7xl mx-auto px-6 pt-4 pb-0">
      <Breadcrumb />
    </div>
  );
}

function BackstageLink() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/backstage-url')
      .then((r) => r.json())
      .then((d) => { if (d.url) setUrl(d.url); })
      .catch(() => {});
  }, []);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      title="Backstage — technical deep dive notebook"
      className="p-1 rounded hover:bg-white/10 transition-colors opacity-30 hover:opacity-100">
      <Code2 className="w-4 h-4" />
    </a>
  );
}

function ScrollToHash() {
  const { hash, pathname } = useLocation();
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    // Wait a frame so the destination section is mounted before we scroll.
    const id = hash.slice(1);
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [hash, pathname]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-100 font-[system-ui]">
        <Sidebar />
        <main className="ml-[268px]">
          <ScrollToHash />
          <BreadcrumbStrip />
          <Routes>
            {/* Workbench top-level — six tiles, Solvency II is the live one */}
            <Route path="/" element={<Workbench />} />
            <Route path="/solvency-2"       element={<Navigate to="/today" replace />} />
            <Route path="/roadmap/:slug"    element={<RoadmapStub />} />

            {/* Solvency II surface — top-level routes preserved so existing links + breadcrumbs keep working */}
            <Route path="/today"            element={<Today />} />
            <Route path="/reporting-cycle"  element={<ReportingCycle />} />
            <Route path="/learn"            element={<Learn />} />

            {/* Operational tools — direct access */}
            <Route path="/ingestion" element={<Monitor initialTab="ingestion" />} />
            <Route path="/data-quality" element={<DataQuality />} />
            <Route path="/examples" element={<Navigate to="/lab" replace />} />
            <Route path="/whatif"   element={<Whatif />} />
            <Route path="/feeds/:feedName" element={<FeedDetail />} />
            <Route path="/orsa/draft" element={<OrsaDraft />} />
            <Route path="/pillar-1" element={<Pillar1Overview />} />
            <Route path="/pillar-2" element={<Pillar2Overview />} />
            <Route path="/pillar-3" element={<Pillar3Overview />} />

            {/* Pillar 1 — Capital. Pretty URLs redirect to the legacy QRT routes. */}
            <Route path="/scr"             element={<Navigate to="/report/s2501" replace />} />
            <Route path="/reserving-pnc"   element={<Navigate to="/report/s0501" replace />} />
            <Route path="/reserving-life"  element={<LifeReserving />} />
            <Route path="/nl-uw-risk"      element={<Navigate to="/report/s2606" replace />} />
            <Route path="/life-uw-risk"    element={<LifeUWRisk />} />
            <Route path="/assets"          element={<Navigate to="/report/s0602" replace />} />

            {/* Actuarial Lab */}
            <Route path="/lab"                element={<ActuarialLab />} />
            <Route path="/lab/:modelId"       element={<LabModelDetail />} />
            <Route path="/overlays"           element={<OverlaysRegister />} />
            <Route path="/adjacencies"        element={<Navigate to="/" replace />} />
            <Route path="/horizon"            element={<Navigate to="/" replace />} />

            {/* Pillar 2 — Governance */}
            <Route path="/orsa"               element={<Orsa />} />
            <Route path="/model-governance"   element={<Navigate to="/governance" replace />} />
            <Route path="/afr"                element={<Afr />} />
            <Route path="/internal-controls"  element={<InternalControls />} />

            {/* Pillar 3 — Disclosure */}
            <Route path="/archive"            element={<Archive />} />
            <Route path="/sfcr"               element={<Sfcr />} />
            <Route path="/rsr"                element={<Rsr />} />
            <Route path="/regulator-qa"       element={<RegulatorQA />} />

            {/* Architecture asset */}
            <Route path="/architecture"       element={<Architecture />} />
            <Route path="/agents"             element={<AgentArchitecture />} />
            <Route path="/governance"         element={<Governance />} />
            <Route path="/model-development"  element={<ModelDevelopment />} />

            <Route path="/report/:qrtId"      element={<ReportDetail />} />
            <Route path="/genie"              element={<Genie />} />
          </Routes>
        </main>
        <WorkbenchAssistant />
      </div>
    </BrowserRouter>
  );
}
