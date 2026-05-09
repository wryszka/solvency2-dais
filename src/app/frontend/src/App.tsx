import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import {
  Building2, FileText, Activity, ShieldCheck, Code2, Home,
  Layers, Beaker, Compass, Sun, GraduationCap, BookOpen,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import Landing from './pages/Landing';
import Monitor from './pages/Monitor';
import ReportsList from './pages/ReportsList';
import ReportDetail from './pages/ReportDetail';
import DataQuality from './pages/DataQuality';
import Dashboard from './pages/Dashboard';
import Genie from './pages/Genie';
import RegulatorQA from './pages/RegulatorQA';
import Archive from './pages/Archive';
import Orsa from './pages/Orsa';
import Afr from './pages/Afr';
import Sfcr from './pages/Sfcr';
import Rsr from './pages/Rsr';
import ModelGovernance from './pages/ModelGovernance';
import InternalControls from './pages/InternalControls';
import Architecture from './pages/Architecture';
import LifeReserving from './pages/LifeReserving';
import LifeUWRisk from './pages/LifeUWRisk';
import OverlaysRegister from './pages/OverlaysRegister';
import ActuarialLab from './pages/ActuarialLab';
import LabModelDetail from './pages/LabModelDetail';
import Adjacencies from './pages/Adjacencies';
import Horizon from './pages/Horizon';
import Today from './pages/Today';
import ReportingCycle from './pages/ReportingCycle';
import Learn from './pages/Learn';
import Breadcrumb from './components/Breadcrumb';
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
  accent: 'amber' | 'blue' | 'emerald';
}

const DOORS: DoorLink[] = [
  { to: '/today',           icon: Sun,           label: 'Today',           tagline: 'Where are we now?',   accent: 'amber' },
  { to: '/reporting-cycle', icon: Layers,        label: 'Reporting Cycle', tagline: 'Three pillars.',      accent: 'blue' },
  { to: '/learn',           icon: GraduationCap, label: 'Learn',           tagline: 'How it all works.',   accent: 'emerald' },
];

const NAV_SECTIONS: NavSection[] = [
  {
    heading: 'Today',
    entries: [
      { to: '/',              icon: Home,         label: 'Home' },
      { to: '/monitor',       icon: Activity,     label: 'Control Tower' },
    ],
  },
  {
    heading: 'Actuarial Lab',
    entries: [
      { to: '/lab',                icon: Beaker,        label: 'Models' },
      { to: '/overlays',           icon: Layers,        label: 'Overlays Register' },
      { to: '/examples',           icon: BookOpen,      label: 'Worked examples' },
    ],
  },
  {
    heading: 'Data',
    entries: [
      { to: '/data-quality',       icon: ShieldCheck,   label: 'Data quality' },
    ],
  },
  {
    heading: 'Workbench',
    entries: [
      { to: '/adjacencies',        icon: Compass,       label: 'Adjacencies' },
      { to: '/horizon',            icon: FileText,      label: 'Workbench horizon' },
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
      {/* Brand */}
      <Link to="/" className="flex items-center gap-3 px-4 py-3.5 border-b border-white/10 hover:opacity-90 transition-opacity">
        <FileText className="w-5 h-5 text-blue-400 shrink-0" />
        <div className="min-w-0">
          <h1 className="text-base font-bold tracking-tight truncate">Solvency II</h1>
          <p className="text-[10px] text-gray-400 truncate">Bricksurance SE — Composite</p>
        </div>
      </Link>

      {/* Three doors — primary navigation */}
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

      {/* Footer */}
      <div className="border-t border-white/10 p-3 flex items-center gap-2 text-[10px] text-gray-400">
        <Building2 className="w-3 h-3 shrink-0" />
        <SignedInUser />
        <div className="ml-auto flex items-center gap-1">
          <DemoModeToggle />
          <BackstageLink />
        </div>
      </div>
    </aside>
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

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-100 font-[system-ui]">
        <Sidebar />
        <main className="ml-[268px]">
          <BreadcrumbStrip />
          <Routes>
            {/* Doors — primary entry points */}
            <Route path="/" element={<Landing />} />
            <Route path="/today"            element={<Today />} />
            <Route path="/reporting-cycle"  element={<ReportingCycle />} />
            <Route path="/learn"            element={<Learn />} />

            {/* Operational tools — direct access */}
            <Route path="/monitor" element={<Monitor />} />
            <Route path="/data-quality" element={<DataQuality />} />
            <Route path="/examples" element={<Navigate to="/lab" replace />} />

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
            <Route path="/adjacencies"        element={<Adjacencies />} />
            <Route path="/horizon"            element={<Horizon />} />

            {/* Pillar 2 — Governance */}
            <Route path="/orsa"               element={<Orsa />} />
            <Route path="/model-governance"   element={<ModelGovernance />} />
            <Route path="/afr"                element={<Afr />} />
            <Route path="/internal-controls"  element={<InternalControls />} />

            {/* Pillar 3 — Disclosure */}
            <Route path="/archive"            element={<Archive />} />
            <Route path="/sfcr"               element={<Sfcr />} />
            <Route path="/rsr"                element={<Rsr />} />
            <Route path="/regulator-qa"       element={<RegulatorQA />} />

            {/* Architecture asset */}
            <Route path="/architecture"       element={<Architecture />} />

            {/* Other / legacy */}
            <Route path="/reports"            element={<ReportsList />} />
            <Route path="/dashboard"          element={<Dashboard />} />
            <Route path="/report/:qrtId"      element={<ReportDetail />} />
            <Route path="/genie"              element={<Genie />} />
          </Routes>
        </main>
        <WorkbenchAssistant />
      </div>
    </BrowserRouter>
  );
}
