import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import {
  Building2, FileText, BarChart3, Activity, ShieldCheck, Bot, Code2, Home,
  Archive as ArchiveIcon, Shield, Landmark, Flame, FlaskConical,
  Scale, Workflow, BookOpen, Lock, Newspaper, ScrollText,
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
import PillarChip, { type Pillar } from './components/PillarChip';
import DemoModeToggle from './components/DemoModeToggle';

interface NavEntry {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  pillar: Pillar;
}

interface NavSection {
  heading: string;
  pillar: Pillar;
  entries: NavEntry[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    heading: 'Control',
    pillar: 'cross',
    entries: [
      { to: '/',              icon: Home,         label: 'Home',          pillar: 'cross' },
      { to: '/monitor',       icon: Activity,     label: 'Control Tower', pillar: 'cross' },
      { to: '/data-quality',  icon: ShieldCheck,  label: 'Data Quality',  pillar: 'cross' },
    ],
  },
  {
    heading: 'Pillar 1 — Capital',
    pillar: 1,
    entries: [
      { to: '/scr',                icon: Shield,        label: 'SCR & Standard Formula',     pillar: 1 },
      { to: '/reserving-pnc',      icon: BarChart3,     label: 'Reserving & TPs (P&C)',      pillar: 1 },
      { to: '/reserving-life',     icon: BookOpen,      label: 'Reserving & TPs (Life)',     pillar: 1 },
      { to: '/nl-uw-risk',         icon: Flame,         label: 'Non-Life UW Risk',           pillar: 1 },
      { to: '/life-uw-risk',       icon: FlaskConical,  label: 'Life UW Risk',               pillar: 1 },
      { to: '/assets',             icon: Landmark,      label: 'Asset Register',             pillar: 1 },
    ],
  },
  {
    heading: 'Pillar 2 — Governance',
    pillar: 2,
    entries: [
      { to: '/orsa',               icon: Workflow,      label: 'ORSA',                       pillar: 2 },
      { to: '/model-governance',   icon: Scale,         label: 'Model Governance',           pillar: 2 },
      { to: '/afr',                icon: ScrollText,    label: 'Actuarial Function',         pillar: 2 },
      { to: '/internal-controls',  icon: Lock,          label: 'Internal Controls',          pillar: 2 },
    ],
  },
  {
    heading: 'Pillar 3 — Disclosure',
    pillar: 3,
    entries: [
      { to: '/archive',            icon: ArchiveIcon,   label: 'QRT Submission Pack',        pillar: 3 },
      { to: '/sfcr',               icon: Newspaper,     label: 'SFCR (Public)',              pillar: 3 },
      { to: '/rsr',                icon: FileText,      label: 'RSR (Supervisor)',           pillar: 3 },
      { to: '/regulator-qa',       icon: Bot,           label: 'Regulator Q&A',              pillar: 3 },
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
      className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors ${
        active ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate flex-1">{entry.label}</span>
      <PillarChip pillar={entry.pillar} size="sm" />
    </Link>
  );
}

function NavSectionHeader({ section }: { section: NavSection }) {
  // Section heading text uses the pillar colour at full saturation; the
  // following bar uses the same colour at lower opacity so the relationship
  // is unmistakeable. Cross-pillar uses slate.
  const colorVar = section.pillar === 'cross'
    ? 'var(--color-cross-border)'
    : `var(--color-pillar-${section.pillar}-border)`;
  return (
    <div className="px-3 pt-4 pb-1.5 text-[10px] uppercase tracking-wider font-semibold flex items-center gap-2"
         style={{ color: colorVar }}>
      <span>{section.heading}</span>
      <span className="flex-1 h-px" style={{ background: colorVar, opacity: 0.5 }} />
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 bottom-0 w-60 bg-[#1e293b] text-white flex flex-col">
      {/* Brand */}
      <Link to="/" className="flex items-center gap-3 px-4 py-4 border-b border-white/10 hover:opacity-90 transition-opacity">
        <FileText className="w-6 h-6 text-blue-400 shrink-0" />
        <div className="min-w-0">
          <h1 className="text-base font-bold tracking-tight truncate">Solvency II</h1>
          <p className="text-[10px] text-gray-400 truncate">Composite — Reporting & Governance</p>
        </div>
      </Link>

      {/* Sections */}
      <nav className="flex-1 flex flex-col gap-0.5 p-2 overflow-y-auto">
        {NAV_SECTIONS.map((section) => (
          <div key={section.heading}>
            <NavSectionHeader section={section} />
            {section.entries.map((entry) => <NavLink key={entry.to} entry={entry} />)}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 p-3 space-y-2 text-xs text-gray-400">
        <div className="flex items-center gap-2 min-w-0">
          <Building2 className="w-3.5 h-3.5 shrink-0" />
          <span className="font-medium text-gray-300 truncate">Bricksurance SE — Composite</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <SignedInUser />
          <div className="flex items-center gap-1.5">
            <DemoModeToggle />
            <BackstageLink />
          </div>
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
        <main className="ml-60">
          <Routes>
            {/* Control */}
            <Route path="/" element={<Landing />} />
            <Route path="/monitor" element={<Monitor />} />
            <Route path="/data-quality" element={<DataQuality />} />

            {/* Pillar 1 — Capital. Pretty URLs redirect to the legacy QRT routes. */}
            <Route path="/scr"             element={<Navigate to="/report/s2501" replace />} />
            <Route path="/reserving-pnc"   element={<Navigate to="/report/s0501" replace />} />
            <Route path="/reserving-life"  element={<LifeReserving />} />
            <Route path="/nl-uw-risk"      element={<Navigate to="/report/s2606" replace />} />
            <Route path="/life-uw-risk"    element={<LifeUWRisk />} />
            <Route path="/assets"          element={<Navigate to="/report/s0602" replace />} />

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
      </div>
    </BrowserRouter>
  );
}
